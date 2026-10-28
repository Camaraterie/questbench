/**
 * Structured views of a run for Studio: agent trajectory steps (from OpenCode JSONL), server events,
 * partner decisions. Pure functions over text so they work for live containers and saved bundles.
 */
export type Step =
    | { kind: 'thought'; t: number | null; text: string }
    | { kind: 'tool'; t: number | null; name: string; code: string; status: 'ok' | 'error' | 'running'; output: string; error?: string; secs?: number; chat: string[] }
    | { kind: 'cost'; t: number | null; tokensIn: number; tokensOut: number; reasoning: number; cached: number; cost: number; total: number }
    | { kind: 'note'; t: number | null; text: string };

export function chatFromOutput(out: string): string[] {
    const found: string[] = [];
    for (const m of out.matchAll(/"type":\s*(\d+),\s*"text":\s*"((?:[^"\\]|\\.)*)",\s*"sender":\s*"([^"]*)"[\s\S]*?"fromSelf":\s*(true|false)/g)) {
        const [, type, text, sender, self] = m;
        if (type === '0') continue;
        let t: string; try { t = JSON.parse(`"${text}"`); } catch { continue; }
        found.push(type === '6' ? `→ PM to ${sender}: ${t}` : type === '3' || type === '7' ? `← PM from ${sender}: ${t}` : self === 'true' ? `→ said: ${t}` : `← ${sender}: ${t}`);
    }
    return found;
}

export function resultOnly(out: string): string {
    return (out.split(/\n?── World State ──/)[0] ?? '').replace(/^── Result ──\n?/, '').trim();
}

export function parseTrajectory(text: string): Step[] {
    const steps: Step[] = [];
    let t0: number | null = null, total = 0;
    const rel = (ms?: number) => { if (!ms) return null; if (t0 === null) t0 = ms; return Math.max(0, Math.round((ms - t0) / 1000)); };
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let e: any; try { e = JSON.parse(line); } catch { e = undefined; }
        if (e === null || typeof e !== 'object' || Array.isArray(e)) { steps.push({ kind: 'note', t: null, text: line.trim() }); continue; }
        const p = e.part ?? {};
        const t = rel(e.timestamp);
        if (e.type === 'text' && String(p.text ?? '').trim()) steps.push({ kind: 'thought', t, text: String(p.text).trim() });
        else if (e.type === 'tool_use') {
            const st = p.state ?? {};
            const input = st.input ?? {};
            const out = typeof st.output === 'string' ? st.output : '';
            steps.push({
                kind: 'tool', t, name: String(p.tool ?? 'tool').replace(/^rs-agent_/, ''),
                code: typeof input.code === 'string' ? input.code.trim() : JSON.stringify(input, null, 2),
                status: st.status === 'error' ? 'error' : st.status === 'completed' ? 'ok' : 'running',
                output: resultOnly(out), error: st.error, chat: chatFromOutput(out),
                secs: st.time?.start && st.time?.end ? (st.time.end - st.time.start) / 1000 : undefined,
            });
        } else if (e.type === 'step_finish') {
            const tk = p.tokens ?? {}; total += Number(p.cost ?? 0);
            steps.push({ kind: 'cost', t, tokensIn: tk.input ?? 0, tokensOut: tk.output ?? 0, reasoning: tk.reasoning ?? 0, cached: tk.cache?.read ?? 0, cost: Number(p.cost ?? 0), total });
        }
    }
    return steps;
}

export function parseJsonl<T = any>(text: string): T[] {
    const out: T[] = [];
    for (const l of text.split('\n')) { if (!l.trim()) continue; try { const v = JSON.parse(l); if (v && typeof v === 'object') out.push(v); } catch { /* skip */ } }
    return out;
}

/** Partner progress milestones in order (A0 meetup partner event names). */
export const MILESTONES = ['start', 'heard', 'reply', 'committed', 'arrived', 'trade_result'] as const;
export function partnerProgress(log: Array<{ event: string; success?: boolean }>) {
    const seen = new Set(log.map(l => l.event));
    const trade = [...log].reverse().find(l => l.event === 'trade_result');
    return { reached: MILESTONES.filter(m => seen.has(m)), traded: trade ? !!trade.success : null, drifted: seen.has('drifted') };
}
