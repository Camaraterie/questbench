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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseJsonl, parseTrajectory, partnerProgress } from './parse';

const ROOT = resolve(import.meta.dir, '..');
const PORT = Number(process.env.QB_STUDIO_PORT ?? 4747);
const BUNDLES = join(ROOT, 'bundles');
const RUNS_DIR = resolve(ROOT, process.env.QB_RUNS_DIR ?? '../questbench-runs');
const MOCK = process.env.QB_STUDIO_MOCK ? resolve(process.env.QB_STUDIO_MOCK) : null;

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
        const out = Object.fromEntries(Object.entries(LIVE_FILES).map(([k, p]) => [k, read(p)])) as LiveFiles;
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
    if (!c) return { live: false };
    const f = await readLive(c);
    const env = Object.fromEntries((f.env ?? '').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const partner = parseJsonl(f.partner ?? ''), lite = f.lite || f.seatLite || '';
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
    return { id: r.id, source: r.source, slug: m.task?.slug, model: seatModels ? seatModels.join(' vs ') : m.model?.id, harness: m.model?.harness, startedAt: m.startedAt, contributor: m.contributor?.handle,
        success: v ? !!(v.jointCompletion ?? v.fairTradeCompleted) : null, reward: v?.reward ?? null, hasVideo: existsSync(join(r.dir, 'recording.mp4')), costUsd: m.usage?.costUsd ?? null };
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
async function startLaunch(body: { variant?: string; all?: boolean; trials?: number; publish?: boolean; duo?: boolean; seatModels?: Record<string, string> }) {
    if (launch.proc && launch.proc.exitCode === null) return { ok: false, error: 'A run is already in progress' };
    const trials = String(Math.max(1, Math.min(10, body.trials ?? 1)));
    const args = body.duo
        ? ['./scripts/run-pilot.sh', '--duo', '-k', trials]
        : ['./scripts/run-pilot.sh', '--glm', '--runebench', '../RuneBench', '-k', trials];
    if (body.duo) {
        if (body.variant && /^[a-z-]+$/.test(body.variant)) args.push('-t', `a0-duo-${body.variant}-15m`);
        const pairs = Object.entries(body.seatModels ?? {}).filter(([seat, m]) => /^[a-z0-9_]+$/.test(seat) && MODEL_RE.test(m));
        if (pairs.length) args.push('--seat-models', pairs.map(([seat, m]) => `${seat}=${m}`).join(','));
    } else if (body.all) args.push('--all'); else if (body.variant && /^[a-z-]+$/.test(body.variant)) args.push('-t', body.variant);
    if (body.publish === false) args.push('--no-publish');
    const proc = Bun.spawn(['bash', ...args], { cwd: ROOT, env: launchEnv, stdout: 'pipe', stderr: 'pipe' });
    launch = { proc, log: '', startedAt: new Date().toISOString(), args };
    const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const ch of s) { launch.log += d.decode(ch).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); if (launch.log.length > 200_000) launch.log = launch.log.slice(-150_000); } };
    pump(proc.stdout); pump(proc.stderr);
    return { ok: true };
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

export function handle(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return new Response(Bun.file(join(import.meta.dir, 'index.html')));
    if (p === '/api/live') return liveSnapshot().then(s => json(s));
    if (p === '/api/live/screen.jpg') return screenshot().then(img => img ? new Response(img, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } }) : new Response('no screen', { status: 404 }));
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
    Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: handle });
    const url = `http://localhost:${PORT}`;
    console.log(`QuestBench Studio → ${url}${MOCK ? `  (mock: ${MOCK})` : ''}`);
    // Open the browser: WSL -> Windows default browser; macOS/Linux fallbacks.
    if (!process.env.QB_STUDIO_NO_OPEN) for (const cmd of [['wslview', url], ['cmd.exe', '/c', 'start', url], ['open', url], ['xdg-open', url]]) { if (sh(['sh', '-c', `command -v ${cmd[0]}`]).ok) { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }); break; } }
}
