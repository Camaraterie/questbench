import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventChain } from '../src/events/chain';
import { writeSave } from '../src/save/write';
import { publishBundles } from '../tools/publish-run';
import { collect, reportKey } from '../tools/file-reports';

const temporaryDirs: string[] = [];
function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'qbp-'));
    temporaryDirs.push(dir);
    return dir;
}
afterEach(() => { for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fakeCli(root: string, name: string, source: string) {
    // These mocks are POSIX executables. On Windows, PATH/shebang lookup can fall through to
    // the real authenticated gh/git CLI and publish fixture data. Fail before spawning anything.
    if (process.platform === 'win32') throw new Error('POSIX CLI fixtures must run under WSL');
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
    return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

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
    test('stages complete bundles and index without marking them published, skips existing markers', () => {
        const root = mkdtempSync(join(tmpdir(), 'qbp-')), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
        mkdirSync(bundles); mkdirSync(runs);
        const b1 = bundle(bundles, 'r1', { success: true, reports: ['walkTo lies at gate (3108, 3353)'] });
        const b2 = bundle(bundles, 'r2');
        const first = publishBundles(bundles, runs);
        expect(first).toHaveLength(2);
        expect(existsSync(join(runs, 'runs/2026-10-27/a0-rendezvous-punctual-bare-15m/r1/events.jsonl'))).toBe(true);
        const idx = JSON.parse(readFileSync(join(runs, 'runs/index.json'), 'utf8'));
        expect(idx.runs).toHaveLength(2);
        const r1 = idx.runs.find((r: any) => r.runId === 'r1');
        expect(r1).toMatchObject({ success: true, model: 'zai-coding-plan/glm-5.3', family: 'a0-rendezvous', reports: 1, tier: 'submitted' });
        expect(r1.metrics.initiative).toBe('agent');
        expect(existsSync(join(b1, 'PUBLISHED'))).toBe(false);
        expect(existsSync(join(b2, 'PUBLISHED'))).toBe(false);
        expect(publishBundles(bundles, runs)).toEqual(first);
        writeFileSync(join(b1, 'PUBLISHED'), first.find(p => p.endsWith('/r1'))! + '\n');
        writeFileSync(join(b2, 'PUBLISHED'), first.find(p => p.endsWith('/r2'))! + '\n');
        expect(publishBundles(bundles, runs)).toHaveLength(0);
        expect(existsSync(join(runs, 'runs/2026-10-27/a0-rendezvous-punctual-bare-15m/r1/PUBLISHED'))).toBe(false);
    });

    test('rejects an oversized nested file before copying any of the bundle', () => {
        const root = tempDir(), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
        const b = bundle(bundles, 'r1');
        mkdirSync(join(b, 'agent'));
        const large = join(b, 'agent', 'transcript.log');
        writeFileSync(large, '');
        truncateSync(large, 50 * 1024 * 1024 + 1);
        expect(() => publishBundles(bundles, runs)).toThrow(/transcript.log.*exceeds MAX_FILE_BYTES/);
        expect(existsSync(join(b, 'PUBLISHED'))).toBe(false);
        expect(existsSync(join(runs, 'runs'))).toBe(false);
        rmSync(large);
        expect(publishBundles(bundles, runs)).toHaveLength(1);
    });

    test.each(['../escape', '/absolute', 'nested/id', 'nested\\id', '.', '..', '', 123])('rejects invalid path component %j', value => {
        for (const field of ['slug', 'runId']) {
            const root = tempDir(), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
            const b = bundle(bundles, 'r1');
            const manifest = JSON.parse(readFileSync(join(b, 'manifest.json'), 'utf8'));
            if (field === 'slug') manifest.task.slug = value; else manifest.runId = value;
            writeFileSync(join(b, 'manifest.json'), JSON.stringify(manifest));
            // Empty runId is already rejected by ingest; all other bad components fail explicitly.
            if (field === 'runId' && value === '') expect(publishBundles(bundles, runs)).toEqual([]);
            else expect(() => publishBundles(bundles, runs)).toThrow(/Invalid (task.slug|runId)/);
            expect(existsSync(join(b, 'PUBLISHED'))).toBe(false);
            expect(existsSync(join(runs, 'runs/2026-10-27'))).toBe(false);
        }
    });

    test('rejects a resolved destination outside runsDir', () => {
        const root = tempDir(), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
        const b = bundle(bundles, 'r1');
        const manifest = JSON.parse(readFileSync(join(b, 'manifest.json'), 'utf8'));
        manifest.startedAt = '../../../../';
        writeFileSync(join(b, 'manifest.json'), JSON.stringify(manifest));
        expect(() => publishBundles(bundles, runs)).toThrow(/escapes runsDir/);
        expect(existsSync(join(b, 'PUBLISHED'))).toBe(false);
        expect(existsSync(runs)).toBe(false);
    });

    test.skipIf(process.platform === 'win32')('CLI writes markers only after push succeeds, and retries a failed push', () => {
        const root = tempDir(), bundles = join(root, 'bundles'), runs = join(root, 'runs-repo');
        const b = bundle(bundles, 'r1');
        mkdirSync(join(runs, '.git'), { recursive: true });
        const log = join(root, 'git.jsonl');
        const env = fakeCli(root, 'git', `
            import { appendFileSync, existsSync } from 'node:fs';
            const args = process.argv.slice(2);
            appendFileSync(process.env.TEST_LOG, JSON.stringify({ args, marked: existsSync(process.env.TEST_MARKER) }) + '\\n');
            if (args[0] === process.env.TEST_FAIL) process.exit(1);
        `);
        const run = (extra: string[], fail = '') => Bun.spawnSync([process.execPath, 'tools/publish-run.ts', bundles, '--runs-dir', runs, ...extra], {
            env: { ...env, TEST_LOG: log, TEST_MARKER: join(b, 'PUBLISHED'), TEST_FAIL: fail }, stdout: 'pipe', stderr: 'pipe',
        });
        expect(run(['--no-push']).exitCode).toBe(0);
        expect(existsSync(join(b, 'PUBLISHED'))).toBe(false);
        expect(existsSync(log)).toBe(false);
        for (const failure of ['add', 'commit', 'push']) {
            expect(run([], failure).exitCode).toBe(1);
            expect(existsSync(join(b, 'PUBLISHED'))).toBe(false);
        }
        expect(run([]).exitCode).toBe(0);
        const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(calls.every(call => !call.marked)).toBe(true);
        expect(calls.at(-1).args).toEqual(['push']);
        expect(readFileSync(join(b, 'PUBLISHED'), 'utf8')).toBe('runs/2026-10-27/a0-rendezvous-punctual-bare-15m/r1\n');
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

    test.skipIf(process.platform === 'win32').each(['create', 'comment'])('failed issue %s keeps every affected bundle eligible for retry', operation => {
        const root = tempDir(), bundles = join(root, 'bundles');
        const a = bundle(bundles, 'a', { reports: ['trade window never opens', 'pathfinder stuck'] });
        const b = bundle(bundles, 'b', { reports: ['pathfinder stuck'] });
        const c = bundle(bundles, 'c', { reports: ['gate stays closed'] });
        const already = bundle(bundles, 'already', { reports: ['old report'] });
        writeFileSync(join(already, 'REPORTED'), 'previous timestamp');
        const list = join(root, 'existing.json');
        writeFileSync(list, JSON.stringify(operation === 'comment' ? [{ number: 7, body: `<!-- qb-report-key:${reportKey('pathfinder stuck')} -->` }] : []));
        const env = fakeCli(root, 'gh', `
            import { readFileSync } from 'node:fs';
            const args = process.argv.slice(2);
            if (args[0] === 'issue' && args[1] === 'list') console.log(readFileSync(process.env.TEST_EXISTING, 'utf8'));
            if (args[0] === 'issue' && args[1] === process.env.TEST_FAIL && args.some(a => a.includes('pathfinder stuck'))) process.exit(1);
        `);
        const run = (fail: string) => Bun.spawnSync([process.execPath, 'tools/file-reports.ts', bundles], {
            env: { ...env, TEST_EXISTING: list, TEST_FAIL: fail }, stdout: 'pipe', stderr: 'pipe',
        });
        expect(run(operation).exitCode).toBe(0);
        expect(existsSync(join(a, 'REPORTED'))).toBe(false);
        expect(existsSync(join(b, 'REPORTED'))).toBe(false);
        expect(existsSync(join(c, 'REPORTED'))).toBe(true);
        expect(readFileSync(join(already, 'REPORTED'), 'utf8')).toBe('previous timestamp');
        expect(collect(bundles).flatMap(g => g.reports)).toHaveLength(3);
        expect(run('').exitCode).toBe(0);
        expect(collect(bundles)).toEqual([]);
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
