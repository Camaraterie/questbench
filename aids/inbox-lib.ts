/** Parse one line of `bun sdk/chat.ts <bot> --watch` output into an inbox message (or null). */
export interface InboxMessage { kind: 'pm' | 'mention'; from: string; text: string }

export function parseChatLine(line: string, bot: string): InboxMessage | null {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const pm = clean.match(/\[PM from ([^\]]+)\]\s*(.*)$/);
    if (pm) return { kind: 'pm', from: pm[1]!.trim(), text: pm[2]!.trim() };
    const pub = clean.match(/^(?:\[[^\]]*\]\s*)?([A-Za-z0-9 _-]{1,12}):\s+(.*)$/);
    if (pub && pub[1]!.toLowerCase() !== bot.toLowerCase() && new RegExp(`\\b${bot}\\b`, 'i').test(pub[2]!)) {
        return { kind: 'mention', from: pub[1]!.trim(), text: pub[2]!.trim() };
    }
    return null;
}
