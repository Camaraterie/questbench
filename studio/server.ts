#!/usr/bin/env bun
/**
 * QuestBench Studio: one local web page to launch, watch and review runs.
 *   bun studio            (or: bun studio/server.ts)   ->  http://localhost:4747
 *
 * Read-only toward experiments: it reads files the container already writes (via `docker exec cat`)
 * and grabs screenshots of the virtual display. It never logs into the game, so watching cannot
 * change a run. The Launch tab starts scripts/run-pilot.sh as a child process.
 *
 * Env: QB_STUDIO_PORT (4747), QB_RUNS_DIR (../questbench-runs), QB_STUDIO_MOCK=<dir> (serve a fake
 * "container" from a directory, for development). Secrets such as ZHIPU_API_KEY can live in a
 * gitignored .env.local at the repo root; Studio loads it for runs it launches.
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseJsonl, parseTrajectory, partnerProgress } from './parse';
import { observerRelay } from './observer';
import { observerCaptions } from './captions';
import { resolveTasks } from '../src/scenarios';
import { customScenario, editableScenario } from '../src/scenarios/custom';

const ROOT = resolve(process.env.QB_STUDIO_ROOT ?? resolve(import.meta.dir, '..'));
const PORT = Number(process.env.QB_STUDIO_PORT ?? 4747);
const BUNDLES = join(ROOT, 'bundles');
const RUNS_DIR = resolve(ROOT, process.env.QB_RUNS_DIR ?? '../questbench-runs');
const MOCK = process.env.QB_STUDIO_MOCK ? resolve(process.env.QB_STUDIO_MOCK) : null;
const VIEWER = resolve(ROOT, 'vendor/viewer-build');
const VIEWER_CACHE = resolve(ROOT, 'vendor/viewer-cache');
let captionContext: { container?: string; events: any[]; reasoning: any[] } = { events: [], reasoning: [] };
const observer = observerRelay(findContainer, () => captionContext.container === observer.status().container ? observerCaptions(captionContext.events, captionContext.reasoning) : {});
const SCENARIO_DIR = resolve(process.env.QB_STUDIO_SCENARIO_DIR ?? join(ROOT, '.qb-scenarios'));

// ── .env.local (gitignored) for launched runs ──
const launchEnv: Record<string, string> = { ...process.env } as Record<string, string>;
if (existsSync(join(ROOT, '.env.local'))) {
    for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) launchEnv[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
}

function sh(cmd: string[], opts: { cwd?: string } = {}): { ok: boolean; out: string; bytes?: Uint8Array } {
    try {
        const r = Bun.spawnSync(cmd, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
        return { ok: r.exitCode === 0, out: r.stdout.toString(), bytes: r.stdout };
    } catch { return { ok: false, out: '' }; }
}

// ── Live container access ──
// Every poll used to make ~10 blocking `docker exec` calls (~2.5 s on WSL, stalling the whole server).
// Now: one async exec for all files plus one for reasoning, cached briefly and shared by every tab.
async function run(cmd: string[], stdin?: string, timeout = 10_000): Promise<{ ok: boolean; out: string; bytes: Uint8Array }> {
    try {
        const p = Bun.spawn(cmd, { stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'ignore', timeout, killSignal: 'SIGKILL' });
        const bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
        return { ok: (await p.exited) === 0, out: new TextDecoder().decode(bytes), bytes };
    } catch { return { ok: false, out: '', bytes: new Uint8Array() }; }
}
// Harbor names trial containers <task-slug>__<trial>__...; task slugs start with a track letter + number.
const TASK_RE = /^[a-e]\d-[\w-]+__/i;
let containerCache = { at: 0, name: null as string | null };
export async function findContainer(): Promise<string | null> {
    if (MOCK) return 'mock';
    if (process.env.QB_STUDIO_CONTAINER) return process.env.QB_STUDIO_CONTAINER;
    if (Date.now() - containerCache.at < 5000) return containerCache.name;
    const r = await run(['docker', 'ps', '--format', '{{.Names}}']);
    containerCache = { at: Date.now(), name: r.ok ? r.out.split('\n').find(n => TASK_RE.test(n)) ?? null : null };
    return containerCache.name;
}
const LIVE_FILES = {
    agent: '/logs/agent/opencode*.txt', partner: '/logs/partners/partner01.jsonl', start: '/logs/tracking/qb_start.txt',
    warnings: '/logs/partners/WARNINGS.txt', lite: '/logs/partners/partner01.lite.log', events: '/logs/tracking/events.jsonl',
    reports: '/var/qb/reports/reports.jsonl', board: '/var/qb/board/board.jsonl',
    seats: '/logs/seats/seats.json', seatLite: '/logs/seats/partner01.lite.log',
};
type LiveFiles = Record<keyof typeof LIVE_FILES | 'env' | 'reasoning', string> & { seatLanes?: SeatLane[] };
interface SeatLane { username: string; user: string; log: string; reasoning: string }
const SEP = '\n<<<QB-STUDIO:';
async function readLive(container: string): Promise<LiveFiles> {
    if (MOCK) {
        const read = (path: string) => {
            const rel = path.replace(/^\//, '');
            if (rel.includes('*')) return [...new Bun.Glob(rel).scanSync({ cwd: MOCK })].map(f => readFileSync(join(MOCK, f), 'utf8')).join('\n');
            const p = join(MOCK, rel); return existsSync(p) ? readFileSync(p, 'utf8') : '';
        };
        const out = Object.fromEntries(Object.entries(LIVE_FILES).map(([k, p]) => [k, read(p)])) as unknown as LiveFiles;
        const seatLanes = out.seats ? (JSON.parse(out.seats) as Array<{ username: string; user: string }>).map(x => ({ ...x, log: read(`/logs/seats/${x.username}/opencode.txt`), reasoning: read(`/logs/seats/${x.username}/reasoning.jsonl`) })) : undefined;
        return { ...out, env: 'QB_TASK=a0-rendezvous-punctual-bare-15m\nQB_DURATION_SECS=900', reasoning: read('/logs/agent/reasoning.jsonl'), seatLanes };
    }
    const script = [`printf '${SEP}env>>>\\n'; env | grep ^QB_`, ...Object.entries(LIVE_FILES).map(([k, p]) => `printf '${SEP}${k}>>>\\n'; cat ${p} 2>/dev/null`)].join('; ');
    const [files, reasoning] = await Promise.all([
        run(['docker', 'exec', container, 'sh', '-c', script]),
        run(['docker', 'exec', '-i', container, 'bun', '-', '/home/agent/.local/share/opencode/opencode.db'], DUMP_REASONING),
    ]);
    const out: Record<string, string> = { reasoning: reasoning.out };
    for (const chunk of files.out.split(SEP).slice(1)) { const i = chunk.indexOf('>>>\n'); if (i > 0) out[chunk.slice(0, i)] = chunk.slice(i + 4); }
    // Pair tier: each seat's OpenCode log and reasoning (second round; seat names come from seats.json).
    let seatLanes: SeatLane[] | undefined;
    try {
        const seats = out.seats?.trim() ? JSON.parse(out.seats) as Array<{ username: string; user: string }> : [];
        if (seats.length) seatLanes = await Promise.all(seats.filter(x => /^[a-z0-9_]+$/.test(x.username) && /^seat\d+$/.test(x.user)).map(async x => {
            const [log, r] = await Promise.all([
                run(['docker', 'exec', container, 'cat', `/logs/seats/${x.username}/opencode.txt`]),
                run(['docker', 'exec', '-i', container, 'bun', '-', `/home/${x.user}/.local/share/opencode/opencode.db`], DUMP_REASONING),
            ]);
            return { ...x, log: log.out, reasoning: r.out };
        }));
    } catch { /* seats.json mid-write */ }
    return { ...(out as LiveFiles), seatLanes };
}
// Images built before docker/dump-reasoning.ts existed lack it, so Studio pipes its own copy in.
const DUMP_REASONING = readFileSync(join(ROOT, 'docker', 'dump-reasoning.ts'), 'utf8');

async function buildSnapshot() {
    const c = await findContainer();
    if (!c) { captionContext = { events: [], reasoning: [] }; return { live: false }; }
    const f = await readLive(c);
    const env = Object.fromEntries((f.env ?? '').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const partner = parseJsonl(f.partner ?? ''), lite = f.lite || f.seatLite || '';
    captionContext = { container: c, events: parseJsonl(f.events ?? ''), reasoning: f.seatLanes?.map(s => ({ username: s.username, parts: parseJsonl(s.reasoning) })) ?? [{ username: env.QB_AGENT ?? 'agent', parts: parseJsonl(f.reasoning ?? '') }] };
    return {
        live: true, container: c, task: env.QB_TASK ?? '', aids: env.QB_AIDS === '1', durationSecs: Number(env.QB_DURATION_SECS ?? 900), startedAt: (f.start ?? '').trim(),
        steps: parseTrajectory(f.agent ?? '', parseJsonl(f.reasoning ?? '')),
        events: parseJsonl(f.events ?? ''),
        partner, progress: partnerProgress(partner),
        partnerLoggedIn: /logged into/.test(lite), partnerError: /ConnectionRefused|error:/i.test(lite) && !/logged into/.test(lite) ? lite.split('\n').filter(Boolean).slice(-3).join('\n') : null,
        reports: parseJsonl(f.reports ?? ''), board: parseJsonl(f.board ?? ''),
        warnings: (f.warnings ?? '').trim() || null,
        seats: f.seatLanes?.map(x => ({ username: x.username, steps: parseTrajectory(x.log, parseJsonl(x.reasoning)) })),
    };
}
function cached<T>(build: () => Promise<T>): () => Promise<T> {
    let p: Promise<T> | undefined, settledAt = 0, pending = false;
    return () => {
        if (!p || (!pending && Date.now() - settledAt > 1500)) {
            pending = true;
            p = build().finally(() => { pending = false; settledAt = Date.now(); });
        }
        return p;
    };
}
const snapshot = cached(buildSnapshot);
export function liveSnapshot(): Promise<any> {
    return snapshot();
}

// One JPEG grab of the virtual display at a time; concurrent requests share it.
const screenshot = cached(async (): Promise<Uint8Array | null> => {
    const c = await findContainer();
    if (!c || MOCK) return null;
    const r = await run(['docker', 'exec', c, 'timeout', '-s', 'KILL', '8s', 'ffmpeg', '-loglevel', 'error', '-f', 'x11grab', '-video_size', '800x600', '-i', ':99', '-frames:v', '1', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']);
    return r.ok && r.bytes.length > 100 ? r.bytes : null;
});

// ── Finished runs: local bundles + the results repo index ──
interface RunRef { id: string; dir: string; source: 'local' | 'results-repo' }
function runRefs(): RunRef[] {
    const refs: RunRef[] = [];
    if (existsSync(BUNDLES)) for (const n of readdirSync(BUNDLES)) { const d = join(BUNDLES, n); if (existsSync(join(d, 'manifest.json'))) refs.push({ id: n.replace(/^run-/, ''), dir: d, source: 'local' }); }
    const walk = (d: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d)) { const p = join(d, e); if (!statSync(p).isDirectory()) continue; if (existsSync(join(p, 'manifest.json'))) { const id = e.replace(/^run-/, ''); if (!refs.some(r => r.id === id)) refs.push({ id, dir: p, source: 'results-repo' }); } else walk(p); } };
    walk(join(RUNS_DIR, 'runs'));
    return refs;
}
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function runSummary(r: RunRef) {
    const m = readJson(join(r.dir, 'manifest.json')) ?? {};
    const v = readJson(join(r.dir, 'verdict.json'));
    const seatModels = Array.isArray(m.seats) ? m.seats.map((x: any) => x.model) : null;
    const exploratory = m.conditions?.exploratory || m.conditions?.intervened;
    return { id: r.id, source: r.source, slug: m.task?.slug, model: seatModels ? seatModels.join(' vs ') : m.model?.id, harness: m.model?.harness, startedAt: m.startedAt, contributor: m.contributor?.handle, exploratory,
        success: v && !exploratory ? !!(v.jointCompletion ?? v.fairTradeCompleted) : null, reward: exploratory ? null : v?.reward ?? null, hasVideo: existsSync(join(r.dir, 'recording.mp4')), costUsd: m.usage?.costUsd ?? null };
}

function runDetail(r: RunRef) {
    const agentDir = join(r.dir, 'agent');
    let agentLog = '';
    // The OpenCode stream only: trajectory.json is a pretty-printed summary that parsed as ~1,400 junk notes.
    if (existsSync(agentDir)) for (const f of readdirSync(agentDir)) if (/^opencode.*\.txt$|\.jsonl$/.test(f)) agentLog += readText(join(agentDir, f)) + '\n';
    const partner = parseJsonl(readText(join(r.dir, 'partners', 'partner01.jsonl')));
    return { ...runSummary(r), manifest: readJson(join(r.dir, 'manifest.json')), verdict: readJson(join(r.dir, 'verdict.json')),
        steps: parseTrajectory(agentLog, parseJsonl(readText(join(r.dir, 'agent-reasoning.jsonl')))), events: parseJsonl(readText(join(r.dir, 'events.jsonl'))), partner, progress: partnerProgress(partner),
        reports: parseJsonl(readText(join(r.dir, 'reports.jsonl'))), warnings: readText(join(r.dir, 'WARNINGS.txt')).trim() || null,
        seats: seatLanes(r.dir) };
}
function seatLanes(dir: string) {
    const list = readJson(join(dir, 'seats', 'seats.json')) as Array<{ username: string }> | null;
    return list?.map(({ username }) => ({ username, steps: parseTrajectory(readText(join(dir, 'seats', username, 'opencode.txt')), parseJsonl(readText(join(dir, 'seats', username, 'reasoning.jsonl')))) }));
}

// ── Preflight + launch ──
function preflight() {
    const has = (c: string) => sh(['sh', '-c', `command -v ${c}`]).ok;
    return [
        { name: 'Docker installed', ok: has('docker'), fix: 'Install Docker Desktop and enable WSL integration for your distro' },
        { name: 'Docker engine running', ok: sh(['docker', 'info']).ok, fix: 'Start Docker Desktop' },
        { name: 'Harbor installed', ok: has('harbor'), fix: 'uv tool install harbor' },
        { name: 'z.ai key (ZHIPU_API_KEY)', ok: !!launchEnv.ZHIPU_API_KEY, fix: 'Add ZHIPU_API_KEY=... to .env.local in the repo (gitignored)' },
        { name: 'RuneBench clone (../RuneBench)', ok: existsSync(resolve(ROOT, '../RuneBench/agents/opencode_adapter.py')), fix: 'git clone https://github.com/MaxBittker/RuneBench ../RuneBench' },
        { name: 'Results repo (../questbench-runs)', ok: existsSync(join(RUNS_DIR, '.git')), fix: 'Cloned automatically on first publish (needs gh auth login once)' },
    ];
}

let launch: { proc: ReturnType<typeof Bun.spawn> | null; log: string; startedAt: string | null; args: string[] } = { proc: null, log: '', startedAt: null, args: [] };
const MODEL_RE = /^[\w.-]+\/[\w.:-]+$/;
let startingLaunch = false;
async function startLaunch(body: { variant?: string; scenario?: string; customId?: string; all?: boolean; trials?: number; publish?: boolean; duo?: boolean; seatModels?: Record<string, string> }) {
    if (startingLaunch || (launch.proc && launch.proc.exitCode === null)) return { ok: false, error: 'A run is already in progress' };
    startingLaunch = true;
    try {
    if (body.scenario === 'lab' && !body.customId) return { ok: false, error: 'Save the custom scenario before launching it' };
    // Disposable viewer previews must not compete with a scored trial for CPU. Only touch
    // containers explicitly labeled as our preview, never arbitrary running experiments.
    const previews = await run(['docker', 'ps', '-q', '--filter', 'label=questbench.observer-preview=1']);
    if (previews.ok) for (const id of previews.out.trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id))) {
        const stopped = await run(['docker', 'stop', '-t', '2', id]);
        if (!stopped.ok) return { ok: false, error: 'Could not stop the observer preview before the trial' };
    }
    const trials = String(Math.max(1, Math.min(10, body.trials ?? 1)));
    const args = body.duo
        ? ['./scripts/run-pilot.sh', '--duo', '-k', trials]
        : ['./scripts/run-pilot.sh', '--glm', '--runebench', '../RuneBench', '-k', trials];
    if (body.duo) {
        if (body.customId) {
            if (!/^a0-lab-[a-f0-9]{12}$/.test(body.customId) || !existsSync(join(SCENARIO_DIR, body.customId + '.json'))) return { ok: false, error: 'Save the custom scenario first' };
            args.push('--scenario-file', join(SCENARIO_DIR, body.customId + '.json'));
        } else if (body.scenario === 'workshop-requisition' || body.scenario === 'workshop-livelihood') args.push('-t', `a0-workshop-${body.scenario.slice('workshop-'.length)}-20m`);
        else if (body.variant && /^[a-z-]+$/.test(body.variant)) args.push('-t', `a0-duo-${body.variant}-15m`);
        const pairs = Object.entries(body.seatModels ?? {}).filter(([seat, m]) => /^[a-z0-9_]+$/.test(seat) && MODEL_RE.test(m));
        if (pairs.length) args.push('--seat-models', pairs.map(([seat, m]) => `${seat}=${m}`).join(','));
    } else if (body.all) args.push('--all'); else if (body.variant && /^[a-z-]+$/.test(body.variant)) args.push('-t', body.variant);
    if (body.publish === false) args.push('--no-publish');
    const proc = Bun.spawn(['bash', ...args], { cwd: ROOT, env: launchEnv, stdout: 'pipe', stderr: 'pipe' });
    launch = { proc, log: '', startedAt: new Date().toISOString(), args };
    const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const ch of s) { launch.log += d.decode(ch).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); if (launch.log.length > 200_000) launch.log = launch.log.slice(-150_000); } };
    pump(proc.stdout); pump(proc.stderr);
    return { ok: true };
    } finally { startingLaunch = false; }
}

async function stopLaunch() {
    const proc = launch.proc;
    if (!proc || proc.exitCode !== null) return;
    // Harbor is a direct child of run-pilot.sh. SIGINT lets it tear down its containers.
    const children = await run(['ps', '-axo', 'pid=,ppid=,args=']);
    if (!children.ok || launch.proc !== proc || proc.exitCode !== null) return;
    for (const line of children.out.split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        if (m && Number(m[2]) === proc.pid && /^(?:\S*\/)?(?:python[\d.]*\s+)?(?:\S*\/)?harbor\s+run(?:\s|$)/.test(m[3]!)) {
            try { process.kill(Number(m[1]), 'SIGINT'); } catch { /* Child already exited. */ }
        }
    }
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function localGame(container: string, port: number, path: string, body?: any) {
    const script = `const q=JSON.parse(await Bun.stdin.text());try{const headers={'content-type':'application/json'};if(q.port===8888&&q.path.startsWith('/qb-control'))headers['x-qb-control']=await Bun.file('/run/qb/studio-token').text();const r=await fetch('http://localhost:'+q.port+q.path,{method:q.body?'POST':'GET',headers,body:q.body?JSON.stringify(q.body):undefined,signal:AbortSignal.timeout(3000)});console.log(JSON.stringify({status:r.status,data:await r.json()}))}catch(e){console.log(JSON.stringify({status:503,data:{error:String(e)}}))}`;
    const result = await run(['docker', 'exec', '-i', container, 'bun', '-e', script], JSON.stringify({ port, path, body }));
    if (!result.ok) return { status: 503, data: { error: 'The local container is unavailable' } };
    try { return JSON.parse(result.out); } catch { return { status: 503, data: { error: 'Invalid response from local engine' } }; }
}

async function operatorApi(req: Request, url: URL): Promise<Response> {
    if (req.method === 'POST' && req.headers.get('origin') !== url.origin) return json({ error: 'Operator changes require the same Studio origin' }, 403);
    if (url.pathname === '/api/scenarios') {
        if (req.method === 'GET') {
            const templates: any[] = resolveTasks().filter(t => t.scenario.tier !== 'lite').map(t => ({ id: t.slug, note: t.variant.note, exploratory: !!t.variant.exploratory, config: editableScenario({ ...t.scenario, roles: t.roles, minutes: [t.minutes] }) }));
            if (existsSync(SCENARIO_DIR)) for (const name of readdirSync(SCENARIO_DIR).filter(n => /^a0-lab-[a-f0-9]{12}\.json$/.test(n))) {
                try { const s = customScenario(JSON.parse(readFileSync(join(SCENARIO_DIR, name), 'utf8'))); templates.push({ id: s.id, savedId: s.id, exploratory: true, config: editableScenario(s) }); } catch { /* Ignore invalid local drafts. */ }
            }
            return json(templates);
        }
        if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        try {
            const raw = await req.text(); if (raw.length > 100000) return json({ error: 'Scenario too large' }, 413);
            const scenario = customScenario(JSON.parse(raw));
            mkdirSync(SCENARIO_DIR, { recursive: true });
            writeFileSync(join(SCENARIO_DIR, scenario.id + '.json'), JSON.stringify(editableScenario(scenario), null, 2));
            return json({ id: scenario.id, config: editableScenario(scenario) });
        } catch (error) { return json({ error: String(error) }, 400); }
    }
    const container = await findContainer();
    if (!container || MOCK) return json({ error: 'No local world is running' }, 503);
    if (url.pathname === '/api/operator/players') {
        const r = await localGame(container, 8888, '/qb-observer');
        return json({ container, players: r.data?.roster?.p ?? [], error: r.data?.error }, r.status);
    }
    if (url.pathname === '/api/operator/items') {
        const r = await localGame(container, 8888, '/qb-control?items=' + encodeURIComponent((url.searchParams.get('q') ?? '').slice(0, 80)));
        return json(r.data, r.status);
    }
    if (url.pathname === '/api/operator/sprite') {
        const id = Number(url.searchParams.get('id')), count = Number(url.searchParams.get('count') ?? 1);
        if (!Number.isInteger(id) || id < 0 || id > 65534 || !Number.isInteger(count) || count < 1 || count > 1_000_000_000) return json({ error: 'Invalid item' }, 400);
        const r = await run(['docker', 'exec', container, 'curl', '-fsS', `http://localhost:8888/sprite/item/${id}-${count}.png`]);
        return r.ok ? new Response(r.bytes.slice().buffer, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } }) : new Response(null, { status: 404 });
    }
    if (url.pathname === '/api/operator/trades') {
        const names = (url.searchParams.get('players') ?? '').split(',').filter(Boolean);
        if (!names.length || names.length > 4 || names.some(n => !/^[a-z][a-z0-9_]{0,11}$/.test(n))) return json({ error: 'Invalid players' }, 400);
        const script = `const names=JSON.parse(await Bun.stdin.text());console.log(JSON.stringify(await Promise.all(names.map(async username=>{try{const r=await fetch('http://localhost:7780/state/'+username,{signal:AbortSignal.timeout(2000)});const s=await r.json();return{username,trade:s.state?.trade??null,stateAge:s.stateAge}}catch{return{username,trade:null}}}))))`;
        const r = await run(['docker', 'exec', '-i', container, 'bun', '-e', script], JSON.stringify(names));
        try { return json(JSON.parse(r.out)); } catch { return json({ error: 'Trade state unavailable' }, 503); }
    }
    const username = url.searchParams.get('player') ?? '';
    if (!/^[a-z][a-z0-9_]{0,11}$/.test(username)) return json({ error: 'Invalid player' }, 400);
    if (url.pathname === '/api/operator/player' && req.method === 'GET') {
        const inspection = await localGame(container, 8888, '/qb-control?player=' + username);
        return json({ ...inspection.data, container }, inspection.status);
    }
    if (url.pathname === '/api/operator/player' && req.method === 'POST') {
        let body; try { const raw = await req.text(); if (raw.length > 10000) return json({ error: 'Request too large' }, 413); body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (body.container !== container || body.username !== username) return json({ error: 'World/player changed; refresh the inspector' }, 409);
        const r = await localGame(container, 8888, '/qb-control', body);
        return json({ ...r.data, container }, r.status);
    }
    return json({ error: 'Unknown operator route' }, 404);
}

export function handle(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return new Response(Bun.file(join(import.meta.dir, 'index.html')), { headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
    if (p === '/observer-ui.js') return new Response(Bun.file(join(import.meta.dir, 'observer-ui.js')));
    if (p === '/lab-ui.js') return new Response(Bun.file(join(import.meta.dir, 'lab-ui.js')));
    if (p === '/api/scenarios' || p.startsWith('/api/operator/')) return operatorApi(req, url);
    if (p === '/api/observer') return json({ ...observer.status(), ready: existsSync(join(VIEWER, 'index.html')) && existsSync(join(VIEWER_CACHE, 'caches.json')) });
    if (p === '/viewer' || p.startsWith('/viewer/')) {
        const cache = p.startsWith('/viewer/caches/');
        const base = cache ? VIEWER_CACHE : VIEWER;
        let relative: string;
        try { relative = decodeURIComponent(cache ? p.slice('/viewer/caches/'.length) : p.slice('/viewer/'.length)); } catch { return new Response('bad path', { status: 400 }); }
        if (p === '/viewer' || p === '/viewer/') relative = 'index.html';
        const file = resolve(base, relative);
        if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return new Response('Viewer asset unavailable. Run bun run viewer:build.', { status: 404 });
        return new Response(Bun.file(file), { headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': cache ? 'public, max-age=86400' : 'no-cache' } });
    }
    if (p === '/api/live') return liveSnapshot().then(s => json(s));
    if (p === '/api/live/screen.jpg') return screenshot().then(img => img ? new Response(img.slice().buffer, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } }) : new Response('no screen', { status: 404 }));
    if (p === '/api/runs') return json(runRefs().map(runSummary).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))));
    const m = p.match(/^\/api\/runs\/([\w.-]+)(\/video\.mp4)?$/);
    if (m) {
        const r = runRefs().find(x => x.id === m[1]);
        if (!r) return json({ error: 'not found' }, 404);
        if (m[2]) { const f = join(r.dir, 'recording.mp4'); return existsSync(f) ? new Response(Bun.file(f), { headers: { 'content-type': 'video/mp4' } }) : new Response('no video', { status: 404 }); }
        return json(runDetail(r));
    }
    if (p === '/api/preflight') return json(preflight());
    if (p === '/api/launch' && req.method === 'POST') return req.json().catch(() => ({})).then(b => startLaunch(b as any)).then(r => json(r, r.ok ? 200 : 409));
    if (p === '/api/launch') return json({ running: !!launch.proc && launch.proc.exitCode === null, exitCode: launch.proc?.exitCode ?? null, startedAt: launch.startedAt, args: launch.args, log: launch.log.slice(-20_000) });
    if (p === '/api/launch/stop' && req.method === 'POST') {
        return stopLaunch().then(() => json({ ok: true }));
    }
    return new Response('not found', { status: 404 });
}

if (import.meta.main) {
    Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === '/observer-feed') {
            if (req.headers.get('origin') !== url.origin) return new Response('Same-origin observer only', { status: 403 });
            return server.upgrade(req, { data: { area: { x: 3174, z: 3170, w: 96, h: 96 } } }) ? undefined : new Response('WebSocket required', { status: 426 });
        }
        return handle(req);
    }, websocket: observer.websocket });
    const url = `http://localhost:${PORT}`;
    console.log(`QuestBench Studio → ${url}${MOCK ? `  (mock: ${MOCK})` : ''}`);
    // Open the browser: WSL -> Windows default browser; macOS/Linux fallbacks.
    if (!process.env.QB_STUDIO_NO_OPEN) for (const cmd of [['wslview', url], ['cmd.exe', '/c', 'start', url], ['open', url], ['xdg-open', url]]) { if (sh(['sh', '-c', `command -v ${cmd[0]}`]).ok) { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }); break; } }
}
