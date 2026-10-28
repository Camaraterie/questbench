#!/usr/bin/env bun
/** Deterministic, no-LLM check. Run only in a disposable QuestBench container with --network none.
 * Mount this checkout read-only at /workspace/qb and run bun /workspace/qb/tools/smoke-duo.ts
 * with the container entrypoint overridden. Seeds saves before starting local engine/gateway.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { writeSave } from '../src/save/write';
import { a0duo } from '../src/scenarios/a0-duo';

if (!process.env.QB_SMOKE_CONTAINER) throw new Error('Run in a disposable container with QB_SMOKE_CONTAINER=1');
const processes: ReturnType<typeof Bun.spawn>[] = [];
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const wait = async (ready: () => boolean | Promise<boolean>, label: string, timeout = 90_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await ready()) return; await Bun.sleep(200); }
    throw new Error(`Timed out: ${label}`);
};
const start = (cmd: string[], cwd: string, name: string) => {
    const file = Bun.file(`/tmp/qb-smoke-${name}.log`);
    processes.push(Bun.spawn(cmd, { cwd, stdout: file, stderr: file }));
};
let sdks: any[] = [];
try {
    mkdirSync('/run/qb', { recursive: true });
    writeFileSync('/run/qb/studio-token', crypto.randomUUID(), { mode: 0o600 });
    process.env.TELEMETRY = 'false';
    process.env.EASY_STARTUP = 'true'; process.env.FRIEND_SERVER = 'true';
    process.env.EVENT_LOG_FILE = '/logs/tracking/events.jsonl';
    mkdirSync('/logs/tracking', { recursive: true });
    writeFileSync('/logs/tracking/qb_start.txt', new Date().toISOString());
    mkdirSync('/app/server/engine/data/players/main', { recursive: true });
    for (const role of a0duo.roles) {
        writeFileSync(`/app/server/engine/data/players/main/${role.username}.sav`, writeSave(role.save));
        mkdirSync(`/app/bots/${role.username}`, { recursive: true });
        writeFileSync(`/app/bots/${role.username}/bot.env`, `BOT_USERNAME=${role.username}\nPASSWORD=test\nSERVER=localhost:8888\nGATEWAY_URL=ws://localhost:7780\nSHOW_CHAT=true\nTELEMETRY=false\n`);
    }
    start(['bun', 'src/app.ts'], '/app/server/engine', 'engine');
    await wait(async () => { try { return (await fetch('http://localhost:8888')).ok; } catch { return false; } }, 'engine');
    start(['bun', 'gateway.ts'], '/app/server/gateway', 'gateway');
    await wait(async () => { try { await fetch('http://localhost:7780'); return true; } catch { return false; } }, 'gateway');
    for (const role of a0duo.roles) start(['bun', 'src/lite/runner.ts', role.username], '/app/server/webclient', role.username);
    const sdkRoot = '/app/sdk';
    const { BotSDK } = await import(`${sdkRoot}/index.ts`);
    const { BotActions } = await import(`${sdkRoot}/actions.ts`);
    sdks = a0duo.roles.map(role => new BotSDK({ botUsername: role.username, password: 'test', gatewayUrl: 'ws://localhost:7780', autoLaunchBrowser: false, autoReconnect: false }));
    // Lite clients register asynchronously; connect once their status says they are in game.
    for (const role of a0duo.roles) await wait(async () => {
        try { const status = await (await fetch(`http://localhost:7780/status/${role.username}`)).json(); return status.inGame === true; } catch { return false; }
    }, `${role.username} login`);
    await Promise.all(sdks.map(s => s.connect()));
    const [buyer, seller] = sdks, bots = sdks.map(s => new BotActions(s));
    for (let i = 0; i < 2; i++) {
        const from = sdks[i], to = sdks[1 - i], target = a0duo.roles[1 - i]!.username;
        const baseline = to.getChat({ includeSelf: false }).length;
        const sent = await from.dm(target, 'hello friend i have iron bars hello friend i have iron bars hello friend i have iron bars', { maxLen: 35, delayTicks: 2 });
        check(sent.length > 1 && sent.every((r: any) => r.success), 'PM chunks were not sent');
        await wait(() => to.getChat({ includeSelf: false }).length >= baseline + sent.length, 'PM chunks');
        const received = to.getChat({ includeSelf: false }).slice(baseline).map((m: any) => m.text.trim().toLowerCase());
        check(JSON.stringify(received) === JSON.stringify(sent.map((r: any) => r.data.finalText.trim().toLowerCase())), 'PM delivery differs from outgoing text');
    }
    console.log('[smoke] PM chunks match in both directions');
    for (let i = 0; i < 2; i++) {
        const role = a0duo.roles[i]!, position = role.save.position;
        const move = await bots[i].walkTo(position.x, position.z + 1, 0);
        check(move.success && sdks[i].getState().player.worldZ === position.z + 1, `${role.username} cannot leave spawn: ${JSON.stringify(move)}`);
        check((await bots[i].walkTo(position.x, position.z, 0)).success, `${role.username} cannot return`);
    }
    console.log('[smoke] Both players can leave and return to their spawn tiles');
    let results;
    const tradeHold = Math.min(60, Math.max(0, Number(process.env.QB_SMOKE_TRADE_HOLD_SECS ?? 0)));
    if (tradeHold) {
        const opened = await Promise.all([bots[0].tradeWith('partner01'), bots[1].tradeWith('agent')]);
        check(opened.every(r => r.success), 'Could not open preview trade');
        await Promise.all([bots[0].offerTradeItems([{ item: /^coins$/i, amount: 150 }]), bots[1].offerTradeItems([{ item: /^iron bar$/i, amount: 5 }])]);
        console.log('[smoke] Holding offer screen for observer QA'); await Bun.sleep(tradeHold * 1000);
        await Promise.all(bots.map(b => b.acceptTrade()));
        console.log('[smoke] Holding confirmation screen for observer QA'); await Bun.sleep(tradeHold * 1000);
        results = await Promise.all(bots.map(b => b.acceptTrade()));
    } else results = await Promise.all([
        bots[0].trade('partner01', { give: [{ item: /^coins$/i, amount: 150 }], want: [{ item: /^iron bar$/i, amount: 5 }] }),
        bots[1].trade('agent', { give: [{ item: /^iron bar$/i, amount: 5 }], want: [{ item: /^coins$/i, amount: 150 }] }),
    ]);
    check(results.every(r => r.success), `Trade failed: ${JSON.stringify(results)}`);
    const count = (sdk: any, id: number) => sdk.getState().inventory.filter((x: any) => x.id === id).reduce((n: number, x: any) => n + x.count, 0);
    check(count(buyer, 995) === 850 && count(buyer, 2351) === 5 && count(seller, 995) === 150 && count(seller, 2351) === 0, 'Unexpected final inventories');
    if (process.env.QB_SMOKE_LAB === '1') {
        const base = 'http://localhost:8888/qb-control';
        const headers = { 'content-type': 'application/json', 'x-qb-control': readFileSync('/run/qb/studio-token', 'utf8') };
        check((await fetch(base + '?player=agent')).status === 403, 'Unauthenticated operator endpoint is accessible');
        const inspect = async () => { const r = await fetch(base + '?player=agent', { headers }); check(r.ok, await r.clone().text()); return r.json(); };
        let current = await inspect();
        const apply = async (change: any) => {
            const body = { username: 'agent', expectedRevision: current.revisions[change.action === 'move' ? 'position' : change.store], reason: 'Deterministic operator smoke test', ...change };
            const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) }); check(r.ok, await r.clone().text()); current = await r.json();
            return body;
        };
        const bar = current.stores.inventory.find((x: any) => x.id === 2351);
        const stale = await apply({ action: 'set-slot', store: 'inventory', slot: bar.slot, item: null });
        check((await fetch(base, { method: 'POST', headers, body: JSON.stringify(stale) })).status === 409, 'Stale operator edit was accepted');
        await apply({ action: 'set-slot', store: 'inventory', slot: bar.slot, item: { id: bar.id, count: bar.count } });
        const bank = current.stores.bank[0];
        await apply({ action: 'set-slot', store: 'bank', slot: 0, item: { id: 995, count: 25 } });
        await apply({ action: 'set-slot', store: 'bank', slot: 0, item: bank.id === null ? null : { id: bank.id, count: bank.count } });
        const worn = current.stores.equipment[3];
        await apply({ action: 'set-slot', store: 'equipment', slot: 3, item: { id: 1277, count: 1 } });
        await apply({ action: 'set-slot', store: 'equipment', slot: 3, item: worn.id === null ? null : { id: worn.id, count: worn.count } });
        await apply({ action: 'move', position: { x: 3222, z: 3219, level: 0 } });
        await apply({ action: 'move', position: { x: 3222, z: 3218, level: 0 } });
        check(readFileSync('/logs/tracking/interventions.jsonl', 'utf8').includes('"phase":"applied"'), 'No intervention audit');
        console.log('[smoke] Inventory, equipment, bank and movement edits passed; unauthenticated and stale edits rejected');
    }
    console.log(JSON.stringify({ ok: true, pm: 'both directions, multiple chunks', movement: 'both spawns', trade: '150 coins for 5 iron bars' }));
    const hold = Math.min(3600, Math.max(0, Number(process.env.QB_SMOKE_HOLD_SECS ?? 0)));
    if (hold) {
        mkdirSync('/logs/tracking', { recursive: true });
        writeFileSync('/logs/tracking/qb_start.txt', new Date().toISOString());
        console.log(`[smoke] Read-only viewer preview for ${hold}s; no LLM is running`);
        const end = Date.now() + hold * 1000;
        while (Date.now() < end) {
            if (process.env.QB_SMOKE_STATIC_PREVIEW === '1') { await Bun.sleep(1000); continue; }
            for (const dz of [3, 0]) {
                await Promise.all(bots.map((bot: any, i: number) => bot.walkTo(a0duo.roles[i]!.save.position.x, a0duo.roles[i]!.save.position.z + dz, 0)));
                await Bun.sleep(3000);
            }
        }
    }
} finally {
    for (const sdk of sdks) sdk.disconnect();
    for (const proc of processes) proc.kill();
}
