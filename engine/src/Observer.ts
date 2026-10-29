/** Read-only, opt-in snapshot for the local benchmark observer. No account login or actions. */
export function observerSnapshot(world: any, url: URL, now = Date.now()) {
    const coord = (key: string, fallback: number, max: number) => {
        const raw = url.searchParams.get(key);
        const n = raw === null ? fallback : Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Invalid ${key}`);
        return n;
    };
    const area = { x: coord('x', 3174, 16383), z: coord('z', 3170, 16383), w: coord('w', 96, 384), h: coord('h', 96, 384) };
    if (!area.w || !area.h) throw new Error('Empty area');
    const inside = (e: any) => e.x >= area.x && e.x < area.x + area.w && e.z >= area.z && e.z < area.z + area.h;
    const players = world.players.flatMap((p: any, slot: number) => p && p.username ? [{ player: p, slot }] : []);
    const entity = (e: any, id: number) => ({ i: id, x: e.x, z: e.z, l: e.level,
        ...(e.faceEntity !== undefined ? { fe: e.faceEntity } : {}),
        ...(e.faceX > 0 && e.faceZ > 0 ? { fs: [e.faceX, e.faceZ] } : {}),
    });
    return {
        at: now, area,
        hello: { t: 'hello', v: 1, rev: 289, tick: world.currentTick, tickMs: world.tickRate, players: players.length },
        roster: { t: 'roster', k: world.currentTick, p: players.map(({ player: p, slot }: any) => [slot, p.username, p.x, p.z, p.level, p.combatLevel ?? 3]), npcs: world.getTotalNpcs() },
        frame: { t: 'tick', k: world.currentTick, ms: 250,
            p: players.filter(({ player }: any) => inside(player)).map(({ player: p, slot }: any) => ({ ...entity(p, slot), ...(p.appearanceBuf ? { ap: Buffer.from(p.appearanceBuf).toString('base64') } : {}) })),
            n: Array.from(world.npcs as Iterable<any>).filter(n => n && inside(n)).map(n => ({ ...entity(n, n.nid), t: n.type })),
        },
    };
}

export function observerResponse(world: any, url: URL): Response {
    try { return Response.json(observerSnapshot(world, url), { headers: { 'cache-control': 'no-store' } }); }
    catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
}
