import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonl, parseTrajectory, partnerProgress, chatFromOutput } from '../studio/parse';

describe('studio parse', () => {
    test('trajectory: thoughts, tool calls with chat, errors, costs, notes', () => {
        const lines = [
            JSON.stringify({ type: 'text', timestamp: 1000, part: { text: 'pinging partner' } }),
            JSON.stringify({ type: 'tool_use', timestamp: 2000, part: { tool: 'rs-agent_execute_code', state: { status: 'completed', input: { code: 'sdk.dm()' }, output: '── Result ──\n{"type": 6, "text": "meet at bank", "sender": "Partner01", "tick": 1, "fromSelf": true}\n── World State ──\nTick 1', time: { start: 1, end: 1001 } } } }),
            JSON.stringify({ type: 'tool_use', timestamp: 3000, part: { tool: 'rs-agent_execute_code', state: { status: 'error', input: { code: 'wait()' }, error: 'MCP error -32001' } } }),
            JSON.stringify({ type: 'step_finish', timestamp: 3000, part: { tokens: { input: 5, output: 2 }, cost: 0.01 } }),
            'null', '[glm53-loop] Elapsed: 600s',
        ].join('\n');
        const s = parseTrajectory(lines);
        expect(s.map(x => x.kind)).toEqual(['thought', 'tool', 'tool', 'cost', 'note', 'note']);
        const tool = s[1] as any;
        expect(tool.chat).toEqual(['→ PM to Partner01: meet at bank']);
        expect(tool.output).not.toContain('World State');
        expect(tool.secs).toBe(1);
        expect((s[2] as any).status).toBe('error');
        expect(s[1]!.t).toBe(1);
    });
    test('reasoning traces merge into the timeline by timestamp', () => {
        const lines = [
            JSON.stringify({ type: 'text', timestamp: 1000, part: { text: 'first' } }),
            JSON.stringify({ type: 'tool_use', timestamp: 5000, part: { tool: 'rs-agent_execute_code', state: { status: 'completed', input: { code: 'x' } } } }),
        ].join('\n');
        const s = parseTrajectory(lines, [{ at: 9000, text: 'after everything' }, { at: 3000, end: 4500, text: 'plan the trade' }]);
        expect(s.map(x => x.kind)).toEqual(['thought', 'reasoning', 'tool', 'reasoning']);
        expect(s[1]).toMatchObject({ text: 'plan the trade', t: 2, secs: 1.5 });
        expect(s[3]).toMatchObject({ text: 'after everything', t: 8 });
    });
    test('bad escapes in chat-shaped output do not throw', () => {
        expect(chatFromOutput('{"type": 3, "text": "a \\q b", "sender": "x", "fromSelf": false}')).toEqual([]);
    });
    test('partner progress', () => {
        expect(partnerProgress([{ event: 'start' }, { event: 'heard' }, { event: 'reply' }, { event: 'committed' }, { event: 'arrived' }, { event: 'trade_result', success: true }]))
            .toEqual({ reached: ['start', 'heard', 'reply', 'committed', 'arrived', 'trade_result'], traded: true, drifted: false });
        expect(partnerProgress([{ event: 'start' }, { event: 'trade_result', success: false }, { event: 'drifted' }]).drifted).toBe(true);
    });
});

describe('studio server (mock container)', () => {
    test('live snapshot reads the mock filesystem', async () => {
        const mock = mkdtempSync(join(tmpdir(), 'qbs-'));
        for (const d of ['logs/agent', 'logs/partners', 'logs/tracking']) mkdirSync(join(mock, d), { recursive: true });
        writeFileSync(join(mock, 'logs/agent/opencode-glm53.txt'), JSON.stringify({ type: 'text', timestamp: 1, part: { text: 'hello' } }));
        writeFileSync(join(mock, 'logs/partners/partner01.lite.log'), "[lite-runner] 'partner01' logged into localhost:8888");
        writeFileSync(join(mock, 'logs/partners/partner01.jsonl'), '{"event":"start"}\n');
        writeFileSync(join(mock, 'logs/agent/reasoning.jsonl'), JSON.stringify({ at: 2, text: 'thinking it over' }) + '\n');
        process.env.QB_STUDIO_MOCK = mock;
        const { handle } = await import(`../studio/server.ts?${Date.now()}`);
        const live = await (await handle(new Request('http://x/api/live'))).json();
        expect(live).toMatchObject({ live: true, partnerLoggedIn: true, partnerError: null });
        expect(live.steps.map((x: any) => x.kind)).toEqual(['thought', 'reasoning']);
        expect(live.steps[1]).toMatchObject({ text: 'thinking it over' });
        expect((await handle(new Request('http://x/'))).status).toBe(200);
        expect((await handle(new Request('http://x/api/runs/nope'))).status).toBe(404);
        delete process.env.QB_STUDIO_MOCK;
    });
});

describe('studio server (mock two-seat container)', () => {
    test('live snapshot has one lane per seat, with reasoning merged in', async () => {
        const mock = mkdtempSync(join(tmpdir(), 'qbs2-'));
        for (const d of ['logs/seats/agent', 'logs/seats/partner01', 'logs/tracking']) mkdirSync(join(mock, d), { recursive: true });
        writeFileSync(join(mock, 'logs/seats/seats.json'), JSON.stringify([{ username: 'agent', user: 'seat1' }, { username: 'partner01', user: 'seat2' }]));
        writeFileSync(join(mock, 'logs/seats/agent/opencode.txt'), JSON.stringify({ type: 'text', timestamp: 5, part: { text: 'offer 250' } }));
        writeFileSync(join(mock, 'logs/seats/agent/reasoning.jsonl'), JSON.stringify({ at: 1, text: 'start low' }) + '\n');
        writeFileSync(join(mock, 'logs/seats/partner01/opencode.txt'), JSON.stringify({ type: 'text', timestamp: 7, part: { text: 'counter 320' } }));
        writeFileSync(join(mock, 'logs/seats/partner01.lite.log'), "[lite-runner] 'partner01' logged into localhost:8888");
        process.env.QB_STUDIO_MOCK = mock;
        const { handle } = await import(`../studio/server.ts?seats${Date.now()}`);
        const live = await (await handle(new Request('http://x/api/live'))).json();
        expect(live.seats.map((x: any) => x.username)).toEqual(['agent', 'partner01']);
        expect(live.seats[0].steps.map((x: any) => x.kind)).toEqual(['reasoning', 'thought']);
        expect(live.seats[1].steps[0]).toMatchObject({ kind: 'thought', text: 'counter 320' });
        expect(live.partnerLoggedIn).toBe(true);
        delete process.env.QB_STUDIO_MOCK;
    });
});

describe('dump-reasoning', () => {
    const script = new URL('../docker/dump-reasoning.ts', import.meta.url).pathname;
    test('prints reasoning parts from an OpenCode database, oldest first, and ignores other parts', () => {
        const dir = mkdtempSync(join(tmpdir(), 'qbr-'));
        const db = new Database(join(dir, 'opencode.db'));
        db.run('create table part (id text, message_id text, session_id text, time_created integer, time_updated integer, data text)');
        const add = (id: string, t: number, data: object) => db.run('insert into part values (?, ?, ?, ?, ?, ?)', [id, 'm', 's1', t, t, JSON.stringify(data)]);
        add('b', 20, { type: 'reasoning', text: 'second', time: { start: 20, end: 25 } });
        add('a', 10, { type: 'reasoning', text: 'first', time: { start: 10, end: 12 } });
        add('c', 15, { type: 'text', text: 'not reasoning' });
        add('d', 30, { type: 'reasoning', text: '   ' });
        db.close();
        const r = Bun.spawnSync([process.execPath, script, join(dir, 'opencode.db')], { stdout: 'pipe' });
        expect(parseJsonl(r.stdout.toString())).toEqual([{ at: 10, end: 12, session: 's1', text: 'first' }, { at: 20, end: 25, session: 's1', text: 'second' }]);
    });
    test('refuses symlinks and missing files without failing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'qbr-'));
        symlinkSync('/etc/hostname', join(dir, 'link.db'));
        for (const p of [join(dir, 'link.db'), join(dir, 'missing.db')]) {
            const r = Bun.spawnSync([process.execPath, script, p], { stdout: 'pipe' });
            expect(r.exitCode).toBe(0);
            expect(r.stdout.toString()).toBe('');
        }
    });
});

describe('studio live operations', () => {
    test('slow snapshots and screenshots stay shared until settling, then cache for 1.5s', async () => {
        const { spyOn } = await import('bun:test');
        const originalMock = process.env.QB_STUDIO_MOCK;
        delete process.env.QB_STUDIO_MOCK;
        let now = 10_000;
        const clock = spyOn(Date, 'now').mockImplementation(() => now);
        const pending: Array<() => void> = [];
        const calls: string[][] = [];
        const spawn = spyOn(Bun, 'spawn').mockImplementation(((cmd: string[]) => {
            calls.push(cmd);
            const listing = cmd[1] === 'ps';
            const shot = cmd.includes('ffmpeg');
            const text = listing ? 'a0-rendezvous-test\n' : shot ? 'x'.repeat(101) : '';
            return { stdout: new ReadableStream({ start(c) {
                const finish = () => { c.enqueue(new TextEncoder().encode(text)); c.close(); };
                if (listing) finish(); else pending.push(finish);
            } }), exited: Promise.resolve(0) };
        }) as any);
        try {
            const { liveSnapshot, handle } = await import(`../studio/server.ts?cache=${now}`);
            const first = liveSnapshot();
            await Bun.sleep(0);
            now += 2000;
            expect(liveSnapshot()).toBe(first);
            expect(calls).toHaveLength(3); // ps + files + reasoning
            pending.splice(0).forEach(f => f());
            await first;
            now += 1499;
            expect(liveSnapshot()).toBe(first);
            now += 2;
            const second = liveSnapshot();
            expect(second).not.toBe(first);
            await Bun.sleep(0);
            pending.splice(0).forEach(f => f());
            await second;

            const shot = () => handle(new Request('http://x/api/live/screen.jpg'));
            const a = shot();
            await Bun.sleep(0);
            now += 2000;
            const b = shot();
            expect(calls.filter(c => c.includes('ffmpeg'))).toHaveLength(1);
            pending.splice(0).forEach(f => f());
            expect((await a).status).toBe(200);
            expect((await b).status).toBe(200);
            now += 1499;
            await shot();
            expect(calls.filter(c => c.includes('ffmpeg'))).toHaveLength(1);
            now += 2;
            const c = shot();
            await Bun.sleep(0);
            expect(calls.filter(c => c.includes('ffmpeg'))).toHaveLength(2);
            pending.splice(0).forEach(f => f());
            await c;
        } finally {
            spawn.mockRestore(); clock.mockRestore();
            if (originalMock === undefined) delete process.env.QB_STUDIO_MOCK; else process.env.QB_STUDIO_MOCK = originalMock;
        }
    });

    test('Stop signals only Harbor children of the active launch, and does nothing when inactive', async () => {
        const { spyOn } = await import('bun:test');
        const wrapper = { pid: 42000, exitCode: null as number | null, stdout: new ReadableStream({ start(c) { c.close(); } }), stderr: new ReadableStream({ start(c) { c.close(); } }) };
        const signals: Array<[number, string | number | undefined]> = [];
        const kill = spyOn(process, 'kill').mockImplementation((pid, signal) => { signals.push([pid, signal]); return true; });
        const calls: string[][] = [];
        const spawn = spyOn(Bun, 'spawn').mockImplementation(((cmd: string[]) => {
            calls.push(cmd);
            if (cmd[0] === 'bash') return wrapper;
            const text = '42001 42000 /venv/bin/python /venv/bin/harbor run -p tasks/one\n' +
                '42002 99999 /venv/bin/harbor run -p tasks/other\n42003 42000 bun tools/publish-run.ts\n';
            return { stdout: new Blob([text]).stream(), exited: Promise.resolve(0) };
        }) as any);
        try {
            const { handle } = await import(`../studio/server.ts?stop=${Date.now()}`);
            const stop = () => handle(new Request('http://x/api/launch/stop', { method: 'POST' }));
            await stop();
            expect(calls).toHaveLength(0);
            expect(signals).toHaveLength(0);
            await handle(new Request('http://x/api/launch', { method: 'POST', body: '{}' }));
            await stop();
            expect(signals).toEqual([[42001, 'SIGINT']]);
            wrapper.exitCode = 0;
            const count = calls.length;
            await stop();
            expect(calls).toHaveLength(count);
            expect(signals).toHaveLength(1);
        } finally { spawn.mockRestore(); kill.mockRestore(); }
    });
});
