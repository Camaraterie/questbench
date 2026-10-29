/** Run from smoke-duo inside --network none. Fake model server exercises real OpenCode tool routing. */
import { mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { parseSave, countItem } from '../src/save/parse';
import { createHash } from 'node:crypto';
import { bundleTrial } from './bundle-from-harbor';
import { returnPlan } from '../src/continuity';
export async function harnessSmoke() {
    const count: Record<string, { play: number; memory: number }> = {};
    const server = Bun.serve({ hostname: '127.0.0.1', port: 19191, async fetch(req) {
        const body = await req.json();
        const seat = req.headers.get('x-qb-seat')!;
        if (!['agent', 'partner01'].includes(seat)) return new Response('missing fixture seat', { status: 400 });
        const tools = body.tools?.map((t: any) => t.function.name) ?? [];
        const codeTool = tools.find((name: string) => name.endsWith('execute_code'));
        // OpenCode also makes title-generation calls without tools; these are not agent phases.
        if (!tools.length) {
            if (body.stream) return new Response('data: ' + JSON.stringify({ id: 'fixture-title', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Fixture' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
            return Response.json({ id: 'title-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        }
        const memory = !codeTool;
        if (memory && (tools.includes('bash') || tools.some((name: string) => name.startsWith('rs-agent')))) throw new Error('Gameplay tool leaked into memory phase');
        const phase = memory ? 'memory' : 'play';
        count[seat] ??= { play: 0, memory: 0 };
        const n = ++count[seat]![phase];
        let delta: any = { role: 'assistant', content: 'Fixture completed.' }, reason = 'stop';
        if (n === 1) {
            const name = memory ? tools.find((name: string) => name.endsWith('write_journal')) : codeTool;
            if (!tools.includes(name)) throw new Error(`Required fixture tool missing: ${name}; tools=${tools}`);
            const other = seat === 'agent' ? 'partner01' : 'agent';
            const item = seat === 'agent' ? 'iron bar' : 'coins';
            const args = memory ? { expectedHash: createHash('sha256').update(readFileSync(`/seats/${seat}/JOURNAL.md`)).digest('hex'), content: `${seat}: I observed fixturePlay during my activity. This is my own updated memory.` } : { bot_name: seat, code: `const opened = await bot.tradeWith('${other}'); if (!opened.success) throw new Error(opened.message); const offered = await bot.offerTradeItems([{item: /^${item}$/i, amount: 1}]); if (!offered.success) throw new Error(offered.message); return {fixturePlay: true, pendingTrade: true};` };
            delta = { role: 'assistant', tool_calls: [{ index: 0, id: `call_${seat}_${phase}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
            reason = 'tool_calls';
        }
        const chunk = (choices: any[], usage?: any) => 'data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'glm-5.3', choices, ...(usage ? { usage } : {}) }) + '\n\n';
        return new Response(chunk([{ index: 0, delta, finish_reason: null }]) + chunk([{ index: 0, delta: {}, finish_reason: reason }], { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
        Bun.spawnSync(['bash', '/qb/isolate-aids.sh'], { env: { ...process.env, QB_AIDS: '0' } });
        for (const user of ['seat1', 'seat2']) {
            if (Bun.spawnSync(['runuser', '-u', user, '--', 'test', '-r', '/qb/aids/board.ts']).exitCode === 0) throw new Error('Unaided seat can read board tooling');
            if (Bun.spawnSync(['runuser', '-u', user, '--', 'test', '-w', '/var/qb/board']).exitCode === 0) throw new Error('Unaided seat can write board');
        }
        const seats = ['agent', 'partner01'];
        writeFileSync('/qb/seats.json', JSON.stringify(seats.map(username => ({ username, brief: 'Read your journal; use execute_code to observe the world, then finish.', initialJournal: 'Initial fixture memory', sessionPolicy: 'finish', discloseDeadline: false }))));
        mkdirSync('/run/qb', { recursive: true });
        writeFileSync('/run/qb/models.json', JSON.stringify({ seats: Object.fromEntries(seats.map(seat => [seat, { model: 'zai-coding-plan/glm-5.3', provider: { 'zai-coding-plan': { options: { baseURL: 'http://127.0.0.1:19191/v1', apiKey: 'local-fixture', headers: { 'x-qb-seat': seat } }, models: { 'glm-5.3': {} } } } }])), env: { ZHIPU_API_KEY: 'local-fixture' } }));
        const launcher = Bun.spawn(['bun', '/qb/seats/launch.ts'], { env: { ...process.env, QB_DURATION_SECS: '180', QB_AIDS: '0' }, stdout: Bun.file('/tmp/qb-harness-launch.log'), stderr: Bun.file('/tmp/qb-harness-launch.log') });
        const timer = setTimeout(() => launcher.kill(), 420000);
        const code = await launcher.exited; clearTimeout(timer);
        if (code !== 0 || readFileSync('/logs/seats/done', 'utf8').trim() !== '0 0') throw new Error('Fixture launcher failed; inspect /tmp/qb-harness-launch.log');
        const checkpoint = JSON.parse(readFileSync('/logs/tracking/final-checkpoint/checkpoint.json', 'utf8'));
        if (!checkpoint.valid || checkpoint.players.length !== 2) throw new Error('Missing grouped engine checkpoint');
        if (checkpoint.recoveredTemporaryItems < 2) throw new Error('Pending-trade recovery was not exercised');
        for (const seat of seats) {
            const phase = JSON.parse(readFileSync(`/logs/seats/${seat}/memory-phase.json`, 'utf8'));
            if (!phase.valid || count[seat]!.play < 2 || count[seat]!.memory < 2) throw new Error(`Incomplete fixture phases: ${seat} ${JSON.stringify(count[seat])} ${JSON.stringify(phase)}`);
            if (!readFileSync(`/seats/${seat}/JOURNAL.md`, 'utf8').includes('updated memory')) throw new Error('Journal not updated');
            const saved = parseSave(new Uint8Array(readFileSync(`/logs/tracking/final-checkpoint/end.${seat}.sav`)));
            if (countItem(saved, 995) !== (seat === 'agent' ? 850 : 150) || countItem(saved, 2351) !== (seat === 'agent' ? 5 : 0)) throw new Error('Checkpoint lost pending trade escrow');
        }
        console.log('[smoke] Real OpenCode received execute_code, called it, then updated private journals with gameplay tools disabled; grouped saves and unaided isolation passed');
        const collect = Bun.spawnSync(['bash', '/qb/collect-artifacts.sh'], { env: { ...process.env, QB_EXPLORATORY: '1', QB_TASK: 'a0-return-fixture-journal-20m' }, stdout: 'pipe', stderr: 'pipe' });
        if (collect.exitCode !== 0) throw new Error('Fixture artifact collection failed');
        const trial = '/tmp/qb-fixture-job/trial';
        mkdirSync(trial + '/verifier', { recursive: true });
        cpSync('/logs/verifier/qb', trial + '/verifier/qb', { recursive: true });
        const bundled = bundleTrial(trial, '/tmp/qb-fixture-job', { out: '/tmp/qb-fixture-bundles', tasksDir: '/tmp/no-tasks', handle: 'local-no-model-fixture', licence: 'CC-BY-4.0' });
        const next = returnPlan(bundled.bundle!);
        for (const role of next.scenario.roles) if (!role.initialJournal?.includes('updated memory')) throw new Error('Collected return lost new journal content');
        console.log('[smoke] Collection, bundle redaction/integrity and next fresh-context return preserved updated journals and exact engine checkpoint saves');
    } finally { server.stop(true); }
}
