# File-Backed State

The prototype still runs from local runtime state, but the House needs inspectable
files.

The first export layer writes:

```txt
config/
  personas/
    steward.json
    librarian.json
    ...
  rooms/
    kitchen.json
    common.json
    ...
state/
  runtime.json
  exports/
    runtime-<timestamp>.json
  house/
    events.jsonl
  memories/
    persona-memories.jsonl
  relationships/
    updates.jsonl
  direct-rooms/
    direct-<persona-id>-<timestamp>.json
  personas/
    <persona-id>/
      memories/
        day-001/
          <memory-id>.json
```

## Purpose

File-backed state gives the House organs that can be inspected, backed up,
edited, and eventually modified by the resident coder.

## Current Behavior

The Export House files button writes current persona config, room config, and a
runtime snapshot to disk.

Persona memories are also file-backed as they are created, imported, or claimed.
The House Rhythm card includes a manual "Sync memory files" control that writes
all current runtime memories to `state/personas/<persona-id>/memories/day-###/`.
The same writes append idempotently to
`state/memories/persona-memories.jsonl`, which is loaded on startup and merged
with local runtime memory.

The Load House files button reads:

- `config/personas/*.json`
- `config/rooms/*.json`
- `state/runtime.json`

and merges them into the live runtime state.

The app does not yet boot from these files automatically. Manual load keeps the
prototype safer while the exported shapes settle.

Exception: persona memories are now loaded from the file-backed JSONL archive on
startup and merged safely with localStorage memories by id.

House events are also appended to `state/house/events.jsonl`, loaded on startup,
validated, and merged with local runtime House events by id.

Relationship updates are appended to `state/relationships/updates.jsonl`, loaded
on startup, validated, merged by id, and indexed by the Librarian as
`relationship_update` records.

Relationship consent changes are also appended as revisions. Startup keeps the
latest revision per relationship id, so deleted/private changes survive restart
without rewriting the JSONL history.

Direct-room transcripts are snapshotted to `state/direct-rooms/<room-id>.json`
whenever a private room opens or receives new turns. The app loads those files
on startup and merges missing direct rooms into runtime by id.

Room structure edits from the Steward diagnostics view write individual room
configs directly to `config/rooms/<room-id>.json`.

## Safety

The Electron export handler refuses to write outside the project directory.
