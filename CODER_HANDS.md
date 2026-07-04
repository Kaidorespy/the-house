# Resident Coder Hands

The resident coder needs hands.

This means controlled ability to inspect and eventually modify the real House
directory. It should not be a raw shell exposed to an autonomous persona.

## First Capability Layer

The first safe layer should include:

- Read approved files.
- List approved directories.
- Propose file edits as patches.
- Create backups before writes.
- Write only inside approved House paths.
- Log every action.
- Enter stasis after errors or suspicious requests.

## Request Path

Resident needs should reach the coder through explicit interaction:

```txt
Persona recognizes need
  -> Persona asks Hedy in-world
  -> Hedy drafts a change request
  -> System creates backup/proposal
  -> User approves or stasis rules allow it
  -> Change is applied
  -> Result is logged into the House
```

## Principle

The coder can change the House, but the House needs recovery, audit, and
boundaries before those hands become autonomous.

