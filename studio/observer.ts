import type { ServerWebSocket } from 'bun';

type Area = { x: number; z: number; w: number; h: number };
export type ObserverSocket = ServerWebSocket<{ area: Area; previous?: any; generation?: number }>;
const DEFAULT_AREA = { x: 3174, z: 3170, w: 96, h: 96 };
export function observerArea(input: any): Area {
    const area = Object.fromEntries(['x', 'z', 'w', 'h'].map(k => [k, Number(input[k])])) as Area;
    if (Object.values(area).some(n => !Number.isInteger(n)) || area.x < 0 || area.z < 0 || area.x > 16383 || area.z > 16383 || area.w < 1 || area.h < 1 || area.w > 384 || area.h > 384) throw new Error('Invalid observer area');
    return area;
}

/** Runs inside the selected container. One exec and a bounded polling loop for all camera panes. */
const POLLER = `let areas=[]; let buffer='';
(async()=>{for await(const chunk of Bun.stdin.stream()){buffer+=new TextDecoder().decode(chunk);let i;while((i=buffer.indexOf('\\n'))>=0){try{areas=JSON.parse(buffer.slice(0,i)).slice(0,4)}catch{}buffer=buffer.slice(i+1)}}})();
while(true){await Promise.all(areas.map(async a=>{try{const q=new URLSearchParams(a);const r=await fetch('http://localhost:8888/qb-observer?'+q,{signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('Observer endpoint '+r.status);console.log(JSON.stringify({key:JSON.stringify(a),data:await r.json()}))}catch(e){console.log(JSON.stringify({key:JSON.stringify(a),error:String(e)}))}}));await Bun.sleep(250)}`;

export function observerRelay(findContainer: () => Promise<string | null>, captions: () => Record<string, any> = () => ({})) {
    const viewers = new Set<ObserverSocket>();
    let proc: ReturnType<typeof Bun.spawn> | undefined, container: string | null = null, generation = 0, timer: ReturnType<typeof setInterval> | undefined;
    let error: string | null = null, lastFrameAt = 0, busy = false;
    const sendAreas = () => {
        const areas = [...new Map([...viewers].map(ws => [JSON.stringify(ws.data.area), ws.data.area])).values()];
        try { (proc?.stdin as any)?.write(JSON.stringify(areas) + '\n'); } catch {}
    };
    const stop = () => { proc?.kill(); proc = undefined; container = null; generation++; };
    const pump = async () => {
        if (busy) return; busy = true;
        try {
            const current = await findContainer();
            if (!current) { if (proc) stop(); error = 'Waiting for a local trial'; return; }
            if (proc && current === container && proc.exitCode === null) return;
            stop(); container = current;
            const g = generation;
            error = null;
            proc = Bun.spawn(['docker', 'exec', '-i', current, 'bun', '-e', POLLER], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
            sendAreas();
            const active = proc;
            void (async () => {
                let buffer = '';
                for await (const chunk of active.stdout as any) {
                    if (generation !== g) break;
                    buffer += new TextDecoder().decode(chunk);
                    if (buffer.length > 4_000_000) { active.kill(); error = 'Observer frame exceeds limit'; break; }
                    let i;
                    while ((i = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
                        let result: any; try { result = JSON.parse(line); } catch { continue; }
                        if (result.error) { error = result.error; continue; }
                        lastFrameAt = Date.now(); error = null;
                        for (const ws of viewers) {
                            if (JSON.stringify(ws.data.area) !== result.key) continue;
                            if (ws.getBufferedAmount() > 1_000_000) { ws.close(1013, 'Slow observer; reconnect'); continue; }
                            const snapshot = result.data;
                            const reset = ws.data.generation !== g;
                            if (reset) { ws.send(JSON.stringify(snapshot.hello)); ws.data.previous = undefined; ws.data.generation = g; }
                            ws.send(JSON.stringify(snapshot.roster));
                            const previous = ws.data.previous;
                            const annotations = captions();
                            const names = new Map(snapshot.roster.p.map((p: any[]) => [p[0], String(p[1]).toLowerCase()]));
                            const frame = { ...snapshot.frame,
                                p: snapshot.frame.p.map((e: any) => ({ ...e, qbSampleMs: 250, qbOverlay: annotations[names.get(e.i) as string] ?? null })),
                                n: snapshot.frame.n.map((e: any) => ({ ...e, qbSampleMs: 250 })),
                                relayObservedAt: snapshot.at, relaySnapshot: false,
                                ...(reset ? { reset: 1 } : {}),
                                rp: previous ? previous.p.filter((p: any) => !snapshot.frame.p.some((n: any) => n.i === p.i)).map((p: any) => p.i) : [],
                                rn: previous ? previous.n.filter((p: any) => !snapshot.frame.n.some((n: any) => n.i === p.i)).map((p: any) => p.i) : [],
                            };
                            ws.send(JSON.stringify(frame)); ws.data.previous = snapshot.frame;
                        }
                    }
                }
            })().catch(e => { error = String(e); });
        } finally { busy = false; }
    };
    return {
        status: () => ({ container, viewers: viewers.size, lastFrameAt, stale: Date.now() - lastFrameAt > 3000, error }),
        websocket: {
            open(ws: ObserverSocket) {
                if (viewers.size >= 4) { ws.close(1013, 'Four observer panes maximum'); return; }
                ws.data.area = { ...DEFAULT_AREA }; viewers.add(ws); sendAreas();
                if (!timer) timer = setInterval(() => void pump(), 1000);
                void pump();
            },
            message(ws: ObserverSocket, raw: string | Buffer) {
                try { const m = JSON.parse(String(raw)); if (m.t === 'sub') { ws.data.area = observerArea(m); sendAreas(); } } catch { ws.close(1008, 'Invalid observer subscription'); }
            },
            close(ws: ObserverSocket) {
                viewers.delete(ws); sendAreas();
                if (!viewers.size) { clearInterval(timer); timer = undefined; stop(); }
            },
        },
    };
}
