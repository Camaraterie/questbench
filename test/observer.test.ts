import { expect, test, spyOn } from 'bun:test';
import { observerSnapshot, observerResponse } from '../engine/src/Observer';
import { observerArea } from '../studio/observer';
import { patchText } from '../engine/apply-patch';

test('observer snapshots contain public entity state, bounded NPC detail and the full player roster', () => {
    const world = { currentTick: 20, tickRate: 50,
        players: [undefined, { pid: 1, username: 'agent', x: 3222, z: 3218, level: 0, appearanceBuf: new Uint8Array([1, 2]), password: 'hidden', inventory: ['hidden'] }, { pid: 2, username: 'partner01', x: 3300, z: 3300, level: 0 }],
        npcs: [{ nid: 4, type: 5, x: 3223, z: 3218, level: 0 }, { nid: 5, type: 6, x: 3300, z: 3300, level: 0 }], getTotalNpcs: () => 2,
    };
    const snapshot = observerSnapshot(world, new URL('http://localhost/qb-observer?x=3200&z=3200&w=48&h=48'), 1000);
    expect(snapshot.roster.p).toHaveLength(2);
    expect(snapshot.frame.p).toHaveLength(1);
    expect(snapshot.frame.p[0].ap).toBe('AQI=');
    expect(snapshot.frame.p[0].i).toBe(1);
    expect(snapshot.roster.p[0][0]).toBe(1);
    expect(snapshot.frame.n.map(n => n.i)).toEqual([4]);
    expect(JSON.stringify(snapshot)).not.toContain('hidden');
    expect(observerResponse(world, new URL('http://localhost/qb-observer?w=999')).status).toBe(400);
});

test('observer camera areas are finite and bounded', () => {
    expect(observerArea({ x: 3200, z: 3200, w: 96, h: 96 })).toEqual({ x: 3200, z: 3200, w: 96, h: 96 });
    for (const w of [0, -1, 385, Infinity, NaN, 1.5]) expect(() => observerArea({ x: 3200, z: 3200, w, h: 96 })).toThrow();
});

test('observer route is opt-in, read-only and idempotently patched', () => {
    const file = 'web/index.ts';
    const original = "import World from '#/engine/World.js';\nasync function handleRequest(req: Request, server: Bun.Server, url: URL): Promise<Response | undefined> {\n return undefined;\n}\n";
    const patched = patchText(file, original);
    expect(patched).toContain("process.env.QB_OBSERVER === '1' && req.method === 'GET'");
    expect(patchText(file, patched)).toBe(patched);
});

test('launch stops only labeled previews and serializes concurrent launch requests', async () => {
    const calls: string[][] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const spawn = spyOn(Bun, 'spawn').mockImplementation(((cmd: string[]) => {
        calls.push(cmd);
        const listing = cmd[1] === 'ps';
        const data = listing ? 'abcdefabcdef\n' : '';
        return { stdout: new ReadableStream({ async start(controller) {
            if (listing) await pending;
            controller.enqueue(new TextEncoder().encode(data)); controller.close();
        } }), stderr: new ReadableStream({ start(c) { c.close(); } }), exited: Promise.resolve(0), exitCode: 0 };
    }) as any);
    try {
        const { handle } = await import(`../studio/server.ts?preview-launch=${Date.now()}`);
        const request = () => new Request('http://localhost/api/launch', { method: 'POST', body: JSON.stringify({ duo: true, publish: false }) });
        const first = handle(request());
        await Bun.sleep(0);
        expect((await handle(request())).status).toBe(409);
        release();
        expect((await first).status).toBe(200);
        expect(calls[0]).toEqual(['docker', 'ps', '-q', '--filter', 'label=questbench.observer-preview=1']);
        expect(calls[1]).toEqual(['docker', 'stop', '-t', '2', 'abcdefabcdef']);
        expect(calls[2][0]).toBe('bash');
    } finally { release(); spawn.mockRestore(); }
});
