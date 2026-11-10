/** Memory-only MCP: fixed private journal path; no shell, game, arbitrary reads, or arbitrary writes. */
import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function readJournal() {
    const fd = openSync('JOURNAL.md', constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        if (!fstatSync(fd).isFile() || fstatSync(fd).size > 64000) throw new Error('Invalid journal file');
        const content = readFileSync(fd, 'utf8');
        return { content, sha256: hash(content), limit: 8000 };
    } finally { closeSync(fd); }
}
export function writeJournal(content: unknown, expectedHash: unknown) {
    if (typeof content !== 'string' || !content.trim() || Array.from(content).length > 8000) throw new Error('Journal must contain 1–8000 characters');
    if (expectedHash !== readJournal().sha256) throw new Error('Journal changed; read it before writing');
    const temp = '.journal-' + randomUUID();
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    renameSync(temp, 'JOURNAL.md');
    return { saved: true, sha256: hash(content), characters: Array.from(content).length };
}
if (import.meta.main) {
    const tools = [
        { name: 'read_journal', description: 'Read your private journal and its current hash.', inputSchema: { type: 'object', properties: {} } },
        { name: 'write_journal', description: 'Replace your private journal, preserving your own recollections and uncertainties. At most 8000 characters. Read first for expectedHash.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, expectedHash: { type: 'string' } }, required: ['content', 'expectedHash'] } },
    ];
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 100000) throw new Error('Journal RPC too large');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const request = JSON.parse(line);
            if (request.id === undefined) continue;
            try {
                let result: any;
                if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'private-journal', version: '1' } };
                else if (request.method === 'ping') result = {};
                else if (request.method === 'tools/list') result = { tools };
                else if (request.method === 'tools/call') {
                    const { name, arguments: args = {} } = request.params;
                    if (!tools.some(tool => tool.name === name)) throw new Error('Unknown journal tool');
                    const value = name === 'read_journal' ? readJournal() : writeJournal(args.content, args.expectedHash);
                    result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
                } else throw new Error('Unknown method');
                console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
            } catch (error) { console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: String(error) } })); }
        }
    }
}
