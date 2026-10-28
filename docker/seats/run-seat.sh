#!/bin/bash
# One LLM seat: run OpenCode on this seat's brief until the trial ends. Runs as the seat's own
# user, in its private workspace (cwd), started by docker/seats/launch.ts.
#
# If OpenCode exits early, the same session is resumed (`run --continue`) with the trial time
# left; there is no fresh restart and no nudging text. Stops in the trial's last minute, or after
# three consecutive exits under 10 s (a broken setup, not a decision).
set -u
LOG="/logs/seats/${QB_SEAT}/opencode.txt"
note() { echo "[seat-loop] $*" | tee -a "$LOG"; }
left() { echo $(( QB_DURATION_SECS - ( $(date +%s) - $(date -d "$(cat /logs/tracking/qb_start.txt)" +%s) ) )); }

FAST=0; RUN=1
note "seat ${QB_SEAT} (${QB_MODEL}) run 1, $(left) s left"
START=$(date +%s)
timeout "$(left)s" opencode run --format=json "$(cat brief.md)" 2>&1 </dev/null | tee -a "$LOG"
while true; do
  DUR=$(( $(date +%s) - START ))
  note "opencode exited after ${DUR}s"
  if [ "$DUR" -lt 10 ]; then FAST=$((FAST + 1)); else FAST=0; fi
  if [ "$FAST" -ge 3 ]; then note "3 consecutive fast exits, stopping"; break; fi
  LEFT=$(left)
  if [ "$LEFT" -lt 60 ]; then note "trial has ${LEFT} s left, not resuming"; break; fi
  RUN=$((RUN + 1))
  note "resuming (run ${RUN}), ${LEFT} s left"
  START=$(date +%s)
  timeout "${LEFT}s" opencode run --continue --format=json \
    "Your session ended, but the trial is still running: about $(( LEFT / 60 )) min (${LEFT} s) left. Continue." \
    2>&1 </dev/null | tee -a "$LOG"
done
note "finished after ${RUN} run(s)"
