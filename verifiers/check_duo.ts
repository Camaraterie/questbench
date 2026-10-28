/**
 * Verifier for pair-tier trades (two LLM seats): score each seat's own trade from its start/end
 * saves with scoreTrade, then the pair.
 *
 * reward: 1 if both seats met their expectation (jointCompletion), 0.5 if nothing changed hands
 * for either seat, 0.25 if exactly one seat's expectation was met, otherwise 0.5 unless a seat
 * ended with less value than it started (0).
 *
 * Harbor reads every top-level value of reward.json as a numeric metric, so reward.json holds
 * numbers only (reward, joint_completion, seats_met, <seat>_met); the per-seat detail goes to
 * /logs/verifier/duo.json, which bundle-from-harbor merges into the bundle's verdict.json.
 *
 * Env: QB_SEATS_JSON ([{username, expect}]), QB_SAVE_DIR, QB_SAVE_PREFIX, QB_START_DIR, QB_VALUES_JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSave } from '../src/save/parse';
import { DEFAULT_VALUES, scoreTrade, type Expect } from './check_trade';

export interface Seat { username: string; expect: Expect }

export function scoreDuo(results: Array<{ username: string } & ReturnType<typeof scoreTrade>>) {
    const met = results.filter(r => r.fairTradeCompleted).length;
    const jointCompletion = met === results.length;
    const nothing = results.every(r => r.unchanged);
    const lost = results.some(r => r.netValue < 0 && !r.fairTradeCompleted);
    const reward = jointCompletion ? 1 : nothing ? 0.5 : lost ? 0 : met > 0 ? 0.25 : 0.5;
    return { jointCompletion, seatsMet: met, reward, seats: Object.fromEntries(results.map(({ username, ...r }) => [username, r])) };
}

/** The numeric-only view Harbor needs. */
export function rewardMetrics(r: ReturnType<typeof scoreDuo>): Record<string, number> {
    const out: Record<string, number> = { reward: r.reward, joint_completion: r.jointCompletion ? 1 : 0, seats_met: r.seatsMet };
    for (const [seat, x] of Object.entries(r.seats)) out[`${seat}_met`] = x.fairTradeCompleted ? 1 : 0;
    return out;
}

if (import.meta.main) {
    const seats: Seat[] = JSON.parse(process.env.QB_SEATS_JSON ?? '[]');
    if (seats.length < 2) throw new Error('QB_SEATS_JSON must list both seats');
    const saveDir = process.env.QB_SAVE_DIR ?? '/app/server/engine/data/players/main';
    const startDir = process.env.QB_START_DIR ?? '/tests/start';
    const prefix = process.env.QB_SAVE_PREFIX ?? '';
    const values = process.env.QB_VALUES_JSON ? JSON.parse(process.env.QB_VALUES_JSON) : DEFAULT_VALUES;
    const result = scoreDuo(seats.map(s => ({
        username: s.username,
        ...scoreTrade(parseSave(readFileSync(join(startDir, `${s.username}.sav`))), parseSave(readFileSync(join(saveDir, `${prefix}${s.username}.sav`))), s.expect, values),
    })));
    mkdirSync('/logs/verifier', { recursive: true });
    writeFileSync('/logs/verifier/reward.json', JSON.stringify(rewardMetrics(result), null, 2));
    writeFileSync('/logs/verifier/duo.json', JSON.stringify(result, null, 2));
    writeFileSync('/logs/verifier/reward.txt', String(result.reward));
    console.log(JSON.stringify(result, null, 2));
}
