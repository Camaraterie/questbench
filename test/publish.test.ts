import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventChain } from '../src/events/chain';
import { writeSave } from '../src/save/write';
import { publishBundles } from '../tools/publish-run';
import { collect, reportKey } from '../tools/file-reports';

function bundle(root: string, id: string, opts: { reports?: string[]; success?: boolean } = {}) {
    const b = join(root, `run-${id}`);
    mkdirSync(join(b, 'saves'), { recursive: true });
    writeFileSync(join(b, 'manifest.json'), JSON.stringify({
        schema: 'questbench.run/v0', runId: id, task: { slug: 'a0-rendezvous-punctual-bare-15m', harborDigest: 'sha256:' + 'a'.repeat(64) },
        image: { ref: 'x', digest: 'sha256:' + 'b'.repeat(64) }, rsSdkCommit: 'c', seed: 0, tickRateMs: 50,
        model: { id: 'zai-coding-plan/glm-5.3', provider: 'zai', harness: 'qb-glm53-opencode' }, startedAt: '2026-10-27T20:00:00Z', endedAt: '', contributor: { handle: 'cam', licence: 'CC-BY-4.0' },
    }));
    const c = new EventChain();
    c.append({ tick: 1, ts: 't', kind: 'chat_private', actors: ['agent', 'partner01'], data: { text: 'meet at varrock west bank in 3 min' } });
    writeFileSync(join(b, 'events.jsonl'), c.lines.join('\n'));
    const s = writeSave({ position: { x: 1, z: 1 } });
    writeFileSync(join(b, 'saves', 'start.agent.sav'), s); writeFileSync(join(b, 'saves', 'end.agent.sav'), s);
    writeFileSync(join(b, 'verdict.json'), JSON.stringify({ fairTradeCompleted: !!opts.success, reward: opts.success ? 1 : 0.5 }));
    if (opts.reports) writeFileSync(join(b, 'reports.jsonl'), opts.reports.map(t => JSON.stringify({ ts: 't', by: 'agent', task: 'a0', text: t })).join('\n'));
    return b;
}

describe('publish-run', () => {
    test('copies bundles into runs/<date>/<task>/<id>, writes index, skips already-published', () => {
        const root = mkdtempSync(join(tmpdir(), 'qbp-')), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
        mkdirSync(bundles); mkdirSync(runs);
        bundle(bundles, 'r1', { success: true, reports: ['walkTo lies at gate (3108, 3353)'] });
        bundle(bundles, 'r2');
        const first = publishBundles(bundles, runs);
        expect(first).toHaveLength(2);
        expect(existsSync(join(runs, 'runs/2026-10-27/a0-rendezvous-punctual-bare-15m/r1/events.jsonl'))).toBe(true);
        const idx = JSON.parse(readFileSync(join(runs, 'runs/index.json'), 'utf8'));
        expect(idx.runs).toHaveLength(2);
        const r1 = idx.runs.find((r: any) => r.runId === 'r1');
        expect(r1).toMatchObject({ success: true, model: 'zai-coding-plan/glm-5.3', family: 'a0-rendezvous', reports: 1, tier: 'submitted' });
        expect(r1.metrics.initiative).toBe('agent');
        expect(publishBundles(bundles, runs)).toHaveLength(0);
        expect(existsSync(join(runs, 'runs/2026-10-27/a0-rendezvous-punctual-bare-15m/r1/PUBLISHED'))).toBe(false);
    });
});

describe('file-reports', () => {
    test('same complaint with different numbers groups together', () => {
        expect(reportKey('walkTo lies at gate (3108, 3353) after 12 tries')).toBe(reportKey('walkTo lies at gate (3200,3400) after 3 tries'));
        expect(reportKey('walkTo lies')).not.toBe(reportKey('trade window never opens'));
    });
    test('collects reports across bundles', () => {
        const root = mkdtempSync(join(tmpdir(), 'qbr-'));
        bundle(root, 'a', { reports: ['trade window never opens (tick 40)'] });
        bundle(root, 'b', { reports: ['trade window never opens (tick 900)', 'pathfinder stuck at 3222,3218'] });
        const g = collect(root);
        expect(g).toHaveLength(2);
        expect(g.find(x => x.title.includes('trade window'))!.reports).toHaveLength(2);
    });
});

describe('report tool', () => {
    test('writes a jsonl line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'qbrep-'));
        const r = Bun.spawnSync(['bun', 'aids/report.ts', 'gate', 'stays', 'closed'], { env: { ...process.env, QB_REPORT_DIR: dir, QB_TASK: 't1' } });
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(readFileSync(join(dir, 'reports.jsonl'), 'utf8'))).toMatchObject({ text: 'gate stays closed', task: 't1' });
    });
});
