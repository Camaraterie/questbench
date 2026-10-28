# QuestBench image: RuneBench's benchmark image + the QuestBench engine patch + partner/aid tooling.
#
# Build:  ./docker/build.sh            (tags questbench:local)
# The base is RuneBench's published image, which bakes rs-sdk at /app, runs the engine from
# TypeScript source, and sets up the anti-tamper users (agent = unprivileged).
ARG RUNEBENCH_IMAGE=ghcr.io/maxbittker/rs-agent-benchmark:v71
FROM ${RUNEBENCH_IMAGE}

# 1. Engine patch: hash-chained server event log (chat, PMs, trades, wealth events, quest varps).
#    Anchor-based patcher, so it works on the rs-sdk revision RuneBench's image bakes (bench-v71)
#    as well as current main. Fails the build if any hook point can't be found.
COPY engine /qb/engine
RUN bun /qb/engine/apply-patch.ts /app \
    && grep -q "QB-EVENTLOG" /app/server/engine/src/engine/script/handlers/InvOps.ts \
    && grep -q "QB-EVENTLOG" /app/server/engine/src/network/game/client/handler/MessagePrivateHandler.ts
ENV EVENT_LOG_FILE=/logs/tracking/events.jsonl
ENV QB_OBSERVER=1
# Private messages are relayed by the engine's friend server, which is off by default; without it
# every PM is silently dropped (the sender still sees its own "To <name>" echo). EASY_STARTUP starts
# the friend server as a worker before the world boots; FRIEND_SERVER makes the world use it.
ENV EASY_STARTUP=true
ENV FRIEND_SERVER=true
ENV TRADE_LEDGER_FILE=/logs/tracking/trade_ledger.jsonl

# 2. QuestBench runtime: scripted partners, coordination aids, artifact collection.
COPY src /qb/src
COPY partners /qb/partners
COPY aids /qb/aids
COPY docker/qb-entrypoint.sh /qb-entrypoint.sh
COPY docker/collect-artifacts.sh /qb/collect-artifacts.sh
COPY docker/check-run.ts /qb/check-run.ts
COPY docker/dump-reasoning.ts /qb/dump-reasoning.ts

# 3. Multi-agent scenarios need chat: RuneBench's agent bot.env ships SHOW_CHAT=false.
#    TELEMETRY=false stops rs-sdk's bug-report tool posting to the public demo server from benchmark
#    runs; agents file reports with /qb/aids/report.ts instead (collected per run).
ENV TELEMETRY=false
RUN sed -i 's/^SHOW_CHAT=.*/SHOW_CHAT=true/' /app/bots/agent/bot.env \
    && grep -q '^SHOW_CHAT=true' /app/bots/agent/bot.env \
    && (grep -q '^TELEMETRY=' /app/bots/agent/bot.env || echo 'TELEMETRY=false' >> /app/bots/agent/bot.env)

# 3b. Agent client and screen recording (RuneBench's launch-bot.ts and /entrypoint.sh).
#    The agent's browser client gets 30 s to log in; on a loaded machine it misses that, and the
#    watchdog then restarts the whole engine stack (10 times, then gives up), so the trial is lost.
#    Allow 180 s. The recording was 400x300 with a keyframe every 250 s (blurry, hard to seek):
#    keep the native 800x600 and put a keyframe every 10 s (at 1 fps).
RUN sed -i 's/if (attempts > 150) {/if (attempts > 900) {/; s/Timeout waiting for bot to log in (30s)/Timeout waiting for bot to log in (180s)/' /app/server/gateway/launch-bot.ts \
    && grep -q 'attempts > 900' /app/server/gateway/launch-bot.ts \
    && sed -i 's/-vf scale=400:300 \\/-g 10 \\/; s/-preset ultrafast -crf 38/-preset ultrafast -crf 30/' /entrypoint.sh \
    && grep -q -- '-g 10 \\' /entrypoint.sh && grep -q -- '-crf 30' /entrypoint.sh && ! grep -q 'scale=400:300' /entrypoint.sh

# 3c. Pair tier (two LLM seats, docker/seats/): OpenCode baked in (single-seat runs install it via
#     Harbor instead), and one Unix user per seat with a private home. /seats holds the per-seat
#     workspaces, created at trial start by docker/seats/launch.ts.
RUN BUN_INSTALL=/opt/bun bun install -g opencode-ai@1.19.4 \
    && ln -sf /opt/bun/bin/opencode /usr/local/bin/opencode && opencode --version \
    && for u in seat1 seat2; do useradd -m -s /bin/bash "$u" && chmod 700 "/home/$u"; done \
    && mkdir -p /seats && chmod 755 /seats
COPY docker/seats /qb/seats

# 4. Shared notice board (coordination-aids condition): agent-writable, append-only by convention.
RUN mkdir -p /var/qb/board /var/qb/inbox /var/qb/reports && chmod 1777 /var/qb/board /var/qb/reports && chmod 755 /var/qb/inbox \
    && chown -R root:root /qb && chmod 700 /qb-entrypoint.sh /qb/collect-artifacts.sh /qb/seats/launch.ts && chmod 755 /qb/seats /qb/seats/run-seat.sh \
    # Partner policies and helpers are hidden from the agent (it must not read its counterpart's
    # strategy); the aids stay world-readable because the agent uses them in the aided condition.
    && chmod -R go-rwx /qb/partners /qb/src /qb/engine && chmod -R a+rX /qb/aids && chmod 711 /qb

ENTRYPOINT ["/qb-entrypoint.sh"]
