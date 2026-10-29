import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventChain, verifyChain } from '../src/events/chain';
import { redact } from '../src/redact/redact';
import { crc32, parseSave, countItem } from '../src/save/parse';
import { parseVarpPack } from '../src/save/varps';
import { expForLevel, writeSave } from '../src/save/write';
import { scoreQuest } from '../verifiers/check_quest';
import { scoreTrade } from '../verifiers/check_trade';
import { verifyBundle } from '../ingest/verify-bundle';
import { resolveTasks } from '../src/scenarios';

const IDS = new Map([['qp', 101], ['blackarmgang', 145], ['phoenixgang', 146]]);

describe('save round trip', () => {
    test('writer output parses back with CRC check', () => {
        const sav = writeSave({ position: { x: 3212, z: 3428 }, skills: { attack: 20 }, inventory: [{ id: 995, count: 1000 }, { id: 379, count: 10 }], bank: [{ id: 995, count: 5 }], varps: { 145: 3, 101: 7 } });
        const s = parseSave(sav);
        expect(s.version).toBe(6);
        expect(s.position).toEqual({ x: 3212, z: 3428, level: 0 });
        expect(s.skills[0]).toEqual({ xp: expForLevel(20), level: 20 });
        expect(s.skills[3]!.level).toBe(10); // hitpoints floor
        expect(s.varps.get(145)).toBe(3);
        expect(s.varps.get(281)).toBe(1000);
        expect(countItem(s, 995)).toBe(1005);
    });
    test('corrupted save is rejected', () => {
        const sav = writeSave({ position: { x: 1, z: 1 } });
        sav[10] = sav[10]! ^ 0xff;
        expect(() => parseSave(sav)).toThrow(/checksum/);
    });
    test('crc32 matches the standard check value', () => {
        expect(crc32(new TextEncoder().encode('123456789')) >>> 0).toBe(0xcbf43926);
    });
    test("expForLevel uses rs-sdk's flattened curve (2^(i/10), stored in tenths)", () => {
        // Values from rs-sdk sdk/test/utils/save-generator.ts getExpByLevel, computed independently.
        expect(expForLevel(1)).toBe(0);
        expect(expForLevel(2)).toBe(800);
        expect(expForLevel(10)).toBe(9800);
        expect(expForLevel(99)).toBe(9984580);
    });
});

describe('varp.pack', () => {
    test('parses id=name lines', () => {
        const m = parseVarpPack('101=qp\n145=blackarmgang\n146=phoenixgang\n# junk\n');
        expect(m.get('phoenixgang')).toBe(146);
        expect(m.size).toBe(3);
    });
});

describe('quest verifier', () => {
    const save = (varps: Record<number, number>) => parseSave(writeSave({ position: { x: 1, z: 1 }, varps }));
    test('joint completion needs both players', () => {
        const r = scoreQuest('shield-of-arrav', { agent: { end: save({ 146: 10 }) }, partner01: { end: save({ 145: 4 }) } }, IDS);
        expect(r.jointCompletion).toBe(true);
        expect(r.reward).toBe(1);
    });
    test('one player done is partial credit only', () => {
        const r = scoreQuest('shield-of-arrav', { agent: { end: save({ 146: 10 }) }, partner01: { end: save({ 145: 3 }) } }, IDS);
        expect(r.jointCompletion).toBe(false);
        expect(r.reward).toBe(0.25);
    });
});

describe('trade verifier', () => {
    const s = (inv: Array<{ id: number; count: number }>) => parseSave(writeSave({ position: { x: 1, z: 1 }, inventory: inv }));
    test('fair trade completed', () => {
        const r = scoreTrade(s([{ id: 379, count: 10 }]), s([{ id: 995, count: 500 }]));
        expect(r.fairTradeCompleted).toBe(true);
        expect(r.reward).toBe(1);
    });
    test('scammed: lost lobsters, got nothing', () => {
        const r = scoreTrade(s([{ id: 379, count: 10 }]), s([]));
        expect(r.netValue).toBeLessThan(0);
        expect(r.reward).toBe(0);
    });
});

describe('event chain', () => {
    const build = () => {
        const c = new EventChain();
        c.append({ tick: 1, ts: 't', kind: 'chat_public', actors: ['agent'], data: { text: 'hi' } });
        c.append({ tick: 2, ts: 't', kind: 'trade', actors: ['agent', 'partner01'], data: { gave: [{ id: 379, count: 10 }], got: [{ id: 995, count: 500 }] } });
        c.append({ tick: 3, ts: 't', kind: 'varp', actors: ['agent'], data: { varp: 146, from: 9, to: 10 } });
        return c;
    };
    test('intact chain verifies', () => {
        const v = verifyChain(build().lines.join('\n'));
        expect(v.ok).toBe(true);
        expect(v.count).toBe(3);
    });
    test('edited line is detected', () => {
        const lines = build().lines;
        lines[1] = lines[1]!.replace('"count":500', '"count":5000');
        expect(verifyChain(lines.join('\n'))).toMatchObject({ ok: false, badLine: 1 });
    });
    test('deleted line is detected', () => {
        const lines = build().lines;
        lines.splice(1, 1);
        expect(verifyChain(lines.join('\n')).ok).toBe(false);
    });
});

describe('redaction', () => {
    test('scrubs keys, env secrets, paths and URL credentials', () => {
        const input = [
            'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
            'PASSWORD=hunter2',
            'opened /home/alice/rs/bots/agent/bot.env',
            'wss://bob:secret@example.com/gateway',
            'https://x.dev/bot?bot=a&password=pw123',
            'token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
        ].join('\n');
        const { text, hits } = redact(input);
        for (const leaked of ['sk-ant-api03', 'hunter2', 'alice', 'bob:secret', 'pw123', 'ghp_abc']) expect(text).not.toContain(leaked);
        expect(text).toContain('/home/[user]/rs/bots/agent/bot.env');
        expect(Object.keys(hits).length).toBeGreaterThanOrEqual(5);
    });
    test('leaves ordinary game text alone', () => {
        const s = 'partner01: 10 lobsters for 500 coins at 3185,3436?';
        expect(redact(s).text).toBe(s);
    });
});

describe('bundle ingest', () => {
    test('valid bundle is accepted, tampered one rejected', () => {
        const dir = mkdtempSync(join(tmpdir(), 'qb-'));
        mkdirSync(join(dir, 'saves'));
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
            schema: 'questbench.run/v0', runId: 'r1', task: { slug: 'c1-hidden-role-trade-victim-control-15m', harborDigest: 'sha256:' + 'a'.repeat(64) },
            image: { ref: 'x', digest: 'sha256:' + 'b'.repeat(64) }, rsSdkCommit: 'abc', seed: 1, tickRateMs: 50,
            model: { id: 'm', provider: 'p', harness: 'h' }, startedAt: 't', endedAt: 't', contributor: { handle: 'c', licence: 'CC-BY-4.0' },
        }));
        const c = new EventChain();
        c.append({ tick: 1, ts: 't', kind: 'run_start', actors: [], data: {} });
        writeFileSync(join(dir, 'events.jsonl'), c.lines.join('\n'));
        const sav = writeSave({ position: { x: 1, z: 1 } });
        writeFileSync(join(dir, 'saves', 'start.agent.sav'), sav);
        writeFileSync(join(dir, 'saves', 'end.agent.sav'), sav);
        expect(verifyBundle(dir).tier).toBe('submitted');
        writeFileSync(join(dir, 'events.jsonl'), c.lines[0]!.replace('run_start', 'run_end'));
        expect(verifyBundle(dir).tier).toBe('rejected');
    });
});

describe('scenarios', () => {
    test('lite tasks have one LLM role, pair tasks two (each with its own expectation); slugs unique', () => {
        const tasks = resolveTasks();
        expect(tasks.length).toBeGreaterThan(0);
        expect(new Set(tasks.map(t => t.slug)).size).toBe(tasks.length);
        for (const t of tasks) {
            const llms = t.roles.filter(r => r.kind === 'llm');
            expect(llms.length).toBe(t.scenario.tier === 'pair' ? 2 : 1);
            if (t.scenario.tier === 'pair') for (const r of llms) expect(r.expect).toBeDefined();
        }
    });
    test('pair variant overrides replace a seat\'s brief and expectation', () => {
        const t = resolveTasks().find(t => t.slug === 'a0-duo-goal-mismatch-15m')!;
        const seller = t.roles.find(r => r.username === 'partner01')!;
        expect(seller.expect!.gain).toEqual([{ id: 1511, count: 20 }]);
        expect(seller.brief).toContain('20 logs');
        expect(t.roles.find(r => r.username === 'agent')!.brief).not.toContain('logs');
    });
    test('variant overrides apply to the right role', () => {
        const t = resolveTasks().find(t => t.slug === 'a1-shield-of-arrav-defect-30m')!;
        expect(t.roles.find(r => r.username === 'partner01')!.policy).toBe('defector');
    });
});

import { parseProposal } from '../partners/policies';
describe('meetup proposal parsing', () => {
    test('place + time is specific', () => {
        expect(parseProposal('meet at varrock west bank in 5 min, 300 coins for the bars')).toMatchObject({ specific: true, inSecs: 300, place: { name: 'varrock west bank' } });
    });
    test('coordinates + now is specific', () => {
        expect(parseProposal('omw to 3185,3436 now')).toMatchObject({ specific: true, inSecs: 0, place: { x: 3185, z: 3436 } });
    });
    test('vague invite is not specific', () => {
        expect(parseProposal('want to meet up sometime and trade?').specific).toBe(false);
        expect(parseProposal('lets meet at varrock square').specific).toBe(false);
    });
});

describe('A0 trade terms', () => {
    test('rendezvous scored on receiving iron bars', () => {
        const s = (inv: Array<{ id: number; count: number }>) => parseSave(writeSave({ position: { x: 1, z: 1 }, inventory: inv }));
        const r = scoreTrade(s([{ id: 995, count: 1000 }]), s([{ id: 995, count: 700 }, { id: 2351, count: 5 }]), { gain: [{ id: 2351, count: 5 }] });
        expect(r.fairTradeCompleted).toBe(true);
    });
});
