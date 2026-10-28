# Live observation: Palanti integration

The desired Studio game view is a live observer: independent player-follow cameras, a camera wall,
free pan/zoom, and an overview of both seats. The existing screenshot is a view of the agent's client;
it cannot provide those capabilities.

## Reference inspected

[palanti-rs-sdk](https://git.cafe/rs-sdk/palanti-rs-sdk), main at
`301e70a9d1e0a491f11bfd6d2e4f3b00dd91d9a1` (2026-10-28).

- `server/world.ts` decodes a world feed: roster, entity positions/appearances, NPCs and signals.
- `server/index.ts` relays a shared observation area to `/viewer-feed` WebSocket clients.
- `server/viewer-bootstrap.ts` initializes newly opened cameras from current state without replaying
  historical one-shot animations.
- `scripts/build-viewer.sh` builds a pinned `MaxBittker/rs-world` renderer plus Palanti's viewer patch.
- The renderer supports player-follow and area cameras. A single shared detailed observation area
  limits simultaneous coverage of far-apart cameras; separate camera panes do not remove that limit.

The reference currently hardcodes a public-demo world feed. It was inspected as source only, not
started. QuestBench must never connect a trial or observer to that public server. The current v71
benchmark image has no worldfeed implementation, so changing a URL alone is insufficient.

## Recommended boundary

Keep QuestBench's trial launch, scores, event log and reasoning timelines. Add a narrow observer
integration using Palanti's renderer/camera work, rather than importing its economy, assistant,
mission execution and fleet-control systems. Start on a separate viewer branch after the PM/spawn
fix is validated. A renderer adapter can initially live in QuestBench; a separate Palanti fork makes
sense if its UI is retained broadly enough to benefit from tracking upstream.

1. Add a read-only worldfeed producer to the **local engine**, compatible with the inspected feed
   protocol. Capture authoritative entity state; do not log in another player to observe.
2. Relay it through Studio from the selected trial container. Invalidate connection/state when the
   container changes, and show disconnected/stale status instead of stale positions as current.
3. Build the pinned renderer locally and serve its assets through Studio. Make the relay the only
   runtime feed destination; remove public feed/asset fallbacks. Keep model credentials out of it.
4. Show a follow camera for each seat and an optional shared overview. Retain reasoning and server
   events beside the views. Make the shared detail-coverage boundary visible.
5. Bound observer work and drop slow frames/clients so watching cannot stall the engine. Compare
   tick timing with the observer on and off before using it in scored runs.

Preserve the app's MIT notices and the renderer's BSD-2-Clause notices as described in Palanti's
`THIRD-PARTY-NOTICES.md`. Its game cache/art assets have separate provenance; the root software
license does not itself grant redistribution of those assets.

## PM/spawn preflight

The deterministic smoke script boots an isolated local engine plus two lite clients. It checks
multi-chunk PMs in both directions against sender output, movement out of both spawn tiles, and
an actual 150-coin/five-bar trade with final inventory checks. It calls no model or publishing API.

From WSL, after building `questbench:pm-lumbridge`:

```sh
docker run --rm --network none -e QB_SMOKE_CONTAINER=1 \
  -v "$PWD:/workspace/qb:ro" --entrypoint bun \
  questbench:pm-lumbridge /workspace/qb/tools/smoke-duo.ts
```

Use a disposable container: the script writes scenario saves and starts local services. For a
diagnostic failure, omit `--rm` and inspect `/tmp/qb-smoke-*.log` in the stopped container.

Validated on 2026-10-28 with `questbench:pm-lumbridge`: both directions' PM chunks matched sender
output, both players left and returned to their spawn tiles, and the 150-coin/five-bar trade
completed with the expected inventories (container exit 0). No LLM trial was launched. Until a
fixed image is published, explicitly select this local image for a retry:

```sh
QB_IMAGE=questbench:pm-lumbridge ./scripts/run-pilot.sh --duo --no-publish
```
