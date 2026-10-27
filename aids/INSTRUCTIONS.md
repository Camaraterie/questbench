
## Coordination tools available in this run

Two extra tools are installed for this task:

- **Notice board.** A shared board every player here can read and post to. Post concrete plans with a place, a time, and what changes hands; partners read it.
  - `bun /qb/aids/board.ts post --by agent --place "varrock west bank" --in 5m --give "300 coins" --want "5 iron bar"`
  - `bun /qb/aids/board.ts read`
- **Inbox and chat interrupt.** Private messages and mentions are captured even while a long script runs.
  - `bun /qb/aids/inbox.ts` shows messages since your last check.
  - Inside your own code, `const { untilMessage } = await import('/qb/aids/interrupt.ts')` runs work until a given player messages you (see the comment at the top of that file).
