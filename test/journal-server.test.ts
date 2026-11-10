import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test('journal server accepts a bounded revision-checked update and rejects stale/oversized writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-journal-'));
    try {
        writeFileSync(join(dir, 'JOURNAL.md'), 'My mistaken belief.');
        const script = `import {readJournal,writeJournal} from ${JSON.stringify(resolve('docker/seats/journal-server.ts'))};
const original=readJournal(); writeJournal('My revised recollection.',original.sha256);
let stale=false,oversized=false;try{writeJournal('stale',original.sha256)}catch{stale=true}
try{writeJournal('x'.repeat(8001),readJournal().sha256)}catch{oversized=true}
console.log(JSON.stringify({stale,oversized}));`;
        const p = Bun.spawnSync([process.execPath, '-e', script], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        expect(p.exitCode).toBe(0);
        expect(JSON.parse(p.stdout.toString())).toEqual({ stale: true, oversized: true });
        expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe('My revised recollection.');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
