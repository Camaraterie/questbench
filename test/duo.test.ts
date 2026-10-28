import { expect, test } from 'bun:test';
import { rewardMetrics, scoreDuo } from '../verifiers/check_duo';
import { seatConfig, seatPrompt } from '../docker/seats/launch';

const seat = (username: string, fairTradeCompleted: boolean, unchanged = false, netValue = 0) =>
    ({ username, fairTradeCompleted, unchanged, netValue, delta: {}, expect: { gain: [] }, reward: 0 });

test('pair scoring: joint completion, nothing happened, one side only, a seat lost value', () => {
    expect(scoreDuo([seat('agent', true), seat('partner01', true)])).toMatchObject({ jointCompletion: true, seatsMet: 2, reward: 1 });
    expect(scoreDuo([seat('agent', false, true), seat('partner01', false, true)]).reward).toBe(0.5);
    expect(scoreDuo([seat('agent', true), seat('partner01', false)])).toMatchObject({ jointCompletion: false, seatsMet: 1, reward: 0.25 });
    expect(scoreDuo([seat('agent', false, false, -300), seat('partner01', false, false, 300)]).reward).toBe(0);
    expect(Object.keys(scoreDuo([seat('agent', true), seat('partner01', true)]).seats)).toEqual(['agent', 'partner01']);
});

test('each seat gets its own name in the system prompt, the rs-agent MCP server and its model', () => {
    const c = seatConfig('partner01', { model: 'zai-coding-plan/glm-5.3', provider: { 'zai-coding-plan': {} } }) as any;
    expect(c.agent.build.prompt).toBe(seatPrompt('partner01'));
    expect(c.agent.build.prompt).toContain('named "partner01"');
    expect(c.agent.build.prompt).not.toContain('opencode');
    expect(c.model).toBe('zai-coding-plan/glm-5.3');
    expect(c.mcp['rs-agent'].command).toEqual(['bun', 'run', '/app/mcp/server.ts']);
});

test('reward.json for Harbor is numbers only', () => {
    const m = rewardMetrics(scoreDuo([seat('agent', true), seat('partner01', false)]));
    expect(m).toEqual({ reward: 0.25, joint_completion: 0, seats_met: 1, agent_met: 1, partner01_met: 0 });
    for (const v of Object.values(m)) expect(typeof v).toBe('number');
});
