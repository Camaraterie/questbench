import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { returnPlan, JOURNAL_LIMIT } from '../src/continuity';
import { writeSave } from '../src/save/write';
import { resolveTasks } from '../src/scenarios';
import { instruction } from '../generate-tasks';
import { seatInGame } from '../docker/seats/launch';

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
