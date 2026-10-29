import { expect, test } from 'bun:test';
import { patchFeedbackIndex, patchFeedbackMcp, patchUseItemEvidence } from '../engine/feedback-patch';
const compile = (source: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(source).replace(/^export /gm, '');
class History {
    seen = 0; messages: any[] = [];
    constructor(private limit = 4096) {}
    record(messages: any[]) { this.messages.push(...messages); this.seen += messages.length; this.messages = this.messages.slice(-this.limit); }
    since(cursor: number) { return this.messages.slice(Math.max(0, this.messages.length - (this.seen - cursor))); }
}
const fixture = `export class BotSDK {
    private chatHistory = new ChatHistory();
    state: any;
    ingest(message: any) { this.state = message.state; this.chatHistory.record(message.state.gameMessages); }
    getState() { return this.state; }
    getStateAge() { return 0; }
    /** Get timestamp when state was last received (ms since epoch) */
}`;
test('all game feedback survives same-tick publication, category differences and repeated reads', () => {
    const patched = patchFeedbackIndex(fixture);
    expect(patchFeedbackIndex(patched)).toBe(patched);
    const SDK = new Function('ChatHistory', compile(patched) + '; return BotSDK;')(History);
    const sdk = new SDK();
    const messages = ["You don't have enough inventory space.", "I can't reach that!", 'You gained a level.', 'Quest points: 3', 'An unfamiliar server notice', 'Another notice'].map((text, i) => ({ text, type: i === 4 ? 5 : 0, sender: '', tick: 12, observationId: i + 1 }));
    sdk.ingest({ state: { gameMessages: messages, recentDialogs: [{ text: ['Quest complete', 'You gained 2 quest points.'], tick: 12, observationId: 7 }] } });
    const result = sdk.getGameFeedback();
    expect(result.messages).toEqual(messages);
    expect(result.dialogs[0].text).toContain('2 quest points');
    expect(result.dropped).toBe(0);
    expect(sdk.getGameFeedback(result.cursor).messages).toEqual([]);
    const source = 'function run(connection) { const parts=[];\n          // Append formatted world state\n old();\n          // Add reminder for long code\n return parts; }';
    const render = new Function('formatWorldState', compile(patchFeedbackMcp(source)) + ';return run;')((state: any) => state.gameMessages.map((m: any) => m.text).join('\n'));
    const connection = { sdk };
    expect(render(connection).join('\n')).toContain("I can't reach that!");
    expect(render(connection).join('\n')).not.toContain("I can't reach that!");
});
test('overflow is explicit instead of silently treating retained feedback as complete', () => {
    const SDK = new Function('ChatHistory', compile(patchFeedbackIndex(fixture.replace('new ChatHistory()', 'new ChatHistory(2)'))) + '; return BotSDK;')(History);
    const sdk = new SDK();
    sdk.ingest({ state: { gameMessages: [1, 2, 3].map(text => ({ text, tick: 1 })), recentDialogs: [] } });
    expect(sdk.getGameFeedback().dropped).toBe(1);
});
test('item-use evidence excludes an already open interface and animation alone', () => {
    const source = `class Actions {
    private async _useItemOnLocOnce() {
        const invBefore = this.helpers.inventorySignature(this.sdk.getState());
        return this.sdk.waitForCondition(state => {
                if (state.dialog.isOpen || state.interface?.isOpen) { return true; }
                if (state.player && state.player.animId !== -1) {
                    return true;
                }
                return false;
        });
    }
}`;
    const patched = patchUseItemEvidence(source);
    const Actions = new Function(compile(patched) + ';return Actions;')();
    const a = new Actions();
    const state = { dialog: { isOpen: true, text: 'old' }, interface: { isOpen: true }, player: { animId: 10 } };
    a.helpers = { inventorySignature: () => 'unchanged' };
    a.sdk = { getState: () => state, waitForCondition: (check: any) => check(state) };
    return a._useItemOnLocOnce().then((value: boolean) => expect(value).toBe(false));
});
