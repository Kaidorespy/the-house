# House Event Log

The House event log is separate from individual memory.

Activity is noisy telemetry. The House log is the Steward-maintained record of
events that happened to the place: meals, gatherings, private-room boundaries,
guest events, absences, infrastructure changes, season changes, and other
moments that should survive beyond a live activity feed.

## Layers

- Activity feed: high-frequency local motion and UI/system traces.
- House event log: canonical events promoted by the Steward.
- Librarian index: durable searchable records derived from House events.
- Persona memory: subjective daily/weekly/monthly summaries formed through each
  persona's own filter.

## Why It Matters

Two residents can read the same Tuesday differently.

Mara may remember a gathering as meal pressure and care. Vale may remember it as
broken routine or social energy. The House event is the shared source; the
persona memory is the interpretation.

## Current Implementation

`HouseRuntimeState.houseEvents` stores promoted events with:

```txt
day
time
kind
title
summary
stewardNote
sourceActivityIds
roomId
participantPersonaIds
visibility
tags
```

The Steward promotes notable activity into this log. The Librarian indexes House
events as `house_event` records with higher confidence than raw activity.

Direct persona calls receive a separate "Visible House event log" section after
awareness filtering. The Activity tab remains User's full testing feed.

House events are now also appended idempotently to:

```txt
state/house/events.jsonl
```

The app loads this archive on startup, validates it, and merges valid events by
id with local runtime events. Malformed archived events are quarantined by the
Steward instead of crashing the app.

Social House events also seed relationship updates. When a meal, gathering,
conversation, or failure includes multiple resident participants, the runtime
creates directed relationship deltas and stores them in
`state/relationships/updates.jsonl`.

## Future Work

- Add rollback checkpoints tied to House event IDs.
- Let nightly memory read House events first, then local activity second.
- Add explicit absence, guest, meal, and season event creators.
- Promote important House events into knowledge edges: who knows, who heard,
  who was told, and who only inferred.
