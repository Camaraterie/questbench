#!/usr/bin/env bun
/**
 * Read unread messages from your inbox (coordination-aids condition).
 *   bun /qb/aids/inbox.ts            # unread since last check
 *   bun /qb/aids/inbox.ts --all
 * Cursor is kept in /tmp so repeated calls only show new messages.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const bot = process.env.BOT_USERNAME ?? 'agent';
const file = `${process.env.QB_INBOX_DIR ?? '/var/qb/inbox'}/${bot}.jsonl`;
const cursorFile = `/tmp/qb-inbox-${bot}.cursor`;
const all = process.argv.includes('--all');
const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
const from = all ? 0 : existsSync(cursorFile) ? Number(readFileSync(cursorFile, 'utf8')) : 0;
const fresh = lines.slice(from);
for (const l of fresh) { const m = JSON.parse(l); console.log(`${m.ts}  [${m.kind}] ${m.from}: ${m.text}`); }
if (!fresh.length) console.log('(no new messages)');
writeFileSync(cursorFile, String(lines.length));
