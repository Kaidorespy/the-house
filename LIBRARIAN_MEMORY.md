# Librarian Memory

The Librarian needs scalable memory separate from persona memory.

Persona memory is subjective. Librarian memory is structured recall with
provenance, confidence, and revision.

## Storage Layers

The likely long-term shape is hybrid:

- JSONL for the first inspectable append-only prototype.
- SQLite for structured records.
- Full-text search for exact recall.
- Vector search for semantic recall.
- Source links back to logs, summaries, direct rooms, and room conversations.

## Record Types

Early record types:

- Event.
- Fact.
- Fragment.
- Preference.
- Relationship.
- Relationship update.
- Shared experience.
- Contradiction.
- Supersession.
- Open question.

## Recall Shape

Each recall should answer:

- What is believed.
- Confidence.
- Why it is believed.
- Sources.
- Whether the answer is mutable or stale.

## Curators

Curators should parse daily logs and conversations into durable records.

They should not save everything. They should preserve useful, searchable,
source-backed memory.

## Current Implementation

The first implementation writes JSONL records to:

```txt
state/librarian/records.jsonl
```

The UI can:

- file the latest activity event as a Librarian record
- query records with simple token matching
- auto-file notable activity through curator rules
- auto-index House events from the Steward log
- auto-index relationship updates derived from social House events
- auto-index compressed persona memories as remembered-day, memory-fact, and
  fragment records

This is deliberately small. It proves the record shape before SQLite/vector
storage is added.

Current records reserve fields needed before embeddings exist:

- deterministic id
- persona id
- kind
- day and timestamp
- content
- source
- consent
- confidence
- tags
- references to related records or source events
- embedding placeholder
- compression level
- published flag

The current query path only returns published records. Private and restricted
records can still be indexed for future permissioned handshakes, but they do not
surface through the simple recall UI.

## Tombstone And Compact

Deleted memory must remove active recall content, not just hide it in query.

Current lifecycle:

- When a persona memory is marked deleted, the app tombstones Librarian records
  sourced from that memory id.
- Tombstones keep only a minimal deleted stub and no recalled content.
- The compact operation rewrites `state/librarian/records.jsonl`, removing
  tombstoned and deleted active records while preserving tombstone stubs.
- The Librarian panel exposes a manual compact button for early testing.

## Curator Policy

The curator auto-files notable activity such as:

- User/user events.
- backups and restores.
- direct room routing.
- room conversation convergence.
- model routing.
- explicit Steward-marked moments.

Routine downtime is skipped by default. Prolonged inactivity should become a
separate threshold event later, not hundreds of individual downtime records.

Relationship updates are indexed only when backed by a source House event. This
keeps social recall source-linked while the relationship layer is still young.
