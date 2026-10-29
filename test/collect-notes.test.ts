import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectNotes } from '../docker/collect-notes';

test.skipIf(process.platform === 'win32')('collect notes without configs, private symlinks, subdirectories or oversized files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-notes-'));
    try {
        const workspace = join(dir, 'workspace'), output = join(dir, 'out');
        mkdirSync(workspace);
        writeFileSync(join(workspace, 'SESSION_NOTES.md'), 'I believe the other player misled me.');
        writeFileSync(join(workspace, 'opencode.json'), 'not an artifact');
        writeFileSync(join(workspace, 'brief.md'), 'private instructions');
        writeFileSync(join(dir, 'secret'), 'must not copy');
        symlinkSync(join(dir, 'secret'), join(workspace, 'leak.md'));
        mkdirSync(join(workspace, 'nested.md'));
        writeFileSync(join(workspace, 'large.txt'), 'a'.repeat(65537));
        expect(collectNotes(workspace, output)).toEqual(['SESSION_NOTES.md']);
        expect(readdirSync(output)).toEqual(['SESSION_NOTES.md']);
        expect(readFileSync(join(output, 'SESSION_NOTES.md'), 'utf8')).toContain('misled');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
