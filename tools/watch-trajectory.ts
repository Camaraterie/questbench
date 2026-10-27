#!/usr/bin/env bun
/**
 * Pretty-print an OpenCode JSONL trajectory (live or after the fact).
 *
 *   docker exec $C tail -n +1 -f /logs/agent/opencode-glm53.txt | bun tools/watch-trajectory.ts
 *   bun tools/watch-trajectory.ts jobs/<job>/<trial>/agent/opencode-glm53.txt
 *
 * Flags: --full (don't trim tool output), --world (keep the "World State" block), --no-color
 * Shows: agent thoughts, each execute_code call with its code, a trimmed result, errors, and
 * per-step tokens/cost. Non-JSON lines (harness messages) are shown dimmed.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const WORLD = args.includes('--world');
const COLOR = !args.includes('--no-color') && process.stdout.isTTY !== false;
const file = args.find(a => !a.startsWith('--'));

const c = (code: string) => (s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c('2'), bold = c('1'), cyan = c('36'), green = c('32'), red = c('31'), yellow = c('33'), magenta = c('35');

let t0: number | null = null;
let totalCost = 0;
const clock = (ms?: number) => {
    if (!ms) return '     ';
    if (t0 === null) t0 = ms;
    const s = Math.max(0, Math.round((ms - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const indent = (s: string, pre = '   │ ') => s.split('\n').map(l => pre + l).join('\n');

export function trimOutput(out: string): string {
    // Split the result from the trailing World State block so length limits apply to the result only.
    const [rawResult, ...worldParts] = out.split(/\n?── World State ──/);
    let o = (rawResult ?? '').replace(/^── Result ──\n?/, '').trim();
    if (!FULL) {
        const lines = o.split('\n');
        if (lines.length > 25) o = [...lines.slice(0, 25), dim(`… ${lines.length - 25} more lines (--full to show)`)].join('\n');
        if (o.length > 2500) o = o.slice(0, 2500) + dim(' …');
    }
    if (WORLD && worldParts.length) o += '\n── World State ──' + worldParts.join('\n── World State ──');
    return o;
}

/** Pull PMs / public chat out of a result so conversation stands out. */
function chatLines(out: string): string[] {
    const found: string[] = [];
    for (const m of out.matchAll(/"type":\s*(\d+),\s*"text":\s*"((?:[^"\\]|\\.)*)",\s*"sender":\s*"([^"]*)"[\s\S]*?"fromSelf":\s*(true|false)/g)) {
        const [, type, text, sender, self] = m;
        if (type === '0') continue;
        let t: string;
        try { t = JSON.parse(`"${text}"`); } catch { continue; } // unparseable fragment stays in the plain result
        const dir = type === '6' ? `→ PM to ${sender}` : type === '3' || type === '7' ? `← PM from ${sender}` : self === 'true' ? '→ said' : `← ${sender}`;
        found.push(`${dir}: ${t}`);
    }
    return found;
}

export function render(line: string): string | null {
    let e: any;
    try { e = JSON.parse(line); } catch { e = undefined; }
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return line.trim() ? dim(`   ${line.trim()}`) : null;
    const p = e.part ?? {};
    const ts = clock(e.timestamp);
    switch (e.type) {
        case 'text':
            return `${dim(ts)} ${bold(cyan('💭 '))}${cyan(String(p.text ?? '').trim())}`;
        case 'reasoning':
            return `${dim(ts)} ${dim('🧠 ' + String(p.text ?? '').trim())}`;
        case 'tool_use': {
            const st = p.state ?? {};
            const name = String(p.tool ?? 'tool').replace(/^rs-agent_/, '');
            const head = `${dim(ts)} ${bold(yellow('▶ ' + name))}`;
            const input = st.input ?? {};
            const code = typeof input.code === 'string' ? input.code.trim() : JSON.stringify(input, null, 2);
            const dur = st.time?.start && st.time?.end ? dim(` (${((st.time.end - st.time.start) / 1000).toFixed(1)}s)`) : '';
            const parts = [head + dur, indent(code, dim('   │ '))];
            if (st.status === 'error') parts.push(red(`   ✗ ${st.error ?? 'error'}`));
            else if (typeof st.output === 'string') {
                const chats = chatLines(st.output);
                if (chats.length) parts.push(magenta(chats.map(l => `   💬 ${l}`).join('\n')));
                parts.push(green(indent(trimOutput(st.output), '   ✓ ')));
            }
            return parts.join('\n');
        }
        case 'step_finish': {
            const tk = p.tokens ?? {};
            totalCost += Number(p.cost ?? 0);
            return dim(`   └ tokens in ${tk.input ?? 0} · out ${tk.output ?? 0} · reasoning ${tk.reasoning ?? 0} · cached ${tk.cache?.read ?? 0} · $${Number(p.cost ?? 0).toFixed(4)} (total $${totalCost.toFixed(3)})`);
        }
        case 'step_start':
            return null;
        case 'error':
            return red(`${ts} ✗ ${JSON.stringify(e.error ?? p)}`);
        default:
            return dim(`${ts} [${e.type}]`);
    }
}

if (import.meta.main) {
    const rl = createInterface({ input: file ? createReadStream(file) : process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
        const out = render(line);
        if (out) console.log(out + '\n');
    }
}
