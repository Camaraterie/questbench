#!/usr/bin/env bun
/**
 * Scroll service (field-notes spike, scrolls/DESIGN.md §9.3). Started as root by qb-entrypoint.sh
 * when /qb/scroll.json exists.
 *
 * The scroll's text lives here, never in a player's workspace. A player may read or rewrite it
 * only while the engine reports the scroll item in that player's inventory, so trading, dropping
 * or dying with the item moves access with it. Every read, write and refusal is appended to a
 * hash-chained log the players cannot write.
 *
 *   /var/qb/scrolls/store.json       current text, version and hash (root only)
 *   /logs/tracking/scrolls.jsonl     hash-chained scroll events (root only)
 *   /run/qb-scroll/<player>.token    that player's credential, readable only by its Unix user
 */
import { appendFileSync, chmodSync, chownSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export interface ScrollSpec { arm: string; item: number; limit: number; holder: string; text: string }
export interface Held { holds: boolean; position?: { x: number; z: number; level: number }; reason?: string }
export interface ScrollState { text: string; sha256: string; version: number; holder: string; lastWriter: string | null }
export class ScrollError extends Error { constructor(message: string, public status = 400) { super(message); } }

const GENESIS = '0'.repeat(64);
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Same canonical form as src/events/chain.ts: keys sorted recursively. */
export function canonical(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
/** True if every line's `prev` and `h` are consistent. */
export function verifyScrollLog(text: string): boolean {
    let prev = GENESIS;
    for (const line of text.split('\n').filter(Boolean)) {
        const { h, ...event } = JSON.parse(line);
        if (event.prev !== prev || hash(canonical(event)) !== h) return false;
        prev = h;
    }
    return true;
}

export function createScrolls(spec: ScrollSpec, deps: { held: (player: string) => Promise<Held>; append: (line: string) => void; save: (state: ScrollState) => void; now?: () => Date }) {
    const state: ScrollState = { text: spec.text, sha256: hash(spec.text), version: 0, holder: spec.holder, lastWriter: null };
    let prev = GENESIS, seq = 0;
    const record = (kind: string, player: string, data: Record<string, unknown>) => {
        const event = { seq: seq++, ts: (deps.now?.() ?? new Date()).toISOString(), kind, actors: [player], data, prev };
        prev = hash(canonical(event));
        deps.append(JSON.stringify({ ...event, h: prev }));
    };
    record('scroll_init', spec.holder, { arm: spec.arm, item: spec.item, limit: spec.limit, version: 0, sha256: state.sha256, text: spec.text });
    deps.save(state);
    // One request at a time, so a check and the action it permits cannot interleave with another.
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(work: () => Promise<T>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };
    const carried = async (player: string, action: string) => {
        const held = await deps.held(player);
        if (!held.holds) {
            record('scroll_denied', player, { action, reason: held.reason ?? 'not carrying the scroll', position: held.position });
            throw new ScrollError('You are not carrying the scroll. It can be read or written only while it is in your inventory.', 403);
        }
        return held;
    };
    return {
        state: () => ({ ...state }),
        read: (player: string) => serial(async () => {
            const held = await carried(player, 'read');
            record('scroll_read', player, { version: state.version, sha256: state.sha256, position: held.position });
            return { content: state.text, sha256: state.sha256, version: state.version, limit: spec.limit };
        }),
        write: (player: string, content: unknown, expectedHash: unknown) => serial(async () => {
            const held = await carried(player, 'write');
            if (typeof content !== 'string' || Array.from(content).length > spec.limit) throw new ScrollError(`A scroll holds at most ${spec.limit} characters`);
            if (expectedHash !== state.sha256) throw new ScrollError('The scroll changed; read it before writing', 409);
            Object.assign(state, { text: content, sha256: hash(content), version: state.version + 1, holder: player, lastWriter: player });
            record('scroll_write', player, { version: state.version, sha256: state.sha256, text: content, position: held.position });
            deps.save(state);
            return { saved: true, sha256: state.sha256, version: state.version, characters: Array.from(content).length };
        }),
    };
}

/** Ask the engine (not the player) whether the scroll item is in the player's inventory right now. */
export function engineHeld(item: number, controlToken: () => string, request: typeof fetch = fetch) {
    return async (player: string): Promise<Held> => {
        try {
            const response = await request(`http://localhost:8888/qb-control?player=${encodeURIComponent(player)}`, { headers: { 'x-qb-control': controlToken() }, signal: AbortSignal.timeout(3000) });
            if (!response.ok) return { holds: false, reason: response.status === 404 ? 'player is not in the world' : `engine refused (${response.status})` };
            const world = await response.json() as any;
            return { holds: (world.stores?.inventory ?? []).some((slot: any) => slot.id === item && slot.count > 0), position: world.position };
        } catch (error) { return { holds: false, reason: `engine unreachable: ${String(error).slice(0, 80)}` }; }
    };
}

if (import.meta.main) {
    const spec: ScrollSpec = JSON.parse(readFileSync('/qb/scroll.json', 'utf8'));
    const dir = '/var/qb/scrolls', log = '/logs/tracking/scrolls.jsonl', run = '/run/qb-scroll';
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    mkdirSync('/logs/tracking', { recursive: true });
    mkdirSync(run, { recursive: true }); chmodSync(run, 0o711);
    writeFileSync(log, '', { mode: 0o600 });
    // QB_SCROLL_PLAYERS: "player:unixuser,..." (default: the scroll's first holder, as the agent user).
    const tokens = new Map<string, string>();
    for (const pair of (process.env.QB_SCROLL_PLAYERS ?? `${spec.holder}:agent`).split(',')) {
        const [player, user] = pair.split(':') as [string, string];
        if (!/^[a-z][a-z0-9_]{0,11}$/.test(player) || !/^[a-z][a-z0-9_-]*$/.test(user ?? '')) throw new Error(`Invalid scroll player ${pair}`);
        const id = (flag: string) => Number(Bun.spawnSync(['id', flag, user]).stdout.toString().trim());
        const token = randomUUID() + randomUUID(), file = `${run}/${player}.token`;
        writeFileSync(file, token, { mode: 0o400 }); chownSync(file, id('-u'), id('-g'));
        tokens.set(token, player);
    }
    const scrolls = createScrolls(spec, {
        held: engineHeld(spec.item, () => readFileSync('/run/qb/studio-token', 'utf8')),
        append: line => appendFileSync(log, line + '\n'),
        save: state => { const temp = `${dir}/.store-${randomUUID()}`; writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(temp, `${dir}/store.json`); },
    });
    const who = (req: Request) => {
        const supplied = req.headers.get('x-scroll-token') ?? '';
        for (const [token, player] of tokens) if (supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return player;
        throw new ScrollError('Unknown scroll credential', 403);
    };
    Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.QB_SCROLL_PORT ?? 7790), async fetch(req) {
        try {
            if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
            const player = who(req), path = new URL(req.url).pathname, body = await req.text();
            if (body.length > 20_000) throw new ScrollError('Request too large');
            const input = body ? JSON.parse(body) : {};
            if (path === '/read') return Response.json(await scrolls.read(player));
            if (path === '/write') return Response.json(await scrolls.write(player, input.content, input.expectedHash));
            return new Response('Not found', { status: 404 });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ScrollError ? error.status : 400 }); }
    } });
    console.log(`[scroll] serving one scroll (item ${spec.item}, arm ${spec.arm}) for ${[...tokens.values()].join(', ')}`);
}
