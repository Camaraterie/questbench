#!/usr/bin/env bun
/**
 * Aggregate run bundles into a results table: one row per (task family, variant, condition, model).
 *   bun analysis/aggregate.ts <bundles-dir> [--json results/a0.json] [--min-tier submitted]
 *
 * Only bundles that pass ingest checks are counted. Success rates come with a 95% bootstrap CI,
 * because RuneBench-scale run-to-run variance makes point estimates misleading at small n.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { verifyBundle } from '../ingest/verify-bundle';
import { a0MetricsFromBundle, type A0Metrics } from './a0-metrics';

/** Seeded PRNG (mulberry32) so CIs are reproducible. */
function rng(seed: number) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function bootstrapCI(xs: number[], iters = 2000, seed = 7): [number, number] | null {
    if (!xs.length) return null;
    const r = rng(seed); const means: number[] = [];
    for (let i = 0; i < iters; i++) { let s = 0; for (let j = 0; j < xs.length; j++) s += xs[Math.floor(r() * xs.length)]!; means.push(s / xs.length); }
    means.sort((a, b) => a - b);
    return [means[Math.floor(0.025 * iters)]!, means[Math.floor(0.975 * iters)]!];
}

/** "a0-rendezvous-drifter-aided-15m" -> { family: a0-rendezvous, variant: drifter, condition: aided } */
export function parseSlug(slug: string) {
    const m = slug.match(/^(a0-rendezvous|a1-shield-of-arrav|c1-hidden-role-trade)-(.+?)(?:-(bare|aided))?-(\d+)m$/);
    return m ? { family: m[1]!, variant: m[2]!, condition: m[3] ?? 'bare', minutes: Number(m[4]) } : { family: slug, variant: '', condition: 'bare', minutes: 0 };
}

export interface Row {
    family: string; variant: string; condition: string; model: string; n: number;
    successRate: number; successCI: [number, number] | null;
    meanSpecificity: number | null; initiativeAgentShare: number | null; medianTimeToTradeTicks: number | null;
}

export function aggregate(bundlesDir: string): { rows: Row[]; rejected: string[] } {
    const groups = new Map<string, { key: Omit<Row, 'n' | 'successRate' | 'successCI' | 'meanSpecificity' | 'initiativeAgentShare' | 'medianTimeToTradeTicks'>; runs: Array<{ success: number; m: A0Metrics | null }> }>();
    const rejected: string[] = [];
    if (!existsSync(bundlesDir)) return { rows: [], rejected };
    for (const name of readdirSync(bundlesDir)) {
        const dir = join(bundlesDir, name);
        if (!existsSync(join(dir, 'manifest.json'))) continue;
        if (verifyBundle(dir).tier === 'rejected') { rejected.push(name); continue; }
        const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
        const s = parseSlug(man.task.slug);
        const verdict = existsSync(join(dir, 'verdict.json')) ? JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8')) : {};
        const success = verdict.jointCompletion ?? verdict.fairTradeCompleted ? 1 : 0;
        const m = s.family === 'a0-rendezvous' ? a0MetricsFromBundle(dir) : null;
        const k = [s.family, s.variant, s.condition, man.model.id].join('|');
        if (!groups.has(k)) groups.set(k, { key: { family: s.family, variant: s.variant, condition: s.condition, model: man.model.id }, runs: [] });
        groups.get(k)!.runs.push({ success, m });
    }
    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const rows: Row[] = [...groups.values()].map(({ key, runs }) => {
        const ms = runs.map(r => r.m).filter((m): m is A0Metrics => !!m);
        const ttt = ms.map(m => m.time_to_trade_ticks).filter((x): x is number => x !== null).sort((a, b) => a - b);
        return {
            ...key, n: runs.length,
            successRate: avg(runs.map(r => r.success))!,
            successCI: bootstrapCI(runs.map(r => r.success)),
            meanSpecificity: avg(ms.map(m => m.proposal_specificity).filter((x): x is number => x !== null)),
            initiativeAgentShare: avg(ms.map(m => (m.initiative === 'agent' ? 1 : 0))),
            medianTimeToTradeTicks: ttt.length ? ttt[Math.floor(ttt.length / 2)]! : null,
        };
    }).sort((a, b) => (a.family + a.variant + a.condition + a.model).localeCompare(b.family + b.variant + b.condition + b.model));
    return { rows, rejected };
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const dir = args.find(a => !a.startsWith('--'));
    if (!dir) { console.error('usage: aggregate.ts <bundles-dir> [--json out.json]'); process.exit(2); }
    const { rows, rejected } = aggregate(dir);
    if (!rows.length && !rejected.length) { console.log(`No run bundles in ${dir} yet (no trial completed). Check the harbor output above.`); process.exit(0); }
    const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
    console.log('| task | variant | condition | model | n | success (95% CI) | specificity | agent initiated | median ticks to trade |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.family} | ${r.variant} | ${r.condition} | ${r.model} | ${r.n} | ${pct(r.successRate)} (${r.successCI ? `${pct(r.successCI[0])}–${pct(r.successCI[1])}` : '–'}) | ${pct(r.meanSpecificity)} | ${pct(r.initiativeAgentShare)} | ${r.medianTimeToTradeTicks ?? '–'} |`);
    if (rejected.length) console.log(`\nRejected ${rejected.length} bundle(s) that failed ingest checks: ${rejected.join(', ')}`);
    const i = args.indexOf('--json');
    if (i >= 0) { mkdirSync(dirname(args[i + 1]!), { recursive: true }); writeFileSync(args[i + 1]!, JSON.stringify({ generatedAt: new Date().toISOString(), rows, rejected }, null, 2)); }
}
