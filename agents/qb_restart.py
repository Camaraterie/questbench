"""
Resume, don't restart: rewrite RuneBench's OpenCode restart loop for QuestBench.

When `opencode run` exits early, RuneBench's loop starts a *new* session (no memory of what the
agent said or agreed) with a skill-benchmark nudge ("CONTINUE training ... keep grinding"). In a
cooperation trial that makes the agent re-negotiate from scratch. Instead, continue the same
session (`opencode run --continue`) with a neutral note giving the trial time actually left
(QB_DURATION_SECS from the agent loop's start), and stop once less than a minute remains.

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

# The engine-ready qb_start.txt precedes login/setup, so it is not the agent's clock.
_LEFT = 'QB_LEFT=$(( QB_DEADLINE - $(date +%s) )); '
RESUME_NOTE = '"Your session ended, but the trial is still running: about $(( QB_LEFT / 60 )) min ($QB_LEFT s) left. Continue."'


def resume_restarts(command: str, instruction: str) -> str:
    """Rewrite the restart step of RuneBench's run command; raise if it is not where expected."""
    restart = f"run --format=json {shlex.quote(RUNEBENCH_RESTART + instruction)} "
    if command.count(restart) != 1:
        raise RuntimeError("RuneBench restart loop not found; refusing to run with its restart prompt")
    command = command.replace(restart, f"run --continue --format=json {RESUME_NOTE} ")
    # RuneBench f2660dcd: TIMEOUT is total seconds since START; MIN_RESTART is seconds left.
    # Accept only the inspected clock/limit shape rather than silently inheriting changed semantics.
    bump = re.search(r"(\w+)_RUN=\$\(\(\s*\1_RUN \+ 1\)\); ", command)
    if not bump:
        raise RuntimeError("RuneBench restart loop not found; refusing to run with its restart prompt")
    vp = bump.group(1)
    limits = re.compile(
        rf'{vp}_START=\$\(date \+%s\); {vp}_TIMEOUT=\$\{{{vp}_TIMEOUT:-\d+\}}; '
        rf'{vp}_MIN_RESTART=\d+; '
    )
    if len(limits.findall(command)) != 1 or f'{vp}_REMAINING=$(( {vp}_TIMEOUT - {vp}_ELAPSED )); ' not in command:
        raise RuntimeError("RuneBench restart limits not found; refusing to run with an unknown clock")
    command = limits.sub(
        f'{vp}_START=$(date +%s); '
        f'QB_DEADLINE=$(( {vp}_START + ${{QB_DURATION_SECS:-900}} )); '
        f'{_LEFT}{vp}_TIMEOUT=$(( QB_DEADLINE - {vp}_START )); {vp}_MIN_RESTART=60; ', command,
    )
    bump = re.search(rf'{vp}_RUN=\$\(\(\s*{vp}_RUN \+ 1\)\); ', command)
    assert bump is not None
    # Before each resume, compute the trial time left and end the loop in the trial's last minute.
    log = re.search(r"\| tee -a (/logs/agent/\S+); ", command)
    stop = (f'{_LEFT}if [ $QB_LEFT -lt 60 ]; then echo "[qb-loop] trial has $QB_LEFT s left, not resuming"'
            f'{" | tee -a " + log.group(1) if log else ""}; break; fi; ')
    return command[:bump.start()] + stop + command[bump.start():]
