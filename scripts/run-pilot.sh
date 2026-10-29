#!/bin/bash
# QuestBench v0.1 pilot: A0 Rendezvous, end to end on your machine.
#
#   ./scripts/run-pilot.sh --glm --runebench ../RuneBench                  # GLM-5.3 on a z.ai key, 1 smoke trial
#   ./scripts/run-pilot.sh --glm --runebench ../RuneBench --all -k 3       # all 10 A0 tasks x 3 trials
#   ./scripts/run-pilot.sh -a claude-code -m anthropic/claude-sonnet-4-5   # any built-in Harbor agent
#   ./scripts/run-pilot.sh --duo                                            # A0 with an LLM in both seats (GLM-5.3 x2)
#   ./scripts/run-pilot.sh --duo -t a0-duo-goal-mismatch-15m --seat-models partner01=zai-coding-plan/glm-5.3
#   --no-publish  keep results local instead of pushing them to Camaraterie/questbench-runs
#
# Image: uses the published image (QB_IMAGE, default ghcr.io/camaraterie/questbench:latest).
#        Pin a commit tag for a pilot so every run shares one environment. --build-local builds
#        docker/Dockerfile into questbench:local instead.
# --glm  uses agents/qb_glm53.py, a thin wrapper over RuneBench's GLM-5.3 OpenCode adapter
#        (z.ai GLM Coding Plan). Needs a RuneBench clone (--runebench) and ZHIPU_API_KEY.
#
# Steps: preflight -> image -> generate tasks -> harbor run -> bundle + redact -> ingest checks -> results.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

AGENT="claude-code"; MODEL=""; IMPORT_PATH=""; RB=""; TRIALS=1; DUO=0; SEAT_MODELS=""; SCENARIO_FILE=""; RESUME_BUNDLE=""
FILTER="a0-rendezvous-punctual-bare-15m"; ENV="docker"; HANDLE="${QB_HANDLE:-anonymous}"; BUILD_LOCAL=0; PUBLISH=1
while [ $# -gt 0 ]; do
  case "$1" in
    -a) AGENT="$2"; shift 2 ;;
    -m) MODEL="$2"; shift 2 ;;
    -k) TRIALS="$2"; shift 2 ;;
    -t) case "$2" in a0-*) FILTER="$2" ;; *) FILTER="a0-rendezvous-$2" ;; esac; shift 2 ;;
    --all) FILTER="a0-rendezvous"; shift ;;
    --env) ENV="$2"; shift 2 ;;
    --handle) HANDLE="$2"; shift 2 ;;
    --agent-import-path) IMPORT_PATH="$2"; shift 2 ;;
    --runebench) RB="$2"; shift 2 ;;
    --glm) IMPORT_PATH="qb_glm53:QbGlm53OpenCode"; MODEL="zai-coding-plan/glm-5.3"; shift ;;
    --duo) DUO=1; shift ;;
    --seat-models) SEAT_MODELS="$2"; shift 2 ;;
    --scenario-file) SCENARIO_FILE="$2"; shift 2 ;;
    --resume-bundle) RESUME_BUNDLE="$2"; shift 2 ;;
    --build-local) BUILD_LOCAL=1; shift ;;
    --no-publish) PUBLISH=0; shift ;;
    --skip-build) shift ;;   # accepted for compatibility; the published image is the default now
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done

# Two LLM seats: the seats adapter starts both inside the container (needs Harbor only, not RuneBench).
if [ "$DUO" = "1" ]; then
  IMPORT_PATH="qb_seats:QbSeats"; MODEL="${MODEL:-zai-coding-plan/glm-5.3}"
  [[ "$FILTER" == a0-duo* || "$FILTER" == a0-workshop* || "$FILTER" == a0-lab* ]] || FILTER="a0-duo-open-15m"
  [ -n "$SCENARIO_FILE" ] && FILTER="a0-lab"
  [ -n "$RESUME_BUNDLE" ] && FILTER="a0-return"
fi

# ── Preflight: fail fast with a fix, before generating anything ──
fail() { echo "✗ $1"; echo "  fix: $2"; exit 2; }
command -v docker >/dev/null || fail "docker not found" "install Docker (WSL: Docker Desktop -> Settings -> Resources -> WSL integration -> enable your distro, then reopen the terminal)"
docker info >/dev/null 2>&1 || fail "docker is installed but the engine isn't reachable" "start Docker Desktop (or the docker service) and retry"
command -v bun >/dev/null || fail "bun not found" "curl -fsSL https://bun.sh/install | bash   (then reopen the terminal)"
command -v harbor >/dev/null || fail "harbor not found" "uv tool install harbor   (or: pip install harbor)"
[ -z "$MODEL" ] && fail "no model" "pass -m <model>, or --glm for GLM-5.3 on a z.ai key"
AGENT_ARGS=(-a "$AGENT")
if [ "$DUO" = "1" ]; then
  export PYTHONPATH="$REPO/agents${PYTHONPATH:+:$PYTHONPATH}"
  AGENT_ARGS=(--agent-import-path "$IMPORT_PATH")
  [ -n "$SEAT_MODELS" ] && AGENT_ARGS+=(--agent-kwarg "seat_models=$SEAT_MODELS")
  [[ "$MODEL" == zai-coding-plan/* || "$SEAT_MODELS" == *zai-coding-plan* ]] && [ -z "${ZHIPU_API_KEY:-}" ] && fail "ZHIPU_API_KEY is not set in this terminal" "export ZHIPU_API_KEY=<your z.ai key>"
elif [ -n "$IMPORT_PATH" ]; then
  [ -z "$RB" ] && fail "--glm / --agent-import-path need RuneBench's adapters" "git clone https://github.com/MaxBittker/RuneBench ../RuneBench  and pass --runebench ../RuneBench"
  [ -f "$RB/agents/opencode_adapter.py" ] || fail "no agents/opencode_adapter.py under $RB" "point --runebench at a RuneBench clone"
  export PYTHONPATH="$REPO/agents:$(cd "$RB" && pwd)/agents${PYTHONPATH:+:$PYTHONPATH}"
  AGENT_ARGS=(--agent-import-path "$IMPORT_PATH")
  if [[ "$IMPORT_PATH" == *glm* ]] && [ -z "${ZHIPU_API_KEY:-}" ]; then fail "ZHIPU_API_KEY is not set in this terminal" "export ZHIPU_API_KEY=<your z.ai key>   (env vars don't carry over to new terminals)"; fi
fi
case "$REPO" in /mnt/[a-z]/*) echo "! repo is on the Windows drive ($REPO); it works, but cloning into your WSL home (~/questbench) is much faster for Docker builds." ;; esac

# ── Image ──
if [ "$BUILD_LOCAL" = "1" ]; then
  export QB_IMAGE="questbench:local"
  ./docker/build.sh "$QB_IMAGE"
else
  export QB_IMAGE="${QB_IMAGE:-ghcr.io/camaraterie/questbench:latest}"
  [ "$QB_IMAGE" = "questbench:local" ] && ! docker image inspect questbench:local >/dev/null 2>&1 && \
    fail "QB_IMAGE=questbench:local but that image doesn't exist" "unset QB_IMAGE to use the published image, or pass --build-local"
  echo "· image $QB_IMAGE"
  docker image inspect "$QB_IMAGE" >/dev/null 2>&1 || docker pull "$QB_IMAGE"
fi
if [ "$ENV" != "docker" ] && [ "$QB_IMAGE" = "questbench:local" ]; then
  fail "remote env --env $ENV can't pull a local image" "use the published image (drop --build-local)"
fi

# ── Generate, run, bundle ──
GEN_ARGS=(--only "$FILTER")
[ -n "$SCENARIO_FILE" ] && GEN_ARGS+=(--scenario-file "$SCENARIO_FILE")
[ -n "$RESUME_BUNDLE" ] && GEN_ARGS+=(--resume-bundle "$RESUME_BUNDLE")
bun generate-tasks.ts "${GEN_ARGS[@]}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p bundles results
for TASK in $(ls tasks); do
  JOB="qb-${TASK}-${STAMP}"
  echo "== $TASK ($MODEL, $TRIALS trial(s)) -> jobs/$JOB"
  harbor run -p "tasks/$TASK" "${AGENT_ARGS[@]}" -m "$MODEL" --job-name "$JOB" --env "$ENV" -n 1 -k "$TRIALS" || echo "! harbor reported an error for $TASK (bundling whatever finished)"
  bun tools/bundle-from-harbor.ts "jobs/$JOB" --out bundles --handle "$HANDLE" --tasks tasks
done

bun analysis/aggregate.ts bundles --json results/a0-latest.json
if [ "$PUBLISH" = "1" ]; then
  # Results go to Camaraterie/questbench-runs (cloned next to this repo on first use); agent reports become issues.
  bun tools/publish-run.ts bundles || echo "! publishing failed; bundles are still in ./bundles (rerun: bun tools/publish-run.ts)"
  bun tools/file-reports.ts bundles || true
else
  echo "Bundles are in ./bundles (redacted). Publish later with: bun tools/publish-run.ts"
fi
