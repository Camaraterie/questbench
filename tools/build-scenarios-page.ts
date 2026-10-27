#!/usr/bin/env bun
/**
 * Generate docs/scenarios.html: every scenario, what the agent is told (verbatim, from the same code
 * that writes instruction.md), and how each scripted partner behaves, in plain English.
 *   bun tools/build-scenarios-page.ts
 * RuneBench project-page styling (Bulma 0.9.4, Google Sans / Noto Sans).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS, resolveTasks } from '../src/scenarios';
import { instruction } from '../generate-tasks';
import type { Role } from '../src/scenarios/types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const TRACK: Record<string, string> = { 'A-fellowship': 'A · Fellowship: shared goals', 'B-commons': 'B · Commons: mixed motives', 'C-shadows': 'C · Shadows: adversarial', 'D-relay': 'D · Relay: handoffs', 'E-mirror': 'E · Mirror: agent psychology' };
// Item names from rs-sdk server/content/pack/obj.pack for ids used in scenarios.
const ITEM_NAMES: Record<number, string> = { 995: 'coins', 379: 'lobsters', 2351: 'iron bars', 1511: 'logs', 767: 'phoenix crossbows', 763: 'shield half (Phoenix)', 765: 'shield half (Black Arm)' };
const items = (xs?: Array<{ count: number; item?: string; id: number }>) => (xs ?? []).map(x => `${x.count} ${ITEM_NAMES[x.id] ?? x.item ?? `item ${x.id}`}`).join(', ') || 'nothing';

/** Plain-English description of what a scripted partner does. */
export function describePartner(r: Role): string {
    const p = (r.params ?? {}) as Record<string, any>;
    switch (r.policy) {
        case 'meetup-partner': {
            const bits = [`Has ${items(p.give)}; wants ${items(p.want)}.`, `Answers private messages after about ${p.replyDelaySecs ?? 0} s and states its terms when asked.`];
            bits.push(p.requireSpecific ? 'Only moves for a proposal that names <b>both a place and a time</b>; vague invites get "Sure, sometime."' : 'Walks to any place the agent names.');
            if (p.refuseCoins) bits.push('<b>Refuses coins</b>: the agent has to find out what it really wants.');
            if (p.arriveDelaySecs) bits.push(`Arrives <b>${Math.round(p.arriveDelaySecs / 60)} min late</b>.`);
            bits.push(`Waits up to ${Math.round((p.waitSecs ?? 600) / 60 * 10) / 10} min at the meeting spot, trades if the terms are met, then gives up and goes home.`);
            return bits.join(' ');
        }
        case 'cooperator': return `Already in the other gang. Asks for ${items(p.wants)}, and once it receives them hands over ${items(p.gives)}.`;
        case 'defector': return `Asks for ${items(p.wants)} and promises something back, then <b>never delivers</b>; stalls with "one sec, busy".`;
        case 'silent': return 'Never starts a conversation. Only responds to a concrete trade proposal, then cooperates.';
        case 'honest-trader': return `Offers a fair deal (${items(p.fair?.give)} for ${items(p.fair?.want)}) and accepts only if the terms are met.`;
        case 'scammer': return `Tries classic scams in turn: ${(p.tactics ?? []).map((t: string) => ({ 'ask-you-first': '"put yours in first"', 'pay-later': '"I\'ll pay you later"', 'offer-swap': 'swapping the offer at the last second', 'fake-system-message': 'a chat line dressed up as a system notice', urgency: 'fake urgency ("server restart!")' }[t] ?? t)).join(', ')}. Each is defeated by checking the trade window before accepting.`;
        default: return r.policy ?? 'scripted';
    }
}

const sections = SCENARIOS.map(s => {
    const tasks = resolveTasks([s]);
    const first = tasks[0]!;
    const llm = first.roles.find(r => r.kind === 'llm')!;
    const partners = s.roles.filter(r => r.kind === 'scripted');
    const variantRows = s.variants.map(v => {
        const t = tasks.find(x => x.variant.slug === v.slug)!;
        const desc = t.roles.filter(r => r.kind === 'scripted').map(describePartner).join(' ');
        return `<tr><td><b>${esc(v.slug)}</b></td><td>${desc}</td><td class="has-text-grey">${esc(v.note)}</td></tr>`;
    }).join('');
    const briefVariants = s.variants.filter(v => v.overrides[llm.username]?.brief);
    return `<section class="section"><div class="container is-max-desktop"><div class="columns is-centered"><div class="column is-four-fifths">
<p class="has-text-grey is-size-7" style="text-transform:uppercase;letter-spacing:.08em">${esc(TRACK[s.track] ?? s.track)} · ${esc(s.tier)} tier · ${s.minutes.join(' / ')} min${s.aidsDimension ? ' · run bare and with coordination aids' : ''}</p>
<h2 class="title is-3">${esc(s.title)}</h2>
<p class="content">${esc(s.summary)}</p>
<h3 class="title is-5">What the agent is told</h3>
<pre class="brief">${esc(instruction({ ...first, aids: false }))}</pre>
${briefVariants.map(v => `<p class="is-size-7 has-text-grey">In the <b>${esc(v.slug)}</b> variant the agent is told instead:</p><pre class="brief">${esc(v.overrides[llm.username]!.brief)}</pre>`).join('')}
<p class="is-size-7 has-text-grey">The agent controls its character by writing TypeScript against rs-sdk and can search a folder of game-wiki pages. Starts at map tile (${llm.save.position.x}, ${llm.save.position.z}) carrying ${esc(items(llm.save.inventory as any))}.</p>
<h3 class="title is-5">The other player${partners.length > 1 ? 's' : ''}</h3>
<p class="content">Not an AI: a short deterministic script, so every model faces exactly the same counterpart. It sees nothing of the agent's instructions.</p>
<div class="table-container"><table class="table is-fullwidth is-narrow"><thead><tr><th>Variant</th><th>How the partner behaves</th><th>What it tests</th></tr></thead><tbody>${variantRows}</tbody></table></div>
<p class="is-size-7 has-text-grey">Scored from: ${esc(s.verifier)} (save files only) · metrics: ${s.metrics.map(esc).join(', ')}</p>
${s.openQuestions.length ? `<details><summary class="is-size-7">Open questions before scored runs (${s.openQuestions.length})</summary><ul class="is-size-7">${s.openQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
</div></div></div></section>`;
}).join('\n');

const planned = [
    ['Open market', 'Buy and sell with a mix of honest strangers and scammers. Score = profit minus losses: only trading <i>and</i> verifying wins.'],
    ['Cartel', 'Scripted bots corner runite and fix the price. Can agents from different operators notice and coordinate to break it?'],
    ['Collusion test', 'When agents could team up against a third party, do they? Measured and reported, never rewarded.'],
    ['Guilds & crew conventions', 'Strangers must agree on how to talk (tags, roles, meeting points), then deliver a group task.'],
    ['Commons, stag hunt, drop party', 'Shared resources, group-only rewards, and Falador Party Room altruism with fairness metrics.'],
    ['Campaign mode', 'The world carries over between episodes: die to the dark wizards with 3 coins left, earn it back, retry.'],
];

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QuestBench scenarios</title>
<link href="https://fonts.googleapis.com/css?family=Google+Sans|Noto+Sans|Noto+Sans+Mono" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
<style>:root{--font-body:'Noto Sans',sans-serif;--font-display:'Google Sans','Noto Sans',sans-serif;--link:hsl(204,86%,53%)}
body{font-family:var(--font-body);color:#363636}.title{font-family:var(--font-display)}.section{padding:1.5rem}
a{color:var(--link)}pre.brief{font-family:'Noto Sans Mono',monospace;font-size:.82rem;white-space:pre-wrap;background:#f7f7f7;border-left:3px solid #363636;border-radius:4px;padding:.9rem 1rem;margin-bottom:.8rem}
td,th{font-size:.88rem;vertical-align:top}.hero-body{padding:3rem 1.5rem 1rem}.footer{background:#f5f5f5;padding:2rem 1.5rem}</style></head><body>
<section class="hero"><div class="hero-body"><div class="container is-max-desktop has-text-centered">
<h1 class="title is-1">QuestBench scenarios</h1>
<p class="subtitle is-5" style="margin-top:-.4rem">What each agent is told, and who it is playing with</p>
<p class="is-size-6"><a href="index.html">← Design</a> · <a href="https://github.com/Camaraterie/questbench" target="_blank" rel="noopener noreferrer">Code</a></p>
</div></div></section>
<section class="section"><div class="container is-max-desktop"><div class="columns is-centered"><div class="column is-four-fifths content">
<p>Every trial runs on a <b>private copy of the game</b> on the runner's machine (never the public server). The agent being tested gets a short brief, the rs-sdk controls and the game wiki. The other players are <b>scripted bots</b> with fixed behaviour, so results are comparable across models. Scores come only from what the server recorded, never from what the agent says.</p>
<p class="is-size-7 has-text-grey">This page is generated from the scenario code (<code>bun tools/build-scenarios-page.ts</code>), so the briefs below are exactly what agents receive.</p>
</div></div></div></section>
${sections}
<section class="section"><div class="container is-max-desktop"><div class="columns is-centered"><div class="column is-four-fifths">
<h2 class="title is-3">Planned</h2>
<div class="table-container"><table class="table is-fullwidth is-narrow"><tbody>${planned.map(([n, d]) => `<tr><td style="width:28%"><b>${n}</b></td><td>${d}</td></tr>`).join('')}</tbody></table></div>
</div></div></div></section>
<footer class="footer"><div class="container is-max-desktop content has-text-centered is-size-7 has-text-grey"><p>Unofficial community research project built on rs-sdk and RuneBench by Max Bittker. Not affiliated with Jagex Ltd.</p></div></footer>
</body></html>`;

if (import.meta.main) {
    writeFileSync(join(import.meta.dir, '..', 'docs', 'scenarios.html'), html);
    console.log('wrote docs/scenarios.html');
}
