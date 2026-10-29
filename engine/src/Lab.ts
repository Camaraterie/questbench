import { createHash } from 'node:crypto';

export const STORES = { inventory: 93, equipment: 94, bank: 95 } as const;
type Catalog = (id: number) => { name: string; stackable: boolean; wearpos: number } | undefined;
interface LabSlot { slot: number; id: number | null; count: number; name: string }
export class LabError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function labPlayer(world: any, username: string) {
    if (typeof username !== 'string' || !/^[a-z][a-z0-9_]{0,11}$/.test(username)) throw new LabError('Invalid player');
    const player = world.players.find((p: any) => p?.username?.toLowerCase() === username);
    if (!player) throw new LabError('Player is not in this world', 404);
    return player;
}
export function labState(player: any, catalog: Catalog) {
    const stores = Object.fromEntries(Object.entries(STORES).map(([name, id]) => {
        const inv = player.getInventory(id);
        const slots = Array.from({ length: inv?.capacity ?? 0 }, (_, slot) => {
            const item = inv.get(slot);
            return item ? { slot, id: item.id, count: item.count, name: catalog(item.id)?.name ?? `Item ${item.id}` } : { slot, id: null, count: 0, name: '' };
        });
        return [name, slots];
    })) as Record<keyof typeof STORES, LabSlot[]>;
    const state = { username: player.username, position: { x: player.x, z: player.z, level: player.level }, stores };
    const hash = (value: any) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const revisions = Object.fromEntries(Object.entries(stores).map(([name, slots]) => [name, hash({ username: player.username, name, slots })]));
    revisions.position = hash({ username: player.username, position: state.position });
    return { ...state, revisions, revision: hash(state) };
}
export function changePlayer(world: any, input: any, catalog: Catalog, record: (event: any) => void) {
    const player = labPlayer(world, input?.username);
    const before = labState(player, catalog);
    const target = input.action === 'move' ? 'position' : input.store;
    if (input.expectedRevision !== before.revisions[target] && input.expectedRevision !== before.revision) throw new LabError('Player changed since inspection. Refresh and review the edit.', 409);
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new LabError('Give a short intervention reason');
    const number = (n: any, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
    if (input.action === 'set-slot') {
        if (!Object.hasOwn(STORES, input.store)) throw new LabError('Unknown inventory');
        const store = input.store as keyof typeof STORES, inv = player.getInventory(STORES[store]);
        if (!number(input.slot, 0, inv.capacity - 1)) throw new LabError('Invalid slot');
        let item = null;
        if (input.item !== null) {
            if (!number(input.item?.id, 0, 65534) || !number(input.item?.count, 1, 1_000_000_000)) throw new LabError('Invalid item/count');
            const definition = catalog(input.item.id);
            if (!definition) throw new LabError('Unknown item ID');
            if (store === 'equipment' && (definition.wearpos !== input.slot || (!definition.stackable && input.item.count !== 1))) throw new LabError('Item does not fit this equipment slot');
            if (store === 'inventory' && !definition.stackable && input.item.count !== 1) throw new LabError('Non-stackable inventory items need separate slots');
            item = { id: input.item.id, count: input.item.count };
        }
        const old = inv.get(input.slot);
        record({ phase: 'intent', username: player.username, action: input.action, store, slot: input.slot, before: old, after: item, reason: input.reason.trim() });
        inv.set(input.slot, item);
        if (store === 'equipment') player.buildAppearance?.(94);
    } else if (input.action === 'move') {
        const p = input.position;
        if (!p || !number(p.x, 1, 16383) || !number(p.z, 1, 16383) || !number(p.level, 0, 3)) throw new LabError('Invalid destination');
        record({ phase: 'intent', username: player.username, action: 'move', before: before.position, after: p, reason: input.reason.trim() });
        player.teleJump(p.x, p.z, p.level);
    } else throw new LabError('Unknown intervention');
    const after = labState(player, catalog);
    record({ phase: 'applied', username: player.username, action: input.action, store: input.store, slot: input.slot,
        before: input.action === 'move' ? before.position : (before.stores as any)[input.store]?.[input.slot],
        after: input.action === 'move' ? after.position : (after.stores as any)[input.store]?.[input.slot],
        beforeRevision: before.revision, afterRevision: after.revision, reason: input.reason.trim() });
    return after;
}
