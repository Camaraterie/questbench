"""
Resume, don't restart: rewrite RuneBench's OpenCode restart loop for QuestBench.

When `opencode run` exits early, RuneBench's loop starts a *new* session (no memory of what the
agent said or agreed) with a skill-benchmark nudge ("CONTINUE training ... keep grinding"). In a
cooperation trial that makes the agent re-negotiate from scratch. Instead, continue the same
session (`opencode run --continue`) with a neutral note giving the trial time actually left
(QB_DURATION_SECS from /logs/tracking/qb_start.txt), and stop once less than a minute remains.

No Harbor imports, so it can be tested on its own (test/restart.test.ts).
"""
import re
import shlex

# RuneBench's restart text (agents/opencode_adapter.py), followed by the task instruction.
RUNEBENCH_RESTART = (
    "You were previously working on this task but stopped early. "
    "There is still time remaining. Check the current game state with "
    "sdk.getState() and CONTINUE training. Do NOT write a summary — "
    "keep grinding. "
)

# Seconds of trial time left, from the entrypoint's start stamp and the task duration.
_LEFT = (
    'QB_LEFT=$(( ${QB_DURATION_SECS:-900} - ( $(date +%s) - '
    '$(date -d "$(cat /logs/tracking/qb_start.txt 2>/dev/null || date -u +%FT%TZ)" +%s) ) )); '
)
RESUME_NOTE = '"Your session ended, but the trial is still running: about $(( QB_LEFT / 60 )) min ($QB_LEFT s) left. Continue."'


def resume_restarts(command: str, instruction: str) -> str:
    """Rewrite the restart step of RuneBench's run command; raise if it is not where expected."""
    restart = f"run --format=json {shlex.quote(RUNEBENCH_RESTART + instruction)} "
    if command.count(restart) != 1:
        raise RuntimeError("RuneBench restart loop not found; refusing to run with its restart prompt")
    command = command.replace(restart, f"run --continue --format=json {RESUME_NOTE} ")
    # Before each resume, compute the trial time left and end the loop in the trial's last minute.
    bump = re.search(r"(\w+)_RUN=\$\(\(\1_RUN \+ 1\)\); ", command)
    if not bump:
        raise RuntimeError("RuneBench restart loop not found; refusing to run with its restart prompt")
    log = re.search(r"\| tee -a (/logs/agent/\S+); ", command)
    stop = (f'{_LEFT}if [ $QB_LEFT -lt 60 ]; then echo "[qb-loop] trial has $QB_LEFT s left, not resuming"'
            f'{" | tee -a " + log.group(1) if log else ""}; break; fi; ')
    return command[:bump.start()] + stop + command[bump.start():]
