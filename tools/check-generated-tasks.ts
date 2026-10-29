/** Validate the generated task matrix without freezing the number of registered scenarios. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTasks } from '../src/scenarios';

const root = process.argv[2] ?? join(import.meta.dir, '..', 'tasks');
const expected = resolveTasks().map(t => t.slug).sort();
const actual = readdirSync(root).filter(name => statSync(join(root, name)).isDirectory()).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Generated task matrix differs from registry: expected ${expected.length}, found ${actual.length}`);
for (const slug of expected) {
    for (const file of ['task.toml', 'instruction.md', 'environment/Dockerfile', 'environment/scenario.json', 'tests/test.sh']) {
        if (!readFileSync(join(root, slug, file)).length) throw new Error(`${slug}/${file} is empty`);
    }
}
console.log(`Validated ${expected.length} generated tasks against the scenario registry`);
