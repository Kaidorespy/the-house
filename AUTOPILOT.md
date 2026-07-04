# Autopilot

The current local motion system is only a placeholder.

It gives the House motion, but it is hollow if it remains pure random movement.
The next version needs a steering layer that can cheaply curate movement and
attention without calling expensive models constantly.

## Problem

Teleport-style movement is hard to read.

The House needs to show:

- Who is moving.
- Where they are going.
- Why the movement seems plausible.
- Whether the movement is routine, reactive, or Steward-influenced.

## Movement Intent

Before a persona changes rooms, the runtime should create an intent:

```txt
persona: Mara
from: Kitchen
to: Dining Room
reason: Dinner gravity
duration: 18 seconds
visibility: visible on blueprint
```

The UI can then animate the marker along a path instead of teleporting.

## Current Implementation

Movement now creates a low-resolution intent instead of instantly changing
rooms.

A resident can be:

```txt
state: moving
from: Kitchen
to: Dining Room
reason: meal gravity
arrivesAt: 19:42
```

The persona remains in the origin room until the arrival tick resolves the
intent. This gives the House a believable "before" that a later model call can
interpret in the persona's own voice.

The persona does not author every idle or movement. The procedural runtime
creates rough facts; model calls can later narrate or interpret those facts.

## Staggering and Downtime

Residents should not all roll at the same time.

Each persona needs a next-decision time. When that time arrives, the persona may:

- Keep doing the same thing.
- Enter downtime.
- Make a small local action.
- Move with intent.
- Become a candidate for a model-guided decision.

Downtime is not failure to act. It is part of life in the House. A resident can
conserve energy, keep thinking, stay in a room, or simply let a moment pass.

## Room Context for Decisions

When a persona consciously decides what to do next, the model should receive
specific room context:

- Room purpose.
- Atmosphere.
- Layout.
- Furniture.
- Items.
- Affordances.
- Current occupants.
- Active conversations the persona can plausibly perceive.

This lets a decision be grounded in the actual House instead of generic
free-floating behavior.

## Cheap Curator

A cheap curator can steer autopilot.

Options:

- Local rules only.
- Local Ollama model for low-cost steering.
- Haiku for occasional summaries, nudges, and lightweight social reads.
- Sonnet for more complex moments.

The curator does not need to generate every action. It can periodically review a
bundle of state and suggest direction.

Example bundle:

```txt
Current time.
Room occupancy.
Active conversations.
Recent events.
Persona tendencies.
Open loops.
Steward impulses.
```

Possible curator output:

```json
{
  "motion_biases": [
    { "persona": "Mara", "toward": "Dining Room", "reason": "meal thread" },
    { "persona": "Vale", "toward": "Common Room", "reason": "social convergence" }
  ],
  "call_candidates": [
    { "persona": "The Steward", "reason": "three residents in Common Room" }
  ],
  "summary": "The house is drifting toward a small evening gathering."
}
```

## Retrospective Narration

Haiku may be useful after motion happens, not before every step.

It can look at a short window of activity and produce:

- A cleaner activity summary.
- A possible room conversation seed.
- A Steward nudge.
- A cheap social interpretation.

This lets the House feel more coherent without spending a model call on every
movement.

## Principle

Autopilot should create believable continuity, not fake consciousness.

Model calls are for moments where meaning needs to enter the system.
