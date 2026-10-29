/** Exercise the configured stdio protocol and read-only game tool before any model calls. */
import { readFileSync } from 'node:fs';
export function validProbeResult(result: any): boolean {
    if (result?.isError) return false;
    for (const part of result?.content ?? []) {
        if (part.type !== 'text') continue;
        const raw = part.text.includes('── Result ──') ? part.text.split('── Result ──')[1].split('── World State ──')[0] : part.text;
        try {
            const data = JSON.parse(raw.trim()), p = data.position;
            if (data.qbReadiness === true && p && Number.isInteger(p.x) && Number.isInteger(p.z) && Number.isInteger(p.level) && p.x > 0 && p.z > 0 && p.x <= 16383 && p.z <= 16383 && p.level >= 0 && p.level <= 3) return true;
        } catch { /* Other text blocks aren't the probe result. */ }
    }
    return false;
}
export async function probeMcp(listOnly = false) {
    const config = JSON.parse(readFileSync('opencode.json', 'utf8'));
    const command = config.mcp?.['rs-agent']?.command;
    if (!Array.isArray(command) || !command.length) throw new Error('Missing rs-agent command');
    const proc = Bun.spawn(command, { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
    const pending = new Map<number, { resolve: (x: any) => void; reject: (e: Error) => void }>();
    let protocolError: Error | undefined;
    const consume = (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of proc.stdout) {
            buffer += decoder.decode(chunk, { stream: true });
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
                if (!line) continue;
                let message: any;
                try { message = JSON.parse(line); } catch { protocolError = new Error('Non-JSON stdout from MCP server'); throw protocolError; }
                const waiter = pending.get(message.id);
                if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
            }
        }
    })().catch(error => { protocolError = error; for (const p of pending.values()) p.reject(error); });
    const send = (message: any) => proc.stdin.write(JSON.stringify(message) + '\n');
    let id = 0;
    async function request(method: string, params: any) {
        if (protocolError) throw protocolError;
        const key = ++id;
        let timer: ReturnType<typeof setTimeout>;
        const result = new Promise<any>((resolve, reject) => { pending.set(key, { resolve, reject }); timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 120_000); });
        send({ jsonrpc: '2.0', id: key, method, params });
        try { return await result; } finally { clearTimeout(timer!); pending.delete(key); }
    }
    try {
        await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'questbench-preflight', version: '1' } });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await request('tools/list', {});
        if (!listed.tools?.some((tool: any) => tool.name === 'execute_code')) throw new Error('execute_code unavailable');
        if (!listOnly) {
            const bot = process.argv[2];
            const result = await request('tools/call', { name: 'execute_code', arguments: { bot_name: bot, code: 'return {qbReadiness: true, position: sdk.getPosition()};' } });
            if (!validProbeResult(result)) throw new Error('Read-only execute_code probe failed or returned no position');
        }
        console.log(JSON.stringify({ mcpReady: true, executeCode: true, readOnlyCall: !listOnly }));
    } finally { proc.stdin.end(); proc.kill(); await proc.exited; await consume; }
}
if (import.meta.main) await probeMcp(process.argv.includes('--list-only'));
