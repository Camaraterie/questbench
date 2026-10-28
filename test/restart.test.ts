import { expect, test } from 'bun:test';
import { join } from 'node:path';

// agents/qb_restart.py rewrites RuneBench's OpenCode restart loop (fresh session + "keep grinding")
// into a resume of the same session. This is the loop's shape as RuneBench's run() builds it.
const AGENTS = join(import.meta.dir, '..', 'agents');
const loop = (restartArg: string) =>
    `G_RUN=1; timeout \${G_TIMEOUT}s opencode --model m run --format=json 'task' 2>&1 </dev/null | tee -a /logs/agent/oc.txt; ` +
    `while true; do G_REMAINING=1; G_RUN=$((G_RUN + 1)); echo "[g-loop] Run" | tee -a /logs/agent/oc.txt; ` +
    `timeout \${G_REMAINING}s opencode --model m run --format=json ${restartArg} 2>&1 </dev/null | tee -a /logs/agent/oc.txt; done`;
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
