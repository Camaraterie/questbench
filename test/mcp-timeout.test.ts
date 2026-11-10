import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_TIMEOUT_MS, journalConfig, seatConfig } from '../docker/seats/launch';

const AGENTS = join(import.meta.dir, '..', 'agents');
const spec = { model: 'provider/model', provider: {} };

test('two-seat MCP servers wait longer than execute_code\'s two-minute default', () => {
    expect(MCP_TIMEOUT_MS).toBeGreaterThan(120_000);
    expect(seatConfig('agent', spec).mcp['rs-agent'].timeout).toBe(MCP_TIMEOUT_MS);
    expect(journalConfig('agent', spec).mcp.journal.timeout).toBe(MCP_TIMEOUT_MS);
});

test('single-seat and two-seat runs use the same MCP request timeout', () => {
    const source = readFileSync(join(AGENTS, 'qb_mcp.py'), 'utf8');
    expect(Number(source.match(/^MCP_TIMEOUT_MS = ([\d_]+)$/m)![1]!.replaceAll('_', ''))).toBe(MCP_TIMEOUT_MS);
    expect(readFileSync(join(AGENTS, 'qb_glm53.py'), 'utf8')).toContain('return with_mcp_timeout(config)');
});

test('single-seat adapter gives every MCP server a request timeout and keeps an explicit one', () => {
    const r = Bun.spawnSync(['python3', '-c', `
import json, qb_mcp as q
config = {"mcp": {"rs-agent": {"type": "local", "command": ["bun"]}, "scroll": {"type": "local", "command": ["bun"], "timeout": 5000}}}
print(json.dumps([q.with_mcp_timeout(config), q.with_mcp_timeout({"model": "m"}), q.with_mcp_timeout({"mcp": None})]))`], { cwd: AGENTS, stdout: 'pipe', stderr: 'pipe' });
    expect(r.stderr.toString()).toBe('');
    const [config, none, empty] = JSON.parse(r.stdout.toString());
    expect(config.mcp['rs-agent'].timeout).toBe(MCP_TIMEOUT_MS);
    expect(config.mcp.scroll.timeout).toBe(5000);
    expect(none).toEqual({ model: 'm' });
    expect(empty).toEqual({ mcp: null });
});
