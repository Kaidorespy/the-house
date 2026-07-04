# Knowledge Asymmetry

The House must not become a hivemind.

Different residents know different things. Knowledge depends on location,
presence, witness status, permissions, memory access, and whether someone told
the Librarian.

## Principles

- The Steward has broad operational awareness.
- The Librarian knows durable records that were filed or told to her.
- Ordinary residents know what they witnessed, heard, or were told.
- Direct rooms are private unless summarized or filed.
- Room conversations belong to participants and witnesses.
- Dinner and group events create shared knowledge among attendees.
- Asking the Librarian is an action.
- Asking the Steward is different from asking the Librarian.

## Awareness Fields

Personas currently have:

```txt
houseLogAccess: none | summary | full
stewardAccess: none | ask | ambient
librarianAccess: none | ask | write
hearingRange: room | adjacent | house
privateRoomAccess: boolean
```

## Current Implementation

`src/runtime/visibilityResolver.ts` is the current authority for deciding what a
persona can know.

It resolves, for a given persona:

- visible persona memories
- visible House events
- visible relationship updates
- visible recent activity
- visible Librarian records when supplied
- excluded records with debugging reasons
- visible room ids and current awareness assumptions

Direct 1:1 model-call context now uses this resolver.

Direct calls also run a small Librarian token recall before model routing. The
query is built from the resident, User, current room, and the latest message.
Returned records are passed through the same resolver before entering the
prompt, so unpublished/private/restricted/deleted recall does not leak into the
persona context.

Direct prompts also receive a scoped "Visible relationship updates" section.
Relationship updates are visible when consent allows them and the persona either
owns the directed update, can see the source House event, or has Steward /
Librarian / full-house access. Hidden relationship records stay out of prompts.

A resident with full house log access may see broader activity context. A
resident with no house log access sees only narrow personal/user context. A
resident with house-range hearing may see more shared conversation than a
resident who only hears the current room.

Activity events can now carry visibility metadata:

```txt
scope: private | room | adjacent | house | system
roomId: kitchen
actorPersonaId: chef
directWitnessPersonaIds: [steward]
informedPersonaIds: [librarian]
basis: departure visible from origin room
```

The global Activity tab still shows User the full stream for testing, but
persona model-call context only includes events the persona could plausibly
know through authorship, witness presence, explicit informing, hearing range, or
log permissions.

Unclaimed imported memories are excluded from resident visibility until housed
or claimed. Private, restricted, soft-forgotten, and deleted records are excluded
unless the persona has the required access path.

The Population screen includes a diagnostic "Knowledge visibility" section for
the selected resident. It shows ids and counts, including visible relationship
update ids, not hidden content.

This is still an early filter. It should become more precise as doors,
room-to-room adjacency, conversation privacy, and durable knowledge edges
mature.

## Future Knowledge Graph

Later, the House should promote important visibility into explicit knowledge
edges:

```txt
subject: Vale
knowsAbout: room-convo-123
basis: walked in midway
confidence: 0.45
```

This allows recall to answer not just "what happened?" but "who knows?"
