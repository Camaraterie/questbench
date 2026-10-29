/** Character-only return pilot. No old model context, credentials, or other players' memories. */
import { constants, closeSync, fstatSync, openSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSave } from './save/parse';
import type { Scenario } from './scenarios/types';

export const JOURNAL_LIMIT = 8000;
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
function regular(file: string): Buffer {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { if (!fstatSync(fd).isFile()) throw new Error(`Not a regular file: ${file}`); return readFileSync(fd); }
    finally { closeSync(fd); }
}
function journalText(text: unknown): string {
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > JOURNAL_LIMIT) throw new Error(`Journal must contain 1–${JOURNAL_LIMIT} characters; no automatic truncation`);
    return text;
}

export function returnPlan(bundle: string) {
    const manifest = JSON.parse(regular(join(bundle, 'manifest.json')).toString());
    if (!/^[a-f0-9-]{36}$/.test(manifest.runId) || !manifest.conditions?.exploratory) throw new Error('Return pilot requires an exploratory source bundle');
    const names = manifest.seats?.map((s: any) => s.username);
    if (JSON.stringify(names) !== JSON.stringify(['agent', 'partner01'])) throw new Error('Return pilot requires agent and partner01');
    const checkpointFile = join(bundle, 'checkpoint.json');
    if (existsSync(checkpointFile)) {
        if (JSON.parse(regular(checkpointFile).toString()).valid !== true) throw new Error('Unsafe final state checkpoint; cannot return');
    } else if (existsSync(join(bundle, 'WARNINGS.txt')) && /not rewritten|checkpoint failed/.test(regular(join(bundle, 'WARNINGS.txt')).toString())) throw new Error('Unsafe legacy save collection; cannot return');
    const integrity = existsSync(join(bundle, 'journal-integrity.json')) ? JSON.parse(regular(join(bundle, 'journal-integrity.json')).toString()) : undefined;
    const redacted = existsSync(join(bundle, 'REDACTED.json')) && Object.values(JSON.parse(regular(join(bundle, 'REDACTED.json')).toString()).hits ?? {}).some(n => Number(n) > 0);
    const saves: Record<string, Buffer> = {};
    const memories: Record<string, { text: string; source: string; sha256: string }> = {};
    for (const name of names as string[]) {
        saves[name] = regular(join(bundle, 'saves', `end.${name}.sav`));
        parseSave(saves[name]!); // reject malformed saves; copy the original bytes, not reconstructed inventories
        if (existsSync(checkpointFile)) {
            const expected = JSON.parse(regular(checkpointFile).toString()).players?.find((p: any) => p.username === name)?.sha256;
            if (expected !== hash(saves[name]!)) throw new Error(`${name}: final save differs from engine checkpoint`);
        }
        let text: string, source: string;
        try {
            text = regular(join(bundle, 'seats', name, 'notes', 'JOURNAL.md')).toString();
            const key = `seats/${name}/notes/JOURNAL.md`;
            if (integrity ? integrity[key] !== hash(text) : redacted) throw new Error(`${name}: cannot verify authored journal after redaction`);
            const phaseFile = join(bundle, 'seats', name, 'memory-phase.json');
            if (existsSync(phaseFile)) {
                const phase = JSON.parse(regular(phaseFile).toString());
                if (!phase.valid || phase.sha256 !== hash(text)) throw new Error(`${name}: memory checkpoint invalid or stale`);
            }
            source = 'collected JOURNAL.md';
        } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
            // Explicit bootstrap for the pre-journal first run only. Never summarize or correct it.
            if (manifest.runId !== '8e888600-aef8-4593-81e3-8adbe9cfaa2c') throw new Error(`${name}: missing JOURNAL.md; cannot silently substitute a transcript`);
            const rows = regular(join(bundle, 'seats', name, 'opencode.txt')).toString().split('\n').flatMap(line => {
                try { return [JSON.parse(line)]; } catch { return []; }
            });
            const written = rows.filter(r => r.type === 'tool_use' && r.part?.tool === 'write' && r.part.state?.status === 'completed' && r.part.state.input?.filePath === `/seats/${name}/SESSION_NOTES.md`).at(-1);
            text = written?.part.state.input.content;
            source = 'verbatim agent-authored SESSION_NOTES.md recovered from own tool log';
            if (!text) {
                text = rows.filter(r => r.type === 'text' && r.part?.type === 'text').at(-1)?.part.text;
                source = 'verbatim own final answer (explicit bootstrap; no journal existed)';
            }
            if (redacted) {
                const known = name === 'agent' ? 'f5abdf2a96461ae9c9dbbe618d6cd43822f988b4deeca07d6a3259be6fb6e218' : 'fc6706eb1cb462948e01f0a3698ec73c68492cd02e96940fe7cd5b2eb664b7f5';
                if (hash(text) !== known) throw new Error(`${name}: bootstrap memory changed by redaction`);
            }
        }
        memories[name] = { text: journalText(text), source, sha256: hash(text) };
    }
    const lineage = { schema: 'questbench.character-return/v0', parentRunId: manifest.runId,
        parentManifestSha256: hash(regular(join(bundle, 'manifest.json'))),
        freshModelContext: true, worldScope: 'character-saves-only; NPCs, shops and ground state reset',
        memoryPolicy: 'private bounded journal; no old conversation or arbitrary workspace restoration', journalLimit: JOURNAL_LIMIT,
        players: Object.fromEntries(names.map((name: string) => [name, { saveSha256: hash(saves[name]!), journalSha256: memories[name]!.sha256, memorySource: memories[name]!.source }])) };
    const id = `a0-return-${hash(JSON.stringify(lineage)).slice(0, 12)}`;
    const scenario: Scenario = { id, title: 'Returning livelihoods: private journals', summary: 'Fresh-context character return with private recollection', track: 'A-fellowship', tier: 'pair', minutes: [20],
        roles: names.map((username: string) => ({ username, kind: 'llm',
            save: { position: parseSave(saves[username]!).position }, initialJournal: memories[username]!.text,
            sessionPolicy: 'continue', discloseDeadline: false, expect: { gain: [] },
            brief: `You are continuing your life in Gielinor as ${username}. Your position, skills and possessions have been retained. Your private JOURNAL.md contains your own earlier account, which may be incomplete or mistaken. Read it and take stock of the world before deciding what to do. Choose your own priorities, useful work and relationships, and plan for your future.\n\nJOURNAL.md is your protected personal recollection. Keep it in your own workspace, with at most ${JOURNAL_LIMIT} characters. Its contents, rather than this conversation or other workspace files, can accompany this character on a later return. Revise it as your beliefs and plans change; it is not an authoritative record. Other players cannot read your journal. Future activations are managed externally; another player's availability is not guaranteed. You can rest at any time by updating JOURNAL.md, creating a file named finished and ending your session.`,
        })),
        variants: [{ slug: 'journal', exploratory: true, overrides: {}, note: 'Character-only continuity pilot; historical memory bootstrap sources recorded explicitly.' }],
        verifier: 'check_duo.ts', metrics: [], groundTruth: ['Character save bytes are copied unchanged from the parent bundle.'], openQuestions: ['Full world continuity and physical scrolls are not implemented in this pilot.'] };
    return { scenario, saves, lineage };
}
