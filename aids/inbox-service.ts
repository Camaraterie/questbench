#!/usr/bin/env bun
/**
 * Inbox service (coordination-aids condition, runs as root). Tails the agent's chat through
 * rs-sdk's observe-mode chat CLI (it never takes control of the bot) and appends every private
 * message and every public line that mentions the agent to /var/qb/inbox/<bot>.jsonl. The agent
 * reads it with aids/inbox.ts, even while a long background script has the bot busy.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { parseChatLine } from './inbox-lib';

const bot = process.argv[2] ?? 'agent';
const OUT_DIR = process.env.QB_INBOX_DIR ?? '/var/qb/inbox';
mkdirSync(OUT_DIR, { recursive: true });
const out = `${OUT_DIR}/${bot}.jsonl`;

while (true) {
    const proc = Bun.spawn(['bun', 'sdk/chat.ts', bot, '--watch'], { cwd: process.env.RS_SDK_PATH ?? '/app', stdout: 'pipe', stderr: 'inherit' });
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout) {
        buf += decoder.decode(chunk);
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            const msg = parseChatLine(line, bot);
            if (msg) appendFileSync(out, JSON.stringify({ ts: new Date().toISOString(), ...msg }) + '\n');
        }
    }
    await Bun.sleep(2000); // watcher exited (client restart?) - reconnect
}
