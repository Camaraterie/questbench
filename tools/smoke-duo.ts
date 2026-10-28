#!/usr/bin/env bun
/** Deterministic, no-LLM check. Run only in a disposable QuestBench container with --network none.
 * Mount this checkout read-only at /workspace/qb and run bun /workspace/qb/tools/smoke-duo.ts
 * with the container entrypoint overridden. Seeds saves before starting local engine/gateway.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
    process.env.TELEMETRY = 'false';
    process.env.EASY_STARTUP = 'true'; process.env.FRIEND_SERVER = 'true';
    process.env.EVENT_LOG_FILE = '/tmp/qb-smoke-events.jsonl';
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
    const { BotSDK } = await import('/app/sdk/index.ts');
    const { BotActions } = await import('/app/sdk/actions.ts');
    sdks = a0duo.roles.map(role => new BotSDK({ botUsername: role.username, password: 'test', gatewayUrl: 'ws://localhost:7780', autoLaunchBrowser: false, autoReconnect: false }));
    // Lite clients register asynchronously; connect once their status says they are in game.
    for (const role of a0duo.roles) await wait(async () => {
        try { const status = await (await fetch(`http://localhost:7780/status/${role.username}`)).json(); return status.inGame === true; } catch { return false; }
    }, `${role.username} login`);
    await Promise.all(sdks.map(s => s.connect()));
    const [buyer, seller] = sdks, bots = sdks.map(s => new BotActions(s));
    for (let i = 0; i < 2; i++) {
        const from = sdks[i], to = sdks[1 - i], target = a0duo.roles[1 - i].username;
        const baseline = to.getChat({ includeSelf: false }).length;
        const sent = await from.dm(target, 'hello friend i have iron bars hello friend i have iron bars hello friend i have iron bars', { maxLen: 35, delayTicks: 2 });
        check(sent.length > 1 && sent.every((r: any) => r.success), 'PM chunks were not sent');
        await wait(() => to.getChat({ includeSelf: false }).length >= baseline + sent.length, 'PM chunks');
        const received = to.getChat({ includeSelf: false }).slice(baseline).map((m: any) => m.text.trim().toLowerCase());
        check(JSON.stringify(received) === JSON.stringify(sent.map((r: any) => r.data.finalText.trim().toLowerCase())), 'PM delivery differs from outgoing text');
    }
    console.log('[smoke] PM chunks match in both directions');
    for (let i = 0; i < 2; i++) {
        const role = a0duo.roles[i], position = role.save.position!;
        const move = await bots[i].walkTo(position.x, position.z + 1, 0);
        check(move.success && sdks[i].getState().player.worldZ === position.z + 1, `${role.username} cannot leave spawn: ${JSON.stringify(move)}`);
        check((await bots[i].walkTo(position.x, position.z, 0)).success, `${role.username} cannot return`);
    }
    console.log('[smoke] Both players can leave and return to their spawn tiles');
    const results = await Promise.all([
        bots[0].trade('partner01', { give: [{ item: /^coins$/i, amount: 150 }], want: [{ item: /^iron bar$/i, amount: 5 }] }),
        bots[1].trade('agent', { give: [{ item: /^iron bar$/i, amount: 5 }], want: [{ item: /^coins$/i, amount: 150 }] }),
    ]);
    check(results.every(r => r.success), `Trade failed: ${JSON.stringify(results)}`);
    const count = (sdk: any, id: number) => sdk.getState().inventory.filter((x: any) => x.id === id).reduce((n: number, x: any) => n + x.count, 0);
    check(count(buyer, 995) === 850 && count(buyer, 2351) === 5 && count(seller, 995) === 150 && count(seller, 2351) === 0, 'Unexpected final inventories');
    console.log(JSON.stringify({ ok: true, pm: 'both directions, multiple chunks', movement: 'both spawns', trade: '150 coins for 5 iron bars' }));
    const hold = Math.min(3600, Math.max(0, Number(process.env.QB_SMOKE_HOLD_SECS ?? 0)));
    if (hold) {
        mkdirSync('/logs/tracking', { recursive: true });
        writeFileSync('/logs/tracking/qb_start.txt', new Date().toISOString());
        console.log(`[smoke] Read-only viewer preview for ${hold}s; no LLM is running`);
        const end = Date.now() + hold * 1000;
        while (Date.now() < end) {
            for (const dz of [3, 0]) {
                await Promise.all(bots.map((bot: any, i: number) => bot.walkTo(a0duo.roles[i].save.position.x, a0duo.roles[i].save.position.z + dz, 0)));
                await Bun.sleep(3000);
            }
        }
    }
} finally {
    for (const sdk of sdks) sdk.disconnect();
    for (const proc of processes) proc.kill();
}
