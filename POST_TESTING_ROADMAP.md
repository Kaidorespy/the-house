# Post-Testing Roadmap

This file holds the future vision that should wait until the current bones have been tested. The near-term milestone remains: a persona can speak using only what that persona is allowed to know, and the system can explain why.

## Do Not Pull Forward Yet

These are important, but they should stay behind a dedicated testing pass:

- Embeddings, vector search, or a database replacement for the current JSONL spine.
- Dramatic multi-agent behavior beyond basic room triggers and logged relationship updates.
- Autonomous file editing by residents or the resident coder.
- Heavy visual polish, animation polish, voice, audio, and cinematic presentation.
- Complex onboarding flows.

## House Body

- Add richer room editing: manual blueprint coordinates, room retirement, doors, adjacency, room privacy, and room-specific rules.
- Let rooms hold structured furniture, tools, and affordances that can be included in model context only when relevant.
- Add room zoom views after the blueprint and population panels are stable.
- Build a relationship map view for resident-to-resident and resident-to-User texture.

## Memory And Recall

- Keep the current file-backed memory archive and Librarian JSONL as the first durable spine until they prove their shape under testing.
- Later, add embeddings or a more formal database behind the Librarian without changing the consent and visibility contracts.
- Expand the compression ladder: day memories, weekly perspective summaries, monthly summaries, and yearly plaques.
- Keep fragments as a dream layer and let weekly compression decide what survives.
- Add better import claiming with alias matching, fuzzy match suggestions, and new-resident creation from unclaimed memories.

## Life And Motion

- Use ambient procedural rules for low-resolution movement and action before model calls.
- Add room triggers, such as conversation pressure when several residents gather in the same room.
- Add away-mode rehydration: when User returns, the Steward recomputes a plausible before-state from logs, weather, go-juice, and quiescence.
- Let go-juice opt certain residents into faster background motion during absence.
- Consider cheap or local steering models only after prompt scoping, visibility, and cost boundaries are tested.

## Persona Tools

- Give specific residents operational notebooks: workout progress, chef recipes, coder notes, travel logs, and other role tools.
- Add explicit permission manifests per resident before any resident can affect files or external systems.
- Build the resident coder slowly, with backup creation, scoped diffs, dry-run review, and stasis or rollback controls.

## Outside Signal

- Keep one shared outside signal at first: weather, season, or one curated daily fragment.
- Later, let rooms and residents interpret the signal differently instead of broadcasting a universal mood.
- Expand house mood as a Steward-owned field derived from weather, presence, event log, and the day's residue.

## Failure Voice

- Extend the Steward's graceful-degradation layer so missing models, rate limits, malformed imports, and context overflows are reported in-world.
- Preserve raw technical detail in diagnostics while keeping resident-facing messages coherent.
- Make every repair action leave a House log trace.

## Testing Gate

Before starting this roadmap, test:

- Startup and restart persistence.
- Backup, restore, and safety snapshot creation.
- Direct room prompt scoping through the visibility resolver.
- Consent boundaries for known, private, restricted, soft-forgotten, and deleted records.
- Memory import, claim, quarantine, compression, and file sync.
- Relationship filing, revision, deletion, and visibility.
- Room creation, room editing, and resident room assignment.
