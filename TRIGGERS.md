# Triggers

Triggers are how ordinary motion becomes an opportunity.

Most House behavior is cheap local simulation. A trigger watches that simulation
and marks moments that may deserve conversation, Steward attention, memory, or a
model call.

## Room Convergence

If three or more awake personas occupy a social room, silence becomes
meaningful.

Social rooms currently include:

- Common Room.
- Kitchen.
- Dining Room.

When convergence happens, the Steward should notice. The result may be:

- Small talk.
- A house-visible conversation prompt.
- A deeper model call for one or more personas.
- Nothing, if the silence itself is the point.

The trigger should have a cooldown so the same room does not spam events.

## User Message

When User speaks into the shared House conversation, the Steward should notice
immediately.

The first implementation does not spend a model call. It records that the
message was heard and marks it for routing. Later, the Steward can decide which
persona should answer, whether the message belongs in house-wide conversation,
whether it should become a one-on-one room, or whether it should be stored as
memory.

## Direct Room Opened

The terminal plus button can open a one-on-one room between User and a selected
persona.

The first implementation creates the room and routes messages as private
conversation state. When `ANTHROPIC_API_KEY` is configured, a message in a
direct room calls the selected persona's configured model. If the key is
missing, the Steward records that no model call was made.

## Model Selection

Each persona can have an assigned model tier.

Early labels:

- Haiku: cheap routine responses and light behavior.
- Sonnet: balanced reasoning, conversation, Steward/Librarian defaults.
- Opus: expensive, reserved for deep reasoning, coding, architecture, or rare
  moments.

The UI can select a model per persona before real routing exists. Later the
model router should combine:

- Persona default model.
- Current moment importance.
- Available call budget.
- Required capability.
- User override.

## Principle

A trigger is not an obligation to call a model.

It is a marked opportunity. The Steward decides whether the moment stays local,
becomes small talk, asks the Librarian, or spends a call.
