import { createHash } from 'node:crypto';
import type { Scenario } from './types';
const integer = (v: unknown, min: number, max: number, label: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be ${min}–${max}`);
    return v;
};
function text(v: unknown, max: number, label: string) {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${label}`);
    return v.trim();
}
function items(v: any, capacity: number) {
    if (!Array.isArray(v) || v.length > capacity) throw new Error(`At most ${capacity} item entries`);
    return v.map(x => ({ id: integer(x.id, 0, 65534, 'Item ID'), count: integer(x.count, 1, 1_000_000_000, 'Item count') }));
}
/** Canonical private roles. Unknown fields/credentials never enter the launch file. */
export function customScenario(input: any): Scenario {
    if (!input || !Array.isArray(input.roles) || input.roles.length < 2 || input.roles.length > 4) throw new Error('Choose two to four players');
    const title = text(input.title, 100, 'title');
    const roles = input.roles.map((r: any) => {
        const username = text(r.username, 12, 'username').toLowerCase();
        if (!/^[a-z][a-z0-9_]*$/.test(username)) throw new Error('Use simple lowercase player names');
        if (r.sessionPolicy !== undefined && !['finish', 'continue'].includes(r.sessionPolicy)) throw new Error('Unknown session policy');
        const worn = r.worn ?? [];
        if (!Array.isArray(worn) || worn.length > 14 || new Set(worn.map((x: any) => x.slot)).size !== worn.length) throw new Error('Invalid equipment slots');
        return { username, kind: 'llm' as const, brief: text(r.brief, 12000, 'private brief'),
            sessionPolicy: r.sessionPolicy === 'continue' ? 'continue' as const : 'finish' as const,
            save: { position: { x: integer(r.position?.x, 1, 16383, 'x'), z: integer(r.position?.z, 1, 16383, 'z'), level: integer(r.position?.level ?? 0, 0, 3, 'level') },
                inventory: items(r.inventory ?? [], 28), bank: items(r.bank ?? [], 496),
                worn: worn.map((x: any) => ({ slot: integer(x.slot, 0, 13, 'Equipment slot'), id: integer(x.id, 0, 65534, 'Item ID') })),
            }, expect: { gain: [] },
        };
    });
    if (new Set(roles.map((r: any) => r.username)).size !== roles.length || roles[0].username !== 'agent') throw new Error('Player names must be unique; first player must be agent');
    const minutes = integer(input.minutes ?? 20, 1, 60, 'Duration');
    const id = `a0-lab-${createHash('sha256').update(JSON.stringify({ title, minutes, roles })).digest('hex').slice(0, 12)}`;
    return { id, title, summary: 'Custom exploratory session', track: 'A-fellowship', tier: roles.length === 2 ? 'pair' : 'society', minutes: [minutes], roles,
        variants: [{ slug: 'custom', exploratory: true, overrides: {}, note: 'Operator-configured exploratory session; excluded from baseline aggregates.' }],
        verifier: 'check_duo.ts', metrics: [], groundTruth: ['The full private scenario configuration is preserved with the run.'], openQuestions: [],
    };
}
export function editableScenario(s: Scenario) {
    return { title: s.title, minutes: s.minutes[0], roles: s.roles.filter(r => r.kind === 'llm').map(r => ({ username: r.username, brief: r.brief, sessionPolicy: r.sessionPolicy ?? 'finish', position: r.save.position, inventory: r.save.inventory ?? [], worn: r.save.worn ?? [], bank: r.save.bank ?? [] })) };
}
