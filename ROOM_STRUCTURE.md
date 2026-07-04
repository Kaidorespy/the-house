# Room Structure

The House structure is now editable in a bounded way.

Rooms are part of the body of the House. They should be able to grow, but early
growth must be explicit, inspectable, and reversible.

## Current Implementation

The Steward diagnostics view includes a Room structure editor.

It can:

- create a room
- update an existing room
- set floor
- set name, purpose, atmosphere, and layout
- edit furniture, items, and affordances as comma-separated lists

New rooms receive default blueprint coordinates on the selected floor. This is
not a drag-and-drop blueprint editor yet; it is controlled metadata growth with
a simple default placement.

## File Backing

Each room save writes directly to:

```txt
config/rooms/<room-id>.json
```

Room changes also remain in runtime/localStorage and are included in normal
export/load and backup flows.

## Audit Trail

Room edits create Steward activity events:

```txt
Created room structure: <room name>.
Updated room structure: <room name>.
```

These are system-scoped because structure editing is an implementation/control
action, not ordinary in-world conversation.

## Future Work

- Add blueprint coordinate editing.
- Add room deletion or retirement with safeguards.
- Add room-to-room adjacency instead of approximate spatial hearing.
- Add permissions for which resident roles can request or author room changes.
- Add source provenance for why a room was created.
