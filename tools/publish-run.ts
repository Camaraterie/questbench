#!/usr/bin/env bun
/**
 * Publish finished run bundles to the results repo (Camaraterie/questbench-runs) and refresh its index.
 *   bun tools/publish-run.ts [bundles] [--runs-dir ../questbench-runs] [--no-push] [--repo Camaraterie/questbench-runs]
 *
 * - Clones the results repo next to this repo on first use (uses your normal git/gh login).
 * - Copies each not-yet-published bundle to runs/<date>/<task>/<run-id>/.
 * - Rebuilds runs/index.json (one summary row per run), which Studio and the public site read.
 * - Commits and pushes, then marks bundles PUBLISHED locally. Re-running skips published bundles.
 * Only bundles that pass the ingest checks are published.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { verifyBundle } from '../ingest/verify-bundle';
import { a0MetricsFromBundle } from '../analysis/a0-metrics';
import { parseSlug } from '../analysis/aggregate';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // GitHub rejects files > 100 MB; stay well under

export interface IndexEntry {
    runId: string; path: string; slug: string; family: string; variant: string; condition: string; minutes: number;
    model: string; harness: string; startedAt: string; contributor: string;
    success: boolean | null; reward: number | null; tier: string; reports: number; hasVideo: boolean;
    metrics?: Record<string, unknown>; costUsd?: number | null;
}

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export function indexEntry(bundleDir: string, relPath: string): IndexEntry {
    const man = readJson(join(bundleDir, 'manifest.json'));
    const verdict = readJson(join(bundleDir, 'verdict.json'));
    const s = parseSlug(man.task.slug);
    const reports = existsSync(join(bundleDir, 'reports.jsonl')) ? readFileSync(join(bundleDir, 'reports.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
    const success = verdict ? !!(verdict.jointCompletion ?? verdict.fairTradeCompleted) : null;
    return {
        runId: man.runId, path: relPath, slug: man.task.slug, ...s,
        model: man.model?.id ?? 'unknown', harness: man.model?.harness ?? 'unknown',
        startedAt: man.startedAt ?? '', contributor: man.contributor?.handle ?? 'anonymous',
        success, reward: verdict?.reward ?? null, tier: verifyBundle(bundleDir).tier, reports,
        hasVideo: existsSync(join(bundleDir, 'recording.mp4')),
        metrics: s.family === 'a0-rendezvous' ? (a0MetricsFromBundle(bundleDir) as unknown as Record<string, unknown>) : undefined,
        costUsd: man.usage?.costUsd ?? null,
    };
}

export function rebuildIndex(runsDir: string): IndexEntry[] {
    const rows: IndexEntry[] = [];
    const walk = (d: string) => {
        if (!existsSync(d)) return;
        for (const e of readdirSync(d)) {
            const p = join(d, e);
            if (!statSync(p).isDirectory()) continue;
            if (existsSync(join(p, 'manifest.json'))) { try { rows.push(indexEntry(p, relative(runsDir, p))); } catch (err) { console.warn(`skip ${p}: ${(err as Error).message}`); } }
            else walk(p);
        }
    };
    walk(join(runsDir, 'runs'));
    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    writeFileSync(join(runsDir, 'runs', 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), runs: rows }, null, 2));
    return rows;
}

export function copyBundle(bundleDir: string, dest: string) {
    const checkSizes = (src: string) => {
        if (src === join(bundleDir, 'PUBLISHED')) return;
        const stat = statSync(src);
        if (stat.isDirectory()) for (const name of readdirSync(src)) checkSizes(join(src, name));
        else if (stat.size > MAX_FILE_BYTES) throw new Error(`Bundle file ${src} is ${stat.size} bytes; exceeds MAX_FILE_BYTES (${MAX_FILE_BYTES}).`);
    };
    checkSizes(bundleDir);
    mkdirSync(dest, { recursive: true });
    cpSync(bundleDir, dest, { recursive: true, filter: (src) => src !== join(bundleDir, 'PUBLISHED') });
}

export function publishBundles(bundlesDir: string, runsDir: string, onStaged?: (bundleDir: string, rel: string) => void): string[] {
    const published: string[] = [];
    if (!existsSync(bundlesDir)) return published;
    for (const name of readdirSync(bundlesDir)) {
        const b = join(bundlesDir, name);
        if (!existsSync(join(b, 'manifest.json')) || existsSync(join(b, 'PUBLISHED'))) continue;
        if (verifyBundle(b).tier === 'rejected') { console.warn(`! ${name} failed ingest checks; not publishing`); continue; }
        const man = readJson(join(b, 'manifest.json'));
        if (typeof man.task.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(man.task.slug)) throw new Error(`Invalid task.slug in ${b}: expected a lowercase hyphenated slug.`);
        // Accept UUIDs and legacy run IDs such as r1, all as a single path component.
        if (typeof man.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(man.runId)) throw new Error(`Invalid runId in ${b}: expected letters, digits, underscores or hyphens.`);
        const date = (man.startedAt || new Date().toISOString()).slice(0, 10);
        const rel = join('runs', date, man.task.slug, man.runId);
        const dest = resolve(runsDir, rel);
        const within = relative(resolve(runsDir), dest);
        if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`Bundle destination escapes runsDir: ${rel}`);
        copyBundle(b, dest);
        onStaged?.(b, rel);
        published.push(rel);
    }
    mkdirSync(join(runsDir, 'runs'), { recursive: true });
    rebuildIndex(runsDir);
    return published;
}

function sh(cmd: string[], cwd?: string): { ok: boolean; out: string } {
    const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
    return { ok: r.exitCode === 0, out: (r.stdout.toString() + r.stderr.toString()).trim() };
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
    const VALUED = new Set(['--runs-dir', '--repo']);
    const bundles = args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? '')) ?? 'bundles';
    const repo = opt('repo', 'Camaraterie/questbench-runs')!;
    const runsDir = resolve(opt('runs-dir', process.env.QB_RUNS_DIR ?? '../questbench-runs')!);
    const push = !args.includes('--no-push');

    if (!existsSync(join(runsDir, '.git'))) {
        console.log(`· cloning ${repo} into ${runsDir}`);
        const viaGh = sh(['gh', 'repo', 'clone', repo, runsDir]);
        if (!viaGh.ok) {
            const viaGit = sh(['git', 'clone', `https://github.com/${repo}.git`, runsDir]);
            if (!viaGit.ok) { console.error(`✗ could not clone ${repo}.\n  fix: run \`gh auth login\` once (the repo is private), then rerun.\n${viaGit.out}`); process.exit(1); }
        }
    } else if (push) sh(['git', 'pull', '--rebase', '--autostash'], runsDir);

    const staged: Array<{ bundleDir: string; rel: string }> = [];
    const published = publishBundles(bundles, runsDir, (bundleDir, rel) => staged.push({ bundleDir, rel }));
    if (!published.length) { console.log('· nothing new to publish'); process.exit(0); }
    console.log(`· ${published.length} run(s) staged:\n  ${published.join('\n  ')}`);
    if (!push) process.exit(0);
    const a = sh(['git', 'add', 'runs'], runsDir);
    if (!a.ok) { console.error(a.out); process.exit(1); }
    const c = sh(['git', 'commit', '-m', `runs: add ${published.length} run(s)`], runsDir);
    if (!c.ok && !/nothing to commit/.test(c.out)) { console.error(c.out); process.exit(1); }
    const p = sh(['git', 'push'], runsDir);
    if (!p.ok) { console.error(`✗ push failed (runs are committed locally in ${runsDir}).\n  fix: \`gh auth login\`, then \`git -C ${runsDir} push\`.\n${p.out}`); process.exit(1); }
    for (const { bundleDir, rel } of staged) writeFileSync(join(bundleDir, 'PUBLISHED'), rel + '\n');
    console.log(`✓ published to https://github.com/${repo}`);
}
