import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkRun } from '../docker/check-run';

test('flags the 2026-10-27 GLM run: PMs never heard, partner stopped early, slow agent start', () => {
    const w = checkRun(readFileSync('test/fixtures/run-2026-10-27-events.jsonl', 'utf8'), { partner01: readFileSync('test/fixtures/run-2026-10-27-partner01.jsonl', 'utf8') });
    expect(w.some(x => x.includes('heard none of the 5 private message'))).toBe(true);
    expect(w.some(x => x.includes('stopped at'))).toBe(true);
    expect(w.some(x => x.includes('slow client start'))).toBe(true);
});

test('healthy run produces no warnings', () => {
    const ev = [
        { seq: 0, tick: 1, ts: '2026-01-01T00:00:00Z', kind: 'varp', actors: ['partner01'], data: {} },
        { seq: 1, tick: 2, ts: '2026-01-01T00:00:10Z', kind: 'varp', actors: ['agent'], data: {} },
        { seq: 2, tick: 3, ts: '2026-01-01T00:01:00Z', kind: 'chat_private', actors: ['agent', 'partner01'], data: { text: 'hi' } },
    ].map(e => JSON.stringify(e)).join('\n');
    const log = [{ event: 'start', ts: '2026-01-01T00:00:15Z' }, { event: 'heard', ts: '2026-01-01T00:01:01Z' }].map(e => JSON.stringify(e)).join('\n');
    expect(checkRun(ev, { partner01: log })).toEqual([]);
});

test('two seats: flags a seat that drives the other bot, a seat that never acted, and a seat never in-game', async () => {
    const { checkSeats } = await import('../docker/check-run');
    const ev = [{ kind: 'varp', actors: ['agent'] }, { kind: 'varp', actors: ['partner01'] }].map(e => JSON.stringify(e)).join('\n');
    const call = (input: object) => JSON.stringify({ type: 'tool_use', part: { tool: 'rs-agent_execute_code', state: { input } } });
    const fair = { agent: call({ bot_name: 'agent', code: 'sdk.getState()' }), partner01: call({ bot_name: 'partner01', code: 'x' }) };
    expect(checkSeats(ev, fair)).toEqual([]);
    const hijack = checkSeats(ev, { ...fair, agent: [call({ bot_name: 'agent', code: 'x' }), call({ bot_name: 'Partner01', code: 'bot.dropItem()' })].join('\n') });
    expect(hijack).toEqual(['seat "agent" tried to control another bot (Partner01): run is not a fair two-player game']);
    expect(checkSeats(ev, { ...fair, partner01: call({ command: 'cat /seats/x/bots/agent/bot.env' }) })[0]).toContain('seat "partner01" tried to control another bot (agent)');
    expect(checkSeats(ev, { ...fair, partner01: '' })).toEqual(['seat "partner01" made no tool calls (did its model run?)']);
    expect(checkSeats(ev.split('\n')[0]!, fair)).toEqual(['seat "partner01" never appeared in the server log (client never got in-game)']);
});
