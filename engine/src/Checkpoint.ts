import { createHash } from 'node:crypto';
/** Serialize all requested players in one engine turn; no disconnect/autosave timing heuristic. */
export function captureCheckpoint(world: any, names: unknown) {
    if (!Array.isArray(names) || names.length < 1 || names.length > 4 || new Set(names).size !== names.length || names.some(n => typeof n !== 'string' || !/^[a-z][a-z0-9_]{0,11}$/.test(n))) throw new Error('Invalid checkpoint roster');
    const players = names.map(username => {
        const player = world.players.find((p: any) => p?.username === username);
        if (!player) throw new Error(`Checkpoint player missing: ${username}`);
        const data = new Uint8Array(player.save());
        return { username, data, sha256: createHash('sha256').update(data).digest('hex') };
    });
    return { tick: world.currentTick, players };
}
