# Self Modification

The House is intended to become self-modifying.

This must be designed deliberately. Self-modification is powerful and dangerous:
it lets the House adapt, but it can also break itself, erase important context,
or drift away from User's intent.

## Basic Flow

A possible self-modification loop:

```txt
Persona recognizes a need
  -> Persona talks to resident coder
  -> Resident coder asks clarifying questions if needed
  -> Resident coder proposes a change
  -> Backup or stasis point is created
  -> Change is made in the House directory
  -> Validation runs
  -> Result is reported back into the House
  -> Change is logged
```

## Required Safety Layer

Before autonomous modification is enabled, the House needs:

- Backup creation.
- Restore ability.
- Change logs.
- Permission checks.
- A dry-run or proposal mode.
- Validation or tests where possible.
- A way to freeze autonomous writes.
- A way for User to inspect what changed.

## Stasis Mode

Stasis mode is a protective state where autonomous modification stops.

In stasis:

- Personas may continue simulated life if allowed.
- The resident coder cannot write files.
- Tools that mutate the House are disabled.
- The system preserves current state.
- User can inspect, repair, approve, or restore.

Stasis may be entered manually or automatically after repeated errors, failed
validation, suspicious edits, or uncertainty about the safety of a change.

## Backups

Backups are required if the House can modify itself.

Backup points should exist before:

- Source edits.
- Schema migrations.
- Prompt rewrites.
- Memory compaction changes.
- Permission changes.
- Runtime upgrades.

Backups should be easy to identify by time, reason, and initiating persona.

Example metadata:

```yaml
backup_id: 2026-06-15_0332_resident-coder_notebook-request
created_by: resident-coder
reason: Add workout coach progress notebook
files_changed:
  - notebooks/workout-coach/progress.md
  - config/personas/workout-coach.yaml
```

## Principle

Self-modification should not mean uncontrolled mutation.

The House may learn to build itself, but it needs memory, restraint, audit
trails, and recovery before that becomes real autonomy.

