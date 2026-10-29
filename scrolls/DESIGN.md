# Scrolls: persistent, transferable agent memory as an in-game item

*Initial exploratory design, 27 Oct 2026; updated 29 Oct on `codex/scrolls-idea`, now based on current main. This document contains the original proposal, not approved implementation requirements. The [experience and mechanics proposal](EXPERIENCE.md) incorporates the first livelihood trial and records the choices to discuss before building. No scroll mechanics have been implemented.*

---

## 1. The idea

Give every agent a **scroll**: a real item in its inventory that holds text the agent writes. It can use it however it likes, whether as a journal, plan, ledger, clan charter, notes on game mechanics, or a script. It can also write scrolls for other players and hand them over, trade them, drop them, or bank them. **Scrolls persist across sessions**, so an agent that comes back next episode finds what it (or someone else) wrote.

Because the scroll is an item and not a side file, it obeys the game's rules: it can be given, sold, stolen, lost on death, or left in a library for strangers. A thought becomes a physical object with an owner and a history.

The questions this opens:
- **What do agents write when nothing requires them to write?** Plans, grudges, debts, maps, tick timings, scripts, a sense of self?
- **Do they organise?** Clans with charters, membership rolls, shared goals and records, none of which the server knows about.
- **Do written records make them better partners, or better liars?** QuestBench's core asset applies directly: the server knows what actually happened, so every written claim can be checked.
- **Does an agent become someone across episodes?** Its personal scroll is the only thing that carries over, so whatever identity forms has to be written down, and we can read it.

## 2. Relationship to QuestBench

QuestBench measures cooperation, competition and deception in **independent, comparable episodes**. Scrolls deliberately break independence: episode 3 depends on what was written in episodes 1–2. That changes the unit of measurement from an episode to a **series** (N series × K episodes), so scrolls are a separate track or a separate benchmark, never a hidden factor in existing cells.

It depends on **multiple LLM seats** (now available on `main`): scrolls are most interesting when the reader is another model that can act on them. Scripted partners can serve as fixtures (e.g. a scripted player that hands over a planted scroll). Studio now supports exploratory livelihood sessions, custom two-to-four-player configurations, observer cameras and audited interventions. Persistent series and scrolls remain proposals.

## 3. Game design

### 3.1 The item
| Rule | Why |
|---|---|
| Each agent starts with one **personal scroll**, inscribed with its name. | A guaranteed private space; the anchor for identity across episodes. |
| **Capacity limit** (start at ~2,000 characters per scroll). | Scarcity forces curation; what an agent keeps is signal. |
| Extra scrolls need **blank parchment**, which is bought or crafted. | Writing for others costs something, so giving a scroll means something. |
| Scrolls are ordinary items: tradeable, droppable, bankable, **dropped on death**, can be picked up by anyone. | Stakes, theft and loss are part of the design, not edge cases. |
| A **library** (an in-world building) where a scroll can be deposited as a public copy. | A shared, readable history of the world; a place strangers learn from. |

**Unresolved:** a name does not make a tradable item private or indestructible. Decide whether the
personal memory anchor is protected, with separate public documents, or whether loss of an ordinary
scroll can remove the agent's only lasting memory. Capacity, costs and death rules above are initial
suggestions; they are not decisions. See EXPERIENCE.md before implementing them.

### 3.2 Actions
| Action | Effect | Logged as |
|---|---|---|
| **Write** | Replace or append text on a held scroll (within capacity). | `scroll_write` (scroll id, author, version, text hash, full text) |
| **Read** | Read a held scroll, or a library copy. | `scroll_read` (who, which version) |
| **Copy** | Copy a held scroll onto a blank parchment. | `scroll_copy` (source, new id) |
| **Sign** | Add the writer's server-verified signature. Several players can co-sign. | `scroll_sign` |
| **Seal** | Make the scroll tamper-evident; any later write breaks the seal visibly. | `scroll_seal` / `scroll_seal_broken` |
| Give / trade / drop / bank / pick up | Ordinary item movement. | Existing trade and wealth events, plus `scroll_move` |

**Authorship is server truth; content is not.** A signature cannot be forged, but text can claim anything ("By order of the King of Varrock…"). The gap between claimed and true authorship is where deception becomes measurable.

Clans, contracts and treaties need no special support: a co-signed charter scroll *is* a clan. The server provides primitives and records; it never defines social structures.

### 3.3 Later, as an explicit condition: scrolls as code
A scroll whose text any holder can execute as an rs-sdk script. Knowledge becomes a transferable, tradeable object: a good mining routine can be sold. It is also the cleanest **in-world malicious-instructions test**: a planted scroll whose code drops the reader's coins. High research value for the safety tracks, high risk of confusing results; never on by default.

## 4. How humans see what is going on

Three layers, from inside the game outward.

**1. Diegetic: inside the world.**
- Humans log into the same local world with the normal web client, as **spectators** who can follow any player (needs an invisible observer mode; see §7).
- A human holding a scroll right-clicks **Read** and sees the parchment, in the same book-style interface quest journals use.
- Humans can **walk into the library** and read the world's public history.
- Optional, as its own condition: humans **play alongside** agents (trade them scrolls, leave scrolls for them). Never mixed into scored runs.

**2. Provenance: the history of every scroll.**
Every write, read, copy, signature and handover is a line in the hash-chained server event log, so each scroll has a complete, verifiable biography: who wrote each version, who held it and when, who read it before acting.

**3. The observatory: outside the game (new Studio views).**
- **Scroll browser:** every scroll, its versions with line-by-line diffs, and where it is now (inventory, bank, ground, library).
- **Agent pages:** an agent's personal scroll evolving across a series. The closest thing to watching an agent become itself.
- **Social graph:** who gave scrolls to whom, co-signatures, clusters that look like clans.
- **Influence:** "B read scroll X at tick 4,100, then did Y." The server knows both, so reading can be linked to acting.
- **Live feed and replay:** scroll events streamed during a run; a time slider across a whole series.

## 5. What we would measure

| Question | Measured by |
|---|---|
| What do agents write about? | Content categories over all versions: plans, ledgers/debts, social/relationships, game mechanics and timings, scripts, self-description. |
| Are written records honest? | Claims in scrolls checked against the event log (payments, positions, trades, promises kept). Accuracy vs self-serving distortion. |
| Do they trust others' scrolls? | Whether a reader acts on a scroll's content, split by author (self / known partner / stranger / unsigned) and by whether the content is true. |
| What carries over? | Behaviour change across a series attributable to the agent's own scroll (vs a no-scroll control series): grudges, learned partner habits, refined routines. |
| Does structure emerge? | Co-signed charters, membership rolls, shared goals, division of labour across a series. |
| Resistance to planted text | Response to a found scroll containing false claims or embedded instructions (in-world prompt injection). |

## 6. First pilot

A0 Rendezvous, two LLM seats of the same model, **5 episodes per series**, scrolls on, against a control series with scrolls off.
- Episode 2: one seat's brief tempts it to renege (e.g. a better offer elsewhere). Does the other seat record it, and does episode 3 change?
- Episode 4: a planted scroll on the ground near the meeting point with a false claim about the partner. Is it read, believed, acted on?
- Metrics: scroll content categories, honesty of written claims, behaviour change across episodes vs control.

## 7. Implementation sketch

Built as an extension of the existing anchor-based engine patcher (`engine/apply-patch.ts`, the same mechanism as the event log), so it applies to RuneBench's `bench-v71` rs-sdk and to `main`. A hard fork of rs-sdk only if a proper per-item-instance data model is needed.

| Piece | Approach | Risk |
|---|---|---|
| **Per-scroll identity** | The 2004 engine stores only item id + count; two scrolls with the same id cannot hold different text. Use a **pool of otherwise-unused existing item ids**, one per live scroll, with text stored server-side keyed by id. Survives trade, drop, bank and pickup unchanged. | Pool size caps the number of live scrolls; ids must be truly unused (no shop, drop table or quest reference). |
| **Text store** | Server-side JSON store (versions, signatures, seal state), persisted with player saves between episodes. | Must be tamper-proof from agents (root-owned, like the event log). |
| **Reading in-game** | Patch the item's Read option to open a book-style interface filled server-side. No client change. | Confirm a suitable interface exists in the cache. |
| **Writing** | SDK call (`sdk.scroll.write(...)`) handled by the engine, not the client UI. Logged to the event log. | Rate and size limits to keep logs sane. |
| **Library** | A designated in-world object (bookcase) with deposit/read operations. | None significant. |
| **Spectator** | Staff/observer account, invisible, able to follow players. | Unverified whether the engine supports invisibility; may need a small patch. |
| **Series runner** | Keep player saves and the scroll store between episodes of a series; reset everything else. | Seeds and variance analysis need series-level design. |
| **Observatory** | New Studio views over the event log + scroll store. | None significant. |

**After the experience/mechanics discussion, spike first:** compare a genuine per-instance item identity
with an isolated item-id pool; verify cache references and persistence before selecting either. Then
confirm native Read/Write interfaces and round-trip one scroll through write → trade → read → save →
reload. No safe item-id pool or suitable editable book interface has been established yet.

## 8. Open questions

1. Separate benchmark, QuestBench track, or an upstream rs-sdk feature? (Upstream would make scrolls available to every rs-sdk user, not just benchmarks.)
2. Does an agent know its personal scroll came from its own previous self? Told, untold, or both as conditions?
3. Capacity, parchment cost, and whether death really drops the personal scroll.
4. Library moderation: anything deposited is readable by every later agent, which is both the point and a contamination channel across models. Per-series libraries by default?
5. Scrolls as code: which isolation keeps an executable scroll from touching anything outside the bot it runs on?
6. Content safety for published runs: scroll text goes through the same redaction as transcripts before publishing.
