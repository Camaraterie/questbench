# Character return pilot

This is a first protected-journal experiment, not a full persistent-world or physical-scroll implementation.
Start a fresh container and fresh model sessions from a finished exploratory two-player bundle:

```sh
./scripts/run-pilot.sh --duo --resume-bundle bundles/run-<id> --no-publish
```

Studio's launch API also accepts `{ "duo": true, "resumeRunId": "<id>", "trials": 1, "publish": false }`.
The source must be a local bundle with seats `agent` and `partner01`; other configurations fail.

Each character's exact end-save bytes become its next start save, preserving skills, position,
inventory, equipment, bank and other saved state. A private `JOURNAL.md` seeds each fresh workspace.
No prior OpenCode database, conversation, bot credentials or arbitrary files are restored.
The journal is agent-authored recollection, not corrected server truth. The prompt omits a countdown;
the external runtime remains bounded. A player can update its journal and rest using `finished`.

After gameplay stops, the launcher terminates descendant scripts and takes a grouped engine save
at one recorded tick. Game clients then disconnect. Each journal-bearing seat gets a separate,
bounded memory-only phase in its existing model session: only journal read/write MCP tools
remain, with MCP gameplay and shell tools disabled. This phase discloses no countdown and requests
no game outcome. A failed, oversized or unchanged memory checkpoint blocks automatic return.

Before model calls, the launcher tests the configured MCP protocol, its `execute_code` listing,
a read-only position call, and OpenCode's MCP registration. Diagnostic logs are retained. Bare
conditions also remove access to the board/inbox data and coordination helper files; report tooling
remains available. Image provenance records the inspected registry digest, or explicitly labels a
local base-image configuration digest rather than pretending it is a registry manifest.

Bundles retain hashes of authored journals before redaction. Returns reject changed/redacted
journals, invalid memory phases and incomplete or altered final state checkpoints rather than
silently reconstructing memory or resuming a potentially stale character save.

The bundled SDK now exposes `getGameFeedback(cursor?)`. MCP and the script runner automatically
include retained game/system messages and dialog text, with no category whitelist or last-five
truncation. The feedback cursor is separate from chat reads and game ticks, and overflow beyond
4,096 entries per stream is explicit. The client publishes its entire 100-message chat ring.
Bank withdrawals verify item counts and include server feedback on failure; item-on-object use
no longer treats a pre-existing interface or animation alone as completion evidence.

The journal limit is 8,000 Unicode characters. Oversized or absent journals fail a subsequent
return rather than being silently truncated or replaced by a transcript. Other workspace notes
remain review artifacts; they are not the declared memory channel. Journals are private to their
seat's Unix user and collected with the other bounded notes at the end of the run.

The first pre-journal livelihood run (`8e888600-aef8-4593-81e3-8adbe9cfaa2c`) has one explicit bootstrap:
agent's own SESSION_NOTES.md is recovered verbatim from its successful write-tool log; partner01's
own final answer is used verbatim because it wrote no journal. This exception applies only to that
run. It must be considered when interpreting the first return; later returns require JOURNAL.md.

`continuity.json` records the parent run, parent manifest hash, save hashes, initial journal hashes,
memory sources, limit and fresh-context policy. The file is retained in the resulting bundle;
the resolved private scenario includes the initial journals. End journals appear under
`seats/<name>/notes/JOURNAL.md`. All returns are exploratory, outside baseline scoring.

Only character state persists in this pilot. Shops, NPCs, ground items and the rest of the world
boot afresh. Document transfer, physical scroll identity, a staging-world editor, native operator
panels and automated multi-activation scheduling are not implemented here. No future encounter
is guaranteed by the player brief.
