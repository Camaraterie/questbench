#!/usr/bin/env bun
/**
 * Shared notice board (coordination-aids condition). A plain append-only JSONL file every player
 * on the local server can read and post to, so commitments are explicit and persistent instead of
 * scrolling away in chat.
 *
 *   bun /qb/aids/board.ts post --by agent --place "varrock west bank" --in 5m --give "300 coins" --want "5 iron bar" [--note "..."]
 *   bun /qb/aids/board.ts read [--since <iso>]
 *
 * A post is a concrete commitment: place + time + what changes hands. Partners read the board too.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const BOARD_FILE = process.env.QB_BOARD_FILE ?? '/var/qb/board/board.jsonl';

export interface BoardPost {
    ts: string;
    by: string;
    place?: string;
    /** absolute meeting time, ISO */
    at?: string;
    give?: string;
    want?: string;
    note?: string;
}

export function parseIn(spec: string, now = Date.now()): string {
    const m = spec.match(/^(\d+)\s*(s|m|min)?$/);
    if (!m) throw new Error(`--in expects e.g. 90s or 5m, got ${spec}`);
    const secs = Number(m[1]) * (m[2] && m[2] !== 's' ? 60 : 1);
    return new Date(now + secs * 1000).toISOString();
}

export function post(p: Omit<BoardPost, 'ts'>, file = BOARD_FILE): BoardPost {
    const full: BoardPost = { ts: new Date().toISOString(), ...p };
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(full) + '\n');
    return full;
}

export function read(since?: string, file = BOARD_FILE): BoardPost[] {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as BoardPost)
        .filter(p => !since || p.ts > since);
}

if (import.meta.main) {
    const [cmd, ...rest] = process.argv.slice(2);
    const opt = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
    if (cmd === 'post') {
        const by = opt('by') ?? process.env.BOT_USERNAME ?? 'agent';
        const inSpec = opt('in');
        const p = post({ by, place: opt('place'), at: opt('at') ?? (inSpec ? parseIn(inSpec) : undefined), give: opt('give'), want: opt('want'), note: opt('note') });
        console.log(JSON.stringify(p));
    } else if (cmd === 'read') {
        for (const p of read(opt('since'))) console.log(`${p.ts}  ${p.by}: ${[p.place && `at ${p.place}`, p.at && `by ${p.at}`, p.give && `gives ${p.give}`, p.want && `wants ${p.want}`, p.note].filter(Boolean).join(' · ')}`);
    } else {
        console.error('usage: board.ts post --place <p> --in <5m> --give <x> --want <y> [--note <n>] | read [--since <iso>]');
        process.exit(2);
    }
}
