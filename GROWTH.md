# Growth Model

The House must be able to grow.

Personas, rooms, tools, notebooks, routines, and subsystems will be added over
time. The architecture should expect expansion instead of treating the first
layout as fixed.

## Personas Over Time

New personas may be added as the House discovers a need or as User introduces
one.

Personas can be:

- Ordinary residents.
- Role-triggered residents.
- Operational specialists.
- Infrastructure personas.

Some personas have explicit trigger roles. For example, a chef matters during
meals. Other personas are defined more by behavior, such as a workout coach who
encourages consistency and notices patterns over time.

Current implementation:

- The Population screen can create a new resident with a name, role, and starting
  room.
- New residents begin with ordinary permissions: observe, speak, and remember.
- Imported memories whose persona does not exist yet appear as unclaimed records.
- Creating a resident from an unclaimed memory uses the imported persona name so
  the memory becomes part of that resident's visible history.
- Existing residents can accumulate aliases, and unclaimed imported memories can
  be claimed as a resident. Exact and fuzzy name matches are suggested before
  manual claim.

## Rooms Over Time

Rooms should also be extensible.

A room is not just a visual region on the blueprint. It may have:

- A name.
- A purpose.
- An atmosphere.
- Occupants.
- Allowed activities.
- Attached tools.
- Attached notebooks or records.
- Special rules.

Rooms can begin simple and become richer later.

## Operational Notebooks

Not all memory is persona memory or Librarian memory.

Some personas need operational records they can open and use. These are working
notebooks, not emotional summaries.

Examples:

- A workout coach may keep progress notes, routines, injury warnings, and
  consistency tracking.
- A chef may keep recipes, preferences, ingredients, and meal history.
- A resident coder may keep implementation notes, system changes, and repair
  history.

Operational notebooks should be structured enough to use, but plain enough to
inspect and edit.

Possible shape:

```txt
notebooks/
  workout-coach/
    progress.md
    routines.md
    constraints.md
  chef/
    recipes.md
    preferences.md
    meal-history.md
  resident-coder/
    change-log.md
    repair-notes.md
```

## Need Recognition

The House should allow needs to surface from within the simulation.

A persona may recognize that a new tool, notebook, room, workflow, or subsystem
would help. They should be able to request it through in-person interaction with
the resident coder or another authorized builder.

The request should include:

- What is needed.
- Why it is needed.
- Who will use it.
- Whether it touches memory, tools, rooms, prompts, or source files.
- What permissions are required.
