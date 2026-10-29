import { expect, test } from 'bun:test';
import { patchSdkIndex, patchSdkFormatter } from '../engine/sdk-patch';

const source = `class SDK {
    getChatFrom(name, opts = {}) {
        const { limit = 20 } = opts;
        const needle = name.toLowerCase();
        const filtered = this.chatHistory.all().filter(m =>
            m.sender !== '' && m.sender.toLowerCase().includes(needle)
        );
        return limit > 0 ? filtered.slice(-limit) : filtered;
    }
    /** Get timestamp when state was last received (ms since epoch) */
}`;

test('patched sender lookup excludes echoes and partial names before applying limit', () => {
    const patched = patchSdkIndex(source);
    expect(patchSdkIndex(patched)).toBe(patched);
    const body = patched.slice(patched.indexOf('getChatFrom'), patched.indexOf('    /** World tile'));
    const SDK = new Function(`return class { ${body} }`)();
    const sdk = new SDK();
    const incoming = { sender: 'Agent', type: 3, fromSelf: false, text: 'come west' };
    sdk.chatHistory = { all: () => [incoming,
        { sender: 'To Agent', type: 6, fromSelf: true, text: 'my outgoing reply' },
        { sender: 'Agent', type: 6, fromSelf: false, text: 'legacy outgoing flag' },
        { sender: 'OtherAgent', type: 3, fromSelf: false, text: 'wrong person' },
    ] };
    expect(sdk.getChatFrom('agent', { limit: 1 })).toEqual([incoming]);
    expect(sdk.getChatFrom('agen')).toEqual([]);
});

test('coordinate clarification preserves renderer coordinates and fails on unsupported source', () => {
    const patched = patchSdkIndex(source);
    expect(patched).toContain('x: p.worldX, z: p.worldZ, level: p.level');
    expect(patched).not.toContain('this.state.player.x =');
    const formatter = 'lines.push(`Position: (${p.worldX}, ${p.worldZ}) Level ${p.level}`);';
    const clarified = patchSdkFormatter(formatter);
    expect(patchSdkFormatter(clarified)).toBe(clarified);
    expect(clarified).toContain('player.x/z are client-local rendering units');
    expect(() => patchSdkIndex('different SDK')).toThrow('anchor');
});
