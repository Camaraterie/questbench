import { describe, expect, test } from 'bun:test';
import { render, trimOutput } from '../tools/watch-trajectory';

describe('watch-trajectory', () => {
    test('non-object JSON lines do not throw', () => {
        expect(render('null')).toContain('null');
        expect(render('42')).toContain('42');
        expect(render('[1,2]')).toContain('[1,2]');
        expect(render('')).toBeNull();
    });
    test('invalid escape in a chat-shaped fragment does not throw', () => {
        const output = '── Result ──\n{"type": 3, "text": "bad \\q escape", "sender": "p", "fromSelf": false}';
        const line = JSON.stringify({ type: 'tool_use', part: { tool: 'rs-agent_execute_code', state: { status: 'completed', input: { code: 'x' }, output } } });
        expect(() => render(line)).not.toThrow();
    });
    test('result trimmed, World State hidden by default', () => {
        const long = '── Result ──\n' + Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n── World State ──\nTick: 1';
        const o = trimOutput(long);
        expect(o).toContain('line 24');
        expect(o).not.toContain('line 30');
        expect(o).not.toContain('World State');
    });
});
