import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('collector copies regular reports and rejects symlinks, directories, FIFOs and missing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'qbcollect-'));
    roots.push(root);
    // Exercise the actual inline copier without running process termination or logout collection.
    const script = readFileSync(new URL('../docker/collect-artifacts.sh', import.meta.url), 'utf8');
    const source = script.split("<<'REPORT_COPY'\n")[1]!.split('\nREPORT_COPY')[0]!;
    const report = join(root, 'reports.jsonl');
    const dest = join(root, 'collected.jsonl');
    const contents = '{"text":"gate stays closed"}\n';
    writeFileSync(report, contents);
    const copy = (src: string) => Bun.spawnSync([process.execPath, '-', src, dest], { stdin: Buffer.from(source), stdout: 'pipe', stderr: 'pipe', timeout: 2000 });
    expect(copy(report).exitCode).toBe(0);
    expect(readFileSync(dest, 'utf8')).toBe(contents);
    rmSync(dest);
    symlinkSync(report, join(root, 'symlink'));
    mkdirSync(join(root, 'directory'));
    expect(Bun.spawnSync(['mkfifo', join(root, 'fifo')]).exitCode).toBe(0);
    for (const name of ['symlink', 'directory', 'fifo', 'missing']) {
        expect(copy(join(root, name)).exitCode).toBe(0);
        expect(existsSync(dest)).toBe(false);
    }
});

test('collector reads the checked descriptor if the report path is replaced with a symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'qbcollect-'));
    roots.push(root);
    const script = readFileSync(new URL('../docker/collect-artifacts.sh', import.meta.url), 'utf8');
    const source = script.split("<<'REPORT_COPY'\n")[1]!.split('\nREPORT_COPY')[0]!;
    const copier = join(root, 'copier.ts'), preload = join(root, 'preload.ts');
    const report = join(root, 'reports.jsonl'), secret = join(root, 'secret.txt'), dest = join(root, 'collected.jsonl');
    writeFileSync(report, 'valid report');
    writeFileSync(secret, 'synthetic private content');
    writeFileSync(copier, source);
    writeFileSync(preload, `
        import { mock } from 'bun:test';
        import * as fs from 'node:fs';
        const original = fs.fstatSync;
        mock.module('node:fs', () => ({ ...fs, fstatSync(fd) {
            const stat = original(fd);
            fs.renameSync(process.argv[2], process.argv[2] + '.original');
            fs.symlinkSync(process.env.TEST_TARGET, process.argv[2]);
            return stat;
        } }));
    `);
    const result = Bun.spawnSync([process.execPath, '--preload', preload, copier, report, dest], {
        env: { ...process.env, TEST_TARGET: secret }, stdout: 'pipe', stderr: 'pipe', timeout: 2000,
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(report, 'utf8')).toBe('synthetic private content');
    expect(readFileSync(dest, 'utf8')).toBe('valid report');
});
