# Server-side event log: integration plan

QuestBench scores social behaviour (promises kept, say–do consistency, scams) by checking what agents *said* against what the *server* recorded. That needs an append-only, hash-chained log written by the engine, which agents cannot write to (RuneBench's anti-tamper model: engine and logs are root-owned, the agent runs as the `agent` user).

**Status:** applied at image build time by `apply-patch.ts`, an anchor-based patcher (each hook point must match exactly once, re-running is a no-op). Tested against rs-sdk `main` (2026-10-25) and the `bench-v71` branch baked into RuneBench's v71 image. The older branch has no `TradeLedger.ts`, so trades are hooked in `InvOps.ts` (the trade-confirm block), which exists in both. Chains it writes pass `src/events/chain.ts`. Not yet run inside a live engine. Login/logout is not logged yet (planned for Track D).

## What rs-sdk already has

| Existing piece | Location (rs-sdk, `server/engine/src/`) | Use |
|---|---|---|
| `TradeLedger.recordTrade` (rs-sdk `main` only) | `engine/entity/tracking/TradeLedger.ts` | Append-only JSONL of completed player↔player trades, both sides, written when the engine runs the exchange. Off by default; enabled with `TRADE_LEDGER_FILE` (RuneBench images already set it). **Model to follow.** |
| `World.addWealthEvent` | `engine/World.ts` (called from `Player.addWealthEvent`, `script/handlers/InvOps.ts`) | Wealth events: TRADE, PVP, STAKE, DEATH, DROP, PICKUP, SHOP_BUY, SHOP_SELL, alchemy (`server/logger/WealthEventType.ts`) |
| `Player.setVar` | `engine/entity/Player.ts` | Every varp write, including quest progress (e.g. `phoenixgang`, `blackarmgang`, `qp`) |
| `MessagePublicHandler.handle` | `network/game/client/handler/MessagePublicHandler.ts` | Public chat, after the server's length cap and word filter |
| `MessagePrivateHandler.handle` | `network/game/client/handler/MessagePrivateHandler.ts` | Private messages |

## What the patch does (to discuss upstreaming with the rs-sdk maintainer)

1. Add `engine/entity/tracking/EventLog.ts` next to `TradeLedger.ts`: off unless `EVENT_LOG_FILE` is set; same append-and-warn-once behaviour; each line carries `seq`, `tick`, `prev` and `h` exactly as `src/events/chain.ts` defines, so `ingest/verify-bundle.ts` can check it.
2. Emit from the five hook points above. For `setVar`, log only `scope=perm` varps (quest state, not per-tick temp vars) to keep volume down.
3. Log the *post-filter* chat text the recipient actually saw, plus a flag if it was truncated or censored.
4. Record login and logout with the tick, so handoffs (Track D) are visible.

Upstreaming this into rs-sdk would let RuneBench and QuestBench share it; if that isn't wanted, it ships as a patch applied in the QuestBench image.
