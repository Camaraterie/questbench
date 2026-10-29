/** Collect bounded, regular top-level text notes; never follow an agent-controlled symlink/FIFO. */
import { closeSync, constants, fstatSync, mkdirSync, openSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function collectNotes(workspace: string, output: string): string[] {
    const copied: string[] = [];
    let budget = 256 * 1024;
    for (const name of readdirSync(workspace).sort()) {
        if (!/^[a-z0-9][a-z0-9_. -]{0,99}\.(md|txt)$/i.test(name) || /^(agents|claude|brief)\.md$/i.test(name)) continue;
        let fd: number | undefined;
        try {
            fd = openSync(join(workspace, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.size > 64 * 1024 || stat.size > budget) continue;
            // Fixed-size read also bounds a file that grows after fstat.
            const data = Buffer.alloc(stat.size);
            const size = readSync(fd, data, 0, data.length, 0);
            mkdirSync(output, { recursive: true });
            writeFileSync(join(output, name), data.subarray(0, size));
            budget -= size;
            copied.push(name);
        } catch { /* Missing, inaccessible, or unsafe entries are not artifacts. */ }
        finally { if (fd !== undefined) closeSync(fd); }
    }
    return copied;
}

if (import.meta.main) collectNotes(process.argv[2]!, process.argv[3]!);
