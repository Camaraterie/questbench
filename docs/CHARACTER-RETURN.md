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
