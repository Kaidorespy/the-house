# Relationships

Relationship state is the House's first social texture layer.

It is not a full relationship simulator yet. The current layer records small,
source-backed deltas when residents share a meaningful House event.

## Current Shape

Relationship updates are stored in runtime and appended idempotently to:

```txt
state/relationships/updates.jsonl
```

Each update includes:

- deterministic id
- day and time
- source House event id
- from persona and to persona
- valence: warmer, cooler, steady, strained, or unknown
- intensity
- summary
- confidence
- tags
- consent policy

The app loads the archive on startup, validates it, quarantines malformed
records, and merges valid updates by id. The archive can contain later revisions
for the same id; startup keeps the latest revision so consent changes persist.

## Derivation

For now, updates are derived from social House events:

- meal
- gathering
- conversation
- failure

When a House event has at least two resident participants, the runtime creates
directed updates for each resident-to-resident pair. This means Mara's relation
to Vale and Vale's relation to Mara can diverge later, even if today's first
update is symmetrical.

Successful direct-room model replies also create a private source House event
and a directed resident-to-User relationship update. These are private by
default and visible to the resident, Steward, and Librarian rather than the
whole House.

Direct-room transcripts can also be manually filed as relationship context from
the direct-room terminal. This creates a private source House event and a
resident-to-User relationship update with the selected valence. It is testing
input, not inferred autonomy.

## Librarian Index

Each relationship update is indexed into `state/librarian/records.jsonl` as a
`relationship_update` record. The record references its source House event so
future recall can answer not only "what changed?" but "why do we think that?"

Consent is preserved from the source House event. Deleted relationship updates
must not enter prompts or normal recall.

When a relationship update is marked deleted in Population, the runtime removes
it from active visibility, appends a deleted revision to the relationship
archive, and tombstones the matching Librarian record.

Direct persona prompts receive only relationship updates allowed by
`visibilityResolver`. The relationship archive is not prompt context by default.

## UI

The Population screen shows a compact relationship map for the selected resident:

- counterpart
- latest valence
- update count
- average intensity

It also exposes recent relationship update IDs and summaries for debugging.
Those rows include consent controls for known, private, restricted,
soft-forgotten, and deleted.

The selected resident view also includes relationship integrity diagnostics:

- duplicate relationship ids
- missing source House events
- unknown from/to identities
- deleted or soft-forgotten records excluded by consent
- resolver exclusion reasons such as source event hidden, source event missing,
  or not relationship subject

The same view includes a source provenance browser. Selecting a relationship
update shows its source House event id, source activity ids, consent state, and
deterministic Librarian record id.

## Future Work

- Improve direct-room relationship valence with model-authored or transcript
  aware classification instead of the current conservative steady delta.
- Add explicit `relationship_update` creation during nightly/weekly memory
  compression.
- Add a real relationship map view once there is enough data to inspect.
