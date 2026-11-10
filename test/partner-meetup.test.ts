import { expect, test } from 'bun:test';
import { PLACES, meetupPartner, spawnProblem, type PolicyCtx } from '../partners/policies';
import { a0 } from '../src/scenarios/a0-rendezvous';
import { a1 } from '../src/scenarios/a1-shield-of-arrav';
import { resolveTasks } from '../src/scenarios';

/** A partner in Varrock that hears the given messages; `walks` decides whether walkTo really moves it. */
function partner(messages: string[], options: { walks: boolean; trades: Array<{ success: boolean; reason?: string }> }) {
    const events: Array<{ event: string; data?: any }> = [], sent: string[] = [];
    const position = { worldX: 3212, worldZ: 3432 };
    let tradeCalls = 0;
    const ctx = {
        self: 'partner01', partner: 'agent', deadline: Date.now() + 60_000,
        params: { give: [{ id: 2351, count: 5, item: 'iron bar' }], want: [{ id: 1511, count: 20, item: 'logs' }], waitSecs: 30, replyDelaySecs: 0 },
        emit: (event: string, data?: any) => { events.push({ event, data }); },
        sdk: {
            waitForChat: async () => { const text = messages.shift(); return text ? { text, sender: 'agent' } : null; },
            sendPrivateMessage: async (_to: string, text: string) => { sent.push(text); },
            waitForTicks: async () => {}, getState: () => ({ player: position }),
            getTradeState: () => ({ theirOffer: [], myOffer: [] }), getInventory: () => [], say: async () => {}, waitForTradeRequest: async () => null,
        },
        bot: {
            walkTo: async (x: number, z: number) => { if (options.walks) Object.assign(position, { worldX: x, worldZ: z }); return { success: options.walks }; },
            trade: async () => options.trades[Math.min(tradeCalls++, options.trades.length - 1)]!,
            tradeWith: async () => ({ success: false }), offerTradeItems: async () => ({ success: false }), acceptTrade: async () => ({ success: false }), declineTrade: async () => {},
        },
    } as unknown as PolicyCtx;
    return { ctx, events, sent, names: () => events.map(e => e.event), tradeCalls: () => tradeCalls };
}

test('a partner that did not move says so instead of claiming it arrived', async () => {
    const p = partner(['Meet at lumbridge castle now with 20 logs.'], { walks: false, trades: [{ success: true }] });
    await meetupPartner(p.ctx);
    expect(p.names()).toEqual(['heard', 'reply', 'committed', 'walk_failed', 'reply']);
    expect(p.events.find(e => e.event === 'walk_failed')!.data.position).toEqual({ x: 3212, z: 3432 });
    expect(p.sent.at(-1)).toContain("can't get to lumbridge castle");
    expect(p.tradeCalls()).toBe(0);
});

test('at the spot, the partner keeps waiting while the other player has not shown up yet', async () => {
    const absent = { success: false, reason: 'player_not_found' };
    const p = partner(['Meet at lumbridge castle now with 20 logs.'], { walks: true, trades: [absent, absent, { success: true }] });
    await meetupPartner(p.ctx);
    expect(p.names()).toEqual(['heard', 'reply', 'committed', 'arrived', 'trade_result', 'reply']);
    expect(p.tradeCalls()).toBe(3);
    expect(p.events.find(e => e.event === 'trade_result')!.data).toEqual({ success: true, reason: undefined });
    expect(p.sent.at(-1)).toBe('Thanks, good trade.');
});

test('a declined trade still ends the wait and the partner leaves', async () => {
    const p = partner(['Meet at lumbridge castle now with 20 logs.'], { walks: true, trades: [{ success: false, reason: 'declined' }] });
    await meetupPartner(p.ctx);
    expect(p.tradeCalls()).toBe(1);
    expect(p.names()).toContain('drifted');
});

test('the fountain tile that trapped the partner is not used as a spawn or a meeting place', () => {
    const FOUNTAIN = { x: 3212, z: 3428 }; // blocked in the live engine
    const same = (p?: { x: number; z: number }) => !!p && p.x === FOUNTAIN.x && p.z === FOUNTAIN.z;
    for (const place of Object.values(PLACES)) expect(same(place)).toBe(false);
    for (const task of resolveTasks([a0, a1])) for (const role of task.roles) {
        expect(same(role.save.position)).toBe(false);
        expect(same(role.params?.home as any)).toBe(false);
    }
});

test('a blocked spawn is reported from the engine state', async () => {
    const engine = (walkable: boolean, status = 200) => (async (url: any, options: any) => {
        expect(String(url)).toBe('http://localhost:8888/qb-control?player=partner01');
        expect(options.headers['x-qb-control']).toBe('operator');
        return new Response(JSON.stringify({ walkable, position: { x: 3212, z: 3428, level: 0 } }), { status });
    }) as unknown as typeof fetch;
    expect(await spawnProblem('partner01', 'operator', engine(false))).toBe('partner01 starts on a blocked tile (3212, 3428) and cannot walk');
    expect(await spawnProblem('partner01', 'operator', engine(true))).toBeNull();
    expect(await spawnProblem('partner01', 'operator', engine(false, 404))).toBeNull();
});
