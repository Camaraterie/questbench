"""
QuestBench wrapper around RuneBench's GLM-5.3 OpenCode adapter.

Newer Harbor releases refuse to start a trial with MCP servers unless the agent declares
`capabilities.mcp_servers = True`. RuneBench's OpenCodeAdapter already forwards MCP servers into
opencode.json, but predates that check, so this subclass adds the declaration.

It also replaces OpenCode's built-in system prompt ("You are opencode, an interactive CLI tool that
helps users with software engineering tasks...") with AGENT_PROMPT, which tells the model it is the
agent in the game. OpenCode uses an agent's `prompt` from opencode.json in place of its provider
prompt; /app/AGENTS.md (the SDK guide) and the task instruction are still sent as before.

When OpenCode exits early, the session is resumed rather than restarted (see qb_restart.py).

Needs RuneBench's agents/ directory on PYTHONPATH (scripts/run-pilot.sh --runebench sets it).

    harbor run --agent-import-path 'qb_glm53:QbGlm53OpenCode' -m 'zai-coding-plan/glm-5.3' -p tasks/<task>
"""
import opencode_adapter as _oc
from glm53_adapter import Glm53OpenCode
from qb_restart import resume_restarts

try:  # Harbor >= capabilities API
    from harbor.agents.capabilities import AgentCapabilities  # noqa: F401
    _HAS_CAPS = True
except ImportError:  # older Harbor: no validation, nothing to declare
    _HAS_CAPS = False


AGENT_PROMPT = """You are the agent: the player character named "agent" in a RuneScape-style game world running on a local benchmark server.
You see and act in the world only through your tools: execute_code on the rs-agent MCP server runs TypeScript that controls your character.
Other characters in the world are other players. Your task follows."""


class QbGlm53OpenCode(Glm53OpenCode):
    if _HAS_CAPS:
        capabilities = Glm53OpenCode.capabilities.model_copy(update={"mcp_servers": True})

    @staticmethod
    def name() -> str:
        return "qb-glm53-opencode"

    def _build_opencode_config(self) -> dict:
        config = super()._build_opencode_config()
        # `build` is the agent `opencode run` uses; its prompt replaces OpenCode's own system prompt.
        config.setdefault("agent", {}).setdefault("build", {})["prompt"] = AGENT_PROMPT
        return config

    def populate_context_post_run(self, context) -> None:
        # trajectory.json reconstructs the system message from OpenCode's built-in prompt files;
        # record the prompt this agent actually ran with instead.
        original = _oc._opencode_system_prompt_for_model
        _oc._opencode_system_prompt_for_model = lambda _model: AGENT_PROMPT
        try:
            super().populate_context_post_run(context)
        finally:
            _oc._opencode_system_prompt_for_model = original

    async def exec_as_agent(self, environment, command, **kwargs):
        # RuneBench's run() builds the restart loop inline; rewrite it before it reaches the container.
        if "-loop] Run" in command:
            command = resume_restarts(command, self._last_instruction)
        return await super().exec_as_agent(environment, command=command, **kwargs)
