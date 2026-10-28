#!/bin/bash
# One LLM seat: run OpenCode on this seat's brief until the trial ends. Runs as the seat's own
# user, in its private workspace (cwd), started by docker/seats/launch.ts.
#
# Normal final answers stop by default. The explicit continue treatment resumes the same session
# with its remaining time and an option to finish; abnormal exits are retried without fresh memory.
# Stops in the last minute, on an explicit finished marker, or after three fast failures.
set -u
LOG_ROOT="${QB_LOG_ROOT:-/logs}"
LOG="$LOG_ROOT/seats/${QB_SEAT}/opencode.txt"
note() { echo "[seat-loop] $*" | tee -a "$LOG"; }
left() { echo $(( QB_DURATION_SECS - ( $(date +%s) - $(date -d "$(cat "$LOG_ROOT/tracking/qb_start.txt")" +%s) ) )); }

FAST=0; RUN=1
note "seat ${QB_SEAT} (${QB_MODEL}) run 1, $(left) s left"
START=$(date +%s)
timeout "$(left)s" opencode run --format=json "$(cat brief.md)" 2>&1 </dev/null | tee -a "$LOG"
CODE=${PIPESTATUS[0]}
while true; do
  DUR=$(( $(date +%s) - START ))
  note "opencode exited after ${DUR}s"
  # A normal final answer is the agent choosing to stop. Only recover abnormal exits by default.
  if [ "$CODE" = "0" ] && [ "${QB_SESSION_POLICY:-finish}" = "finish" ]; then note "agent finished voluntarily; not resuming"; break; fi
  if [ -f finished ]; then note "agent marked itself finished; not resuming"; break; fi
  if [ "$DUR" -lt 10 ]; then FAST=$((FAST + 1)); else FAST=0; fi
  if [ "$FAST" -ge 3 ]; then note "3 consecutive fast exits, stopping"; break; fi
  LEFT=$(left)
  if [ "$LEFT" -lt 60 ]; then note "trial has ${LEFT} s left, not resuming"; break; fi
  RUN=$((RUN + 1))
  note "resuming (run ${RUN}), ${LEFT} s left"
  START=$(date +%s)
  timeout "${LEFT}s" opencode run --continue --format=json \
    "You have about $(( LEFT / 60 )) minutes available. Decide what you want to do next. If you are finished, create a file named finished in your workspace and end your session." \
    2>&1 </dev/null | tee -a "$LOG"
  CODE=${PIPESTATUS[0]}
done
note "finished after ${RUN} run(s)"
