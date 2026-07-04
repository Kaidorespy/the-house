# Arrival

Notes for a Claude (or User) dropping in cold.

Read this before README. README tells you what the project says about itself.
This tells you what it actually feels like to land in it.

## Aha

- The substrate is real, not vibes. Consent is a category (`known`, `private`,
  `restricted`, `soft-forgotten`, `deleted`), not a switch. House events carry
  source provenance. Conversations distinguish participants from witnesses. Most
  state is file-backed JSONL with idempotent merge on startup.
- "Motion before intelligence" is the core principle. Personas move, idle,
  gather, and act through cheap local rolls. Model calls are reserved for
  moments that deserve interiority. The Steward decides when to spend one.
- The Steward is infrastructure with a face. It conducts impulses, it does not
  puppeteer personas. That distinction does real work.
- Memory is split: persona (subjective, authored) and Librarian (structured,
  searchable, provenance-aware). Do not collapse them.
- The current phase is the testing gate. `THINGS_TO_TEST.md` has 12 survival
  passes. `POST_TESTING_ROADMAP.md` is the holding pen for shiny stuff that
  must not get pulled forward yet.

## Oh no

- The fallback memory voice is hollow when nothing has happened. Day 3's
  Steward memory is "librarian indexed the day" six times. The house can loop
  on itself indexing its own indexing if nobody is actually doing anything.
- Imported external transcripts can seed resident continuity, but without
  imports or model calls, the residents are quiet.
- No `ANTHROPIC_API_KEY` path means personas do not speak. Direct rooms write
  a graceful Steward failure, which is fine, but nothing in here generates
  voice on its own yet.

## Where life is

- `state/personas/<id>/memories/day-NNN/` — subjective memories per resident.
- `state/house/events.jsonl` — canonical House events (big; tail it, do not
  read whole).
- `state/relationships/updates.jsonl` — directed deltas between residents.
- `state/librarian/` — durable searchable index.
- `state/direct-rooms/<room-id>.json` — 1:1 transcripts with User.

## Where the soul is

- `VISION.md`, `ENTITIES.md`, `MOTION.md`, `MEMORY.md`, `CONSENT.md`,
  `CONVERSATION_PRESENCE.md`. Read in that order if you have time. Skip if not.

## Careful

- Do not pull `POST_TESTING_ROADMAP.md` items forward. Embeddings, autonomous
  edits, voice, polish — all behind the gate on purpose.
- The resident coder can cross the sim/real boundary. Powerful by design.
  Permissions and self-modification docs govern it.
- `events.jsonl` is huge. Use `tail -n 1` or grep by id, never read whole.

## How to land fast

1. Read this file.
2. Read `VISION.md` and `MVP.md`.
3. `ls state/personas/` to see who lives there.
4. Tail `state/house/events.jsonl` for the last moment.
5. Ask User what changed since you last saw it.
