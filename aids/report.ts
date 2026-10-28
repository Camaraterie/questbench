#!/usr/bin/env bun
/**
 * File a report about something broken or confusing, then keep playing.
 *   bun /qb/aids/report.ts "walkTo returns success but the gate is still closed"
 *
 * Reports stay inside this run (they become part of the run's results and, after the run, are
 * grouped into GitHub issues on Camaraterie/questbench). They are NOT sent to the public rs-sdk
 * server. Available in every QuestBench task.
 */
import { appendFileSync, mkdirSync } from 'node:fs';

const DIR = process.env.QB_REPORT_DIR ?? '/var/qb/reports';
const text = process.argv.slice(2).join(' ').trim();
if (!text) { console.error('usage: report.ts "<what seems broken>"'); process.exit(2); }
mkdirSync(DIR, { recursive: true });
const rec = { ts: new Date().toISOString(), by: process.env.BOT_USERNAME ?? 'agent', task: process.env.QB_TASK ?? '', text: text.slice(0, 2000) };
appendFileSync(`${DIR}/reports.jsonl`, JSON.stringify(rec) + '\n');
console.log('Report saved. Thanks; keep going with your task.');
