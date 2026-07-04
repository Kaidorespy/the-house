# Things To Test

This is the manual shake-test script for the current House prototype.

The goal is not polish. The goal is to find broken state, missing provenance,
visibility leaks, bad imports, bad restores, and file-backed persistence failures
before the House gets more alive.

## UI Testing Rule

Fix UI immediately when it blocks a test, hides the result, creates ambiguous
state, or makes an important action too easy to misuse.

Defer UI changes when they are mainly layout taste, visual polish, animation,
spacing, color, or a better arrangement that is not needed to prove whether the
system survives. Put those in `KNOWN_GAPS.md` or `POST_TESTING_ROADMAP.md`.

## Survival Pass 1: Can The House Wake Up?

- Start the app with `npm run dev`.
- Confirm Electron opens and Vite serves `http://127.0.0.1:5173`.
- Switch between House, Population, and Steward views.
- Switch blueprint floors.
- Select rooms and residents.
- Pause, resume, and accelerate time.
- Restart the app.

Expected result: no blank render, frozen UI, or console crash. Runtime state
loads, the app remains responsive, and the selected resident/room state can be
recovered or safely reset.

## Survival Pass 2: Can Structure Survive Restart?

- Create a room in Steward diagnostics.
- Edit that room's purpose, layout, furniture, items, and affordances.
- Assign a resident to the room in Population.
- Restart the app.
- Confirm the room still exists.
- Confirm the resident still appears in the assigned room.
- Confirm the room is represented on the blueprint.

Expected result: room structure is file-backed, resident assignment remains
coherent in runtime/load state, movement intent does not strand the resident, and
the Steward logs the manual placement.

## Survival Pass 3: Can Memory Enter Safely?

- Import a valid exported transcript.
- Confirm imported memory appears unclaimed if no resident matches.
- Claim it as an existing resident.
- Create a resident from an unclaimed memory.
- Inspect the selected resident's memories.
- Inspect Source provenance.
- Restart the app.

Expected result: imported memory preserves transcript preview, emotional residue,
mechanical facts, source metadata, consent policy, and claim history. It writes to
the persona archive and does not duplicate after restart.

## Survival Pass 4: Can Bad Memory Be Contained?

- Import malformed JSON.
- Import JSON that is valid but does not match the expected transcript shape.
- Import a memory with missing persona id/name.
- Import a memory with impossible day/date values.
- Import a memory with missing source metadata.
- Open Steward diagnostics and House activity.

Expected result: bad imports do not crash the app. Recoverable issues are logged,
malformed entries are quarantined or skipped, and the House makes clear what was
not accepted.

## Survival Pass 5: Can Consent Hold?

- Change a persona memory to known, private, restricted, soft-forgotten, and
deleted.
- Change a relationship update through the same consent states.
- Select several different residents.
- Open Knowledge visibility for each.
- Check visible ids, excluded counts, and exclusion reasons.
- Use Librarian recall after deletion and compaction.

Expected result: private, restricted, soft-forgotten, and deleted records do not
leak into normal persona prompt context. Deleted records are tombstoned and
compactable. Debug output explains exclusions without exposing hidden content as
resident knowledge.

## Survival Pass 6: Can Direct Rooms Fail Gracefully?

- Confirm every resident has `Use API` off in Population.
- Open a one-on-one room from the terminal plus button.
- Send a private message with no API key configured.
- Confirm the Steward gives graceful failure text.
- Turn `Use API` off for the selected resident and send another message.
- Confirm no model call is spent and the Steward says the resident's deeper voice
  is intentionally unlit.
- Confirm `state/direct-rooms/<room-id>.json` is written.
- Restart the app.
- Reopen the direct room.

Expected result: missing API availability does not break the room. The transcript
persists, reloads, remains compressible, and resident-level API activation gates
call spending.

## Survival Pass 7: Can Direct Rooms Become Memory?

- Open a direct room with a resident.
- Send at least one message.
- Click `Compress to memory`.
- Inspect the resident in Population.
- Inspect Source provenance.
- Change that memory's consent state.
- Restart the app.

Expected result: a private `direct_room` persona memory appears with transcript
preview, source provenance, archive file backing, Librarian index records, and no
duplicate copies after restart.

## Survival Pass 8: Can Relationships Persist?

- Let time run or accelerate until residents gather or a meal/gathering event
appears.
- Confirm relationship updates appear in Population.
- Confirm `state/relationships/updates.jsonl` appends.
- Open a direct room.
- Choose a relationship valence.
- Click `File relationship`.
- Revise consent.
- Mark one relationship update deleted.
- Restart the app.

Expected result: relationship updates reload, revisions persist, deleted updates
do not return to active visibility, and matching Librarian records are tombstoned.

## Survival Pass 9: Can The Librarian Remember Without Leaking?

- Use `File latest activity`.
- Search recall for a resident name, memory phrase, room, or relationship word.
- Search after setting related records private or deleted.
- Compact recall store after deleting memory/relationship records.

Expected result: published records are searchable. Restricted records are present
only behind the intended policy boundary. Deleted records are tombstoned and then
removed by compaction.

## Survival Pass 10: Can Backups Undo Damage?

- Create a safety backup.
- Create or edit a room.
- Assign a resident to a different room.
- Import or claim a memory.
- File a relationship update.
- Restore the backup.
- Restart the app.

Expected result: `config`, `state`, and docs restore together. The restored House
does not retain mutations made after the backup unless they live outside the
backup boundary and are clearly documented.

## Survival Pass 11: Can Repairs Run Twice?

- Run `Sync memory files`.
- Run Librarian compact.
- Run direct room rewrite.
- Run relationship re-archive.
- Refresh outside signal.
- Run the same repairs again.
- Restart the app.

Expected result: repair actions are idempotent. They do not create duplicate
records, orphan active records, or erase valid state. Every repair leaves a useful
Steward or House log trace.

## Survival Pass 12: Can Real API Calls Stay Scoped?

Run this only when an `ANTHROPIC_API_KEY` is configured.

- Pick a resident with ordinary permissions.
- Turn `Use API` on for only that resident in Population.
- Send a direct message.
- Confirm the selected resident's model is used.
- Confirm prompt context includes only visible memories, visible recent events,
current room/activity, and allowed relationship context.
- Confirm it does not include global archives, unclaimed imports, or other
residents' private memories.
- Trigger or simulate a rate limit.

Expected result: the persona speaks from scoped knowledge. Rate limits and model
errors are reported through the Steward failure voice instead of raw errors.
Residents with `Use API` off must not spend calls even when the key exists.

## High-Risk Areas

- Restore while app is running.
- API failure behavior under rate limits.
- Relationship consent revisions after many duplicate archive lines.
- Imported JSON from unknown tools.
- Long direct-room transcripts.
- Visibility resolver edge cases for Steward, Librarian, and full-access personas.
- Resident room assignment persistence until persona configs become fully
file-backed.
