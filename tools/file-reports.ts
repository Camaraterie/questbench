#!/usr/bin/env bun
/**
 * Turn agents' in-run reports (bundle/reports.jsonl, written by /qb/aids/report.ts) into GitHub issues.
 *   bun tools/file-reports.ts [bundles] [--repo Camaraterie/questbench] [--dry-run]
 *
 * Reports with the same normalised message share one issue (label `agent-report`); new sightings
 * add a comment listing the runs. Uses the `gh` CLI with your login. Marks each bundle REPORTED.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Report { ts: string; by: string; task: string; text: string }
export interface Group { key: string; title: string; reports: Array<Report & { runId: string; model: string; path?: string; bundleDir: string }> }

/** Normalise so the same complaint from different runs groups together. */
export function reportKey(text: string): string {
    const norm = text.toLowerCase()
        .replace(/\(?\d{3,5}\s*,\s*\d{3,5}\)?/g, '<xy>')   // coordinates
        .replace(/\d+/g, '<n>')
        .replace(/["'`]/g, '')
        .replace(/[^a-z<>\s.()]/g, ' ')
        .replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

export function collect(bundlesDir: string): Group[] {
    const groups = new Map<string, Group>();
    if (!existsSync(bundlesDir)) return [];
    for (const name of readdirSync(bundlesDir)) {
        const b = join(bundlesDir, name);
        const f = join(b, 'reports.jsonl');
        if (!existsSync(f) || existsSync(join(b, 'REPORTED'))) continue;
        const man = existsSync(join(b, 'manifest.json')) ? JSON.parse(readFileSync(join(b, 'manifest.json'), 'utf8')) : {};
        const path = existsSync(join(b, 'PUBLISHED')) ? readFileSync(join(b, 'PUBLISHED'), 'utf8').trim() : undefined;
        for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
            let r: Report; try { r = JSON.parse(line); } catch { continue; }
            const key = reportKey(r.text);
            if (!groups.has(key)) groups.set(key, { key, title: `[agent-report] ${r.text.slice(0, 80)}`, reports: [] });
            groups.get(key)!.reports.push({ ...r, runId: man.runId ?? name, model: man.model?.id ?? 'unknown', path, bundleDir: b });
        }
    }
    return [...groups.values()];
}

const gh = (args: string[]) => {
    const r = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
    return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
};

const sightings = (g: Group) => g.reports.map(r => `- \`${r.model}\` · ${r.task} · run \`${r.runId}\`${r.path ? ` ([results](https://github.com/Camaraterie/questbench-runs/tree/main/${r.path}))` : ''}\n  > ${r.text.replace(/\n/g, ' ')}`).join('\n');

if (import.meta.main) {
    const args = process.argv.slice(2);
    const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
    const VALUED = new Set(['--repo']);
    const bundles = args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? '')) ?? 'bundles';
    const repo = opt('repo', 'Camaraterie/questbench')!;
    const dry = args.includes('--dry-run');
    const groups = collect(bundles);
    if (!groups.length) { console.log('· no new agent reports'); process.exit(0); }
    if (dry) { for (const g of groups) console.log(`${g.key}  ${g.title}  (${g.reports.length})`); process.exit(0); }
    if (!gh(['--version']).ok) { console.error('! gh CLI not found; reports stay in the bundles. Install: https://cli.github.com'); process.exit(0); }
    gh(['label', 'create', 'agent-report', '-R', repo, '--color', 'C5DEF5', '--description', 'Filed by an agent during a QuestBench run', '--force']);
    const list = gh(['issue', 'list', '-R', repo, '--label', 'agent-report', '--state', 'all', '--limit', '500', '--json', 'number,body']);
    const existing: Array<{ number: number; body: string }> = list.ok ? JSON.parse(list.out || '[]') : [];
    const accepted = new Map<string, boolean>();
    for (const g of groups) {
        const marker = `<!-- qb-report-key:${g.key} -->`;
        const hit = existing.find(i => i.body?.includes(marker));
        const r = hit
            ? gh(['issue', 'comment', String(hit.number), '-R', repo, '--body', `Seen again:\n\n${sightings(g)}`])
            : gh(['issue', 'create', '-R', repo, '--label', 'agent-report', '--title', g.title, '--body', `${marker}\nAn agent filed this during a QuestBench run. Triage: SDK bug (forward to rs-sdk), QuestBench bug, or not a bug.\n\n${sightings(g)}`]);
        console.log(`${r.ok ? '✓' : '✗'} ${hit ? `#${hit.number} updated` : 'new issue'}: ${g.title}${r.ok ? '' : `\n  ${r.err}`}`);
        for (const report of g.reports) accepted.set(report.bundleDir, (accepted.get(report.bundleDir) ?? true) && r.ok);
    }
    for (const [bundleDir, ok] of accepted) if (ok) writeFileSync(join(bundleDir, 'REPORTED'), new Date().toISOString());
}
