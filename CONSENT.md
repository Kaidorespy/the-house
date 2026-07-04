# Consent To Be Known

The House needs a system-level right to be unknown.

This is not just a privacy setting. It is part of the ethical substrate. The
House may eventually know intimate, compressed, long-running context. User must
retain the ability to restrict, soften, remove, or delete specific knowledge
without trusting every persona prompt to behave.

## Primitive

Memory-bearing records can carry:

```txt
state: known | private | restricted | soft-forgotten | deleted
reason
updatedAt
allowedPersonaIds
allowSteward
allowLibrarian
```

## Meaning

- `known`: normal House knowledge.
- `private`: visible only to explicitly allowed access paths.
- `restricted`: visible only to allowed residents or privileged infrastructure.
- `soft-forgotten`: retained for audit/recovery, but excluded from persona
  context, nightly memory, and Librarian recall.
- `deleted`: removed from active runtime collections and hidden from recall.

## Current Implementation

`HouseEvent`, `PersonaMemoryEntry`, and `LibrarianRecord` can carry consent.

Runtime prompt context and nightly memory filter House events through consent.
The Librarian query path excludes `soft-forgotten` and `deleted` records.
Population memory cards expose a consent selector for captured nightly memories.

## Next Work

- Add consent controls for House events and Librarian records.
- Persist consent mutations as append-only redaction ledger entries.
- Add restricted-access persona allow lists in the UI.
- Add hard deletion across JSONL files with backup-aware tombstones.
