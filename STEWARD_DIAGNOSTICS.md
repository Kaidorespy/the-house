# Steward Diagnostics

The Steward view is the House integrity surface.

It exists because the right terminal column should not carry every operational
concern. The Steward needs a place to show substrate health, file-backed ledger
counts, consent boundaries, failure events, and source integrity without
pretending those diagnostics are in-world conversation.

## Current Surface

The top-level `Steward` view shows:

- runtime posture: day, time, presence, time mode, motion, model-call budget
- API readiness
- durable ledger counts for House events, persona memories, relationships,
  direct rooms, room conversations, and activity
- memory and relationship consent counts
- attention items such as missing API key, missing source references, unknown
  relationship identities, away mode, and spent call budget
- recent Steward/system activity
- recent failure surface
- source integrity warnings

## Repair Actions

The Steward view has bounded repair controls. These are explicit user-triggered
actions, not autonomous file editing:

- create a safety backup
- sync persona memory files
- compact the Librarian recall store
- rewrite current direct-room transcript snapshots
- re-archive active relationship updates as revisions
- refresh the outside signal

These actions reuse existing runtime/file-backed APIs and write Steward activity
events so repairs have an audit trail.

## Boundary

This is a diagnostic view for User and the implementation, not normal resident
knowledge. A resident should not receive Steward diagnostics in prompts unless a
future permission path explicitly allows it.

## Future Work

- Add repair actions beside recoverable integrity warnings.
- Link attention items to exact source records.
- Add backup age and last successful archive write timestamps.
- Add a redacted developer-mode toggle for private diagnostic content.
- Turn repeated failures into Steward House events with clear provenance.
