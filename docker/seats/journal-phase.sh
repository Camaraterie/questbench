#!/bin/bash
set -u
LOG="/logs/seats/${QB_SEAT}/opencode.txt"
timeout -k 5s 120s opencode run --session "$QB_JOURNAL_SESSION" --agent journal --format=json \
  'Activity is paused. Update JOURNAL.md now with your own recollections, uncertain beliefs, commitments, possessions and plans from this activity. Keep at most 8000 characters. Preserve useful older memories; distinguish intentions from completed actions. Do not act in the game. This journal update is the only memory checkpoint for a later return.' \
  </dev/null 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
