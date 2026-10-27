/**
 * Resolve varp names to numeric ids from rs-sdk's content/pack/varp.pack ("<id>=<name>" per line).
 *
 * Ids are assigned by the content pack and can move between rs-sdk revisions, so verifiers look
 * them up by name at run time instead of hardcoding numbers. FALLBACK_VARPS records the ids seen
 * at the rs-sdk commit this scaffold was written against, for tests and as a sanity check.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Observed in rs-sdk server/content/pack/varp.pack (commit of 2026-10-25). */
export const FALLBACK_VARPS: Record<string, number> = {
    qp: 101,
    blackarmgang: 145,
    phoenixgang: 146,
};

export const DEFAULT_VARP_PACK_PATHS = [
    '/app/server/content/pack/varp.pack',
    'vendor/rs-sdk/server/content/pack/varp.pack',
];

export function parseVarpPack(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^(\d+)=(\S+)\s*$/);
        if (m) out.set(m[2]!, Number(m[1]));
    }
    return out;
}

export function loadVarpIds(paths: string[] = DEFAULT_VARP_PACK_PATHS): { ids: Map<string, number>; source: string } {
    for (const p of paths) {
        if (existsSync(p)) return { ids: parseVarpPack(readFileSync(p, 'utf8')), source: p };
    }
    return { ids: new Map(Object.entries(FALLBACK_VARPS)), source: 'fallback' };
}

export function varpId(ids: Map<string, number>, name: string): number {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`varp "${name}" not found in varp.pack`);
    return id;
}
