"""
QuestBench wrapper around RuneBench's GLM-5.3 OpenCode adapter.

Newer Harbor releases refuse to start a trial with MCP servers unless the agent declares
`capabilities.mcp_servers = True`. RuneBench's OpenCodeAdapter already forwards MCP servers into
opencode.json, but predates that check, so this subclass only adds the declaration.

Needs RuneBench's agents/ directory on PYTHONPATH (scripts/run-pilot.sh --runebench sets it).

    harbor run --agent-import-path 'qb_glm53:QbGlm53OpenCode' -m 'zai-coding-plan/glm-5.3' -p tasks/<task>
"""
from glm53_adapter import Glm53OpenCode

try:  # Harbor >= capabilities API
    from harbor.agents.capabilities import AgentCapabilities  # noqa: F401
    _HAS_CAPS = True
except ImportError:  # older Harbor: no validation, nothing to declare
    _HAS_CAPS = False


class QbGlm53OpenCode(Glm53OpenCode):
    if _HAS_CAPS:
        capabilities = Glm53OpenCode.capabilities.model_copy(update={"mcp_servers": True})

    @staticmethod
    def name() -> str:
        return "qb-glm53-opencode"
