# Running QuestBench (v0.1 pilot: A0 Rendezvous)

All runs use a **local, controlled server** inside a container. Nothing touches the public rs-sdk demo server.

## Prerequisites
- Docker (8 GB+ RAM per concurrent trial)
- [Bun](https://bun.sh) ≥ 1.1
- [Harbor](https://harborframework.com) (the framework RuneBench uses)
- An API key for the agent you want to test (for example `ANTHROPIC_API_KEY` for `claude-code`)

## One command

```bash
./scripts/run-pilot.sh -a claude-code -m anthropic/claude-sonnet-4-5            # 1 trial, punctual partner, no aids
./scripts/run-pilot.sh -a claude-code -m anthropic/claude-sonnet-4-5 --all -k 3  # all 10 A0 tasks, 3 trials each
```

What it does:
1. **Builds the image** (`docker/Dockerfile`): starts from RuneBench's published benchmark image, applies the event-log hooks (`engine/apply-patch.ts`), adds the scripted partners and coordination aids, and turns chat on for the agent bot.
2. **Generates tasks** (`generate-tasks.ts`): starting saves, partner config, instructions (aided tasks also get `aids/INSTRUCTIONS.md`), and a bundled verifier.
3. **Runs Harbor.** In the container: the RuneBench services start, then `partner01` logs in through rs-sdk's headless lite client and runs its scripted policy; the agent plays through the `rs-agent` MCP server.
4. **Collects and scores.** `tests/test.sh` stops the partners, logs every bot out so final saves reach disk, copies the event log, saves and partner logs to `/logs/verifier/qb/`, then scores the trade from the saves.
5. **Bundles** each trial (`tools/bundle-from-harbor.ts`), redacts it, and runs the same checks the shared dataset will run on submission.
6. **Prints a results table** (`analysis/aggregate.ts`): success rate with a bootstrap CI, proposal specificity, initiative, and time to trade.

## Running GLM-5.3 on a z.ai key

RuneBench already ships an OpenCode adapter for GLM-5.3 on the z.ai GLM Coding Plan. Reuse it:

```bash
git clone https://github.com/MaxBittker/RuneBench ../RuneBench
export ZHIPU_API_KEY=...        # your z.ai key, set in your own shell; never commit it
./scripts/run-pilot.sh --glm --runebench ../RuneBench                 # 1 smoke trial
./scripts/run-pilot.sh --glm --runebench ../RuneBench --all -k 3      # 10 tasks x 3 trials
```

The coding plan is billed by subscription, not per token, so the `cost_usd` in bundles uses RuneBench's stand-in list price.

## The A0 task matrix (10 tasks)

| Variant | Partner behaviour | × condition |
|---|---|---|
| punctual | replies fast, waits 10 min | bare / aided |
| late | arrives 3 min after the agreed time | bare / aided |
| drifter | replies slowly, leaves after 90 s at the spot | bare / aided |
| vague-only | moves only for a place **and** a time | bare / aided |
| goal-mismatch | refuses coins, wants 20 logs | bare / aided |

**Aided** runs add a shared notice board, an inbox that captures messages while scripts run, and a chat-interrupt helper. Comparing bare with aided separates model limits from harness limits.

## First-run checklist (things only a live run can confirm)
- [ ] `docker/build.sh` succeeds: all event-log hooks apply to the rs-sdk revision baked into the RuneBench image.
- [ ] `events.jsonl` appears in `bundles/run-*/` and passes the chain check (the ingest output shows `"tier": "submitted"`).
- [ ] `partners/partner01.jsonl` shows `start`, then `reply`/`committed`/`arrived` events.
- [ ] Final saves are rewritten on logout (no `WARNINGS.txt` in the bundle).
- [ ] With a trivial "agent" that never acts, the verifier scores 0.5 (nothing changed hands); with a manual trade, 1.0.

## Remote runs (Modal)
Remote sandboxes can't pull `questbench:local`. The `publish-image` workflow builds the image on every push to `main` and publishes it to `ghcr.io/camaraterie/questbench`. Make the package public once (GitHub → Packages → questbench → Package settings → Change visibility), then set `QB_IMAGE=ghcr.io/camaraterie/questbench:latest` before generating tasks.
