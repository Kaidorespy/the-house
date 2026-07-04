# Memory Architecture

The House has multiple kinds of memory. They should not be collapsed into one
giant prompt.

## Persona Memory

Persona memory is subjective.

It is authored by the persona through reflection. It captures emotional residue,
interpretation, continuity, and selfhood.

This is the first layer of memory and belongs to the persona.

Current implementation:

- Runtime stores `personaMemories`.
- At 3:32, once per House day, the nightly pass creates one memory record per resident.
- Each record reads visible House events first, then visible activity, filtered through that resident's awareness.
- Each record contains emotional residue, sparse mechanical facts, and source IDs.
- At 3:33, residents default to sleep where the day left them.

The ritual now has a model-authored path. At the scheduled crossing or from the
manual "Run ritual now" control, each persona is called sequentially with their
configured model. If a model call is unavailable or fails, that resident receives
the deterministic fallback memory instead. The storage shape stays the same.

External JSON room exports can be imported into `personaMemories`. The importer
currently understands exports with `room_name`, `exported`, and `messages`,
using the room name as the persona name and treating the messages as a 1:1
source transcript.

Direct one-on-one rooms can also be manually compressed into persona memory from
inside the direct-room terminal. The resulting memory is private by default,
source kind `direct_room`, and keeps a transcript preview for inspection.

The Population view includes a source provenance browser for selected resident
memories and relationship updates. For memories it shows source House event ids,
source activity ids, direct-room transcript presence, consent state, and the
deterministic Librarian record ids expected from indexing.

Imported transcripts are the first manual-compression test path:

- The transcript is deterministically compressed into a Day memory.
- Sparse mechanical facts record source path, export time, and message counts.
- Each memory can keep a small fragment buffer: two or three short shards that
  did not become canonical residue but may matter during weekly compression.
- A source transcript preview is retained on the memory record for inspection.
- The Population screen shows active resident memories, unclaimed imported
  memories, and a full memory archive for testing compression quality.
- Compressed persona memories are indexed into Librarian recall as provenance
  records with source id, consent policy, confidence, and mechanical facts.
- Persona memories are written to file-backed storage under
  `state/personas/<persona-id>/memories/day-###/` when they are created,
  imported, claimed, or manually synced.
- Persona memories are also appended idempotently to
  `state/memories/persona-memories.jsonl`; the app loads and merges this archive
  on startup.
- Memory archive validation detects duplicate ids, missing identity fields,
  impossible days, missing source metadata, invalid consent, and malformed
  residue/facts. Fatal imports are quarantined instead of crashing the app.
- The Steward maintains a cheap `houseMood` field: a short label, weight, and
  note derived from presence, weather, gatherings, and failures.

Example file shape:

```txt
persona_memory/
  ada/
    days/
      day-001.md
      day-002.md
    weeks/
      week-001.md
    months/
      month-001.md
    plaques/
      year-001.md
```

Daily entries may contain:

```md
# Day 1

## Emotional Residue
I spent most of the day aware of the kitchen as the warm center of the house...

## Mechanical Facts
Helped User apply for a job at Coffeehouse.
```

## Librarian Memory

Librarian memory is structured, searchable, provenance-based, and
confidence-aware.

It stores durable facts and recall material such as:

- Events.
- Mutable facts.
- Relationship history.
- Shared experiences.
- Persona-specific recalls.
- House-wide recalls.
- Confidence scores.
- Source links back to logs, summaries, or observations.
- Superseded or contradictory records.

The Librarian should likely use a hybrid memory system:

- Relational storage for structured facts.
- Full-text search for exact recall.
- Vector or embedding search for fuzzy semantic recall.
- Provenance links for source inspection.

Example question:

> Have User and I ever watched Severance together?

The Librarian should be able to answer with confidence and source awareness,
not just vibes.

## House Subconscious

The House subconscious is Steward-mediated.

It routes impulses, memory lookups, atmosphere, and pattern pressure between
personas and deeper systems.

The Steward interprets. The Librarian records and retrieves.

Flow:

```txt
Persona asks a question
  -> Steward receives the request
  -> Steward decides whether memory lookup is needed
  -> Librarian searches records
  -> Librarian returns answer, confidence, and sources
  -> Steward translates the result back into house/persona context
  -> Persona receives usable recollection
```
