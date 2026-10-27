#!/usr/bin/env bun
/**
 * Sanity checks on a finished trial, run by collect-artifacts.sh. Prints one warning per line
 * (empty output = healthy). Warnings land in the bundle's WARNINGS.txt and mark the run as
 * not counting toward results.
 *   bun /qb/check-run.ts <events.jsonl> <partners-dir> [agent=agent]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checkRun(eventsText: string, partnerLogs: Record<string, string>, agent = 'agent'): string[] {
    const events = eventsText.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const warnings: string[] = [];
    const firstSeen = (who: string) => events.find((e: any) => e.actors?.[0] === who);
    const agentOn = firstSeen(agent);
    if (!agentOn) warnings.push(`agent "${agent}" never appeared in the server log (client never got in-game)`);
    for (const [partner, log] of Object.entries(partnerLogs)) {
        const lines = log.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const pOn = firstSeen(partner);
        if (!pOn) { warnings.push(`partner "${partner}" never appeared in the server log (did not log in)`); continue; }
        const toPartner = events.filter((e: any) => e.kind === 'chat_private' && e.actors?.[0] === agent && e.actors?.[1]?.toLowerCase() === partner);
        const heard = lines.filter((l: any) => l.event === 'heard').length;
        if (toPartner.length > 0 && heard === 0) warnings.push(`partner "${partner}" heard none of the ${toPartner.length} private message(s) the server logged from ${agent} (PM delivery broken?)`);
        const end = lines.find((l: any) => l.event === 'end');
        const lastAgentMsg = [...toPartner].pop();
        if (end && lastAgentMsg && Date.parse(lastAgentMsg.ts) > Date.parse(end.ts)) warnings.push(`partner "${partner}" stopped at ${end.ts}, before the agent's last message at ${lastAgentMsg.ts}`);
    }
    if (agentOn) {
        const first = events[0];
        const lag = (Date.parse(agentOn.ts) - Date.parse(first.ts)) / 1000;
        if (lag > 90) warnings.push(`agent got in-game ${Math.round(lag)} s after the first player (slow client start; time lost from the agent's budget)`);
    }
    return warnings;
}

if (import.meta.main) {
    const [eventsPath, partnersDir, agent = 'agent'] = process.argv.slice(2);
    const logs: Record<string, string> = {};
    if (partnersDir && existsSync(partnersDir)) for (const f of readdirSync(partnersDir)) if (/^[a-z0-9_]+\.jsonl$/.test(f)) logs[f.replace('.jsonl', '')] = readFileSync(join(partnersDir, f), 'utf8');
    for (const w of checkRun(existsSync(eventsPath!) ? readFileSync(eventsPath!, 'utf8') : '', logs, agent)) console.log(`[check] ${w}`);
}
