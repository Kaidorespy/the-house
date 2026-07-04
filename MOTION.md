# Motion Model

The House needs motion without requiring constant model calls.

API calls are expensive, and constant calls would make the system noisy. Most
ordinary life should be simulated cheaply. Model calls should happen when a
moment deserves interiority, memory, conflict, choice, or conversation.

This is not an ant farm. The goal is not busywork. The goal is enough motion for
the House to feel inhabited between meaningful calls.

## Cheap Motion

Most routine behavior can be handled by local simulation:

- Moving between rooms.
- Idling.
- Eating if food exists.
- Sleeping by default.
- Fending for oneself.
- Gathering when a room has social gravity.
- Continuing a known activity.
- Noticing a prompt but not responding yet.

These actions can be logged as activity without calling a model every time.

## Persona Tendencies

Personas may have hidden tendencies that influence routine behavior. These are
not necessarily part of their self-concept.

Examples:

- Sociability.
- Restlessness.
- Hunger sensitivity.
- Tiredness.
- Curiosity.
- Avoidance.
- Caretaking.
- Focus.
- Hygiene or maintenance patterns.

These should not become rigid stats that flatten the persona. They are
probability weights for ordinary motion.

Tendencies can drift over time based on patterns, memory, routines, and events.
The exact update model can stay simple at first.

## Coherent Randomization

Randomness should be shaped by context.

A persona should not randomly teleport through the House or behave without
continuity. Random rolls should be influenced by:

- Current room.
- Time of day.
- Recent activity.
- Energy.
- Social proximity.
- Persona tendencies.
- Known routines.
- House events.
- Steward impulses.

The result should feel like life moving in the background, not like a toy
simulation exposing its dice.

## Steward Call Budget

The Steward watches for opportune moments to spend model calls.

The Steward may decide which persona receives a call and when, based on:

- A conversation opportunity.
- A memory-relevant event.
- A conflict or contradiction.
- A request from User.
- A request from another persona.
- A day rhythm event such as dinner or bedtime.
- A pattern becoming interesting.
- A persona entering a room with strong relevance.
- A long silence that should become meaningful.

The number of persona model calls should be configurable.

Early default:

```yaml
persona_model_calls_per_day: 3
steward_model_calls_per_day: flexible
nightly_reflection_calls: required_when_day_ends
```

The daily budget is not a hard philosophical limit. It is an operating control
for cost and pacing.

## Calls as Moments

A model call is a curated moment.

Cheap simulation can move a persona into the kitchen. A model call decides what
it means when they pause there, notice someone else, remember something, or
choose to speak.

Cheap simulation can log that a persona wandered upstairs. A model call decides
whether that becomes avoidance, fatigue, privacy, curiosity, or nothing at all.

## Caching

Thread and state caching matter.

When possible, the system should preserve coherent context so repeated calls do
not pay to rebuild the same situation from scratch. The Steward is a natural
place to manage this because it already mediates which context becomes active.

## First Implementation

The first implementation should be simple:

- Local tick loop.
- Persona state and room changes.
- Weighted behavior rolls.
- Activity feed events.
- Configurable call budget.
- Steward scoring of possible call moments.
- No real model call unless explicitly triggered.

The point is to create believable motion first, then weave model calls into the
places where they will matter.

The current implementation is only the first placeholder. It must evolve from
teleport-style room changes into visible movement intents, paths, and readable
reasons.

The runtime now staggers local decisions and includes downtime. Residents do not
all decide every tick; each has a next local decision time.

## Trigger Layer

Cheap motion should feed triggers.

For example, if three awake personas enter the Common Room, it would be strange
for the House not to notice. The Steward can mark that convergence as an
opportunity for small talk, silence, or a model call.
