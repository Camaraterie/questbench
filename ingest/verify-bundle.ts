#!/usr/bin/env bun
/**
 * Ingest-side checks for a submitted run bundle directory (already unpacked).
 *   bun ingest/verify-bundle.ts <bundle-dir>
 *
 * Never trusts the submitted verdict.json: it re-derives what it can from events.jsonl and saves/.
 * Output: a JSON report with a trust tier of "submitted" (all checks passed) or "rejected".
 * Replication and maintainer verification are later tiers assigned by the leaderboard.
 *
 * v0.1 checks: manifest shape, hash chain, start/end saves parse, task digest present.
 * TODO: replay events against start saves and require the result to equal end saves; tick/clock
 *       consistency against manifest.tickRateMs; transcript-to-event timing alignment.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyChain } from '../src/events/chain';
import { parseSave } from '../src/save/parse';

export interface Manifest {
    schema: 'questbench.run/v0';
    runId: string;
    task: { slug: string; harborDigest: string };
    image: { ref: string; digest: string };
    rsSdkCommit: string;
    seed: number;
    tickRateMs: number;
    model: { id: string; provider: string; harness: string; harnessVersion?: string; reasoning?: string };
    startedAt: string;
    endedAt: string;
    contributor: { handle: string; licence: string };
}

export interface Check { name: string; ok: boolean; detail?: string }

export function verifyBundle(dir: string) {
    const checks: Check[] = [];
    const check = (name: string, fn: () => string | void) => {
        try { checks.push({ name, ok: true, detail: fn() || undefined }); }
        catch (e) { checks.push({ name, ok: false, detail: (e as Error).message }); }
    };

    let manifest: Manifest | null = null;
    check('manifest', () => {
        manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
        if (manifest.schema !== 'questbench.run/v0') throw new Error(`unknown schema ${manifest.schema}`);
        for (const k of ['runId', 'task', 'image', 'rsSdkCommit', 'model', 'contributor'] as const) if (!manifest[k]) throw new Error(`missing ${k}`);
        if (!/^sha256:[0-9a-f]{64}$/.test(manifest.task.harborDigest)) throw new Error('task.harborDigest must be sha256:<64 hex>');
        return `${manifest.task.slug} · ${manifest.model.id}`;
    });
    check('event_chain', () => {
        const v = verifyChain(readFileSync(join(dir, 'events.jsonl'), 'utf8'));
        if (!v.ok) throw new Error(`${v.error} at line ${v.badLine}`);
        return `${v.count} events, head ${v.head.slice(0, 12)}`;
    });
    check('saves', () => {
        const saveDir = join(dir, 'saves');
        if (!existsSync(saveDir)) throw new Error('no saves/');
        const files = readdirSync(saveDir).filter(f => f.endsWith('.sav'));
        const starts = files.filter(f => f.startsWith('start.')), ends = files.filter(f => f.startsWith('end.'));
        if (!starts.length || starts.length !== ends.length) throw new Error(`need matching start.<user>.sav / end.<user>.sav, got ${files.join(', ')}`);
        for (const f of files) parseSave(readFileSync(join(saveDir, f)));
        return `${ends.length} players`;
    });

    const ok = checks.every(c => c.ok);
    return { tier: ok ? 'submitted' : 'rejected', checks };
}

if (import.meta.main) {
    const dir = process.argv[2];
    if (!dir) { console.error('usage: verify-bundle.ts <bundle-dir>'); process.exit(2); }
    const report = verifyBundle(dir);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.tier === 'submitted' ? 0 : 1);
}
