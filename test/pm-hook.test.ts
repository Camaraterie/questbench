import { expect, test } from 'bun:test';
import { patchText } from '../engine/apply-patch';

const file = 'network/game/client/handler/MessagePrivateHandler.ts';
const original = `import World from '#/engine/World.js';
function handle(buf, input, player, username) {
    World.sendPrivateMessage(player, username, WordPack.unpack(buf, input.length));
}
`;
const legacy = original.replace('    World.sendPrivateMessage', "    logEvent(World.currentTick, 'chat_private', [player.username, fromBase37(username)], { text: WordPack.unpack(buf, input.length) }); // QB-EVENTLOG\n    World.sendPrivateMessage");

test.each([['unpatched', original], ['legacy double-decode hook', legacy]])('%s: logging preserves the delivered PM and consumes its packet exactly once', (_, source) => {
    const patched = patchText(file, source);
    expect(patchText(file, patched)).toBe(patched);
    // Execute the generated handler, with a consuming decoder that exposes an accidental second
    // read. Test multiple consecutive messages/chunks, not just the injected string's shape.
    const body = patched.slice(patched.indexOf('function handle'));
    const logged: string[] = [], delivered: string[] = [];
    let decodes = 0;
    const handle = new Function('World', 'WordPack', 'logEvent', 'fromBase37', `${body}; return handle;`)(
        { currentTick: 1, sendPrivateMessage: (_p: unknown, _u: unknown, text: string) => delivered.push(text) },
        { unpack: (buf: { pos: number; text: string }, length: number) => {
            decodes++;
            if (buf.pos !== 0) throw new Error('decoded past the message');
            buf.pos += length;
            return buf.text;
        } },
        (_t: number, _k: string, _a: string[], data: { text: string }) => logged.push(data.text),
        (name: string) => name,
    );
    for (const text of ['hello', '500 coins for 5 bars', 'first chunk', 'second chunk']) {
        const buf = { pos: 0, text };
        handle(buf, { length: text.length }, { username: 'agent' }, 'partner01');
        expect(buf.pos).toBe(text.length);
    }
    expect(delivered).toEqual(['hello', '500 coins for 5 bars', 'first chunk', 'second chunk']);
    expect(logged).toEqual(delivered);
    expect(decodes).toBe(4);
});
