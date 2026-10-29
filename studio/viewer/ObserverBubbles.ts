/** Canvas-only observer annotations. These are never sent to the game or its players. */
export function drawObserverBubbles(ctx: CanvasRenderingContext2D, overlays: any[], width: number, height: number) {
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    const now = Date.now();
    for (const o of overlays) {
        const data = (o.e as any).qbOverlay;
        if (!data) continue;
        for (const kind of ['chat', 'thought']) {
            if (!data[kind] || data[kind + 'Until'] < now) continue;
            const label = kind === 'thought' ? 'THOUGHT · excerpt' : 'CHAT · observer';
            const words = String(data[kind]).split(/\s+/), lines: string[] = [];
            ctx.save(); ctx.font = '12px system-ui, sans-serif';
            let line = '';
            for (const word of words) {
                if (ctx.measureText(line + ' ' + word).width > 230 && line) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
            }
            if (line) lines.push(line);
            const clipped = lines.slice(0, 5), w = Math.min(250, width - 16), h = 27 + clipped.length * 15;
            const x = Math.max(8, Math.min(width - w - 8, o.head.x - w / 2));
            let y = o.head.y - h - 22;
            for (let i = 0; i < 8 && occupied.some(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y); i++) y -= h + 8;
            if (y < 8 || y + h > height) { ctx.restore(); continue; }
            occupied.push({ x, y, w, h });
            ctx.fillStyle = kind === 'thought' ? 'rgba(35,32,58,.94)' : 'rgba(38,36,22,.94)';
            ctx.strokeStyle = kind === 'thought' ? '#b5a7df' : '#dfca7a';
            ctx.beginPath(); ctx.roundRect(x, y, w, h, kind === 'thought' ? 15 : 5); ctx.fill(); ctx.stroke();
            ctx.textAlign = 'left'; ctx.fillStyle = kind === 'thought' ? '#c9bfee' : '#ead993';
            ctx.font = '9px system-ui, sans-serif'; ctx.fillText(label, x + 10, y + 14);
            ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#fff';
            clipped.forEach((t, i) => ctx.fillText(t, x + 10, y + 30 + i * 15, w - 20));
            ctx.restore();
        }
    }
}
