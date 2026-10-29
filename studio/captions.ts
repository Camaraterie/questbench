/** Extractive condensation, never a model-generated claim about what a player really believes. */
export function thoughtExcerpt(text: string, max = 150): string {
    const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
    const first = plain.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? plain;
    if (first.length <= max) return first;
    return first.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
export function observerCaptions(events: any[], reasoning: Array<{ username: string; parts: any[] }>, now = Date.now()) {
    const out: Record<string, any> = {};
    for (const event of events) {
        const at = Date.parse(event.ts), name = event.actors?.[0]?.toLowerCase();
        if (!name || now - at > 12000 || at > now || !['chat_public', 'chat_private'].includes(event.kind)) continue;
        out[name] = { ...out[name], chat: (event.kind === 'chat_private' ? `PM → ${event.actors[1]}: ` : '') + String(event.data?.shown ?? event.data?.text ?? '').slice(0, 220), chatUntil: at + 12000 };
    }
    for (const seat of reasoning) {
        const part = [...seat.parts].reverse().find(p => p?.text && Number.isFinite(p.at));
        if (!part || now - part.at > 45000 || part.at > now) continue;
        const thought = thoughtExcerpt(part.text);
        if (thought) out[seat.username.toLowerCase()] = { ...out[seat.username.toLowerCase()], thought, thoughtUntil: part.at + 45000 };
    }
    return out;
}
