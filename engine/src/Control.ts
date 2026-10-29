import ObjType from '#/cache/config/ObjType.js';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { labState, labPlayer, changePlayer, LabError } from './Lab.js';
import { logEvent } from './EventLog.js';
import { isFlagged, CollisionFlag, isZoneAllocated } from '#/engine/routefinder/index.js';

const catalog = (id: number) => id >= 0 && id < ObjType.count ? ObjType.get(id) : undefined;
export async function controlResponse(world: any, req: Request, url: URL): Promise<Response> {
    try {
        const token = readFileSync('/run/qb/studio-token', 'utf8');
        const supplied = req.headers.get('x-qb-control') ?? '';
        if (!token || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return Response.json({ error: 'Operator authentication required' }, { status: 403 });
        if (req.method === 'GET') {
            if (url.searchParams.has('items')) {
                const q = (url.searchParams.get('items') ?? '').toLowerCase().slice(0, 80);
                const results = [];
                for (let id = 0; id < ObjType.count && results.length < 40; id++) {
                    const item = catalog(id);
                    if (item?.name && (String(id) === q || item.name.toLowerCase().includes(q))) results.push({ id, name: item.name, stackable: item.stackable, wearpos: item.wearpos });
                }
                return Response.json(results);
            }
            const state = labState(labPlayer(world, url.searchParams.get('player') ?? ''), catalog);
            const p = state.position;
            const problems: string[] = [];
            for (const [store, slots] of Object.entries(state.stores)) for (const item of slots as any[]) if (item.id !== null) {
                const definition = catalog(item.id);
                if (!definition) problems.push(`${store} slot ${item.slot}: unknown item ${item.id}`);
                else if (store === 'equipment' && definition.wearpos !== item.slot) problems.push(`equipment slot ${item.slot}: item ${item.id} does not fit`);
            }
            return Response.json({ ...state, problems, walkable: isZoneAllocated(p.x, p.z, p.level) && !isFlagged(p.x, p.z, p.level, CollisionFlag.WALK_BLOCKED) });
        }
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        const text = await req.text();
        if (text.length > 10_000) throw new LabError('Request too large');
        const input = JSON.parse(text);
        if (input.action === 'move' && input.position && Number.isInteger(input.position.x) && Number.isInteger(input.position.z) && Number.isInteger(input.position.level)) {
            const p = input.position;
            if (!isZoneAllocated(p.x, p.z, p.level) || isFlagged(p.x, p.z, p.level, CollisionFlag.WALK_BLOCKED)) throw new LabError('Destination is blocked or outside the loaded world');
        }
        const record = (event: any) => {
            const entry = { ts: new Date().toISOString(), tick: world.currentTick, by: 'studio-operator', ...event };
            mkdirSync('/logs/tracking', { recursive: true });
            appendFileSync('/logs/tracking/interventions.jsonl', JSON.stringify(entry) + '\n');
            logEvent(world.currentTick, 'intervention', [entry.username], entry);
        };
        return Response.json(changePlayer(world, input, catalog, record));
    } catch (error) { return Response.json({ error: String(error) }, { status: error instanceof LabError ? error.status : 400 }); }
}
