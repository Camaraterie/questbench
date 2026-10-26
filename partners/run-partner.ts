#!/usr/bin/env bun
/**
 * Run one scripted partner inside the task container.
 *   bun partners/run-partner.ts <username> <policy> <partner> <minutes> '<params-json>'
 *
 * Uses rs-sdk's runScript (sdk/runner.ts) from the image (RS_SDK_PATH, default /app). Credentials
 * come from /app/bots/<username>/bot.env, which the task entrypoint writes. Started by the
 * container entrypoint as root, before the agent; the agent user cannot signal or edit it.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { POLICIES } from './policies';

const [username, policyName, partner, minutesArg, paramsJson = '{}'] = process.argv.slice(2);
if (!username || !policyName || !partner || !minutesArg) {
    console.error('usage: run-partner.ts <username> <policy> <partner> <minutes> [params-json]');
    process.exit(2);
}
const policy = POLICIES[policyName];
if (!policy) throw new Error(`unknown policy ${policyName}`);

const RS = process.env.RS_SDK_PATH ?? '/app';
const LOG_DIR = process.env.PARTNER_LOG_DIR ?? '/logs/partners';
mkdirSync(LOG_DIR, { recursive: true });
const logPath = `${LOG_DIR}/${username}.jsonl`;
const emit = (event: string, data: Record<string, unknown> = {}) =>
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), username, policy: policyName, event, ...data }) + '\n');

// Credentials from the bot.env the entrypoint wrote (root-only). rs-sdk's runScript reads
// BOT_USERNAME / PASSWORD / SERVER from process.env.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(`${RS}/bots/${username}/bot.env`, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!;
}
const { runScript } = await import(`${RS}/sdk/runner.ts`);
const deadline = Date.now() + Number(minutesArg) * 60_000;

emit('start', { partner, params: JSON.parse(paramsJson) });
const res = await runScript(async ({ bot, sdk }: any) => {
    await policy({ bot, sdk, self: username, partner, params: JSON.parse(paramsJson), deadline, emit });
}, { printState: false, onDisconnect: 'wait', timeout: Number(minutesArg) * 60_000 });
emit('end', { success: res.success, error: res.error ? String(res.error) : undefined });
