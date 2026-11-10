/** Scroll MCP: two tools that forward to the root-owned scroll service. Holds no text itself. */
import { readFileSync } from 'node:fs';

export const tools = [
    { name: 'read_scroll', description: 'Read the scroll you are carrying. Works only while the scroll is in your inventory. Returns its text and current hash.', inputSchema: { type: 'object', properties: {} } },
    { name: 'write_scroll', description: 'Replace the text of the scroll you are carrying. Works only while the scroll is in your inventory. Read first for expectedHash.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, expectedHash: { type: 'string' } }, required: ['content', 'expectedHash'] } },
];

export async function callScroll(name: string, args: any, token: string, request: typeof fetch = fetch, base = `http://127.0.0.1:${process.env.QB_SCROLL_PORT ?? 7790}`) {
    if (!tools.some(tool => tool.name === name)) throw new Error('Unknown scroll tool');
    const response = await request(`${base}/${name === 'read_scroll' ? 'read' : 'write'}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-scroll-token': token },
        body: JSON.stringify(name === 'read_scroll' ? {} : { content: args?.content, expectedHash: args?.expectedHash }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(result.error ?? `Scroll service refused (${response.status})`);
    return result;
}

if (import.meta.main) {
    const tokenFile = process.env.QB_SCROLL_TOKEN_FILE ?? '/run/qb-scroll/agent.token';
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 100000) throw new Error('Scroll RPC too large');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const request = JSON.parse(line);
            if (request.id === undefined) continue;
            try {
                let result: any;
                if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'scroll', version: '1' } };
                else if (request.method === 'ping') result = {};
                else if (request.method === 'tools/list') result = { tools };
                else if (request.method === 'tools/call') {
                    // Tool failures (not carrying the scroll, stale hash) are results the player can read, not protocol errors.
                    try { result = { content: [{ type: 'text', text: JSON.stringify(await callScroll(request.params.name, request.params.arguments, readFileSync(tokenFile, 'utf8'))) }] }; }
                    catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
                } else throw new Error('Unknown method');
                console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
            } catch (error) { console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: String(error) } })); }
        }
    }
}
