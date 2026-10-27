#!/bin/bash
# QuestBench v0.1 pilot: A0 Rendezvous, end to end on your machine.
#
#   ./scripts/run-pilot.sh -a claude-code -m anthropic/claude-sonnet-4-5 [-k 3] [-t punctual-bare] [--env docker]
#   ./scripts/run-pilot.sh --glm --runebench ../RuneBench [-k 3] [--all]     # GLM-5.3 on a z.ai key (ZHIPU_API_KEY)
#
# --glm reuses RuneBench's OpenCode adapter for GLM-5.3 (agents/glm53_adapter.py, z.ai GLM Coding
# Plan endpoint), so clone https://github.com/MaxBittker/RuneBench next to this repo first.
#
# Steps: build the image -> generate tasks -> harbor run -> bundle + redact -> ingest checks -> results table.
# Requires: docker, bun, harbor (https://harborframework.com), and the API key your agent needs.
set -euo pipefail
cd "$(dirname "$0")/.."

AGENT="claude-code"; MODEL=""; IMPORT_PATH=""; RB_AGENTS=""; TRIALS=1; FILTER="a0-rendezvous-punctual-bare-15m"; ENV="docker"; HANDLE="${QB_HANDLE:-anonymous}"; SKIP_BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    -a) AGENT="$2"; shift 2 ;;
    -m) MODEL="$2"; shift 2 ;;
    --agent-import-path) IMPORT_PATH="$2"; shift 2 ;;
    --runebench) RB_AGENTS="$(cd "$2" && pwd)/agents"; shift 2 ;;
    --glm) IMPORT_PATH="glm53_adapter:Glm53OpenCode"; MODEL="zai-coding-plan/glm-5.3"; shift ;;
    -k) TRIALS="$2"; shift 2 ;;
    -t) FILTER="a0-rendezvous-$2"; shift 2 ;;
    --all) FILTER="a0-rendezvous"; shift ;;
    --env) ENV="$2"; shift 2 ;;
    --handle) HANDLE="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done
[ -z "$MODEL" ] && { echo "-m <model> is required (e.g. anthropic/claude-sonnet-4-5), or use --glm"; exit 2; }
AGENT_ARGS=(-a "$AGENT")
if [ -n "$IMPORT_PATH" ]; then
  [ -z "$RB_AGENTS" ] && { echo "--agent-import-path/--glm need --runebench <path-to-RuneBench-clone>"; exit 2; }
  export PYTHONPATH="$RB_AGENTS${PYTHONPATH:+:$PYTHONPATH}"
  AGENT_ARGS=(--agent-import-path "$IMPORT_PATH")
  [[ "$IMPORT_PATH" == glm* ]] && [ -z "${ZHIPU_API_KEY:-}" ] && { echo "Set ZHIPU_API_KEY (your z.ai key) in your shell first."; exit 2; }
fi
if [ "$ENV" != "docker" ] && [ "${QB_IMAGE:-questbench:local}" = "questbench:local" ]; then
  echo "Remote envs (--env $ENV) cannot pull a local image. Push the image and set QB_IMAGE=<registry>/<tag>."; exit 2
fi

if [ "$SKIP_BUILD" = "0" ]; then ./docker/build.sh "${QB_IMAGE:-questbench:local}"; fi
bun generate-tasks.ts --only "$FILTER"

STAMP=$(date +%Y%m%d-%H%M%S)
for TASK in $(ls tasks); do
  JOB="qb-${TASK}-${STAMP}"
  echo "== $TASK ($MODEL, $TRIALS trial(s)) -> jobs/$JOB"
  harbor run -p "tasks/$TASK" "${AGENT_ARGS[@]}" -m "$MODEL" --job-name "$JOB" --env "$ENV" -n 1 -k "$TRIALS"
  bun tools/bundle-from-harbor.ts "jobs/$JOB" --out bundles --handle "$HANDLE" --tasks tasks
done

bun analysis/aggregate.ts bundles --json results/a0-latest.json
echo "Bundles are in ./bundles (redacted). Review them before sharing."
