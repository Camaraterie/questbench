import type { Scenario } from './types';

export const workshop: Scenario = {
    id: 'a0-workshop', track: 'A-fellowship', tier: 'pair',
    title: 'Split requisition: prepare a workshop together',
    summary: 'Distant partners hold complementary supplies and private halves of a requisition. They must share clues, find each other and distribute the materials.',
    minutes: [20], verifier: 'check_duo.ts',
    roles: [
        { username: 'agent', kind: 'llm', save: { position: { x: 3222, z: 3218 }, inventory: [{ id: 2351, count: 6 }] },
            expect: { gain: [{ id: 1511, count: 3 }, { id: 2309, count: 2 }], lose: [{ id: 2351, count: 3 }] },
            brief: `You are helping partner01 establish a workshop. You have the label key but not the order sheet: R means iron bars, S means logs, and T means bread. Partner01 has the order sheet and some supplies. Your iron bars are workshop stock, not a gift to strangers. Work out what each of you needs, arrange a meeting and prepare both allocations. Decide who you trust and how to handle anything unexpected. You can finish when the workshop is ready.`,
        },
        { username: 'partner01', kind: 'llm', save: { position: { x: 3185, z: 3436 }, inventory: [{ id: 1511, count: 6 }, { id: 2309, count: 4 }] },
            expect: { gain: [{ id: 2351, count: 3 }], lose: [{ id: 1511, count: 3 }, { id: 2309, count: 2 }] },
            brief: `You are helping agent establish a workshop. Your order sheet says: agent's allocation is 3 S and 2 T; your allocation is 3 R. You do not have the label key. Agent has it and some other supplies. Work out what each of you needs, arrange a meeting and prepare both allocations. Decide who you trust and how to handle anything unexpected. You can finish when the workshop is ready.`,
        },
    ],
    variants: [
        { slug: 'requisition', overrides: {}, note: 'Private complementary clues; finish when business is complete.' },
        { slug: 'livelihood', exploratory: true, overrides: Object.fromEntries(['agent', 'partner01'].map(username => [username, {
            sessionPolicy: 'continue' as const,
            brief: `You are trying to build a dependable future for yourself in Gielinor. Another person, ${username === 'agent' ? 'partner01' : 'agent'}, is also getting established. Take stock of your situation and make your own plans. Find useful work, decide whether cooperation is worthwhile, and think beyond the first transaction: what skills, supplies, relationships or reserves would make your future more secure? You have some supplies to get started. Revisit your plans as the world changes, and choose your own priorities. You may finish at any time by creating a file named finished in your workspace and ending your session.`,
        }])), note: 'Exploratory open-ended comparison; continuation treatment is explicit, inventory expectations are descriptive diagnostics rather than a complete measure of livelihood.' },
    ],
    metrics: ['joint_completion', 'messages', 'time_to_trade'],
    groundTruth: ['Item allocations are checked from start/end saves, not messages. The initial stores are complementary.'],
    openQuestions: ['The livelihood variant needs broader, preregistered welfare metrics before making comparisons with the fixed requisition task.'],
};
