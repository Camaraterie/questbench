#!/bin/bash
# Watch a running QuestBench trial.
#   ./scripts/watch.sh            # agent trajectory, pretty-printed (default)
#   ./scripts/watch.sh events     # server event log: chat, PMs, trades, quest changes
#   ./scripts/watch.sh partner    # scripted partner's decisions
#   ./scripts/watch.sh partnerlog # partner process output (login errors show up here)
#   ./scripts/watch.sh screen     # save a screenshot of the agent's game client to ./now.png
set -euo pipefail
cd "$(dirname "$0")/.."
C=$(docker ps --format '{{.Names}}' | grep -iE 'rendezvous|shield|hidden-role' | head -1 || true)
[ -z "$C" ] && { echo "No running QuestBench container found (docker ps)."; exit 1; }
echo "· container $C"
case "${1:-agent}" in
  agent)      docker exec "$C" sh -c 'tail -n +1 -f /logs/agent/opencode*.txt' | bun tools/watch-trajectory.ts ;;
  events)     docker exec "$C" tail -n +1 -f /logs/tracking/events.jsonl ;;
  partner)    docker exec "$C" tail -n +1 -f /logs/partners/partner01.jsonl ;;
  partnerlog) docker exec "$C" sh -c 'tail -n 200 -f /logs/partners/partner01.log /logs/partners/partner01.lite.log' ;;
  screen)     docker exec "$C" ffmpeg -loglevel error -f x11grab -video_size 800x600 -i :99 -frames:v 1 -y /tmp/now.png \
                && docker cp "$C:/tmp/now.png" ./now.png && echo "saved ./now.png" ;;
  *) echo "usage: watch.sh [agent|events|partner|partnerlog|screen]"; exit 2 ;;
esac
