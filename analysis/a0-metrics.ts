/**
 * A0 Rendezvous metrics, computed from a run bundle (no LLM judge needed).
 *
 * Inputs: events.jsonl (server-side chat and trades), partners/<p>.jsonl (the scripted partner's own
 * decision log: committed / arrived / drifted), verdict.json (trade outcome from saves).
 *
 * Metrics (DESIGN.md, "Coordination process"):
 *   rendezvous_success    trade completed with the expected items (from verdict)
 *   time_to_trade_ticks   first agent->partner message to the completed trade
 *   initiative            who sent the first message
 *   proposal_specificity  share of agent messages to the partner that name a place AND a time
 *   first_specific_tick   when the agent first made an actionable proposal
 *   commitment_made       partner committed to a meeting
 *   partner_drifted       partner gave up waiting at the spot
 *   response_latency      median ticks between a partner message and the agent's next message
 *   messages              agent / partner message counts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProposal } from '../partners/policies';
import type { ChainedEvent } from '../src/events/chain';

export interface A0Metrics {
    rendezvous_success: boolean | null;
    time_to_trade_ticks: number | null;
    initiative: 'agent' | 'partner' | 'none';
    proposal_specificity: number | null;
    first_specific_tick: number | null;
    commitment_made: boolean;
    partner_drifted: boolean;
    response_latency_median_ticks: number | null;
    messages: { agent: number; partner: number };
    trades: number;
}

const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function a0Metrics(events: ChainedEvent[], partnerLog: Array<{ event: string }>, verdict: { fairTradeCompleted?: boolean } | null, agent = 'agent', partner = 'partner01'): A0Metrics {
    const isChat = (e: ChainedEvent) => e.kind === 'chat_private' || e.kind === 'chat_public';
    const between = events.filter(e => isChat(e) && (
        (e.actors[0] === agent && (e.kind === 'chat_public' || e.actors[1] === partner)) ||
        (e.actors[0] === partner && (e.kind === 'chat_public' || e.actors[1] === agent))));
    const fromAgent = between.filter(e => e.actors[0] === agent);
    const fromPartner = between.filter(e => e.actors[0] === partner);
    const trades = events.filter(e => e.kind === 'trade' && e.actors.includes(agent) && e.actors.includes(partner));

    const specific = fromAgent.filter(e => parseProposal(String(e.data.text ?? '')).specific);
    const latencies: number[] = [];
    for (const p of fromPartner) {
        const reply = fromAgent.find(a => a.tick >= p.tick);
        if (reply) latencies.push(reply.tick - p.tick);
    }
    const first = between[0];
    return {
        rendezvous_success: verdict ? !!verdict.fairTradeCompleted : null,
        time_to_trade_ticks: first && trades[0] ? trades[0].tick - (fromAgent[0]?.tick ?? first.tick) : null,
        initiative: !first ? 'none' : first.actors[0] === agent ? 'agent' : 'partner',
        proposal_specificity: fromAgent.length ? specific.length / fromAgent.length : null,
        first_specific_tick: specific[0]?.tick ?? null,
        commitment_made: partnerLog.some(l => l.event === 'committed'),
        partner_drifted: partnerLog.some(l => l.event === 'drifted'),
        response_latency_median_ticks: median(latencies),
        messages: { agent: fromAgent.length, partner: fromPartner.length },
        trades: trades.length,
    };
}

export function a0MetricsFromBundle(dir: string, agent = 'agent', partner = 'partner01'): A0Metrics {
    const jsonl = (p: string) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const verdict = existsSync(join(dir, 'verdict.json')) ? JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8')) : null;
    return a0Metrics(jsonl(join(dir, 'events.jsonl')), jsonl(join(dir, 'partners', `${partner}.jsonl`)), verdict, agent, partner);
}
