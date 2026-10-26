#!/usr/bin/env bun
/**
 * Redact every text file in a run bundle directory in place, and print what was found.
 *   bun tools/redact-bundle.ts <bundle-dir> [--dry-run]
 *
 * Binary files (.sav, .mp4, images) are skipped. Review the printed hit counts and spot-check the
 * transcripts before submitting; pattern-based redaction is not a guarantee.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { redact } from '../src/redact/redact';

const TEXT = new Set(['.json', '.jsonl', '.md', '.txt', '.log', '.ts', '.js', '.sh', '.toml', '.yaml', '.yml', '.env', '']);

function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) yield* walk(p); else yield p;
    }
}

if (import.meta.main) {
    const dir = process.argv[2];
    const dry = process.argv.includes('--dry-run');
    if (!dir) { console.error('usage: redact-bundle.ts <bundle-dir> [--dry-run]'); process.exit(2); }
    const total: Record<string, number> = {};
    for (const f of walk(dir)) {
        if (!TEXT.has(extname(f))) continue;
        const { text, hits } = redact(readFileSync(f, 'utf8'));
        if (Object.keys(hits).length) {
            console.log(`${f}: ${JSON.stringify(hits)}`);
            for (const [k, v] of Object.entries(hits)) total[k] = (total[k] ?? 0) + v;
            if (!dry) writeFileSync(f, text);
        }
    }
    console.log(`total: ${JSON.stringify(total)}${dry ? ' (dry run, nothing written)' : ''}`);
}
