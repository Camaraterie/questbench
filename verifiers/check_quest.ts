/**
 * Verifier: joint quest completion, read from end-of-run save files only.
 *
 * Env:
 *   QB_ROLES       comma-separated usernames to score (e.g. "agent,partner01")
 *   QB_QUEST       quest key (see QUESTS below)
 *   QB_SAVE_DIR    default /app/server/engine/data/players/main
 *   QB_START_DIR   start saves copied in by the generator, default /tests/start
 *   QB_VARP_PACK   optional path to varp.pack (otherwise default paths, then fallback ids)
 *
 * Writes /logs/verifier/reward.json and reward.txt (Harbor). reward = 1 only if every role completed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSave, type ParsedSave } from '../src/save/parse';
import { DEFAULT_VARP_PACK_PATHS, loadVarpIds, varpId } from '../src/save/varps';

interface QuestRule { describe: string; complete: (s: ParsedSave, id: (n: string) => number) => boolean }

export const QUESTS: Record<string, QuestRule> = {
    'shield-of-arrav': {
        describe: 'phoenixgang >= 10 (Phoenix route complete) OR blackarmgang >= 4 (Black Arm route complete)',
        complete: (s, id) => (s.varps.get(id('phoenixgang')) ?? 0) >= 10 || (s.varps.get(id('blackarmgang')) ?? 0) >= 4,
    },
};

export function scoreQuest(quest: string, saves: Record<string, { start?: ParsedSave; end: ParsedSave }>, ids: Map<string, number>) {
    const rule = QUESTS[quest];
    if (!rule) throw new Error(`unknown quest ${quest}`);
    const id = (n: string) => varpId(ids, n);
    const perRole = Object.fromEntries(Object.entries(saves).map(([u, s]) => [u, {
        completed: rule.complete(s.end, id),
        qpStart: s.start ? (s.start.varps.get(id('qp')) ?? 0) : null,
        qpEnd: s.end.varps.get(id('qp')) ?? 0,
    }]));
    const done = Object.values(perRole).filter(r => r.completed).length;
    const n = Object.keys(perRole).length;
    return { quest, rule: rule.describe, perRole, jointCompletion: done === n, reward: n ? (done === n ? 1 : done / n / 2) : 0 };
}

if (import.meta.main) {
    const roles = (process.env.QB_ROLES ?? 'agent').split(',').map(s => s.trim()).filter(Boolean);
    const quest = process.env.QB_QUEST ?? 'shield-of-arrav';
    const saveDir = process.env.QB_SAVE_DIR ?? '/app/server/engine/data/players/main';
    const startDir = process.env.QB_START_DIR ?? '/tests/start';
    const { ids, source } = loadVarpIds(process.env.QB_VARP_PACK ? [process.env.QB_VARP_PACK] : DEFAULT_VARP_PACK_PATHS);

    const saves: Record<string, { start?: ParsedSave; end: ParsedSave }> = {};
    for (const u of roles) {
        const endPath = join(saveDir, `${process.env.QB_SAVE_PREFIX ?? ''}${u}.sav`);
        const startPath = join(startDir, `${u}.sav`);
        saves[u] = {
            end: parseSave(readFileSync(endPath)),
            start: existsSync(startPath) ? parseSave(readFileSync(startPath)) : undefined,
        };
    }
    const result = { ...scoreQuest(quest, saves, ids), varpSource: source };
    mkdirSync('/logs/verifier', { recursive: true });
    writeFileSync('/logs/verifier/reward.json', JSON.stringify(result, null, 2));
    writeFileSync('/logs/verifier/reward.txt', String(result.reward));
    console.log(JSON.stringify(result, null, 2));
}
