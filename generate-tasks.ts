#!/usr/bin/env bun
/**
 * Generate Harbor task directories for every scenario x variant x condition x duration.
 *   bun generate-tasks.ts [--only <slug-substring>] [--varp-pack <path>]
 *
 * Output (gitignored): tasks/<slug>/{task.toml, instruction.md, tests/, environment/}
 *
 * Lite-tier tasks are single-LLM, so they fit Harbor's one-agent-per-trial model directly: the
 * scripted partners run as root-owned background services inside the same container, started by
 * the QuestBench image's entrypoint (docker/qb-entrypoint.sh).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTasks, type ResolvedTask } from './src/scenarios';
import { writeSave } from './src/save/write';
import { DEFAULT_VARP_PACK_PATHS, loadVarpIds, varpId } from './src/save/varps';

const ROOT = import.meta.dir;
const TASKS = join(ROOT, 'tasks');

/**
 * Base image: the QuestBench image (docker/Dockerfile = RuneBench image + event-log patch + partner
 * and aid tooling). Defaults to the published image; pin a commit tag via QB_IMAGE for reproducible
 * pilots, or set QB_IMAGE=questbench:local after ./docker/build.sh.
 */
const QB_IMAGE = process.env.QB_IMAGE ?? 'ghcr.io/camaraterie/questbench:latest';
const PLAYERS_DIR = '/app/server/engine/data/players/main';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const only = arg('only');
const varpPack = arg('varp-pack');
const { ids: varpIds, source: varpSource } = loadVarpIds(varpPack ? [varpPack] : DEFAULT_VARP_PACK_PATHS);

const llmRole = (t: ResolvedTask) => t.roles.find(r => r.kind === 'llm')!;

export function taskToml(t: ResolvedTask): string {
    const tags = ['runescape', 'questbench', 'multi-agent', t.scenario.track, t.scenario.tier, t.scenario.id, `variant-${t.variant.slug}`, t.aids ? 'aids' : 'bare'];
    return `version = "1.0"

[metadata]
author_name = "QuestBench contributors"
difficulty = "hard"
category = "agent"
tags = [${tags.map(s => `"${s}"`).join(', ')}]

[verifier]
timeout_sec = 400.0

[agent]
timeout_sec = ${t.minutes * 60 + 120}.0
# Non-root, as in RuneBench: engine, saves, partners, event log and verifier are root-owned.
user = "agent"

[environment]
cpus = 2
memory_mb = ${8192 + 1024 * t.roles.filter(r => r.kind === 'scripted').length}
storage_mb = 10240
allow_internet = true
build_timeout_sec = 1200.0

[[environment.mcp_servers]]
name = "rs-agent"
transport = "stdio"
command = "bun"
args = ["run", "/app/mcp/server.ts"]
`;
}

export function dockerfile(t: ResolvedTask): string {
    const saves = t.roles.map(r => `COPY saves/${r.username}.sav ${PLAYERS_DIR}/${r.username}.sav`).join('\n');
    return `FROM ${QB_IMAGE}
ENV QB_TASK=${t.slug}
ENV QB_DURATION_SECS=${t.minutes * 60}
ENV QB_AIDS=${t.aids ? 1 : 0}
ENV QB_AGENT=${llmRole(t).username}
ENV SAMPLE_INTERVAL_MS=15000
ENV GATEWAY_URL=ws://localhost:7780
ENV BENCHMARK_DURATION_SECS=${t.minutes * 60}
${saves}
COPY partners.json /qb/partners.json
RUN chown root:root ${PLAYERS_DIR}/*.sav /qb/partners.json && chmod 600 /qb/partners.json
`;
}

export function testSh(t: ResolvedTask): string {
    const roles = t.roles.map(r => r.username).join(',');
    const env = t.scenario.verifier === 'check_quest.ts'
        ? `export QB_ROLES="${roles}"\nexport QB_QUEST="shield-of-arrav"`
        : `export QB_AGENT="${llmRole(t).username}"\nexport QB_EXPECT_JSON='${JSON.stringify(t.scenario.expect ?? {})}'`;
    return `#!/bin/bash
set -e
mkdir -p /logs/verifier
# Stop partners, force logouts so final saves reach disk, copy artifacts to /logs/verifier/qb/.
/qb/collect-artifacts.sh
${env}
export QB_SAVE_DIR=/logs/verifier/qb/saves QB_SAVE_PREFIX=end.
cd /tests && bun run ${t.scenario.verifier.replace('.ts', '.js')}
`;
}

export function instruction(t: ResolvedTask): string {
    const llm = llmRole(t);
    const aidsText = t.aids ? readFileSync(join(ROOT, 'aids', 'INSTRUCTIONS.md'), 'utf8') : '';
    const reportText = `\nIf the SDK or this environment seems broken, file a short note with \`bun /qb/aids/report.ts "<what happened>"\` and keep going. Do not use sdk/bug-report.ts.\n`;
    return `${llm.brief}\n\nYou have ${t.minutes} minutes. You control the bot "${llm.username}" via the rs-agent MCP server (execute_code with bot_name: "${llm.username}").\n${reportText}${aidsText}`;
}

async function bundleVerifier(entry: string, outDir: string) {
    const res = await Bun.build({ entrypoints: [join(ROOT, 'verifiers', entry)], outdir: outDir, target: 'bun' });
    if (!res.success) throw new Error(`bundle ${entry}: ${res.logs.join('\n')}`);
}

if (import.meta.main) {
    const tasks = resolveTasks().filter(t => !only || t.slug.includes(only));
    rmSync(TASKS, { recursive: true, force: true });
    console.log(`Generating ${tasks.length} tasks (varp ids from ${varpSource}; image ${QB_IMAGE})`);

    for (const t of tasks) {
        const dir = join(TASKS, t.slug);
        const env = join(dir, 'environment');
        const tests = join(dir, 'tests');
        mkdirSync(join(env, 'saves'), { recursive: true });
        mkdirSync(join(tests, 'start'), { recursive: true });

        const llms = t.roles.filter(r => r.kind === 'llm');
        if (llms.length !== 1) throw new Error(`${t.slug}: lite tier needs exactly one LLM role, got ${llms.length}`);

        writeFileSync(join(dir, 'task.toml'), taskToml(t));
        writeFileSync(join(dir, 'instruction.md'), instruction(t));

        for (const r of t.roles) {
            const varps = { ...(r.save.varps ?? {}) };
            for (const [name, v] of Object.entries(r.varpsByName ?? {})) varps[varpId(varpIds, name)] = v;
            const sav = writeSave({ ...r.save, varps });
            writeFileSync(join(env, 'saves', `${r.username}.sav`), sav);
            writeFileSync(join(tests, 'start', `${r.username}.sav`), sav);
        }

        const partners = t.roles.filter(r => r.kind === 'scripted').map(r => ({ username: r.username, policy: r.policy, partner: llms[0]!.username, params: r.params ?? {} }));
        writeFileSync(join(env, 'partners.json'), JSON.stringify(partners, null, 2));
        writeFileSync(join(env, 'Dockerfile'), dockerfile(t));
        writeFileSync(join(tests, 'test.sh'), testSh(t));
        await bundleVerifier(t.scenario.verifier, tests);
        console.log(`  tasks/${t.slug}/`);
    }
}
