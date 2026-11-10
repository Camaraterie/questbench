"""
QuestBench pair-tier adapter: two LLM seats in one trial.

Harbor runs one agent per trial, so this "agent" plays no seat itself. It hands the model config
to the container (root-only /run/qb/models.json) and waits; the container's launcher
(docker/seats/launch.ts) starts both seats together as separate Unix users once both bots are
in-game, and writes /logs/seats/done when they finish. Harbor then runs the verifier as usual.

    harbor run --agent-import-path 'qb_seats:QbSeats' -m 'zai-coding-plan/glm-5.3' -p tasks/a0-duo-open-15m
    # different models per seat:  --agent-kwarg seat_models=agent=<model>,partner01=<model>

The -m model plays every seat that seat_models does not name. Needs only Harbor, not RuneBench.
"""
import asyncio
import json
import os
import shlex
import time

from harbor.agents.base import BaseAgent

try:  # Harbor >= capabilities API: tasks declare MCP servers, which the seats use themselves
    from harbor.agents.capabilities import AgentCapabilities

    _HAS_CAPS = True
except ImportError:
    _HAS_CAPS = False

# provider prefix -> (API key env var, OpenCode provider options/models for that model)
# GLM-5.3 cost/limits mirror RuneBench's glm53_adapter (z.ai rate card stand-in).
_PROVIDERS = {
    "zai-coding-plan": ("ZHIPU_API_KEY", {"glm-5.3": {"cost": {"input": 1.4, "output": 4.4, "cache_read": 0.26}, "limit": {"context": 1000000, "output": 131072}}}),
}


def model_spec(model: str) -> tuple[dict, dict]:
    """OpenCode provider block and the env (API key) for one model id like 'provider/model'."""
    provider, _, suffix = model.partition("/")
    if provider not in _PROVIDERS or not suffix:
        raise ValueError(f"unsupported model for seats: {model!r} (known providers: {', '.join(_PROVIDERS)})")
    key_env, known = _PROVIDERS[provider]
    block = {provider: {"options": {"timeout": 180000}, "models": {suffix: known.get(suffix, {})}}}
    key = os.environ.get(key_env, "")
    if not key:
        raise ValueError(f"{key_env} is not set; it is needed for {model}")
    return {"model": model, "provider": block}, {key_env: key}


def parse_seat_models(text: str | None) -> dict[str, str]:
    """'agent=a/b,partner01=c/d' -> {'agent': 'a/b', 'partner01': 'c/d'}"""
    out: dict[str, str] = {}
    for part in (text or "").split(","):
        if part.strip():
            seat, _, model = part.partition("=")
            out[seat.strip()] = model.strip()
    return out


class QbSeats(BaseAgent):
    if _HAS_CAPS:
        capabilities = AgentCapabilities(mcp_servers=True)

    def __init__(self, *args, seat_models: str | None = None, poll_sec: float = 15.0, **kwargs):
        super().__init__(*args, **kwargs)
        self.seat_models = parse_seat_models(seat_models)
        self.poll_sec = poll_sec

    @staticmethod
    def name() -> str:
        return "qb-seats"

    def version(self) -> str | None:
        return "0.1"

    async def setup(self, environment) -> None:
        return None  # OpenCode is baked into the QuestBench image for the pair tier

    def models_json(self) -> str:
        default = self.model_name or "zai-coding-plan/glm-5.3"
        seats, env = {}, {}
        for seat, model in {"*": default, **self.seat_models}.items():
            spec, key = model_spec(model)
            seats[seat] = spec
            env.update(key)
        return json.dumps({"seats": seats, "env": env})

    async def run(self, instruction, environment, context) -> None:
        # The key travels in exec's env, never in the command text.
        await environment.exec(
            "umask 077 && mkdir -p /run/qb && printf %s \"$QB_MODELS_JSON\" > /run/qb/models.tmp && mv /run/qb/models.tmp /run/qb/models.json",
            env={"QB_MODELS_JSON": self.models_json()}, user="root",
        )
        duration = int(((await environment.exec("echo ${QB_DURATION_SECS:-900}", user="root")).stdout or "").strip() or 900)
        # Seats start once both clients are in-game (up to ~6 min), then play `duration`.
        deadline = time.monotonic() + duration + 900
        while time.monotonic() < deadline:
            r = await environment.exec("test -f /logs/seats/done && cat /logs/seats/done", user="root")
            if r.return_code == 0:
                self.logger.info(f"seats finished: {(r.stdout or '').strip()}")
                if not (r.stdout or '').strip() or any(code != '0' for code in (r.stdout or '').split()):
                    await self._usage(environment, context)
                    raise RuntimeError("Seat launcher failed; inspect per-seat MCP diagnostics and launch.log")
                break
            await asyncio.sleep(self.poll_sec)
        else:
            self.logger.warning("seats did not finish before the adapter's deadline")
        await self._usage(environment, context)

    async def _usage(self, environment, context) -> None:
        """Sum OpenCode's per-step tokens and cost over both seats."""
        script = (
            "let u={i:0,o:0,c:0,usd:0};for(const f of require('fs').readdirSync('/logs/seats')){"
            "const p='/logs/seats/'+f+'/opencode.txt';if(!require('fs').existsSync(p))continue;"
            "for(const l of require('fs').readFileSync(p,'utf8').split('\\n')){let e;try{e=JSON.parse(l)}catch{continue}"
            "if(e?.type!=='step_finish')continue;const t=e.part?.tokens??{};u.i+=(t.input??0)+(t.cache?.read??0);u.o+=t.output??0;"
            "u.c+=t.cache?.read??0;u.usd+=Number(e.part?.cost??0)}}console.log(JSON.stringify(u))"
        )
        r = await environment.exec(f"bun -e {shlex.quote(script)}", user="root")
        try:
            u = json.loads((r.stdout or "").strip().splitlines()[-1])
        except (ValueError, IndexError):
            return
        context.n_input_tokens, context.n_output_tokens, context.n_cache_tokens, context.cost_usd = u["i"], u["o"], u["c"], u["usd"]
