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
