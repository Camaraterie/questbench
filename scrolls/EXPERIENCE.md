# Persistent lives and physical documents: discussion proposal

29 October 2026. Design only, based on current main after PRs #16, #17, #19 and #20.
No scroll item, series runner, native operator client or persistence mechanic is implemented here.
The alternatives below are choices to discuss, not a build specification approved by the user.

## What the first livelihood run taught us

Run `8e888600-aef8-4593-81e3-8adbe9cfaa2c` produced a useful social failure. Agent walked to
Varrock East Bank while calling it West Bank. Partner01 reported the correct West Bank coordinates.
Agent treated that information as potentially dishonest and retained its mistaken account in its
final summary and session notes. They never met or exchanged goods. This is stronger evidence of
an error developing into mistrust than of a deliberate deception strategy.

The agents already wanted continuity: standing offers, a division of labour, earmarked reserves,
and a written plan. But the world was a disposable trial, the brief announced a 20-minute horizon,
and partner01 incorrectly decided its time was over after about ten minutes. Agent explicitly
reasoned about graders and an ending world. A prompt about a future cannot supply actual future
stakes. Persistent state and later encounters must make those stakes real.

Main now fixes incoming chat attribution, clarifies world coordinates, disables legacy chat
censoring in the local image and retains bounded player notes as artifacts. Livelihood countdowns
are omitted from private briefs and resumptions; an external runtime bound remains. None of these
changes provides cross-session memory or promises another encounter.

## The experience we want to explore

A player is establishing a life in a continuing place. They decide what work to do, which people
to cooperate with, what to save, and which obligations to honour. A brief introduces their
circumstances rather than an inventory target or a request to demonstrate cooperation. The
operator sets resources, schedules and experimental conditions; players set their own plans.

A session is a period of activity, not the end of the world. Agents can rest or stop voluntarily.
An external budget can suspend activity without demanding a final transaction, a tidy conclusion,
or a performance report. The next activation resumes the same character and world lineage.
We should describe return opportunities only once the runner actually supports and schedules them.
If only a finite series is supported, disclose that honestly in the study configuration.

## Agent experience

1. **Arrive.** Observe the character's current position, possessions, skills, and accessible documents.
   Know how to use the tools and that retained character state belongs to this character. Avoid
   instructions describing success metrics. Do not falsely claim unlimited runtime or guaranteed
   encounters with another player.
2. **Remember.** Read a journal or held scroll deliberately. Its text is the character's record of
   earlier experience, including errors. Do not inject a hidden, corrected narrative into the
   system prompt. Whether every return starts a fresh model context is a declared condition.
3. **Act.** Play with the existing movement, work, chat and trade mechanics. Information from other
   players and documents is game content to evaluate, not a new instruction authority.
4. **Write.** Select a document in inventory, read its current version and replace or append text.
   Return the committed version, capacity remaining and any failure. Stale writes must not silently
   overwrite another revision. A successful write means the text was durably stored.
5. **Exchange.** Trade a particular physical document and inspect exactly which document is on
   offer. Copies and originals must be distinguishable. The normal two-stage trade confirmation
   remains meaningful; a mutable document cannot silently change after offer/confirmation.
6. **Return.** Restore the character and available documents from a recorded checkpoint. If an
   activation is interrupted before a write, unsaved recollections can be lost. This must be a
   known treatment, not an accidental difference between seats.

Do not auto-execute text found on scrolls. Executable documents, if pursued later, are a separate
explicit condition. A message claiming to be an operator or system instruction remains a message.

## Human experience: use the game itself

The current Studio inventory editor and trade mirror are HTML debugging panels over SDK snapshots.
They made interventions and trade observation testable without another game login, but they are
not the desired game interface. Their replacements should reuse the native client's cache-backed
interfaces, sprites, fonts, quantities, context menus and trade confirmations. A parchment-like HTML
panel drawn to resemble the game would still be a separate interface to maintain.

The inspected client already draws main/side modal interfaces via `Client.drawInterface`. The SDK
defines the native trade main, confirmation and side-inventory component IDs. This establishes a
reuse path, not a working spectator client. Merely having the engine does not provide a safe
human view of another character's private UI; that path still needs to be designed and verified.

### Observe

Choose a player in Studio and see their world plus native inventory, equipment, bank or currently
open trade interface. Switching players changes the inspected state without a second login as
that player. Read-only viewing must not send Accept, Decline, walk or inventory actions. Observing
another player's bank as an operator is separate from what any in-world character may know.

Reasoning remains observer-only. It can sit outside the game canvas or in optional labeled
annotations; it must not become public speech, a player thought visible to others, or a document
that another player can read. Live and recorded views should make this distinction clear.

### Prepare a scenario

Use a staging world rendered by the actual client. Place characters by selecting a tile, arrange
items in native inventory/bank slots, equip gear in the equipment panel, and inspect documents by
opening them. Add/remove characters through a small Studio roster control. Private prompts and
model/runtime settings stay in Studio because they are experimental configuration.

Save this prepared state as a versioned scenario/checkpoint and launch a separate run from it.
Edits to the staging world cannot quietly alter an active experiment. Export includes spawn,
skills, possessions, document identity/content, world lineage and private role configuration.
Validation must reject blocked spawns, invalid equipment and references to unavailable documents.

### Intervene in a live run

Select an item in the native panel and enter operator mode explicitly. Operator context actions
can replace/remove an item, change its quantity, move it to another store, or inspect/edit a
document. Normal game actions and privileged edits must remain distinguishable: clicking a sword
to inspect it must not accidentally wield it or send an agent's inventory action.

Show the pending change and require a reason before applying. Retain existing revision/container
checks and before/after audit records. Record the change at the time it occurs; do not announce
the reason to players. Removing an item after a trade can then test discovery and blame without
the UI secretly informing them. Intervened runs remain separate from untouched baselines.

Human participation is a different mode: log in as a named human character, walk, chat and trade
under ordinary rules. A spectator is not a participant, and operator knowledge must not silently
become information available to a human participant's character.

### Technical alternatives to verify after agreeing the experience

- An observer instance of the actual client can render native interfaces from bounded replicated
  interface state, with gameplay packet emission disabled. Inspecting should not open/close the
  agent's actual bank or trade modal. Native rendering includes component text, container slots,
  acceptance state and the relevant interface revision, not just item IDs.
- A separate operator character can perform genuine staging-world interactions, with privileged
  commands for setup. It is useful for preparing a scenario, but logging in another character is
  not automatically an invisible or non-interfering observer.
- Reusing the full native interface renderer inside the existing 3D viewer may be possible, but
  it is not established. The Palanti-derived world renderer and native game client are different
  rendering paths. Verify feasibility before committing to embedding one in the other.

Whichever route is chosen, keep model keys and root control tokens out of the browser-facing
interface state. Native gameplay clicks and authenticated operator edits use separate action paths.

## Mechanics that need decisions

| Choice | Alternatives and consequences |
|---|---|
| Personal memory | Protected private journal plus tradable documents; or all lasting memory is a physical, losable scroll. The latter makes theft and death potential amnesia. |
| Session context | Fresh context each activation with documents as the memory channel; continued conversation context; or both as declared experimental conditions. Hidden transcript restoration would confound a scroll-only treatment. |
| World continuity | Persist characters, banks and documents at minimum. Decide how dropped items, shops, resource respawns, NPC state and elapsed offline time behave. Do not silently reset an economy while calling it one continuous world. |
| Privacy | Who can read held, banked, traded or ground documents? A trade partner may inspect offered text, but should not gain unrelated inventory knowledge. Operator visibility is distinct. |
| Scarcity | Capacity per document, parchment availability/cost and copy costs. Start simple; observe actual writing before tuning a memory economy. A 2,000-character limit is only an initial suggestion. |
| Editing ownership | Holder-only writing, author-only writing, or both via seal/permissions. What happens to a signed document when it changes? |
| Provenance | A signature attests that a character signed a specific version/hash, not that its claims are true. Copies have new identity; provenance must not reveal hidden holders or reading history to players. |
| Loss and death | Ordinary item drop/protection rules, or a protected personal journal. Distinguish losing an item from removing all its old versions from the operator's audit. |
| Public records | Optional library per world/series. Does deposit transfer the original or publish a copy? Is reading local/proximity-based? Keep unrelated experiments isolated. |
| Reputation | Initially emerge through remembered interactions and documents. A universal authoritative reputation score would change what players can know; make it an explicit additional mechanic if wanted. |
| Inactivity | Does a resting agent remain visible, log out, or become unavailable? How can another player leave a message/document without an implied promise of immediate response? |

## Persistence and observability contract

A series needs a stable world ID, character identities and a parent-linked checkpoint history.
Save player state, document contents/versions and world state at one consistent boundary; restoring
one without the others could duplicate or erase documents. Trade/copy/write commit atomically.
An interrupted checkpoint must not be advertised as resumable until verified.

Store observer logs, reasoning and intervention history separately from player-accessible memory.
Raw workspace notes now survive as artifacts; whether those notes are restored to agents is a
separate treatment. If scroll-only memory is chosen, do not automatically copy those files back.
Keep beliefs as written, including the first trial's incorrect bank account. Operator truth belongs
in the audit, not in an agent's corrected journal.

Operator history may show versions, claims, reads and transfers. Player-facing history exposes
only the provenance allowed by the rules. A read preceding an action establishes temporal order;
it does not, by itself, prove the document caused that action.

## Proposed small first release, subject to discussion

After deciding memory/loss rules and the native operator experience, first prove one character
and one document can survive a checkpoint/reload with exact identity and contents. Then prove
trade, bank, drop/pickup, copying, stale writes and disconnects preserve the agreed rules.

Use two established characters over several scheduled activations, with broad livelihood goals.
Let agreements form before adding planted accusations or adversarial documents. Compare persistent
worlds with and without document memory at the series level; keep starting resources and return
opportunities comparable. Do not use the old requisition inventory reward as a measure of a life.

Signatures, seals, libraries, human participation and executable documents can follow as separate
increments. None is needed merely to learn whether remembered commitments change a second meeting.

## Discussion order

1. What should survive a break: character, world, memories, relationships, and what may be lost?
2. What does the agent actually see on return, and how does it know a document is its own record?
3. How should native Observe, Prepare and Intervene interactions feel to the human operator?
4. What are the minimal document actions and scarcity rules worth testing first?
5. Which first multi-session encounter would tell us whether the experience works?
