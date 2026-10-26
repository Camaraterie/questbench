#!/bin/bash
# QuestBench entrypoint: start RuneBench's services, then the scenario's scripted partners and
# (aided condition only) the coordination-aid services. Everything here runs as root; the agent
# runs as the unprivileged `agent` user and cannot signal, edit or read partner credentials.
set -e
/entrypoint.sh "$@" &
BASE_PID=$!

# Wait for engine (8888) and gateway (7780).
for i in $(seq 1 240); do
  curl -sf http://localhost:8888 >/dev/null 2>&1 && curl -sf http://localhost:7780 >/dev/null 2>&1 && break
  sleep 1
done

mkdir -p /logs/partners /logs/tracking && chmod 700 /logs/partners
date -u +%Y-%m-%dT%H:%M:%SZ > /logs/tracking/qb_start.txt
# Snapshot start saves before anyone logs in (the verifier also has its own copies in /tests/start).
mkdir -p /logs/tracking/start_saves && chmod 700 /logs/tracking/start_saves && cp /app/server/engine/data/players/main/*.sav /logs/tracking/start_saves/ 2>/dev/null || true

DURATION_MIN=$(( ${QB_DURATION_SECS:-900} / 60 ))
if [ -f /qb/partners.json ]; then
  bun -e '
    const ps = JSON.parse(require("fs").readFileSync("/qb/partners.json", "utf8"));
    for (const p of ps) console.log([p.username, p.policy, p.partner, JSON.stringify(p.params)].join("\t"));
  ' | while IFS=$'\t' read -r USERNAME POLICY PARTNER PARAMS; do
    mkdir -p "/app/bots/$USERNAME"
    printf 'BOT_USERNAME=%s\nPASSWORD=test\nSERVER=\nSHOW_CHAT=true\n' "$USERNAME" > "/app/bots/$USERNAME/bot.env"
    chmod 700 "/app/bots/$USERNAME" && chmod 600 "/app/bots/$USERNAME/bot.env"
    (cd /app/server/webclient && nohup bun src/lite/runner.ts "$USERNAME" > "/logs/partners/$USERNAME.lite.log" 2>&1 &)
    sleep 5
    (cd /qb && QB_AIDS="${QB_AIDS:-0}" nohup bun partners/run-partner.ts "$USERNAME" "$POLICY" "$PARTNER" "$DURATION_MIN" "$PARAMS" \
        > "/logs/partners/$USERNAME.log" 2>&1 &)
    echo "[qb] partner $USERNAME ($POLICY) started"
  done
fi

if [ "${QB_AIDS:-0}" = "1" ]; then
  (cd /qb && nohup bun aids/inbox-service.ts "${QB_AGENT:-agent}" > /logs/partners/inbox-service.log 2>&1 &)
  echo "[qb] coordination aids enabled"
fi

wait $BASE_PID
