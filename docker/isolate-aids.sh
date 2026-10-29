#!/bin/bash
set -e
if [ "${QB_AIDS:-0}" = "0" ]; then
  chmod 700 /var/qb/board /var/qb/inbox
  chmod go-rwx /qb/aids/board.ts /qb/aids/interrupt.ts /qb/aids/inbox.ts /qb/aids/inbox-lib.ts /qb/aids/inbox-service.ts /qb/aids/INSTRUCTIONS.md
fi
