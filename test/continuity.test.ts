import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { returnPlan, JOURNAL_LIMIT } from '../src/continuity';
import { writeSave } from '../src/save/write';
import { resolveTasks } from '../src/scenarios';
import { instruction } from '../generate-tasks';
import { seatInGame, journalConfig, stopSeatProcesses } from '../docker/seats/launch';
import { validProbeResult } from '../docker/seats/mcp-probe';
import { imageIdentity } from '../tools/image-identity';
import { createHash } from 'node:crypto';
import { captureCheckpoint } from '../engine/src/Checkpoint';

test('returning seat readiness requires fresh login state, not a settings-change event', async () => {
    for (const [state, expected] of [[{ inGame: true, stateAge: 90 }, true], [{ inGame: true, stateAge: 6000 }, false], [{ inGame: false, stateAge: 0 }, false], [{ inGame: true, stateAge: null }, false]] as const) {
        expect(await seatInGame('agent', async () => ({ ok: true, json: async () => state }))).toBe(expected);
    }
    expect(await seatInGame('agent', async () => { throw new Error('gateway booting'); })).toBe(false);
});

test('fresh-context return retains exact saves and only each players own journal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-return-'));
    try {
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runId: '12345678-1234-1234-1234-123456789012', conditions: { exploratory: true }, seats: [{ username: 'agent' }, { username: 'partner01' }] }));
        mkdirSync(join(dir, 'saves'));
        const saved = writeSave({ position: { x: 3252, z: 3420 }, bank: [{ id: 2351, count: 4 }] });
        for (const name of ['agent', 'partner01']) {
            mkdirSync(join(dir, 'seats', name, 'notes'), { recursive: true });
            writeFileSync(join(dir, 'saves', `end.${name}.sav`), saved);
            writeFileSync(join(dir, 'seats', name, 'notes/JOURNAL.md'), `${name}: my mistaken belief`);
            writeFileSync(join(dir, 'seats', name, 'notes/other.md'), 'Never restore arbitrary files');
        }
        const plan = returnPlan(dir);
        expect(plan.saves.agent!.equals(saved)).toBe(true);
        expect(plan.scenario.roles[0]!.initialJournal).toBe('agent: my mistaken belief');
        expect(plan.scenario.roles[1]!.initialJournal).toBe('partner01: my mistaken belief');
        expect(JSON.stringify(plan)).not.toContain('Never restore arbitrary files');
        expect(plan.lineage.freshModelContext).toBe(true);
        const task = resolveTasks([plan.scenario])[0]!;
        expect(instruction(task)).not.toContain('20 minutes');
        expect(instruction(task)).toContain('may be incomplete or mistaken');
        const own = join(dir, 'seats/agent/notes/JOURNAL.md');
        writeFileSync(join(dir, 'journal-integrity.json'), JSON.stringify(Object.fromEntries(['agent', 'partner01'].map(name => [`seats/${name}/notes/JOURNAL.md`, createHash('sha256').update(`${name}: my mistaken belief`).digest('hex')]))));
        writeFileSync(own, 'This memory was changed by a redactor.');
        expect(() => returnPlan(dir)).toThrow('after redaction');
        writeFileSync(own, 'agent: my mistaken belief');
        writeFileSync(join(dir, 'seats/agent/memory-phase.json'), JSON.stringify({ valid: false }));
        expect(() => returnPlan(dir)).toThrow('invalid or stale');
        rmSync(join(dir, 'seats/agent/memory-phase.json'));
        writeFileSync(join(dir, 'continuity.json'), '{}');
        expect(() => returnPlan(dir)).toThrow('memory checkpoint missing');
        rmSync(join(dir, 'continuity.json'));
        rmSync(join(dir, 'journal-integrity.json'));
        writeFileSync(join(dir, 'seats/agent/notes/JOURNAL.md'), 'x'.repeat(JOURNAL_LIMIT + 1));
        expect(() => returnPlan(dir)).toThrow('no automatic truncation');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing journals cannot silently import transcripts from arbitrary runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-return-missing-'));
    try {
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runId: '12345678-1234-1234-1234-123456789012', conditions: { exploratory: true }, seats: [{ username: 'agent' }, { username: 'partner01' }] }));
        mkdirSync(join(dir, 'saves'));
        writeFileSync(join(dir, 'saves/end.agent.sav'), writeSave({ position: { x: 3222, z: 3218 } }));
        expect(() => returnPlan(dir)).toThrow('cannot silently substitute');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('memory-only configuration removes gameplay and shell access', () => {
    const config = journalConfig('agent', { model: 'test/model', provider: {} });
    expect(config.mcp['rs-agent'].enabled).toBe(false);
    expect(config.permission['journal_*']).toBe('allow');
    expect(config.permission['*']).toBe('deny');
});

test('grouped engine checkpoint serializes a single tick and rejects incomplete rosters', () => {
    const bytes = writeSave({ position: { x: 3222, z: 3218 }, inventory: [{ id: 995, count: 7 }] });
    const world = { currentTick: 42, players: [{ username: 'agent', save: () => bytes }] };
    const snapshot = captureCheckpoint(world, ['agent']);
    expect(snapshot.tick).toBe(42);
    expect(snapshot.players[0]!.data).toEqual(new Uint8Array(bytes));
    expect(snapshot.players[0]!.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(() => captureCheckpoint(world, ['agent', 'partner01'])).toThrow('missing');
    expect(() => captureCheckpoint(world, ['../escape'])).toThrow('Invalid');
});

test('checkpoint recovers temporary items through native interface closure and refuses loss', () => {
    let offered: any = { id: 2351, count: 2 }, held: any = null;
    const player = { username: 'agent', invs: new Map([[93, { capacity: 1, get: () => held }], [100, { capacity: 1, get: () => offered }]]),
        closeModal() { held = offered; offered = null; }, save: () => writeSave({ position: { x: 3222, z: 3218 }, inventory: held ? [held] : [] }) };
    const checkpoint = captureCheckpoint({ players: [player], currentTick: 1 }, ['agent'], id => id === 100);
    expect(checkpoint.recoveredTemporaryItems).toBe(2);
    expect(offered).toBeNull();
    offered = { id: 2351, count: 2 }; held = null;
    player.closeModal = () => { offered = null; };
    expect(() => captureCheckpoint({ players: [player], currentTick: 1 }, ['agent'], id => id === 100)).toThrow('changed item totals');
});

test('seat cleanup escalates TERM-resistant processes and waits for non-running status', async () => {
    const commands: string[][] = []; let alive = true;
    await stopSeatProcesses('seat1', ((cmd: string[]) => {
        commands.push(cmd); if (cmd.includes('-KILL')) alive = false;
        return { stdout: Buffer.from(cmd[0] === 'ps' && alive ? 'S' : ''), exitCode: 0 };
    }) as any);
    expect(commands.some(cmd => cmd.includes('-KILL'))).toBe(true);
    expect(commands.filter(cmd => cmd[0] === 'ps')).toHaveLength(2);
});

test('MCP readiness requires a real position, not merely a marker string', () => {
    const response = (position: any) => ({ content: [{ type: 'text', text: '── Result ──\n' + JSON.stringify({ qbReadiness: true, position }) + '\n── World State ──\n...' }] });
    expect(validProbeResult(response(null))).toBe(false);
    expect(validProbeResult(response({ x: 3222, z: 3218, level: 0 }))).toBe(true);
    expect(validProbeResult(response({ x: 3222, z: 3218, level: 9 }))).toBe(false);
});

test('image identity matches the requested repository rather than the first digest', () => {
    const inspected = { Id: 'sha256:' + 'c'.repeat(64), RepoDigests: ['other/repo@sha256:' + 'a'.repeat(64), 'ghcr.io/owner/questbench@sha256:' + 'b'.repeat(64)] };
    expect(imageIdentity('ghcr.io/owner/questbench:latest', inspected)).toEqual({ digest: 'sha256:' + 'b'.repeat(64), kind: 'registry-manifest' });
    expect(imageIdentity('questbench:local', inspected)).toEqual({ digest: inspected.Id, kind: 'base-image-config' });
});

test('first-run bootstrap preserves each players own authored source verbatim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-bootstrap-'));
    try {
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runId: '8e888600-aef8-4593-81e3-8adbe9cfaa2c', conditions: { exploratory: true }, seats: [{ username: 'agent' }, { username: 'partner01' }] }));
        mkdirSync(join(dir, 'saves'));
        for (const name of ['agent', 'partner01']) {
            mkdirSync(join(dir, 'seats', name), { recursive: true });
            writeFileSync(join(dir, 'saves', `end.${name}.sav`), writeSave({ position: { x: 3222, z: 3218 } }));
            writeFileSync(join(dir, 'seats', name, 'opencode.txt'), name === 'agent'
                ? JSON.stringify({ type: 'tool_use', part: { tool: 'write', state: { status: 'completed', input: { filePath: '/seats/agent/SESSION_NOTES.md', content: 'My inaccurate notes.\nUncorrected.' } } } })
                : JSON.stringify({ type: 'text', part: { type: 'text', text: 'My own final summary.' } }));
        }
        const plan = returnPlan(dir);
        expect(plan.scenario.roles[0]!.initialJournal).toBe('My inaccurate notes.\nUncorrected.');
        expect(plan.scenario.roles[1]!.initialJournal).toBe('My own final summary.');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
