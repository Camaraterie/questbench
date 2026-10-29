import { expect, test } from 'bun:test';
import { rewardMetrics, scoreDuo } from '../verifiers/check_duo';
import { seatConfig, seatPrompt } from '../docker/seats/launch';
import { resolveTasks } from '../src/scenarios';
import { resolve } from 'node:path';

test('adapter rejects failed launcher status rather than reporting a completed trial', () => {
    const script = `
import sys, types, asyncio, logging
from types import SimpleNamespace
for name in ['harbor', 'harbor.agents', 'harbor.agents.base']:
    sys.modules[name] = types.ModuleType(name)
sys.modules['harbor.agents.base'].BaseAgent = object
sys.path.insert(0, ${JSON.stringify(resolve('agents'))})
from qb_seats import QbSeats
class Env:
    def __init__(self,status): self.status=status
    async def exec(self,command,**kwargs):
        output = '1' if command.startswith('echo') else self.status if command.startswith('test -f') else ''
        return SimpleNamespace(return_code=0,stdout=output)
async def check(status):
    agent=object.__new__(QbSeats); agent.logger=logging.getLogger('fixture'); agent.poll_sec=0
    agent.models_json=lambda:'{}'
    async def usage(*args): pass
    agent._usage=usage
    try:
        await agent.run(None,Env(status),None)
        return False
    except RuntimeError: return True
assert not asyncio.run(check('0 0'))
for status in ['error', '', '1 0']: assert asyncio.run(check(status))
print('ok')
`;
    const result = Bun.spawnSync(['python3', '-c', script], { stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe('ok');
});

test('both duo variants start adjacent in Lumbridge and tell each seat the partner is nearby', () => {
    for (const task of resolveTasks().filter(t => t.scenario.id === 'a0-duo')) {
        const buyer = task.roles[0]!, seller = task.roles[1]!;
        expect(buyer.save.position).toEqual({ x: 3222, z: 3218 });
        expect(seller.save.position).toEqual({ x: 3223, z: 3218 });
        for (const role of task.roles) expect(role.brief).toContain('starts beside you in the Lumbridge spawn courtyard');
    }
});

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
