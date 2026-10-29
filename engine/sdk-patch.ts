/** Small, fail-closed patches for the rs-sdk bundled in RuneBench's image. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function once(source: string, from: string, to: string): string {
    if (source.includes(to)) return source;
    if (source.split(from).length !== 2) throw new Error(`SDK patch anchor must match once: ${from.slice(0, 80)}`);
    return source.replace(from, to);
}

export function patchSdkIndex(source: string): string {
    source = once(source,
        "m.sender !== '' && m.sender.toLowerCase().includes(needle)",
        "!m.fromSelf && m.type !== 6 && m.sender !== '' && m.sender.toLowerCase() === needle");
    source = source.replace('specific sender (case-insensitive, substring match\n     * on name)', 'specific sender (case-insensitive exact match\n     * on name; outgoing messages excluded)')
        .replace('@param name Sender name (or substring) to match.', '@param name Exact sender name to match (case-insensitive).');
    return once(source, `    /** Get timestamp when state was last received (ms since epoch) */`,
        `    /** World tile coordinates, suitable for walkTo and sharing with other players.
     * player.x/z are client-local rendering units; use this or player.worldX/worldZ.
     */
    getPosition(): { x: number; z: number; level: number } | null {
        const p = this.state?.player;
        return p ? { x: p.worldX, z: p.worldZ, level: p.level } : null;
    }

    /** Get timestamp when state was last received (ms since epoch) */`);
}

export function patchSdkFormatter(source: string): string {
    return once(source,
        'lines.push(`Position: (${p.worldX}, ${p.worldZ}) Level ${p.level}`);',
        'lines.push(`Position: (${p.worldX}, ${p.worldZ}) Level ${p.level}`);\n        lines.push("Coordinates above are world tiles for walkTo and PMs. Use sdk.getPosition() or player.worldX/worldZ; player.x/z are client-local rendering units, not world tiles.");');
}

if (import.meta.main) {
    const root = process.argv[2] ?? '/app';
    for (const [name, patch] of [['index.ts', patchSdkIndex], ['formatter.ts', patchSdkFormatter]] as const) {
        const file = join(root, 'sdk', name);
        writeFileSync(file, patch(readFileSync(file, 'utf8')));
    }
    const api = join(root, 'sdk/API.md');
    const text = readFileSync(api, 'utf8');
    if (!text.includes('## QuestBench coordinate and chat clarification')) writeFileSync(api, text + `

## QuestBench coordinate and chat clarification

- sdk.getPosition() returns world tile { x, z, level }, or null before login. Use these for walkTo and shared meeting points.
- player.worldX/worldZ are world tiles. player.x/z are client-local rendering units and cannot be compared across clients.
- sdk.getChatFrom(name) matches the exact sender name, case-insensitively, and excludes your own outgoing messages. It reads retained history, not only unread messages.
- Check action results before announcing success. A requested purchase quantity can exceed the amount actually bought.
`);
}
