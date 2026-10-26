/**
 * Write scenario starting saves (.sav) for the local rs-sdk server.
 *
 * Emits save version 6, the same layout rs-sdk's own sdk/test/utils/save-generator.ts writes
 * (dense varp array, trailing CRC-32). The engine migrates v6 saves forward on first load.
 * Keep this in sync with rs-sdk if the save-generator layout changes.
 */
import { crc32, InvTypes } from './parse';

export const WRITE_SAV_VERSION = 6;
const DENSE_VARP_COUNT = 309; // matches save-generator; covers all quest varps used here
const BANK_SIZE = 496;

export const Skills = {
    attack: 0, defence: 1, strength: 2, hitpoints: 3, ranged: 4, prayer: 5, magic: 6, cooking: 7,
    woodcutting: 8, fletching: 9, fishing: 10, firemaking: 11, crafting: 12, smithing: 13, mining: 14,
    herblore: 15, agility: 16, thieving: 17, runecraft: 20,
} as const;
export type SkillName = keyof typeof Skills;

export interface ScenarioSave {
    position: { x: number; z: number; level?: number };
    skills?: Partial<Record<SkillName, number>>; // skill -> level
    inventory?: Array<{ id: number; count: number }>;
    worn?: Array<{ slot: number; id: number }>;
    bank?: Array<{ id: number; count: number }>;
    varps?: Record<number, number>;
}

/** Engine XP storage (tenths of XP) for a level, as in save-generator.getExpByLevel. */
export function expForLevel(level: number): number {
    let xp = 0;
    for (let i = 1; i < level; i++) xp += Math.floor(i + 300 * Math.pow(2, i / 10));
    return Math.floor(xp / 4) * 10;
}

class Writer {
    buf = new Uint8Array(16384);
    view = new DataView(this.buf.buffer);
    pos = 0;
    p1(v: number) { this.view.setUint8(this.pos++, v & 0xff); }
    p2(v: number) { this.view.setUint16(this.pos, v & 0xffff, false); this.pos += 2; }
    p4(v: number) { this.view.setInt32(this.pos, v | 0, false); this.pos += 4; }
    p8(v: bigint) { this.view.setBigInt64(this.pos, v, false); this.pos += 8; }
    bytes() { return this.buf.slice(0, this.pos); }
}

function writeInv(w: Writer, type: number, size: number, slots: Array<{ id: number; count: number } | null>) {
    w.p2(type);
    w.p2(size);
    for (let i = 0; i < size; i++) {
        const it = slots[i];
        if (!it) { w.p2(0); continue; }
        w.p2(it.id + 1);
        if (it.count >= 255) { w.p1(255); w.p4(it.count); } else w.p1(it.count);
    }
}

export function writeSave(cfg: ScenarioSave, now: bigint = 0n): Uint8Array {
    const w = new Writer();
    w.p2(0x2004);
    w.p2(WRITE_SAV_VERSION);
    w.p2(cfg.position.x);
    w.p2(cfg.position.z);
    w.p1(cfg.position.level ?? 0);
    for (const b of [0, 10, 18, 26, 33, 36, 42]) w.p1(b); // default body
    for (let i = 0; i < 5; i++) w.p1(0);                   // colours
    w.p1(0);                                               // gender
    w.p2(10000);                                           // run energy
    w.p4(1000);                                            // playtime (ticks)

    for (let i = 0; i < 21; i++) {
        const name = (Object.keys(Skills) as SkillName[]).find(k => Skills[k] === i);
        let level = (name && cfg.skills?.[name]) || 1;
        if (i === Skills.hitpoints && level < 10) level = 10;
        w.p4(expForLevel(level));
        w.p1(level);
    }

    const varps = new Array(DENSE_VARP_COUNT).fill(0);
    varps[281] = 1000; // tutorial complete (as save-generator)
    for (const [id, v] of Object.entries(cfg.varps ?? {})) {
        const i = Number(id);
        if (i < 0 || i >= DENSE_VARP_COUNT) throw new Error(`varp ${i} outside dense range ${DENSE_VARP_COUNT}`);
        varps[i] = v;
    }
    w.p2(DENSE_VARP_COUNT);
    for (const v of varps) w.p4(v);

    const invs: Array<[number, number, Array<{ id: number; count: number } | null>]> = [];
    if (cfg.inventory?.length) invs.push([InvTypes.INV, 28, cfg.inventory]);
    if (cfg.worn?.length) {
        const worn: Array<{ id: number; count: number } | null> = new Array(14).fill(null);
        for (const it of cfg.worn) worn[it.slot] = { id: it.id, count: 1 };
        invs.push([InvTypes.WORN, 14, worn]);
    }
    if (cfg.bank?.length) invs.push([InvTypes.BANK, BANK_SIZE, cfg.bank]);
    w.p1(invs.length);
    for (const [t, size, slots] of invs) writeInv(w, t, size, slots);

    w.p1(0);   // afk zone count
    w.p2(0);   // last afk zone
    w.p1(0);   // chat modes
    w.p8(now); // last login

    const body = w.bytes();
    const out = new Uint8Array(body.length + 4);
    out.set(body);
    new DataView(out.buffer).setInt32(body.length, crc32(body), false);
    return out;
}
