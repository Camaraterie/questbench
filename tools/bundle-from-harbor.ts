#!/usr/bin/env bun
/**
 * Turn finished Harbor trials into QuestBench run bundles, redact them, and run ingest checks.
 *   bun tools/bundle-from-harbor.ts <harbor-job-dir> [--out bundles] [--handle <you>] [--licence CC-BY-4.0]
 *                                   [--image-digest sha256:...] [--tasks tasks] [--include-recording]
 *
 * Harbor brings back only /logs/verifier from the container (plus agent logs and result.json on
 * the host side), so tests/test.sh copies everything QuestBench needs into /logs/verifier/qb/ via
 * docker/collect-artifacts.sh. Layout handled here (same discovery as RuneBench's extractors):
 *   <job>/config.json                   agents[0].model_name / name
 *   <job>/<trial>/result.json           agent_result token counts and cost
 *   <job>/<trial>/agent/...             agent transcript (format depends on the harness)
 *   <job>/<trial>/verifier/reward.json  verifier output
 *   <job>/<trial>/verifier/qb/...       events.jsonl, saves/{start,end}.<user>.sav, partners/, board.jsonl, env.txt
 */
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { redact } from '../src/redact/redact';
import { verifyBundle, type Manifest } from '../ingest/verify-bundle';

export function findTrials(jobDir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(jobDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const d = join(jobDir, e.name);
        if (existsSync(join(d, 'verifier')) || existsSync(join(d, 'agent'))) { out.push(d); continue; }
        for (const s of readdirSync(d, { withFileTypes: true })) {
            const n = join(d, s.name);
            if (s.isDirectory() && (existsSync(join(n, 'verifier')) || existsSync(join(n, 'agent')))) out.push(n);
        }
    }
    return out;
}

function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir).sort()) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) yield* walk(p); else yield p;
    }
}

/** Deterministic digest of a generated task directory (paths + bytes), for the manifest. */
export function dirDigest(dir: string): string {
    const h = createHash('sha256');
    for (const f of walk(dir)) { h.update(relative(dir, f)); h.update('\0'); h.update(readFileSync(f)); h.update('\0'); }
    return `sha256:${h.digest('hex')}`;
}

function readEnv(file: string): Record<string, string> {
    if (!existsSync(file)) return {};
    return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

const TEXT_EXT = /\.(json|jsonl|md|txt|log|ts|js|sh|toml|ya?ml)$/i;

export interface BundleOptions { out: string; handle: string; licence: string; imageDigest?: string; tasksDir: string; includeRecording?: boolean }

export function pairSeats(qb: string): Array<{ username: string; model: string }> | undefined {
    const list = join(qb, 'seats', 'seats.json');
    if (!existsSync(list)) return undefined;
    const launch = existsSync(join(qb, 'seats', 'launch.log')) ? readFileSync(join(qb, 'seats', 'launch.log'), 'utf8') : '';
    return (JSON.parse(readFileSync(list, 'utf8')) as Array<{ username: string }>).map(({ username }) =>
        ({ username, model: launch.match(new RegExp(`starting seat ${username} as \\S+ \\(([^)]+)\\)`))?.[1] ?? 'unknown' }));
}

export function bundleTrial(trialDir: string, jobDir: string, opts: BundleOptions) {
    const qb = join(trialDir, 'verifier', 'qb');
    if (!existsSync(qb)) return { trialDir, skipped: 'no verifier/qb (not a QuestBench trial, or collection failed)' };
    const env = readEnv(join(qb, 'env.txt'));
    const slug = env.QB_TASK ?? 'unknown';
    const config = existsSync(join(jobDir, 'config.json')) ? JSON.parse(readFileSync(join(jobDir, 'config.json'), 'utf8')) : {};
    const result = existsSync(join(trialDir, 'result.json')) ? JSON.parse(readFileSync(join(trialDir, 'result.json'), 'utf8')) : {};
    const agentCfg = config?.agents?.[0] ?? {};
    const taskDir = join(opts.tasksDir, slug);

    const runId = randomUUID();
    const dir = join(opts.out, `run-${runId}`);
    mkdirSync(dir, { recursive: true });

    const manifest: Manifest & Record<string, unknown> = {
        schema: 'questbench.run/v0',
        runId,
        task: { slug, harborDigest: existsSync(taskDir) ? dirDigest(taskDir) : `sha256:${'0'.repeat(64)}` },
        image: { ref: env.QB_IMAGE ?? 'questbench', digest: opts.imageDigest ?? `sha256:${'0'.repeat(64)}` },
        rsSdkCommit: existsSync(join(qb, 'rs-sdk-commit.txt')) ? readFileSync(join(qb, 'rs-sdk-commit.txt'), 'utf8').trim() : 'unknown',
        seed: Number(env.QB_SEED ?? 0),
        tickRateMs: Number(env.NODE_TICKRATE ?? 50),
        model: { id: agentCfg.model_name ?? 'unknown', provider: String(agentCfg.model_name ?? '').split('/')[0] || 'unknown', harness: agentCfg.name ?? 'unknown' },
        startedAt: existsSync(join(qb, 'qb_start.txt')) ? readFileSync(join(qb, 'qb_start.txt'), 'utf8').trim() : '',
        endedAt: existsSync(join(qb, 'qb_end.txt')) ? readFileSync(join(qb, 'qb_end.txt'), 'utf8').trim() : '',
        contributor: { handle: opts.handle, licence: opts.licence },
        conditions: { aids: env.QB_AIDS === '1', durationSecs: Number(env.QB_DURATION_SECS ?? 0) },
        usage: result?.agent_result ? { inputTokens: result.agent_result.n_input_tokens ?? 0, outputTokens: result.agent_result.n_output_tokens ?? 0, cacheTokens: result.agent_result.n_cache_tokens ?? 0, costUsd: result.agent_result.cost_usd ?? null } : undefined,
        provenance: { imageDigestKnown: !!opts.imageDigest, taskDigestFromLocalTasksDir: existsSync(taskDir) },
        // Pair tier: who played each seat (docker/seats/launch.ts logs "starting seat <bot> as <user> (<model>)").
        seats: pairSeats(qb),
    };

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (existsSync(join(qb, 'events.jsonl'))) cpSync(join(qb, 'events.jsonl'), join(dir, 'events.jsonl')); else writeFileSync(join(dir, 'events.jsonl'), '');
    cpSync(join(qb, 'saves'), join(dir, 'saves'), { recursive: true });
    for (const extra of ['partners', 'board.jsonl', 'trade_ledger.jsonl', 'WARNINGS.txt', 'reports.jsonl', 'agent-reasoning.jsonl', 'seats']) if (existsSync(join(qb, extra))) cpSync(join(qb, extra), join(dir, extra), { recursive: true });
    if (existsSync(join(trialDir, 'verifier', 'reward.json'))) cpSync(join(trialDir, 'verifier', 'reward.json'), join(dir, 'verdict.json'));
    if (existsSync(join(trialDir, 'agent'))) cpSync(join(trialDir, 'agent'), join(dir, 'agent'), { recursive: true });
    // Screen recordings cannot be text-redacted. Opt in only after reviewing the video for secrets.
    if (opts.includeRecording && existsSync(join(trialDir, 'verifier', 'recording.mp4'))) cpSync(join(trialDir, 'verifier', 'recording.mp4'), join(dir, 'recording.mp4'));

    // Redact every text file except the hash-chained event log (editing it would break the chain;
    // it only holds in-game text, which the server already filtered) and the manifest.
    const hits: Record<string, number> = {};
    for (const f of walk(dir)) {
        if (!TEXT_EXT.test(f) || f.endsWith('events.jsonl') || f.endsWith('manifest.json')) continue;
        const r = redact(readFileSync(f, 'utf8'));
        if (Object.keys(r.hits).length) { writeFileSync(f, r.text); for (const [k, v] of Object.entries(r.hits)) hits[k] = (hits[k] ?? 0) + v; }
    }
    writeFileSync(join(dir, 'REDACTED.json'), JSON.stringify({ at: new Date().toISOString(), hits }, null, 2));

    return { trialDir, bundle: dir, slug, redactionHits: hits, ingest: verifyBundle(dir) };
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
    const jobDir = args.find(a => !a.startsWith('--'));
    if (!jobDir) { console.error('usage: bundle-from-harbor.ts <harbor-job-dir> [--out bundles] [--handle you] [--licence CC-BY-4.0] [--image-digest sha256:..] [--tasks tasks] [--include-recording]'); process.exit(2); }
    const opts: BundleOptions = { out: opt('out', 'bundles')!, handle: opt('handle', 'anonymous')!, licence: opt('licence', 'CC-BY-4.0')!, imageDigest: opt('image-digest'), tasksDir: opt('tasks', 'tasks')!, includeRecording: args.includes('--include-recording') };
    const trials = findTrials(jobDir);
    console.log(`${trials.length} trials in ${jobDir}`);
    for (const t of trials) console.log(JSON.stringify(bundleTrial(t, jobDir, opts)));
    console.log('Review each bundle (and REDACTED.json) before sharing it.');
}
