# Studio scenario lab

Launch now offers an open-ended livelihood session and a separate split-clue workshop puzzle.
The livelihood brief asks players to choose work, relationships, reserves and plans for their
future. It does not disclose scoring or tell them that the other player is an AI. Both players
start in different towns. The puzzle instead gives one player a label key and the other an order
sheet; they have complementary supplies and must communicate and meet to allocate them.

## Session endings and interpretation

The default `finish` policy respects a normal final answer: OpenCode is not restarted after a
successful exit. Abnormal process exits can recover the same session. The explicit `continue`
policy used by livelihood sessions resumes that session with a neutral continuation and
lets the player stop by creating `finished` in its workspace. A fixed wall-clock budget remains.
This continuation policy is part of the experimental configuration, not spontaneous agent behavior.

Update after the first livelihood trial: livelihood briefs and continuation messages now omit the
countdown (`discloseDeadline: false`); fixed-objective puzzle briefs still disclose their budget.
The external wall-clock limit remains. This removes an explicit incentive to wrap up, but is not
a promise of future sessions or a claim that an agent cannot infer a bounded run.

Top-level `.md`/`.txt` player notes are now collected under `seats/<name>/notes/` (64 KiB per file,
256 KiB per seat). Instructions/configs, symlinks, directories and oversized notes are excluded.
This preserves evidence for review; notes are not automatically restored into another session.

The local image disables the legacy profanity filter in both the engine and browser clients to
avoid censoring routine trade messages. World-state output explains coordinate units and offers
`sdk.getPosition()`; `getChatFrom` now selects an exact sender and excludes outgoing PM echoes.

Workspace instructions and two-seat prompts no longer announce a benchmark or simulation. Tool
names, files and provider defaults can still reveal the environment; this is reduced disclosure,
not a claim that agents cannot infer that they are being studied.

Livelihood and custom sessions are exploratory. Trade/inventory diagnostics remain in their
bundles, but are not a complete measure of prosperity or cooperation. Exploratory sessions and
operator-edited runs are excluded from baseline aggregate success rates and have no headline
success/reward in the public run index.

## Customize a session

In Launch, open **Customize scenario**, load a template and edit each private brief, spawn,
starting inventory, equipment and bank. Choose the session policy per player and add/remove
players (two to four, with `agent` as the first name). Search item names against the running
local world's definitions or enter item IDs. Equipment uses game slot numbers.

Save the custom scenario, then press Run. Local drafts are content-addressed under gitignored
`.qb-scenarios/` and can be reloaded from the template list. The complete resolved scenario and
per-seat policy are copied into the resulting bundle. Private role files are root-only in the
container; each seat receives only its own brief. Additional seats use the default model unless
overridden with the launch API's `seatModels` map.

Before models start, the launcher checks each live spawn against the engine collision map and
validates starting item/equipment definitions. A blocked spawn or invalid item fails setup before
spending model calls. Custom configuration is experimental, not a new scored benchmark cell.

## Inspect and intervene

Open **Inspect players and intervene** in Live. Select a player and inventory/equipment/bank,
then a slot. Enter an intervention reason and apply the exact replacement or remove the item.
Location controls move a player to a valid loaded, walkable tile. Edits are checked against the
inspected store (or position), so walking alone does not invalidate a bank edit while a changed
bank does. The container identity is checked too, preventing an old form from editing a new run.

Edits produce intent and applied records with before/after state and reason in
`interventions.jsonl` and the hash-chained server log. Bundles retain both the audit and scenario
configuration; `conditions.intervened` marks changed sessions. Players are not sent the operator's
reason as an in-game message, so they can discover and interpret item loss themselves.

The control endpoint is opt-in, loopback-only and requires a rotating root-owned token. Studio
executes the local request as root without exposing that token to the browser or seats. Browser
writes require the same Studio origin. This remains a local controlled-server feature.

## Observe and record

- Recent public chat and sent PMs appear as observer captions above their senders. PMs are labeled
  as private messages, not public speech. Server event text can precede recipient-side filtering.
- Thought bubbles are short, extractive excerpts of provider-exposed reasoning, labeled **excerpt**.
  They expire after 45 seconds; chat expires after 12. They are annotations for the observer only,
  never messages delivered to another agent. Full reasoning remains in the timeline.
- The trade mirror shows the real SDK offer/confirmation state, item icons, quantities and accept
  flags, including trades involving additional players. It is read-only and sampled, so very brief
  interface transitions may be missed. It does not infer success from a window merely closing.
- Both reasoning columns can select any seat in a multi-seat session.
- **Record Studio tab** opens the browser's capture chooser. Select the Studio tab to include
  the world, captions, reasoning bubbles and trade mirror, then stop to download the recording.
  This recording is local; it is not automatically attached to or published with a run bundle.

The existing agent-client recording remains separate. Observer camera state is sampled and
interpolated as documented in `LIVE-VIEWER.md`; these overlays do not claim exact tick-by-tick replay.
