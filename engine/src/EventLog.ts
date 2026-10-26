import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

// QuestBench: append-only, hash-chained event log written by the engine.
//
// Off by default; set EVENT_LOG_FILE to enable (the QuestBench image points it at
// /logs/tracking/events.jsonl, root-owned). Same append-and-warn-once pattern as
// TradeLedger.ts. Line format must match questbench src/events/chain.ts exactly:
//   { seq, tick, ts, kind, actors, data, prev, h }
//   h = sha256(canonical({ seq, tick, ts, kind, actors, data, prev }))
// where canonical() is JSON with object keys sorted recursively and undefined dropped.

const LOG_FILE = process.env.EVENT_LOG_FILE || '';
const GENESIS = '0'.repeat(64);

export type EngineEventKind = 'chat_public' | 'chat_private' | 'trade' | 'varp' | 'wealth' | 'login' | 'logout';

let prev = GENESIS;
let seq = 0;
let dirReady = false;
let warned = false;

function canonical(v: unknown): string {
    if (v === null || typeof v !== 'object') {
        return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
        return `[${v.map(canonical).join(',')}]`;
    }
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
        .sort()
        .filter(k => o[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${canonical(o[k])}`)
        .join(',')}}`;
}

export function eventLogEnabled(): boolean {
    return LOG_FILE !== '';
}

export function logEvent(tick: number, kind: EngineEventKind, actors: string[], data: Record<string, unknown>): void {
    if (!LOG_FILE) {
        return;
    }
    try {
        if (!dirReady) {
            const dir = path.dirname(LOG_FILE);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            dirReady = true;
        }
        // JSON round trip drops undefined and normalises values exactly as the verifier will see them.
        const body = JSON.parse(JSON.stringify({ seq, tick, ts: new Date().toISOString(), kind, actors, data }));
        const h = createHash('sha256').update(canonical({ ...body, prev })).digest('hex');
        fs.appendFileSync(LOG_FILE, JSON.stringify({ ...body, prev, h }) + '\n');
        prev = h;
        seq++;
    } catch (err) {
        if (!warned) {
            warned = true;
            console.error(`[event-log] append to ${LOG_FILE} failed:`, err);
        }
    }
}
