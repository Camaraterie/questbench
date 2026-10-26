import type { ScenarioSave } from '../save/write';

export type Track = 'A-fellowship' | 'B-commons' | 'C-shadows' | 'D-relay' | 'E-mirror';
export type Tier = 'lite' | 'pair' | 'society';

/** Scripted partner policies (partners/policies.ts). Deterministic, no LLM cost. */
export type PartnerPolicy = 'cooperator' | 'defector' | 'tit-for-tat' | 'scammer' | 'silent' | 'honest-trader' | 'meetup-partner';

export interface Role {
    /** login username on the local server (lowercase, <= 12 chars) */
    username: string;
    kind: 'llm' | 'scripted';
    policy?: PartnerPolicy;
    /** Scenario-specific parameters passed to the partner policy */
    params?: Record<string, unknown>;
    save: ScenarioSave;
    /** Varps by name; resolved to ids from varp.pack when tasks are generated. */
    varpsByName?: Record<string, number>;
    /** Private brief for this role. For the LLM role this becomes instruction.md. */
    brief: string;
}

export interface Variant {
    /** appended to the scenario id: <id>-<variant.slug>-<minutes>m */
    slug: string;
    /** which roles' policies change in this variant */
    overrides: Record<string, Partial<Pick<Role, 'policy' | 'params' | 'brief'>>>;
    note: string;
}

export interface TradeExpect { gain: Array<{ id: number; count: number }>; lose?: Array<{ id: number; count: number }> }

export interface Scenario {
    id: string;
    track: Track;
    tier: Tier;
    title: string;
    summary: string;
    minutes: number[];
    roles: Role[];
    variants: Variant[];
    /** Run every variant twice: bare rs-sdk tools vs coordination aids (board + inbox + interrupt). */
    aidsDimension?: boolean;
    /** Verifier script under verifiers/ */
    verifier: string;
    /** Trade scenarios: what the LLM role should have gained/given up for full credit */
    expect?: TradeExpect;
    /** Metrics this scenario reports (see DESIGN.md, "Metrics") */
    metrics: string[];
    /** Facts checked against rs-sdk content when writing the scenario */
    groundTruth: string[];
    /** Unverified assumptions to close before scored runs */
    openQuestions: string[];
}
