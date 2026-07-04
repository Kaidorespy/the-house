# MVP

The MVP is the first usable shell of the House.

## Desktop App

The app must be standalone. It may use web technology internally, but it should
not require opening a browser. Electron or Tauri are likely candidates.

## Main Blueprint Screen

The main screen contains:

- A bird's-eye blueprint of the house.
- Clickable rooms.
- Zoom into a selected room.
- Blinking or animated persona markers showing location.
- Visual state changes for each persona, such as idle, thinking, talking,
  acting, distressed, focused, or asleep.
- A terminal column on the right.
- A wide desktop layout that favors horizontal stacking on large monitors.

The blueprint is the primary interface, not decoration.

## Terminal Column

The right-side terminal has tabs:

- `Conversation`: shared house-visible conversation, likely using a 25-turn
  sliding window.
- `Activity`: recent actions from personas, including mundane actions.

The terminal should also expose a `+` action for creating direct interaction,
starting with one-on-one conversation with a persona.

## Population Screen

The population screen is primarily for testing at first.

It should allow inspection and editing of:

- Persona name and identity.
- Current room.
- Current activity.
- Recent thoughts.
- Recent actions.
- System prompt.
- Memory settings.
- Autonomy settings.
- Read/write or tool access.
- Model/API settings later.

This screen can be utilitarian in the MVP. Its purpose is control and
observability while the runtime is being shaped.

## Motion Before Intelligence

The MVP should support cheap simulated motion before continuous model calls.

Personas can move, idle, gather, act, and update visible state through local
rules. The Steward later decides when a model call is worth spending.
