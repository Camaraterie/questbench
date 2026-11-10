#!/bin/bash
# Called by every task's tests/test.sh before scoring. Stops partners, makes every bot log out so
# the engine writes final saves, and copies run artifacts into /logs/verifier/qb/ (the only
# directory Harbor brings back). Root-owned; the agent cannot alter what is collected.
set +e
OUT=/logs/verifier/qb
mkdir -p "$OUT/saves" "$OUT/partners"
MARK=$(date +%s)

pkill -f "partners/run-partner.ts"
# Pair tier: stop both LLM seats (their OpenCode, MCP server and any scripts) before logouts.
bun -e 'const {stopSeatProcesses}=await import("/qb/seats/launch.ts"); for(const user of ["agent","seat1","seat2","seat3","seat4"]) await stopSeatProcesses(user);' || { echo '[collect] gameplay cleanup failed' | tee -a "$OUT/WARNINGS.txt"; exit 1; }
bun /qb/checkpoint.ts || echo '[collect] WARNING: final engine checkpoint failed; return is unsafe' | tee -a "$OUT/WARNINGS.txt"
pkill -f "src/lite/runner.ts"          # partner clients disconnect -> logout -> save
pkill -f "launch-bot.ts"; pkill -f chromium   # agent client disconnects -> logout -> save

# Wait (up to 120 s) until every save has been rewritten after MARK.
if [ ! -f /logs/tracking/final-checkpoint/checkpoint.json ]; then
for i in $(seq 1 120); do
  STALE=0
  for f in /app/server/engine/data/players/main/*.sav; do
    [ "$(stat -c %Y "$f")" -lt "$MARK" ] && STALE=1
  done
  [ "$STALE" = "0" ] && break
  sleep 1
done
[ "$STALE" = "1" ] && echo "[collect] WARNING: some saves were not rewritten after logout; scoring last autosave" | tee "$OUT/WARNINGS.txt"
echo '{"valid":false,"source":"legacy-save-fallback"}' > "$OUT/checkpoint.json"
fi

# Stop the screen recorder cleanly so recording.mp4 is complete when Harbor copies /logs/verifier
# (it used to be copied mid-write and end in a partial fragment).
pkill -INT -f "ffmpeg -f x11grab"
for i in $(seq 1 15); do pgrep -f "ffmpeg -f x11grab" >/dev/null || break; sleep 1; done

for f in /app/server/engine/data/players/main/*.sav; do cp "$f" "$OUT/saves/end.$(basename "$f")"; done
for f in /logs/tracking/start_saves/*.sav; do cp "$f" "$OUT/saves/start.$(basename "$f")"; done
if [ -f /logs/tracking/final-checkpoint/checkpoint.json ]; then
  cp /logs/tracking/final-checkpoint/end.*.sav "$OUT/saves/"
  cp /logs/tracking/final-checkpoint/checkpoint.json "$OUT/"
fi
cp /logs/tracking/events.jsonl "$OUT/events.jsonl" 2>/dev/null || echo "[collect] no events.jsonl (engine patch missing?)" | tee -a "$OUT/WARNINGS.txt"
cp /logs/tracking/trade_ledger.jsonl "$OUT/" 2>/dev/null
cp /logs/tracking/qb_start.txt "$OUT/" 2>/dev/null
cp /logs/partners/*.jsonl /logs/partners/*.log "$OUT/partners/" 2>/dev/null
cat /logs/partners/WARNINGS.txt >> "$OUT/WARNINGS.txt" 2>/dev/null
cp /var/qb/board/*.jsonl "$OUT/" 2>/dev/null
# Open without following a symlink, then check and read that same descriptor.
# O_NONBLOCK also lets us reject a FIFO without waiting for a writer.
bun - /var/qb/reports/reports.jsonl "$OUT/reports.jsonl" <<'REPORT_COPY'
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
let fd;
try {
    fd = openSync(process.argv[2], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (fstatSync(fd).isFile()) writeFileSync(process.argv[3], readFileSync(fd));
} catch {
    // Reports are optional; missing files and unsafe file types are not collected.
} finally {
    if (fd !== undefined) closeSync(fd);
}
REPORT_COPY
cp /var/qb/inbox/*.jsonl "$OUT/partners/" 2>/dev/null
cp /app/.rs-sdk-commit "$OUT/rs-sdk-commit.txt" 2>/dev/null
cp /logs/tracking/interventions.jsonl "$OUT/interventions.jsonl" 2>/dev/null
cp /qb/scenario.json "$OUT/scenario.json" 2>/dev/null
cp /qb/continuity.json "$OUT/continuity.json" 2>/dev/null
# Reasoning text never reaches the harness's JSON log; export it from OpenCode's session database.
bun /qb/dump-reasoning.ts > "$OUT/agent-reasoning.jsonl"
# Pair tier: each seat's OpenCode log and reasoning, plus the launcher's log.
if [ -f /logs/seats/seats.json ]; then
  mkdir -p "$OUT/seats"
  cp /logs/seats/seats.json /logs/seats/launch.log "$OUT/seats/" 2>/dev/null
  cp /logs/seats/*.lite.log "$OUT/partners/" 2>/dev/null
  bun -e 'for (const s of JSON.parse(require("fs").readFileSync("/logs/seats/seats.json","utf8"))) console.log(s.username + " " + s.user)' |
  while read -r BOT SEAT_USER; do
    mkdir -p "$OUT/seats/$BOT"
    bun /qb/collect-notes.ts "/logs/seats/$BOT" "$OUT/seats/$BOT" --seat-logs
    bun /qb/dump-reasoning.ts "/home/$SEAT_USER/.local/share/opencode/opencode.db" > "$OUT/seats/$BOT/reasoning.jsonl"
    bun /qb/collect-notes.ts "/seats/$BOT" "$OUT/seats/$BOT/notes"
  done
fi
env | grep -E '^(QB_|NODE_TICKRATE)' | sort > "$OUT/env.txt"
bun /qb/check-run.ts "$OUT/events.jsonl" "$OUT/partners" "${QB_AGENT:-agent}" "$OUT/seats" | tee -a "$OUT/WARNINGS.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/qb_end.txt"
exit 0
