import { createHash } from 'node:crypto';
/** Serialize all requested players in one engine turn; no disconnect/autosave timing heuristic. */
export function captureCheckpoint(world: any, names: unknown, isTemporary: (id: number) => boolean = () => false) {
    if (!Array.isArray(names) || names.length < 1 || names.length > 4 || new Set(names).size !== names.length || names.some(n => typeof n !== 'string' || !/^[a-z][a-z0-9_]{0,11}$/.test(n))) throw new Error('Invalid checkpoint roster');
    const selected = names.map(username => {
        const player = world.players.find((p: any) => p?.username === username);
        if (!player) throw new Error(`Checkpoint player missing: ${username}`);
        return player;
    });
    const totals = (player: any) => {
        const items = new Map<number, number>();
        for (const [, inv] of player.invs ?? []) for (let slot = 0; slot < inv.capacity; slot++) {
            const item = inv.get(slot); if (item) items.set(item.id, (items.get(item.id) ?? 0) + item.count);
        }
        return items;
    };
    const before = selected.map(totals);
    let recoveredTemporaryItems = 0;
    for (const player of selected) for (const [id, inv] of player.invs ?? []) if (isTemporary(id)) {
        for (let slot = 0; slot < inv.capacity; slot++) recoveredTemporaryItems += inv.get(slot)?.count ?? 0;
    }
    // Native IF_CLOSE scripts return trade escrow before save(), which serializes permanent invs only.
    for (const player of selected) player.closeModal?.();
    const players = selected.map((player, index) => {
        const username = player.username;
        for (const [id, inv] of player.invs ?? []) if (isTemporary(id)) {
            for (let slot = 0; slot < inv.capacity; slot++) if (inv.get(slot)) throw new Error(`${username}: recoverable temporary inventory ${id} remains; checkpoint refused`);
        }
        const after = totals(player);
        if ([...new Set([...before[index]!.keys(), ...after.keys()])].some(id => before[index]!.get(id) !== after.get(id))) throw new Error(`${username}: interface closure changed item totals; checkpoint refused`);
        const data = new Uint8Array(player.save());
        return { username, data, sha256: createHash('sha256').update(data).digest('hex') };
    });
    return { tick: world.currentTick, recoveredTemporaryItems, players };
}
