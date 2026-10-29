#!/usr/bin/env bun
/**
 * Apply the QuestBench event-log hooks to an rs-sdk checkout.
 *   bun engine/apply-patch.ts [rs-sdk-root]        (default /app)
 *
 * Anchor-based instead of a line diff, so it works across rs-sdk revisions (RuneBench's v71 image
 * bakes the older `bench-v71` branch, which differs from `main`). Every anchor must match exactly
 * once; anything else fails loudly. Re-running is a no-op (each file is marked once patched).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '/app';
const SRC = join(root, 'server/engine/src');
const MARK = '// QB-EVENTLOG';
const IMPORT = "import { logEvent } from '#/engine/entity/tracking/EventLog.js';";

interface Edit { anchor: string | RegExp; insert: string; where: 'before' | 'after' | 'replace' }
interface FilePatch { file: string; imports: string[]; edits: Edit[] }

const PATCHES: FilePatch[] = [
    {
        file: 'web/index.ts',
        imports: ["import { observerResponse } from '#/engine/entity/tracking/Observer.js';", "import { controlResponse } from '#/engine/entity/tracking/Control.js';"],
        edits: [{
            anchor: /(\n(\s*)async function handleRequest\(req: Request, server: Bun\.Server, url: URL\): Promise<Response \| undefined> \{)/,
            where: 'after',
            insert: "\n$2    if (process.env.QB_OBSERVER === '1' && req.method === 'GET' && url.pathname === '/qb-observer') return observerResponse(World, url); " + MARK + "\n$2    if (process.env.QB_STUDIO_CONTROL === '1' && url.pathname === '/qb-control' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(server.requestIP(req)?.address ?? '')) return controlResponse(World, req, url);",
        }],
    },
    {
        // Trades: the BOTH_MOVEINV trade-confirm block, where both players are in scope.
        file: 'engine/script/handlers/InvOps.ts',
        imports: [IMPORT],
        edits: [{
            anchor: /(\n(\s*)fromPlayer\.addWealthEvent\(\{\n\s*event_type: WealthEventType\.TRADE,)/,
            where: 'before',
            insert: "\n$2logEvent(World.currentTick, 'trade', [fromPlayer.username, toPlayer.username], { fromItems, toItems: Array.from(toLogs.values()), fromValue: fromTotal, toValue: toTotal }); " + MARK,
        }],
    },
    {
        file: 'engine/entity/Player.ts',
        imports: [IMPORT, "import { WealthEventType } from '#/server/logger/WealthEventType.js';"],
        edits: [
            {
                anchor: /(\n(\s*)addWealthEvent\(event: WealthEventParams\) \{)/,
                where: 'after',
                insert: "\n$2    if (event.event_type !== WealthEventType.TRADE) { logEvent(World.currentTick, 'wealth', [this.username], { type: event.event_type, items: event.account_items, value: event.account_value, x: this.x, z: this.z, level: this.level }); } " + MARK,
            },
            {
                anchor: /(\n(\s*)\} else if \(typeof value === 'number'\) \{\n\s*this\.vars\[varp\.id\] = value;)/,
                where: 'before',
                insert: '',
            },
        ],
    },
    {
        file: 'network/game/client/handler/MessagePublicHandler.ts',
        imports: [IMPORT],
        edits: [{
            anchor: /(\n(\s*)const filtered: string = WordEnc\.filter\(unpack\);)/,
            where: 'after',
            insert: "\n$2logEvent(World.currentTick, 'chat_public', [player.username], { text: unpack, shown: filtered, x: player.x, z: player.z, level: player.level }); " + MARK,
        }],
    },
    {
        file: 'network/game/client/handler/MessagePrivateHandler.ts',
        imports: [IMPORT, "import { fromBase37 } from '#/util/JString.js';"],
        edits: [{
            anchor: /(\n(\s*)World\.sendPrivateMessage\(player, username, WordPack\.unpack\(buf, input\.length\)\);)/,
            where: 'replace',
            insert: "\n$2const privateText = WordPack.unpack(buf, input.length);\n$2logEvent(World.currentTick, 'chat_private', [player.username, fromBase37(username)], { text: privateText }); " + MARK + "\n$2World.sendPrivateMessage(player, username, privateText);",
        }],
    },
];

// The varp hook is a replacement, not an insertion: log real changes to persistent varps before the write.
const VARP_FROM = /\} else if \(typeof value === 'number'\) \{\n(\s*)this\.vars\[varp\.id\] = value;/;
const VARP_TO = (ind: string) => `} else if (typeof value === 'number') {\n${ind}if (varp.scope === VarPlayerType.SCOPE_PERM && this.vars[varp.id] !== value) { logEvent(World.currentTick, 'varp', [this.username], { varp: varp.id, name: varp.debugname, from: this.vars[varp.id], to: value }); } ${MARK}\n${ind}this.vars[varp.id] = value;`;

function count(text: string, re: RegExp) { return (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length; }

export function patchText(file: string, text: string): string {
    if (file === 'web/index.ts' && !text.includes('controlResponse')) text = text.replace(/^.*if \(process\.env\.QB_OBSERVER.*observerResponse\(World, url\); \/\/ QB-EVENTLOG\r?\n/gm, '');
    // Upgrade the original hook too: unpack() consumes buf, so logging it inline made delivery
    // decode pooled bytes after the message. Remove only that exact legacy hook before patching.
    if (file === 'network/game/client/handler/MessagePrivateHandler.ts') {
        text = text.replace(/^.*logEvent\(World\.currentTick, 'chat_private', \[player\.username, fromBase37\(username\)\], \{ text: WordPack\.unpack\(buf, input\.length\) \}\); \/\/ QB-EVENTLOG\r?\n/gm, '');
    }
    if (text.includes(MARK)) return text; // already patched
    const p = PATCHES.find(x => x.file === file)!;
    let out = text;
    for (const e of p.edits) {
        if (e.insert === '') continue;
        const re = e.anchor as RegExp;
        const n = count(out, re);
        if (n !== 1) throw new Error(`${file}: anchor ${re} matched ${n} times (need exactly 1)`);
        out = out.replace(re, (...m) => {
            const whole = m[1] as string, ind = m[2] as string;
            const ins = e.insert.replace(/\$2/g, ind);
            return e.where === 'replace' ? ins : e.where === 'before' ? ins + whole : whole + ins;
        });
    }
    if (file === 'engine/entity/Player.ts') {
        const n = count(out, VARP_FROM);
        if (n !== 1) throw new Error(`${file}: setVar anchor matched ${n} times`);
        out = out.replace(VARP_FROM, (_m, ind) => VARP_TO(ind));
    }
    for (const imp of p.imports) {
        if (out.includes(imp)) continue;
        const lastImport = [...out.matchAll(/^import .*;$/gm)].pop();
        if (!lastImport) throw new Error(`${file}: no import block`);
        const at = lastImport.index! + lastImport[0].length;
        out = out.slice(0, at) + '\n' + imp + out.slice(at);
    }
    return out;
}

if (import.meta.main) {
    const eventLog = join(SRC, 'engine/entity/tracking/EventLog.ts');
    copyFileSync(join(import.meta.dir, 'src/EventLog.ts'), eventLog);
    copyFileSync(join(import.meta.dir, 'src/Observer.ts'), join(SRC, 'engine/entity/tracking/Observer.ts'));
    for (const name of ['Lab.ts', 'Control.ts']) copyFileSync(join(import.meta.dir, 'src', name), join(SRC, 'engine/entity/tracking', name));
    for (const p of PATCHES) {
        const f = join(SRC, p.file);
        if (!existsSync(f)) throw new Error(`missing ${f}`);
        const before = readFileSync(f, 'utf8');
        const after = patchText(p.file, before);
        writeFileSync(f, after);
        console.log(`${before === after ? 'unchanged' : 'patched  '} ${p.file} (${(after.match(new RegExp(MARK, 'g')) ?? []).length} hooks)`);
    }
    console.log(`EventLog.ts -> ${eventLog}`);
}
