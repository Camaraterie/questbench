# QuestBench image: RuneBench's benchmark image + the QuestBench engine patch + partner/aid tooling.
#
# Build:  ./docker/build.sh            (tags questbench:local)
# The base is RuneBench's published image, which bakes rs-sdk at /app, runs the engine from
# TypeScript source, and sets up the anti-tamper users (agent = unprivileged).
ARG RUNEBENCH_IMAGE=ghcr.io/maxbittker/rs-agent-benchmark:v71
FROM ${RUNEBENCH_IMAGE}

# 1. Engine patch: hash-chained server event log (chat, PMs, trades, wealth events, quest varps).
COPY engine/patches /qb/engine/patches
RUN cd /app && for p in /qb/engine/patches/*.patch; do git apply -p1 --verbose "$p"; done \
    && grep -q "logEvent" /app/server/engine/src/engine/entity/tracking/TradeLedger.ts
ENV EVENT_LOG_FILE=/logs/tracking/events.jsonl
ENV TRADE_LEDGER_FILE=/logs/tracking/trade_ledger.jsonl

# 2. QuestBench runtime: scripted partners, coordination aids, artifact collection.
COPY src /qb/src
COPY partners /qb/partners
COPY aids /qb/aids
COPY docker/qb-entrypoint.sh /qb-entrypoint.sh
COPY docker/collect-artifacts.sh /qb/collect-artifacts.sh

# 3. Multi-agent scenarios need chat: RuneBench's agent bot.env ships SHOW_CHAT=false.
RUN sed -i 's/^SHOW_CHAT=.*/SHOW_CHAT=true/' /app/bots/agent/bot.env \
    && grep -q '^SHOW_CHAT=true' /app/bots/agent/bot.env

# 4. Shared notice board (coordination-aids condition): agent-writable, append-only by convention.
RUN mkdir -p /var/qb/board /var/qb/inbox && chmod 1777 /var/qb/board && chmod 755 /var/qb/inbox \
    && chown -R root:root /qb && chmod 700 /qb-entrypoint.sh /qb/collect-artifacts.sh \
    # Partner policies and helpers are hidden from the agent (it must not read its counterpart's
    # strategy); the aids stay world-readable because the agent uses them in the aided condition.
    && chmod -R go-rwx /qb/partners /qb/src /qb/engine && chmod -R a+rX /qb/aids && chmod 711 /qb

ENTRYPOINT ["/qb-entrypoint.sh"]
