# QuestBench

**Measuring how AI agents cooperate, compete and deceive inside a living MMO, where every claim can be checked against the world.**

[Project page](https://camaraterie.github.io/questbench/) · [Design](DESIGN.md) · Built on [rs-sdk](https://github.com/MaxBittker/rs-sdk) and [RuneBench](https://maxbittker.github.io/runebench/) by Max Bittker · [rs-sdk Discord](https://discord.gg/3DcuU5cMJN)

> **Status: v0.1, pilot-ready, not yet run live.** The A0 Rendezvous pipeline is built end to end and passes offline tests. The first live container run is the next step ([runbook](docs/RUNBOOK.md)).

RuneBench asks how well a model plays alone. QuestBench asks what happens when several agents share the world:
- Can they split a quest, and do they keep their promises?
- Can they share a scarce resource without draining it?
- Do they resist a partner who is trying to scam them, and do they avoid lying themselves?

Rewards come only from server state, never from what agents say. Chat is data to be checked against what actually happened.

The first thing it measures is the most basic: **can two agents agree on a time and place, show up, and trade?** In open play this often fails because of asynchrony, vague plans, agents drifting off to other tasks, and mismatched goals. Each cooperative scenario runs with and without coordination aids, to tell model limits apart from harness limits.

Following Max's guidance, **all measurements run on a controlled, repeatable local server; nothing runs on the public demo server.**

## Tracks

| Track | Theme | First scenarios |
|---|---|---|
| A · Fellowship | Shared goals (miscoordination) | **A0 Rendezvous** (the meetup problem), **A1 Shield of Arrav** (a native two-gang quest) |
| B · Commons | Mixed motives (conflict) | Tragedy of the commons, stag hunt, public goods, Falador Party Room drop party |
| C · Shadows | Adversarial (collusion, deception) | **C1 Hidden-role trade**: scam resistance and deception propensity |
| D · Relay | Handoffs between controllers | Commitments kept across a controller swap |
| E · Mirror | Agent psychology | Sealed partner predictions, in-group bias |

Full rationale, metrics and prior work: [DESIGN.md](DESIGN.md).

## Layout

```
generate-tasks.ts        Harbor task generator (scenario × variant × condition × duration → tasks/<slug>/)
src/scenarios/           scenario specs (A0, A1, C1) with ground-truth notes and open questions
src/save/                .sav parser and writer, varp-name lookup from rs-sdk's varp.pack
src/events/chain.ts      hash-chained events.jsonl format + verifier
src/redact/              secret/PII scrubbing for run bundles
partners/                deterministic scripted partners (meetup partner, honest trader, cooperator, defector, silent, scammer)
aids/                    coordination aids: notice board, inbox service, chat interrupt
analysis/                A0 metrics + results aggregation
docker/                  QuestBench image, entrypoint, artifact collection
scripts/run-pilot.sh     one-command pilot run
verifiers/               check_quest.ts, check_trade.ts (score from saves only)
ingest/verify-bundle.ts  server-side checks for submitted run bundles
tools/                   bundle-from-harbor.ts, redact-bundle.ts, submit.ts (stub), build-page.py
schema/                  run manifest JSON schema
engine/                  event-log hooks for rs-sdk (apply-patch.ts, src/EventLog.ts, EVENT_LOG.md)
docs/                    project page (GitHub Pages)
```

## Quick start

```bash
bun test                                    # 29 unit + offline end-to-end tests
./scripts/run-pilot.sh -a claude-code -m anthropic/claude-sonnet-4-5    # build image, run A0, bundle, score
```

Full instructions and a first-run checklist: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Watch runs in your browser: QuestBench Studio

```bash
bun run studio      # opens http://localhost:4747
```
- **Live:** the agent's timeline (thoughts, code, results, cost), the game screen refreshing every second, the partner's progress (online → heard → replied → agreed to meet → arrived → traded), and everything the server recorded (PMs, chat, trades). Alerts appear if the partner bot fails to log in.
- **Runs:** every finished run with its outcome, game video, conversation and full timeline.
- **Launch:** a setup check (Docker, Harbor, key, RuneBench) and a Run button. Put `ZHIPU_API_KEY=...` in a gitignored `.env.local` so launches don't need a terminal.

Watching is read-only. The separate operator inspector can edit player items and positions with an audited reason; edited runs are excluded from baseline results. Launch also supports distant cooperative puzzles, open-ended livelihood sessions and custom two-to-four-player scenarios. See [the scenario lab guide](docs/SCENARIO-LAB.md) for configuration, observation and intervention details. Coding agents can use the same JSON API (see `AGENTS.md`).

## Pipeline

```
docker/Dockerfile        RuneBench image + event-log hooks + partners + aids  ->  ghcr.io/camaraterie/questbench
generate-tasks.ts        scenario x variant x (bare|aided) x duration                 ->  tasks/<slug>/   (20 tasks)
harbor run               container: engine, gateway, agent bot, scripted partner(s)
  tests/test.sh          collect-artifacts.sh (logout -> final saves) + verifier       ->  /logs/verifier/qb/
tools/bundle-from-harbor.ts   trial -> run bundle, redacted, ingest-checked            ->  bundles/run-<uuid>/
analysis/aggregate.ts    bundles -> results table with bootstrap CIs                   ->  results/*.json
```

## Status

| Piece | State |
|---|---|
| A0 Rendezvous (pilot) | 5 partner variants × bare/aided; meetup partner, aids, verifier, metrics written and unit-tested |
| Engine event log | Anchor-based patcher (`engine/apply-patch.ts`); applies to rs-sdk `main` and RuneBench's `bench-v71`; output verified against the chain checker |
| Coordination aids | Notice board, inbox service (rs-sdk observe-mode chat), chat-interrupt helper |
| Bundling, redaction, ingest, aggregation | Offline end-to-end test passes |
| Save parser/writer, quest + trade verifiers | Tested |
| A1 Shield of Arrav | Generated; Black Arm partner route is TODO |
| C1 Hidden-role trade | Generated; scam tactics written |
| **Live container run** | **Not yet done.** The sandbox this was built in can't run the engine; see the runbook checklist |
| Submit / hosted dataset | Not started |

## Open decisions

- **Image hosting:** the QuestBench image builds on RuneBench's published image. Publishing our own (for example to GHCR) is needed for remote runs (Modal).
- **Event log:** upstream it into rs-sdk, or keep it as a QuestBench patch.
- **Telemetry hosting:** where run bundles and the public dataset live.
- **Data licence** for contributed runs (proposed: CC-BY-4.0).

## Contributing

Feedback on the design is the most useful contribution right now: open an issue or find us in the rs-sdk Discord. When run packs are ready, contributors will be able to run tasks with their own API keys and submit redacted run bundles.

## Acknowledgements

QuestBench builds directly on [rs-sdk](https://github.com/MaxBittker/rs-sdk) and [RuneBench](https://github.com/MaxBittker/RuneBench) by Max Bittker. Both are built on the [LostCity](https://github.com/LostCityRS/Server) engine. This is an independent community project. It is not affiliated with or endorsed by Jagex Ltd. or the rs-sdk / RuneBench maintainers.

## License

[MIT](LICENSE)
