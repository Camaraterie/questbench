/** Retain every client-published chat/system message and dialog independently of agent chat cursors. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const replace = (text: string, from: string, to: string) => {
    if (text.includes(to)) return text;
    if (text.split(from).length !== 2) throw new Error(`Feedback anchor must match once: ${from.slice(0, 70)}`);
    return text.replace(from, to);
};
export function patchFeedbackIndex(text: string) {
    text = replace(text, 'export class BotSDK {', 'export class BotSDK {\n    private qbDialogHistory = new ChatHistory(4096);');
    text = replace(text, 'this.chatHistory.record(message.state.gameMessages);', `this.chatHistory.record(message.state.gameMessages);
                this.qbDialogHistory.record((message.state.recentDialogs ?? []).map(d => ({ type: 0, sender: '', fromSelf: false, text: d.text.join('\\n'), tick: d.tick, observationId: d.observationId })));`);
    return replace(text, '    /** Get timestamp when state was last received (ms since epoch) */', `    /** All retained client feedback since an independent cursor. No chat-type whitelist. */
    getGameFeedback(cursor: { messages: number; dialogs: number } = { messages: 0, dialogs: 0 }) {
        const take = (history: ChatHistory, previous: number) => {
            const start = Number.isInteger(previous) && previous >= 0 && previous <= history.seen ? previous : 0;
            const items = history.since(start);
            return { items, dropped: Math.max(0, history.seen - start - items.length), cursor: history.seen };
        };
        const messages = take(this.chatHistory, cursor.messages), dialogs = take(this.qbDialogHistory, cursor.dialogs);
        return { messages: messages.items, dialogs: dialogs.items, dropped: messages.dropped + dialogs.dropped, cursor: { messages: messages.cursor, dialogs: dialogs.cursor } };
    }

    /** Get timestamp when state was last received (ms since epoch) */`);
}
export function patchFeedbackMcp(text: string) {
    if (text.includes('qbFeedbackCursor')) return text;
    const anchor = /          \/\/ Append formatted world state[\s\S]*?          \/\/ Add reminder for long code/;
    if (!anchor.test(text)) throw new Error('MCP feedback anchor missing');
    return text.replace(anchor, `          // Feedback cursor is independent of getNewChat and message game ticks.
          const state = connection.sdk.getState();
          if (state) {
            const feedback = connection.sdk.getGameFeedback((connection as any).qbFeedbackCursor);
            (connection as any).qbFeedbackCursor = feedback.cursor;
            parts.push('', '── World State ──');
            parts.push(formatWorldState({ ...state, gameMessages: feedback.messages }, connection.sdk.getStateAge(), { sinceTick: -1 }));
            for (const dialog of feedback.dialogs) parts.push('Game dialog: ' + dialog.text);
            if (feedback.dropped) parts.push('WARNING: ' + feedback.dropped + ' feedback entries exceeded retained history.');
          }

          // Add reminder for long code`);
}
if (import.meta.main) {
    const root = process.argv[2] ?? '/app';
    writeFileSync(join(root, 'sdk/qb-feedback.ts'), readFileSync(join(import.meta.dir, 'src/GameFeedback.ts')));
    for (const [path, patch] of [['sdk/index.ts', patchFeedbackIndex], ['mcp/server.ts', patchFeedbackMcp]] as const) writeFileSync(join(root, path), patch(readFileSync(join(root, path), 'utf8')));
    const history = join(root, 'sdk/chat-history.ts');
    writeFileSync(history, replace(readFileSync(history, 'utf8'), 'export const CHAT_HISTORY_LIMIT = 500;', 'export const CHAT_HISTORY_LIMIT = 4096;'));
    const collector = join(root, 'server/webclient/src/bot/StateCollector.ts');
    writeFileSync(collector, replace(readFileSync(collector, 'utf8'), 'private static readonly MAX_GAME_MESSAGES = 50;', 'private static readonly MAX_GAME_MESSAGES = 100;'));
    const formatter = join(root, 'sdk/formatter.ts');
    let formatted = readFileSync(formatter, 'utf8');
    formatted = replace(formatted, 'for (const msg of playerChat.slice(-5))', 'for (const msg of playerChat)');
    formatted = replace(formatted, 'for (const msg of systemMessages.slice(-5))', 'for (const msg of systemMessages)');
    formatted = replace(formatted, "        lines.push('## Dialog');", "        lines.push('## Dialog');\n        if (state.dialog.text) lines.push(state.dialog.text);\n        for (const component of state.dialog.allComponents ?? []) if ((component as any).text) lines.push((component as any).text);");
    writeFileSync(formatter, formatted);
    const runner = join(root, 'sdk/runner.ts');
    let run = readFileSync(runner, 'utf8');
    run = replace(run, "import { formatWorldStateSummary } from './formatter';", "import { formatWorldStateSummary } from './formatter';\nimport { formatGameFeedbackLine } from './qb-feedback';");
    run = replace(run, '        console.log(formatWorldStateSummary(finalState, sdk.getStateAge(), { xpBefore }));', `        console.log(formatWorldStateSummary(finalState, sdk.getStateAge(), { xpBefore }));
        const feedback = sdk.getGameFeedback();
        console.log('── Game Feedback (all retained messages) ──');
        for (const message of feedback.messages) console.log(formatGameFeedbackLine(message));
        for (const dialog of feedback.dialogs) console.log('Game dialog: ' + dialog.text);
        if (feedback.dropped) console.log('WARNING: ' + feedback.dropped + ' feedback entries exceeded retained history.');`);
    writeFileSync(runner, run);
    const actions = join(root, 'sdk/actions.ts');
    let action = readFileSync(actions, 'utf8');
    action = replace(action, '        await this.sdk.sendBankWithdraw(bankItem.slot, dispatchAmount);', `        const qbFeedbackBefore = this.sdk.getGameFeedback().cursor;
        await this.sdk.sendBankWithdraw(bankItem.slot, dispatchAmount);`);
    action = replace(action, 'message: `Timeout waiting for ${bankItem.name} to be withdrawn`,', `message: 'No withdrawal observed. Game feedback: ' + this.sdk.getGameFeedback(qbFeedbackBefore).messages.filter(m => ![1,2,3,6,7].includes(m.type)).map(m => m.text).join(' | '),`);
    action = patchUseItemEvidence(action);
    writeFileSync(actions, action);
    const api = join(root, 'sdk/API.md');
    const docs = readFileSync(api, 'utf8');
    if (!docs.includes('## Complete game feedback')) writeFileSync(api, docs + '\n\n## Complete game feedback\n\nsdk.getGameFeedback(cursor?) returns all retained client-published messages and dialog text, an independent cursor, and an explicit dropped-entry count. Pass its cursor on the next read; getNewChat does not consume it. MCP calls and runScript print this feedback automatically. History is bounded to 4096 entries per stream within this SDK connection; overflow is reported, never silently claimed as complete. Dispatch success alone does not establish a game-state change.\n');
}

export function patchUseItemEvidence(text: string) {
    const start = text.indexOf('    private async _useItemOnLocOnce(');
    const end = text.indexOf('\n    }', start) + 6;
    if (start < 0 || end < start) throw new Error('Item use method missing');
    let method = text.slice(start, end);
    method = replace(method, '        const invBefore = this.helpers.inventorySignature(this.sdk.getState());', `        const qbUiBefore = JSON.stringify({ dialog: this.sdk.getState()?.dialog, interface: this.sdk.getState()?.interface });
        const invBefore = this.helpers.inventorySignature(this.sdk.getState());`);
    method = replace(method, 'if (state.dialog.isOpen || state.interface?.isOpen)', 'if ((state.dialog.isOpen || state.interface?.isOpen) && JSON.stringify({ dialog: state.dialog, interface: state.interface }) !== qbUiBefore)');
    method = replace(method, `                if (state.player && state.player.animId !== -1) {
                    return true;
                }`, '                // Animation alone proves activity started, not that this item use succeeded.');
    return text.slice(0, start) + method + text.slice(end);
}
