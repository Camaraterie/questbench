"""
MCP request timeout for single-seat runs.

RuneBench's OpenCode adapter writes each MCP server into opencode.json without a `timeout`, so
OpenCode stops waiting for a tool call after about a minute ("MCP error -32001: Request timed
out"). rs-sdk's execute_code allows two minutes by default and keeps running on the bot after the
client gives up, so the agent loses the result of work that is still in progress.

Wait slightly longer than execute_code's default limit, so the server's own, more informative
"Code execution timed out after 2 minute(s)" reaches the agent first. Two-seat runs set the same
value in docker/seats/launch.ts (MCP_TIMEOUT_MS).
"""

MCP_TIMEOUT_MS = 130_000


def with_mcp_timeout(config: dict, timeout_ms: int = MCP_TIMEOUT_MS) -> dict:
    """Give every MCP server in an OpenCode config a request timeout, unless it already has one."""
    for server in (config.get("mcp") or {}).values():
        if isinstance(server, dict):
            server.setdefault("timeout", timeout_ms)
    return config
