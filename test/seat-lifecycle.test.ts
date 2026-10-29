import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(process.platform === 'win32').each(['normal', 'explicit-finish', 'recover', 'recover-no-countdown'])('seat lifecycle: %s', mode => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-seat-'));
    try {
        mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'logs/tracking'), { recursive: true }); mkdirSync(join(dir, 'logs/seats/agent'), { recursive: true });
        writeFileSync(join(dir, 'brief.md'), 'Make your own plans.');
        writeFileSync(join(dir, 'logs/tracking/qb_start.txt'), new Date().toISOString());
        writeFileSync(join(dir, 'bin/opencode'), `#!/bin/sh\necho run >> count\nprintf '%s\\n' "$@" >> args\n${mode.startsWith('recover') ? '[ "$(wc -l < count)" = 1 ] && exit 2\n' : ''}${mode === 'explicit-finish' ? 'touch finished\n' : ''}exit 0\n`, { mode: 0o755 });
        const path = `${join(dir, 'bin')}:${process.env.PATH}`;
        expect(Bun.which('opencode', { PATH: path })).toBe(join(dir, 'bin/opencode'));
        const result = Bun.spawnSync(['bash', resolve('docker/seats/run-seat.sh')], { cwd: dir, env: { ...process.env, PATH: path, QB_LOG_ROOT: join(dir, 'logs'), QB_SEAT: 'agent', QB_MODEL: 'fake', QB_DURATION_SECS: '900', QB_DISCLOSE_DEADLINE: mode === 'recover-no-countdown' ? '0' : '1', QB_SESSION_POLICY: mode === 'explicit-finish' ? 'continue' : 'finish' }, stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(0);
        expect(readFileSync(join(dir, 'count'), 'utf8').trim().split('\n')).toHaveLength(mode.startsWith('recover') ? 2 : 1);
        const args = readFileSync(join(dir, 'args'), 'utf8');
        if (mode === 'recover') expect(args).toContain('minutes available');
        if (mode === 'recover-no-countdown') { expect(args).not.toContain('minutes'); expect(args).toContain('--continue'); }
        if (mode === 'normal') expect(result.stdout.toString()).toContain('finished voluntarily');
        if (mode === 'explicit-finish') expect(result.stdout.toString()).toContain('marked itself finished');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
