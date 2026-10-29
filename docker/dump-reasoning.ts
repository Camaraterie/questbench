#!/usr/bin/env bun
/**
 * Print the agent's reasoning traces as JSONL ({at, end, session, text}), oldest first.
 *   bun dump-reasoning.ts [/home/agent/.local/share/opencode/opencode.db]
 * OpenCode's `run --format=json` stream counts reasoning tokens but never emits the text; the text
 * only lives in its session database (`part` rows with data.type === "reasoning"). Opened read-only.
 * Used by collect-artifacts.sh (finished runs) and piped over `docker exec` by Studio (live runs).
 */
import { Database } from 'bun:sqlite';
import { lstatSync } from 'node:fs';

const path = process.argv[2] ?? '/home/agent/.local/share/opencode/opencode.db';
// Collected as root from an agent-owned directory: only a regular file is opened, never a symlink.
const isFile = (() => { try { return lstatSync(path).isFile(); } catch { return false; } })();
if (isFile) {
    try {
        const db = new Database(path, { readonly: true });
        const rows = db.query('select session_id, time_created, data from part order by time_created, id').all() as Array<{ session_id: string; time_created: number; data: string }>;
        for (const r of rows) {
            let d: any; try { d = JSON.parse(r.data); } catch { continue; }
            if (d?.type !== 'reasoning' || !String(d.text ?? '').trim()) continue;
            console.log(JSON.stringify({ at: d.time?.start ?? r.time_created, end: d.time?.end ?? null, session: r.session_id, text: String(d.text).trim() }));
        }
    } catch (e) { console.error(`[dump-reasoning] ${e}`); }
}
