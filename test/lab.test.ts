import { expect, test } from 'bun:test';
import { changePlayer, labState } from '../engine/src/Lab';
import { customScenario, editableScenario } from '../src/scenarios/custom';
import { resolveTasks } from '../src/scenarios';
import { observerCaptions, thoughtExcerpt } from '../studio/captions';

function fixture() {
    const containers = new Map([93, 94, 95].map(id => [id, { capacity: id === 95 ? 496 : id === 94 ? 14 : 28, slots: new Map<number, any>(), get(slot: number) { return this.slots.get(slot) ?? null; }, set(slot: number, item: any) { this.slots.set(slot, item); } }]));
    containers.get(93)!.set(0, { id: 995, count: 1000 });
    const player = { username: 'agent', x: 3222, z: 3218, level: 0, getInventory: (id: number) => containers.get(id), teleJump(x: number, z: number, level: number) { this.x = x; this.z = z; this.level = level; } };
    const catalog = (id: number) => id === 995 ? { name: 'Coins', stackable: true, wearpos: -1 } : id === 2351 ? { name: 'Iron bar', stackable: false, wearpos: -1 } : undefined;
    return { player, catalog, world: { players: [player] } };
}
test('live interventions record intent before changing state and reject stale edits', () => {
    const { player, world, catalog } = fixture(), events: any[] = [];
    const before = labState(player, catalog);
    const input = { username: 'agent', expectedRevision: before.revision, action: 'set-slot', store: 'inventory', slot: 0, item: null, reason: 'Remove delivered funds' };
    const after = changePlayer(world, input, catalog, e => { if (e.phase === 'intent') expect(player.getInventory(93)!.get(0).count).toBe(1000); events.push(e); });
    expect(after.stores.inventory[0]!.id).toBeNull();
    expect(events.map(e => e.phase)).toEqual(['intent', 'applied']);
    expect(() => changePlayer(world, input, catalog, e => events.push(e))).toThrow(/changed since/);
    expect(events).toHaveLength(2);
});
test('invalid equipment, stack sizes and destinations do not mutate player inventories', () => {
    const { player, world, catalog } = fixture(), revision = labState(player, catalog).revision;
    for (const change of [
        { action: 'set-slot', store: 'equipment', slot: 3, item: { id: 2351, count: 1 } },
        { action: 'set-slot', store: 'inventory', slot: 1, item: { id: 2351, count: 5 } },
        { action: 'move', position: { x: NaN, z: 3218, level: 0 } },
    ]) expect(() => changePlayer(world, { username: 'agent', expectedRevision: revision, reason: 'test', ...change }, catalog, () => { throw Error('must not record invalid changes'); })).toThrow();
    expect(labState(player, catalog).revision).toBe(revision);
});
test('walking does not invalidate a bank edit, while changes to the selected store do', () => {
    const { player, world, catalog } = fixture(), before = labState(player, catalog);
    player.z++;
    const input = { username: 'agent', expectedRevision: before.revisions.bank, action: 'set-slot', store: 'bank', slot: 0, item: { id: 995, count: 25 }, reason: 'Test bank intervention while walking' };
    expect(changePlayer(world, input, catalog, () => {}).stores.bank[0]!.count).toBe(25);
    expect(() => changePlayer(world, { ...input, item: null }, catalog, () => {})).toThrow(/changed since/);
});
test('custom roles preserve private goals and supplies, support four players and discard unknown fields', () => {
    const base = resolveTasks().find(t => t.slug === 'a0-workshop-livelihood-20m')!;
    const config = editableScenario({ ...base.scenario, roles: base.roles });
    config.roles.push({ ...structuredClone(config.roles[1]!), username: 'third' }, { ...structuredClone(config.roles[1]!), username: 'fourth' });
    const scenario = customScenario({ ...config, API_KEY: 'never-copy-this' });
    expect(scenario.roles).toHaveLength(4);
    expect(scenario.tier).toBe('society');
    expect(scenario.variants[0]!.exploratory).toBe(true);
    expect(JSON.stringify(scenario)).not.toContain('never-copy-this');
    expect(scenario.id).toBe(customScenario(config).id);
    config.roles[1]!.username = 'agent';
    expect(() => customScenario(config)).toThrow(/unique/);
});
test('livelihood goals plan beyond transactions without revealing the simulation or supplying a fixed win condition', () => {
    const task = resolveTasks().find(t => t.slug === 'a0-workshop-livelihood-20m')!;
    expect(task.variant.exploratory).toBe(true);
    for (const role of task.roles) {
        expect(role.sessionPolicy).toBe('continue');
        expect(role.brief).toContain('future');
        expect(role.brief).not.toMatch(/benchmark|simulation|score|AI agent/i);
    }
});
test('observer captions separate sent chat from condensed reasoning and expire from source timestamps', () => {
    const now = Date.now();
    const events = [{ ts: new Date(now - 1000).toISOString(), kind: 'chat_private', actors: ['agent', 'partner01'], data: { text: 'hello' } }];
    const reasoning = [{ username: 'agent', parts: [{ at: now - 2000, text: 'I should save some coins. Then I can buy supplies tomorrow.' }] }];
    const caption = observerCaptions(events, reasoning, now).agent;
    expect(caption.chat).toBe('PM → partner01: hello');
    expect(caption.thought).toBe('I should save some coins.');
    expect(observerCaptions(events, reasoning, now + 60000)).toEqual({});
    expect(thoughtExcerpt('a '.repeat(200)).length).toBeLessThanOrEqual(150);
});
