#!/bin/bash
# Called by every task's tests/test.sh before scoring. Stops partners, makes every bot log out so
# the engine writes final saves, and copies run artifacts into /logs/verifier/qb/ (the only
# directory Harbor brings back). Root-owned; the agent cannot alter what is collected.
set +e
OUT=/logs/verifier/qb
mkdir -p "$OUT/saves" "$OUT/partners"
MARK=$(date +%s)

pkill -f "partners/run-partner.ts"
pkill -f "src/lite/runner.ts"          # partner clients disconnect -> logout -> save
pkill -f "launch-bot.ts"; pkill -f chromium   # agent client disconnects -> logout -> save

# Wait (up to 120 s) until every save has been rewritten after MARK.
for i in $(seq 1 120); do
  STALE=0
  for f in /app/server/engine/data/players/main/*.sav; do
    [ "$(stat -c %Y "$f")" -lt "$MARK" ] && STALE=1
  done
  [ "$STALE" = "0" ] && break
  sleep 1
done
[ "$STALE" = "1" ] && echo "[collect] WARNING: some saves were not rewritten after logout; scoring last autosave" | tee "$OUT/WARNINGS.txt"

for f in /app/server/engine/data/players/main/*.sav; do cp "$f" "$OUT/saves/end.$(basename "$f")"; done
for f in /logs/tracking/start_saves/*.sav; do cp "$f" "$OUT/saves/start.$(basename "$f")"; done
cp /logs/tracking/events.jsonl "$OUT/events.jsonl" 2>/dev/null || echo "[collect] no events.jsonl (engine patch missing?)" | tee -a "$OUT/WARNINGS.txt"
cp /logs/tracking/trade_ledger.jsonl "$OUT/" 2>/dev/null
cp /logs/tracking/qb_start.txt "$OUT/" 2>/dev/null
cp /logs/partners/*.jsonl /logs/partners/*.log "$OUT/partners/" 2>/dev/null
cat /logs/partners/WARNINGS.txt >> "$OUT/WARNINGS.txt" 2>/dev/null
cp /var/qb/board/*.jsonl "$OUT/" 2>/dev/null
cp /var/qb/reports/reports.jsonl "$OUT/reports.jsonl" 2>/dev/null
cp /var/qb/inbox/*.jsonl "$OUT/partners/" 2>/dev/null
cp /app/.rs-sdk-commit "$OUT/rs-sdk-commit.txt" 2>/dev/null
env | grep -E '^(QB_|NODE_TICKRATE)' | sort > "$OUT/env.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/qb_end.txt"
exit 0
