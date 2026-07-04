# Failure Modes

The House should not leak raw substrate failures into the world.

When a model is unavailable, a context window is too large, a tool fails, or a
persona cannot answer, the Steward acts as the integrity layer. She names the
interruption in House language and preserves continuity.

## Principles

- Raw errors are for logs and diagnostics, not resident-facing speech.
- The Steward explains absence without pretending the failed action succeeded.
- The House should acknowledge interruption, not rupture.
- Failure events belong in the House log when they affect continuity.
- A persona should not contradict herself just because a call failed.

## Current Voice

Missing model key:

```txt
Mara is present, but the line to her deeper voice is not connected yet. The
Steward is holding the room intact until that channel exists.
```

Model/API failure:

```txt
Mara's deeper voice flickered out before it could answer. The Steward has
marked the interruption and kept the room from tearing open.
```

Weather/outside-signal failure:

```txt
The outside signal blurred before it reached the windows. The Steward kept
today's rain as the shared anchor.
```

Generic runtime failure:

```txt
Something under the floorboards hiccupped. The Steward caught it, named it
gently, and kept the House coherent.
```

## Current Implementation

Direct-room model failures now return Steward language instead of raw API
messages.

The Activity log records a softened integrity-layer event. Failed direct model
routing is promoted into the House log as `failure`.

Outside-signal fetch failures fall back to the manual rain signal and use
Steward wording in the UI.

## Next Work

- Add a developer diagnostics panel for raw errors.
- Add context-window-too-large detection before model calls.
- Add contradiction repair notes for persona state conflicts.
- Route export/load/backup failures through the same Steward vocabulary.
