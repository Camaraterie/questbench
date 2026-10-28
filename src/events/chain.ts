/**
 * Hash-chained, append-only event log (events.jsonl).
 *
 * Each line is one JSON event plus `prev` (hash of the previous line, or GENESIS for the first)
 * and `h` (SHA-256 over the canonical event body including `prev`). Deleting, inserting or editing
 * any line breaks every hash after it, so ingest can detect a tampered log without trusting the
 * machine that produced it. It does NOT prove the log is complete or honest at the source; that is
 * what re-verification against saves and replication tiers are for (see DESIGN.md, "Trust").
 */
import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

export type EventKind =
    | 'run_start' | 'run_end'
    | 'chat_public' | 'chat_private'
    | 'trade'
    | 'varp'
    | 'wealth'      // drop / pickup / death / pvp / shop, from World.addWealthEvent
    | 'combat'
    | 'login' | 'logout' | 'intervention';

export interface GameEvent {
    seq: number;
    tick: number;
    ts: string;
    kind: EventKind;
    /** login usernames involved; first entry is the actor */
    actors: string[];
    data: Record<string, unknown>;
}

export interface ChainedEvent extends GameEvent { prev: string; h: string }

/** Stable JSON: object keys sorted recursively, so hashes don't depend on key order. */
export function canonical(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function hashEvent(e: GameEvent, prev: string): string {
    return createHash('sha256').update(canonical({ ...e, prev })).digest('hex');
}

export class EventChain {
    private prev = GENESIS;
    private seq = 0;
    readonly lines: string[] = [];

    append(e: Omit<GameEvent, 'seq'>): ChainedEvent {
        const ev: GameEvent = { ...e, seq: this.seq++ };
        const h = hashEvent(ev, this.prev);
        const chained: ChainedEvent = { ...ev, prev: this.prev, h };
        this.prev = h;
        this.lines.push(JSON.stringify(chained));
        return chained;
    }

    get head(): string { return this.prev; }
}

export interface ChainVerdict { ok: boolean; count: number; head: string; error?: string; badLine?: number }

export function verifyChain(jsonl: string): ChainVerdict {
    let prev = GENESIS;
    const lines = jsonl.split('\n').filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
        let ev: ChainedEvent;
        try { ev = JSON.parse(lines[i]!); } catch { return { ok: false, count: i, head: prev, error: 'invalid JSON', badLine: i }; }
        if (ev.seq !== i) return { ok: false, count: i, head: prev, error: `seq ${ev.seq} != ${i}`, badLine: i };
        if (ev.prev !== prev) return { ok: false, count: i, head: prev, error: 'prev hash mismatch', badLine: i };
        const { h, prev: _p, ...body } = ev;
        if (hashEvent(body as GameEvent, prev) !== h) return { ok: false, count: i, head: prev, error: 'hash mismatch', badLine: i };
        prev = h;
    }
    return { ok: true, count: lines.length, head: prev };
}
