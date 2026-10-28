/**
 * Offline end-to-end: simulate what a container run leaves in a Harbor job directory (engine-written
 * event log, saves, partner log, verifier output), then run the real host-side pipeline over it:
 * bundle -> redact -> ingest checks -> A0 metrics -> aggregate.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSave } from '../src/save/write';
import { parseSave } from '../src/save/parse';
import { verifyChain } from '../src/events/chain';
import { scoreTrade } from '../verifiers/check_trade';
import { bundleTrial } from '../tools/bundle-from-harbor';
import { a0MetricsFromBundle } from '../analysis/a0-metrics';
import { aggregate, bootstrapCI, parseSlug } from '../analysis/aggregate';
import { parseChatLine } from '../aids/inbox-lib';
import { parseIn, post, read } from '../aids/board';
import { untilMessage } from '../aids/interrupt';
import { resolveTasks } from '../src/scenarios';
import { instruction, testSh } from '../generate-tasks';

async function engineLog(file: string, events: Array<[number, string, string[], Record<string, unknown>]>) {
    process.env.EVENT_LOG_FILE = file;
    // Fresh module instance per log file (EventLog keeps chain state in module scope).
    const mod = await import(`../engine/src/EventLog.ts?${file}`);
    for (const [tick, kind, actors, data] of events) mod.logEvent(tick, kind, actors, data);
}

function fakeTrial(root: string, opts: { slug: string; success: boolean; model: string; specific: boolean }) {
    const trial = join(root, `trial-${Math.random().toString(36).slice(2)}`);
    const qb = join(trial, 'verifier', 'qb');
    mkdirSync(join(qb, 'saves'), { recursive: true });
    mkdirSync(join(qb, 'partners'), { recursive: true });
    mkdirSync(join(trial, 'agent'), { recursive: true });
    const start = writeSave({ position: { x: 3222, z: 3218 }, inventory: [{ id: 995, count: 1000 }] });
    const end = opts.success ? writeSave({ position: { x: 3185, z: 3436 }, inventory: [{ id: 995, count: 700 }, { id: 2351, count: 5 }] }) : start;
    writeFileSync(join(qb, 'saves', 'start.agent.sav'), start);
    writeFileSync(join(qb, 'saves', 'end.agent.sav'), end);
    writeFileSync(join(qb, 'env.txt'), `QB_TASK=${opts.slug}\nQB_AIDS=${opts.slug.includes('aided') ? 1 : 0}\nQB_DURATION_SECS=900\nNODE_TICKRATE=50\n`);
    writeFileSync(join(qb, 'qb_start.txt'), '2026-10-26T20:00:00Z');
    writeFileSync(join(qb, 'qb_end.txt'), '2026-10-26T20:15:00Z');
    writeFileSync(join(qb, 'partners', 'partner01.jsonl'), [{ event: 'start' }, { event: 'committed' }, { event: 'arrived' }].map(e => JSON.stringify(e)).join('\n'));
    const verdict = scoreTrade(parseSave(start), parseSave(end), { gain: [{ id: 2351, count: 5 }] });
    writeFileSync(join(trial, 'verifier', 'reward.json'), JSON.stringify(verdict));
    writeFileSync(join(trial, 'agent', 'transcript.txt'), 'thinking... ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 /home/alice/x');
    writeFileSync(join(trial, 'result.json'), JSON.stringify({ agent_result: { n_input_tokens: 1000, n_output_tokens: 200, cost_usd: 0.01 } }));
    return { trial, qb };
}

describe('engine event log is compatible with the verifier', () => {
    test('chains written by engine/src/EventLog.ts verify', async () => {
        const f = join(mkdtempSync(join(tmpdir(), 'qbev-')), 'events.jsonl');
        await engineLog(f, [
            [10, 'chat_private', ['agent', 'partner01'], { text: 'meet at varrock west bank in 5 min' }],
            [12, 'varp', ['agent'], { varp: 146, name: 'phoenixgang', from: 9, to: 10, gone: undefined }],
            [30, 'trade', ['partner01', 'agent'], { fromItems: [{ id: 2351, name: 'iron_bar', count: 5 }], toItems: [{ id: 995, name: 'coins', count: 300 }] }],
        ]);
        expect(verifyChain(readFileSync(f, 'utf8'))).toMatchObject({ ok: true, count: 3 });
    });
    test('apply-patch hooks every anchor once, is idempotent, and fails loudly on drift', async () => {
        const { patchText } = await import('../engine/apply-patch');
        const invOps = "import World from '#/engine/World.js';\n\nfoo(() => {\n            if (fromItems.length > 0 || toLogs.size > 0) {\n                const toItems = Array.from(toLogs.values());\n                fromPlayer.addWealthEvent({\n                    event_type: WealthEventType.TRADE,\n                });\n            }\n});\n";
        const once = patchText('engine/script/handlers/InvOps.ts', invOps);
        expect(once).toContain("logEvent(World.currentTick, 'trade', [fromPlayer.username, toPlayer.username]");
        expect(once).toContain("import { logEvent } from '#/engine/entity/tracking/EventLog.js';");
        expect(patchText('engine/script/handlers/InvOps.ts', once)).toBe(once);
        expect(() => patchText('engine/script/handlers/InvOps.ts', "import x from 'y';\nnothing here\n")).toThrow(/matched 0 times/);
        const player = "import World from '#/engine/World.js';\nclass P {\n    addWealthEvent(event: WealthEventParams) {\n        World.addWealthEvent({});\n    }\n    setVar(id: number, value: number | string) {\n        if (a) {\n        } else if (typeof value === 'number') {\n            this.vars[varp.id] = value;\n        }\n    }\n}\n";
        const p = patchText('engine/entity/Player.ts', player);
        expect(p).toContain("'varp', [this.username]");
        expect(p).toContain("'wealth', [this.username]");
        expect(p).toContain("import { WealthEventType } from '#/server/logger/WealthEventType.js';");
    });
});

describe('coordination aids', () => {
    test('inbox parses rs-sdk chat.ts --watch lines', () => {
        expect(parseChatLine('[PM from partner01] meet at the bank?', 'agent')).toEqual({ kind: 'pm', from: 'partner01', text: 'meet at the bank?' });
        expect(parseChatLine('partner01: agent, over here', 'agent')).toEqual({ kind: 'mention', from: 'partner01', text: 'agent, over here' });
        expect(parseChatLine('partner01: nice weather', 'agent')).toBeNull();
        expect(parseChatLine('* Welcome to RuneScape.', 'agent')).toBeNull();
    });
    test('board round trip and --in parsing', () => {
        const file = join(mkdtempSync(join(tmpdir(), 'qbb-')), 'board.jsonl');
        expect(parseIn('5m', 0)).toBe(new Date(300_000).toISOString());
        post({ by: 'agent', place: 'varrock west bank', at: parseIn('90s'), give: '300 coins' }, file);
        expect(read(undefined, file)).toHaveLength(1);
        expect(read(undefined, file)[0]).toMatchObject({ by: 'agent', place: 'varrock west bank' });
    });
    test('untilMessage interrupts long work when the partner speaks', async () => {
        const sdk = { waitForChat: () => new Promise<any>(r => setTimeout(() => r({ text: 'here!', sender: 'partner01' }), 20)) };
        const r = await untilMessage(sdk, async (signal) => { while (!signal.aborted) await Bun.sleep(5); return 'done'; }, { from: 'partner01' });
        expect(r).toMatchObject({ interrupted: true, message: { text: 'here!' } });
    });
});

describe('task generation', () => {
    test('A0 runs bare and aided; aided instructions include the tools', () => {
        const a0 = resolveTasks().filter(t => t.scenario.id === 'a0-rendezvous');
        expect(a0).toHaveLength(10);
        const aided = a0.find(t => t.slug === 'a0-rendezvous-drifter-aided-15m')!;
        expect(instruction(aided)).toContain('/qb/aids/board.ts');
        const bare = instruction(a0.find(t => t.slug === 'a0-rendezvous-drifter-bare-15m')!);
        expect(bare).not.toContain('/qb/aids/board.ts');
        expect(bare).toContain('/qb/aids/report.ts');
        expect(testSh(aided)).toContain('/qb/collect-artifacts.sh');
        expect(testSh(aided)).toContain('"id":2351');
    });
});

describe('offline end-to-end pipeline', () => {
    test('screen recording is excluded unless explicitly opted in', () => {
        const job = mkdtempSync(join(tmpdir(), 'qbvideo-'));
        const { trial } = fakeTrial(job, { slug: 'a0-rendezvous-punctual-bare-15m', success: false, model: 'test', specific: false });
        const video = Buffer.from('synthetic unredacted video contents');
        writeFileSync(join(trial, 'verifier', 'recording.mp4'), video);
        const opts = { out: join(job, 'bundles'), handle: 'tester', licence: 'CC-BY-4.0', tasksDir: join(job, 'no-tasks') };
        const excluded = bundleTrial(trial, job, opts);
        expect(existsSync(join(excluded.bundle!, 'recording.mp4'))).toBe(false);
        const included = bundleTrial(trial, job, { ...opts, includeRecording: true });
        expect(readFileSync(join(included.bundle!, 'recording.mp4'))).toEqual(video);
    });

    test('job dir -> bundles -> metrics -> results table', async () => {
        const job = mkdtempSync(join(tmpdir(), 'qbjob-'));
        writeFileSync(join(job, 'config.json'), JSON.stringify({ agents: [{ name: 'claude-code', model_name: 'anthropic/test-model' }] }));
        const runs = [
            { slug: 'a0-rendezvous-punctual-bare-15m', success: true, specific: true },
            { slug: 'a0-rendezvous-punctual-bare-15m', success: false, specific: false },
            { slug: 'a0-rendezvous-punctual-aided-15m', success: true, specific: true },
        ];
        for (const r of runs) {
            const { qb } = fakeTrial(job, { ...r, model: 'anthropic/test-model' });
            await engineLog(join(qb, 'events.jsonl'), [
                [5, 'chat_private', ['agent', 'partner01'], { text: r.specific ? 'meet at varrock west bank in 3 min, 300 coins for 5 iron bars' : 'hey want to trade sometime?' }],
                [9, 'chat_private', ['partner01', 'agent'], { text: 'OK' }],
                [11, 'chat_private', ['agent', 'partner01'], { text: 'on my way' }],
                ...(r.success ? [[200, 'trade', ['partner01', 'agent'], { fromItems: [{ id: 2351, count: 5 }], toItems: [{ id: 995, count: 300 }] }] as [number, string, string[], Record<string, unknown>]] : []),
            ]);
        }
        const out = join(job, 'bundles');
        const results = readdirSync(job).filter(d => d.startsWith('trial-')).map(d => bundleTrial(join(job, d), job, { out, handle: 'tester', licence: 'CC-BY-4.0', tasksDir: join(job, 'no-tasks') }));
        for (const r of results) expect((r as any).ingest.tier).toBe('submitted');

        // Redaction reached the transcript but never touched the event log.
        const b = (results[0] as any).bundle as string;
        const transcript = readFileSync(join(b, 'agent', 'transcript.txt'), 'utf8');
        expect(transcript).not.toContain('sk-ant-api03');
        expect(transcript).not.toContain('alice');
        expect(verifyChain(readFileSync(join(b, 'events.jsonl'), 'utf8')).ok).toBe(true);

        const specificRun = results.find(r => readFileSync(join((r as any).bundle, 'events.jsonl'), 'utf8').includes('varrock west bank'))!;
        const m = a0MetricsFromBundle((specificRun as any).bundle);
        expect(m.initiative).toBe('agent');
        expect(m.proposal_specificity).toBe(0.5);
        expect(m.response_latency_median_ticks).toBe(2);

        const { rows, rejected } = aggregate(out);
        expect(rejected).toHaveLength(0);
        const bare = rows.find(r => r.variant === 'punctual' && r.condition === 'bare')!;
        expect(bare.n).toBe(2);
        expect(bare.successRate).toBe(0.5);
        expect(rows.find(r => r.condition === 'aided')!.successRate).toBe(1);
    });
    test('slug parsing and bootstrap CI', () => {
        expect(parseSlug('a0-rendezvous-goal-mismatch-aided-15m')).toEqual({ family: 'a0-rendezvous', variant: 'goal-mismatch', condition: 'aided', minutes: 15 });
        expect(parseSlug('c1-hidden-role-trade-victim-naive-15m')).toMatchObject({ family: 'c1-hidden-role-trade', variant: 'victim-naive', condition: 'bare' });
        const ci = bootstrapCI([1, 1, 0, 1, 0, 1, 1, 1])!;
        expect(ci[0]).toBeLessThan(0.75); expect(ci[1]).toBeGreaterThan(0.75);
    });
});
