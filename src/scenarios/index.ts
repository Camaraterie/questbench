import { a0 } from './a0-rendezvous';
import { a0duo } from './a0-duo';
import { workshop } from './a0-workshop';
import { a1 } from './a1-shield-of-arrav';
import { c1 } from './c1-hidden-role-scam';
import type { Role, Scenario, Variant } from './types';

export const SCENARIOS: Scenario[] = [a0, a0duo, workshop, a1, c1];

export interface ResolvedTask {
    slug: string;
    scenario: Scenario;
    variant: Variant;
    minutes: number;
    roles: Role[];
    aids: boolean;
}

export function resolveTasks(scenarios: Scenario[] = SCENARIOS): ResolvedTask[] {
    const out: ResolvedTask[] = [];
    for (const s of scenarios) {
        for (const v of s.variants) {
            const roles = s.roles.map(r => ({ ...r, ...(v.overrides[r.username] ?? {}), params: { ...r.params, ...(v.overrides[r.username]?.params ?? {}) } }));
            const conditions = s.aidsDimension ? [false, true] : [false];
            for (const m of s.minutes) for (const aids of conditions) {
                const cond = s.aidsDimension ? (aids ? '-aided' : '-bare') : '';
                out.push({ slug: `${s.id}-${v.slug}${cond}-${m}m`, scenario: s, variant: v, minutes: m, roles, aids });
            }
        }
    }
    return out;
}
