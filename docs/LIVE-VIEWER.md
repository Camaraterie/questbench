# Live world observer

Studio includes two independent 3D cameras built from Palanti's rs-world integration. Each camera
can follow either trial player or explore freely. Controls include top view, roof cutaway and
fullscreen. The existing agent-client screenshot remains available as a collapsed fallback.

## Build and run

Use WSL on Windows. The renderer build puts dependencies on the Linux filesystem for performance
and copies the generated files to ignored vendor/viewer-build. It downloads the revision-289 game
cache into ignored vendor/viewer-cache; those files are served locally at runtime.

```sh
bun run viewer:build
./docker/build.sh questbench:observer
QB_IMAGE=questbench:observer bun run studio
```

Open http://localhost:4747. For a workspace reached through a Docker Desktop bind-mount alias, set
QB_STUDIO_ROOT to its original absolute path so sibling repositories resolve correctly.

Store ZHIPU_API_KEY in the repository's gitignored .env.local. Studio reads it at startup, so restart
Studio after changing the file. The value is passed to the trial launcher and never to the viewer.

## How observation works

- The local engine exposes an opt-in GET /qb-observer endpoint (QB_OBSERVER=1 in the image). It reads
  public entity positions, appearance and facing. It exposes no inventories, credentials or actions.
- Studio keeps one docker-exec polling process for its camera panes. Requests to the engine remain
  inside the selected local container; its game ports need not be published to the host.
- Each pane subscribes to its own bounded detail rectangle, up to 384 tiles on each side. Both panes
  get the full player roster. They can inspect different places independently.
- Positions are sampled about four times per second, with visual interpolation between observations.
  This is an observer view, not an exact reconstruction of every 50 ms game step. Stationary samples
  do not enqueue walking; feed loss does not extrapolate movement; long teleports snap.
- Studio resets entity state when the trial container changes and reports stale/disconnected feeds.
  Slow viewers are dropped rather than blocking the engine. Four concurrent panes are supported.
- A labeled disposable preview is stopped before a scored trial starts, so it does not compete for CPU.

No additional game account logs in to watch. No gameplay action is available through the observer.
There is no public-demo feed or runtime cache fallback. The optional 2D atlas falls back to the
renderer's local terrain worker; a precomputed whole-world atlas is not bundled.

## Provenance

Palanti source: https://git.cafe/rs-sdk/palanti-rs-sdk at
301e70a9d1e0a491f11bfd6d2e4f3b00dd91d9a1. Renderer: MaxBittker/rs-world at
7e4c9f711ba2f5a1f8e354c6083b8a471530383b. The maintained Palanti patch and QuestBench adaptations
are under studio/viewer; vendor is generated. See studio/viewer/NOTICE.md for credits and licenses.
Palanti's economy, assistant and mission execution systems are not imported.

## Deterministic preflight

The no-LLM smoke script boots an isolated local engine and two lite clients. It checks multi-chunk
PMs in both directions, movement from both adjacent Lumbridge spawn tiles, and a real
150-coin/five-bar trade with final inventory assertions.

```sh
docker run --rm --network none -e QB_SMOKE_CONTAINER=1 \
  -v "$PWD:/workspace/qb:ro" --entrypoint bun \
  questbench:observer /workspace/qb/tools/smoke-duo.ts
```

A disposable visual preview additionally sets QB_SMOKE_HOLD_SECS=1800 and the Docker label
questbench.observer-preview=1. The players walk short loops after the successful smoke check; no
model runs. This is explicitly preview activity, never benchmark results.
