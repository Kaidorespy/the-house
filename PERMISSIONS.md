# Permissions

The House needs a permission model because not every persona should have the
same power.

Permissions should be explicit, inspectable, and changeable.

## Permission Types

Early permission types may include:

- `observe`: inspect house state available to the persona.
- `speak`: participate in conversation.
- `act`: take simulated actions inside rooms.
- `remember`: write subjective persona memory.
- `recall`: ask the Steward and Librarian for recall.
- `notebook:read`: read assigned operational notebooks.
- `notebook:write`: write assigned operational notebooks.
- `tool:use`: use assigned tools.
- `filesystem:read`: read approved House files.
- `filesystem:write`: write approved House files.
- `code:modify`: alter source code or configuration.
- `runtime:restart`: request or perform a restart.
- `backup:create`: create a recovery point.
- `backup:restore`: restore from a recovery point.

This list will grow as the House grows.

## Ordinary Personas

Most personas should have limited permissions:

- Speak.
- Act in the house.
- Write their own subjective memory.
- Ask for recall through the Steward.
- Use assigned notebooks or tools if their role requires it.

They should not modify the House source by default.

## Specialists

Some personas require special access.

Examples:

- Chef: meal planning, recipe notebook, meal events.
- Workout coach: progress notebook, routines, user check-ins.
- Librarian: structured memory records and retrieval.
- Steward: routing, atmosphere, impulses, subsystem mediation.
- Resident coder: controlled access to the actual House directory.

Specialists should receive only the permissions required for their role.

## Resident Coder

The resident coder is explicitly allowed and encouraged to alter the House when
there is a recognized need.

This persona may:

- Read the House directory.
- Edit approved files.
- Create new tools, notebooks, schemas, or rooms.
- Propose architecture changes.
- Run tests or validation.
- Create backups before risky changes.

The resident coder should not be treated as an ordinary autonomous persona. This
role crosses the boundary between simulation and implementation.

