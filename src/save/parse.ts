/**
 * Read-only parser for rs-sdk / LostCity player save files (.sav).
 *
 * Mirrors server/engine/src/engine/entity/PlayerLoading.ts in rs-sdk:
 *   magic 0x2004 (g2) · version (g2) · ... · CRC32 of everything before it (g4s, last 4 bytes)
 * Version >= 7 stores varps sparsely as (id g2, value varint); older saves store a dense g4s array.
 *
 * Verifiers read saves straight from disk (as RuneBench's check_gold.ts does), so scoring never
 * depends on a live client or on anything the agent reports.
 */

export const SAV_MAGIC = 0x2004;
/** Highest save version this parser has been checked against (rs-sdk PlayerLoading.SAV_VERSION). */
export const MAX_KNOWN_SAV_VERSION = 10;
export const SKILL_COUNT = 21;

export const InvTypes = { INV: 93, WORN: 94, BANK: 95 } as const;

export interface SaveItem { slot: number; id: number; count: number }

export interface ParsedSave {
    version: number;
    position: { x: number; z: number; level: number };
    playtime: number;
    skills: Array<{ xp: number; level: number }>;
    /** Sparse: varp id -> value. Missing ids are 0. */
    varps: Map<number, number>;
    /** Inventory type id -> occupied slots. */
    inventories: Map<number, SaveItem[]>;
}

class Reader {
    pos = 0;
    private view: DataView;
    constructor(private data: Uint8Array) {
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    get remaining() { return this.data.length - this.pos; }
    g1(): number { return this.view.getUint8(this.pos++); }
    g2(): number { const v = this.view.getUint16(this.pos, false); this.pos += 2; return v; }
    g4s(): number { const v = this.view.getInt32(this.pos, false); this.pos += 4; return v; }
    /** Port of Packet.gVarInt (7 bits per byte, high bit = continue, most significant group first). */
    gVarInt(): number {
        let byte = this.g1();
        let result = 0;
        while ((byte & 0x80) !== 0) {
            result = (result | (byte & 0x7f)) << 7;
            byte = this.g1();
        }
        return (result | byte) >>> 0;
    }
}

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

/** Same as Packet.getcrc: standard CRC-32, returned as a signed 32-bit int. */
export function crc32(src: Uint8Array, offset = 0, length = src.length): number {
    let crc = 0xffffffff;
    for (let i = offset; i < length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ src[i]!) & 0xff]!;
    return ~crc;
}

export interface ParseOptions {
    /** Reject files whose trailing CRC doesn't match (default true). */
    checkCrc?: boolean;
}

export function parseSave(data: Uint8Array, opts: ParseOptions = {}): ParsedSave {
    const r = new Reader(data);
    if (r.g2() !== SAV_MAGIC) throw new Error('not a save file (bad magic)');
    const version = r.g2();
    if (version > MAX_KNOWN_SAV_VERSION) {
        throw new Error(`save version ${version} is newer than this parser (${MAX_KNOWN_SAV_VERSION}); update src/save/parse.ts`);
    }
    if (opts.checkCrc !== false) {
        const stored = new DataView(data.buffer, data.byteOffset + data.length - 4, 4).getInt32(0, false);
        if (stored !== crc32(data, 0, data.length - 4)) throw new Error('save checksum mismatch');
    }

    const x = r.g2();
    const z = r.g2();
    const level = r.g1();
    r.pos += 7 + 5 + 1; // body parts, colours, gender
    r.g2(); // run energy
    const playtime = version >= 2 ? r.g4s() : r.g2();

    const skills: ParsedSave['skills'] = [];
    for (let i = 0; i < SKILL_COUNT; i++) skills.push({ xp: r.g4s(), level: r.g1() });

    const varps = new Map<number, number>();
    const varpCount = r.g2();
    if (version >= 7) {
        for (let i = 0; i < varpCount; i++) {
            const id = r.g2();
            varps.set(id, r.gVarInt());
        }
    } else {
        for (let i = 0; i < varpCount; i++) {
            const v = r.g4s();
            if (v !== 0) varps.set(i, v);
        }
    }

    const inventories = new Map<number, SaveItem[]>();
    const invCount = r.g1();
    for (let i = 0; i < invCount; i++) {
        const type = r.g2();
        if (version < 5) throw new Error('save versions < 5 need InvType sizes from the cache; not supported');
        const size = r.g2();
        const items: SaveItem[] = [];
        for (let slot = 0; slot < size; slot++) {
            const id = r.g2() - 1;
            if (id === -1) continue;
            let count = r.g1();
            if (count === 255) count = r.g4s();
            items.push({ slot, id, count });
        }
        inventories.set(type, items);
    }
    // Anything after inventories (afk zones, etc.) is not needed for scoring.

    return { version, position: { x, z, level }, playtime, skills, varps, inventories };
}

export function countItem(save: ParsedSave, itemId: number, invTypes: number[] = [InvTypes.INV, InvTypes.BANK, InvTypes.WORN]): number {
    let n = 0;
    for (const t of invTypes) for (const it of save.inventories.get(t) ?? []) if (it.id === itemId) n += it.count;
    return n;
}
