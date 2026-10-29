import { expect, test } from 'bun:test';
import { join } from 'node:path';

// agents/qb_restart.py rewrites RuneBench's OpenCode restart loop (fresh session + "keep grinding")
// into a resume of the same session. Loop contract inspected at RuneBench
// f2660dcd6d2906ef719bec0592dc66187fd19443, agents/opencode_adapter.py:317-350.
const AGENTS = join(import.meta.dir, '..', 'agents');
const loop = (restartArg: string, vp = 'G') =>
    `${vp}_START=$(date +%s); ${vp}_TIMEOUT=\${${vp}_TIMEOUT:-1620}; ${vp}_MIN_RESTART=180; ` +
    `${vp}_RUN=1; timeout \${${vp}_TIMEOUT}s opencode --model m run --format=json 'task' 2>&1 </dev/null | tee -a /logs/agent/oc.txt; ` +
    `while true; do ${vp}_ELAPSED=$(( $(date +%s) - ${vp}_START )); ${vp}_REMAINING=$(( ${vp}_TIMEOUT - ${vp}_ELAPSED )); ` +
    `if [ $${vp}_REMAINING -lt $${vp}_MIN_RESTART ]; then break; fi; ${vp}_RUN=$((${vp}_RUN + 1)); ` +
    `echo "[g-loop] Run" | tee -a /logs/agent/oc.txt; ` +
    `timeout \${${vp}_REMAINING}s opencode --model m run --format=json ${restartArg} 2>&1 </dev/null | tee -a /logs/agent/oc.txt; done`;
const py = (code: string) => Bun.spawnSync(['python3', '-c', code], { cwd: AGENTS, stdout: 'pipe', stderr: 'pipe' });

test('restart becomes a --continue resume with the trial time left', () => {
    const r = py(`
import shlex, qb_restart as q
cmd = ${JSON.stringify(loop("__RESTART__"))}.replace("__RESTART__", shlex.quote(q.RUNEBENCH_RESTART + "Get the bars."))
print(q.resume_restarts(cmd, "Get the bars."))`);
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).not.toContain('grinding');
    expect(out).toContain('run --continue --format=json "Your session ended, but the trial is still running');
    expect(out).toContain('QB_DURATION_SECS');
    // The time check sits before the run counter, so a skipped resume is not counted as a run.
    expect(out.indexOf('QB_LEFT -lt 60')).toBeLessThan(out.indexOf('G_RUN=$((G_RUN + 1))'));
    expect(out.indexOf('run --format=json \'task\'')).toBeGreaterThan(-1); // first run untouched
});

test('refuses to run if RuneBench changed its loop', () => {
    const r = py(`import qb_restart as q; q.resume_restarts(${JSON.stringify(loop("'something else'"))}, "Get the bars.")`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain('restart loop not found');
});

// Execute the rewritten loop with a synthetic clock and process boundary. The first run
// consumes 200s and the resume consumes 70s, leaving 30s (below the restart guard).
test('agent clock gives the full duration and resumes below RuneBench’s old 180s guard', () => {
    const r = py(`
import os, subprocess, tempfile, shlex, qb_restart as q
cmd = ${JSON.stringify(loop('__RESTART__', 'GLM53'))}.replace('__RESTART__', shlex.quote(q.RUNEBENCH_RESTART + 'task'))
cmd = q.resume_restarts(cmd, 'task')
with tempfile.NamedTemporaryFile(mode='w') as clock:
    clock.write('5000'); clock.flush()
    env = dict(os.environ, CLOCK_FILE=clock.name, QB_DURATION_SECS='300', GLM53_TIMEOUT='20')
    shell = r"""
date() { cat "$CLOCK_FILE"; }
tee() { cat; }
timeout() {
  echo "budget=$1";
  now=$(cat "$CLOCK_FILE");
  if [ "$now" -eq 5000 ]; then step=200; else step=70; fi;
  echo $(( now + step )) > "$CLOCK_FILE";
}
"""
    result = subprocess.run(['bash', '-c', shell + cmd + '; echo "remaining=$GLM53_REMAINING"'], env=env, capture_output=True, text=True, timeout=5)
    print(result.stdout)
    raise SystemExit(result.returncode)
`);
    expect(r.stderr.toString()).toBe('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().match(/budget=\d+s/g)).toEqual(['budget=300s', 'budget=100s']);
    expect(r.stdout.toString()).toContain('remaining=30');
});

test('refuses an unknown RuneBench timing contract', () => {
    const r = py(`
import shlex, qb_restart as q
cmd = ${JSON.stringify(loop('__RESTART__'))}.replace('__RESTART__', shlex.quote(q.RUNEBENCH_RESTART + 'task')).replace('G_MIN_RESTART=180;', 'G_GUARD=180;')
q.resume_restarts(cmd, 'task')`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain('restart limits not found');
});
