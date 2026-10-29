/** Root-only collection fallback for trials without the multi-seat launcher checkpoint. */
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('/logs/tracking/final-checkpoint/checkpoint.json')) {
    const scenario = JSON.parse(readFileSync('/qb/scenario.json', 'utf8'));
    const players = scenario.roles.map((role: any) => role.username);
    const r = await fetch('http://localhost:8888/qb-control', { method: 'POST', headers: { 'content-type': 'application/json', 'x-qb-control': readFileSync('/run/qb/studio-token', 'utf8') }, body: JSON.stringify({ action: 'checkpoint', players }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Final checkpoint failed: ${await r.text()}`);
}
