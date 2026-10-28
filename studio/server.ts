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
const TASK_RE = /(a0-rendezvous|a1-shield-of-arrav|c1-hidden-role-trade)/i;
export function findContainer(): string | null {
    if (MOCK) return 'mock';
    const r = sh(['docker', 'ps', '--format', '{{.Names}}']);
    return r.ok ? r.out.split('\n').find(n => TASK_RE.test(n)) ?? null : null;
}
function readIn(container: string, path: string): string {
    if (MOCK) {
        const rel = path.replace(/^\//, '');
        if (rel.includes('*')) return [...new Bun.Glob(rel).scanSync({ cwd: MOCK })].map(f => readFileSync(join(MOCK, f), 'utf8')).join('\n');
        const p = join(MOCK, rel); return existsSync(p) ? readFileSync(p, 'utf8') : '';
    }
    const r = sh(['docker', 'exec', container, 'sh', '-c', `cat ${path} 2>/dev/null`]);
    return r.ok ? r.out : '';
}
function liveEnv(container: string): Record<string, string> {
    if (MOCK) return { QB_TASK: 'a0-rendezvous-punctual-bare-15m', QB_DURATION_SECS: '900' };
    const r = sh(['docker', 'exec', container, 'sh', '-c', 'env | grep ^QB_']);
    return Object.fromEntries(r.out.split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

export function liveSnapshot() {
    const c = findContainer();
    if (!c) return { live: false };
    const env = liveEnv(c);
    const agentLog = readIn(c, '/logs/agent/opencode*.txt');
    const partner = parseJsonl(readIn(c, '/logs/partners/partner01.jsonl'));
    const startedAt = readIn(c, '/logs/tracking/qb_start.txt').trim();
    const warnings = readIn(c, '/logs/partners/WARNINGS.txt').trim();
    const lite = readIn(c, '/logs/partners/partner01.lite.log');
    return {
        live: true, container: c, task: env.QB_TASK ?? '', aids: env.QB_AIDS === '1', durationSecs: Number(env.QB_DURATION_SECS ?? 900), startedAt,
        steps: parseTrajectory(agentLog),
        events: parseJsonl(readIn(c, '/logs/tracking/events.jsonl')),
        partner, progress: partnerProgress(partner),
        partnerLoggedIn: /logged into/.test(lite), partnerError: /ConnectionRefused|error:/i.test(lite) && !/logged into/.test(lite) ? lite.split('\n').filter(Boolean).slice(-3).join('\n') : null,
        reports: parseJsonl(readIn(c, '/var/qb/reports/reports.jsonl')),
        board: parseJsonl(readIn(c, '/var/qb/board/board.jsonl')),
        warnings: warnings || null,
    };
}

let shotCache: { at: number; png: Uint8Array | null } = { at: 0, png: null };
function screenshot(): Uint8Array | null {
    if (Date.now() - shotCache.at < 1000) return shotCache.png;
    const c = findContainer();
    if (!c || MOCK) return null;
    const r = sh(['docker', 'exec', c, 'sh', '-c', 'ffmpeg -loglevel error -f x11grab -video_size 800x600 -i :99 -frames:v 1 -f image2pipe -vcodec png - 2>/dev/null']);
    shotCache = { at: Date.now(), png: r.ok && r.bytes && r.bytes.length > 100 ? r.bytes : null };
    return shotCache.png;
}

// ── Finished runs: local bundles + the results repo index ──
interface RunRef { id: string; dir: string; source: 'local' | 'results-repo' }
function runRefs(): RunRef[] {
    const refs: RunRef[] = [];
    if (existsSync(BUNDLES)) for (const n of readdirSync(BUNDLES)) { const d = join(BUNDLES, n); if (existsSync(join(d, 'manifest.json'))) refs.push({ id: n.replace(/^run-/, ''), dir: d, source: 'local' }); }
    const walk = (d: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d)) { const p = join(d, e); if (!statSync(p).isDirectory()) continue; if (existsSync(join(p, 'manifest.json'))) { if (!refs.some(r => r.id === e)) refs.push({ id: e, dir: p, source: 'results-repo' }); } else walk(p); } };
    walk(join(RUNS_DIR, 'runs'));
    return refs;
}
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function runSummary(r: RunRef) {
    const m = readJson(join(r.dir, 'manifest.json')) ?? {};
    const v = readJson(join(r.dir, 'verdict.json'));
    return { id: r.id, source: r.source, slug: m.task?.slug, model: m.model?.id, harness: m.model?.harness, startedAt: m.startedAt, contributor: m.contributor?.handle,
        success: v ? !!(v.jointCompletion ?? v.fairTradeCompleted) : null, reward: v?.reward ?? null, hasVideo: existsSync(join(r.dir, 'recording.mp4')), costUsd: m.usage?.costUsd ?? null };
}

function runDetail(r: RunRef) {
    const agentDir = join(r.dir, 'agent');
    let agentLog = '';
    if (existsSync(agentDir)) for (const f of readdirSync(agentDir)) if (/opencode.*\.txt$|\.jsonl?$/.test(f)) agentLog += readText(join(agentDir, f)) + '\n';
    const partner = parseJsonl(readText(join(r.dir, 'partners', 'partner01.jsonl')));
    return { ...runSummary(r), manifest: readJson(join(r.dir, 'manifest.json')), verdict: readJson(join(r.dir, 'verdict.json')),
        steps: parseTrajectory(agentLog), events: parseJsonl(readText(join(r.dir, 'events.jsonl'))), partner, progress: partnerProgress(partner),
        reports: parseJsonl(readText(join(r.dir, 'reports.jsonl'))), warnings: readText(join(r.dir, 'WARNINGS.txt')).trim() || null };
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
async function startLaunch(body: { variant?: string; all?: boolean; trials?: number; publish?: boolean }) {
    if (launch.proc && launch.proc.exitCode === null) return { ok: false, error: 'A run is already in progress' };
    const args = ['./scripts/run-pilot.sh', '--glm', '--runebench', '../RuneBench', '-k', String(Math.max(1, Math.min(10, body.trials ?? 1)))];
    if (body.all) args.push('--all'); else if (body.variant && /^[a-z-]+$/.test(body.variant)) args.push('-t', body.variant);
    if (body.publish === false) args.push('--no-publish');
    const proc = Bun.spawn(['bash', ...args], { cwd: ROOT, env: launchEnv, stdout: 'pipe', stderr: 'pipe' });
    launch = { proc, log: '', startedAt: new Date().toISOString(), args };
    const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const ch of s) { launch.log += d.decode(ch).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); if (launch.log.length > 200_000) launch.log = launch.log.slice(-150_000); } };
    pump(proc.stdout); pump(proc.stderr);
    return { ok: true };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function handle(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return new Response(Bun.file(join(import.meta.dir, 'index.html')));
    if (p === '/api/live') return json(liveSnapshot());
    if (p === '/api/live/screen.png') { const png = screenshot(); return png ? new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } }) : new Response('no screen', { status: 404 }); }
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
    if (p === '/api/launch/stop' && req.method === 'POST') { launch.proc?.kill(); return json({ ok: true }); }
    return new Response('not found', { status: 404 });
}

if (import.meta.main) {
    Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: handle });
    const url = `http://localhost:${PORT}`;
    console.log(`QuestBench Studio → ${url}${MOCK ? `  (mock: ${MOCK})` : ''}`);
    // Open the browser: WSL -> Windows default browser; macOS/Linux fallbacks.
    if (!process.env.QB_STUDIO_NO_OPEN) for (const cmd of [['wslview', url], ['cmd.exe', '/c', 'start', url], ['open', url], ['xdg-open', url]]) { if (sh(['sh', '-c', `command -v ${cmd[0]}`]).ok) { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }); break; } }
}
