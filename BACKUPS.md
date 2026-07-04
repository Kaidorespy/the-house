# Backups

Backups are required before the House becomes self-modifying.

The first backup layer creates timestamped snapshots under:

```txt
backups/
  backup-<timestamp>/
    manifest.json
    config/
    state/
    docs/
```

## Current Behavior

The Create Backup button copies:

- `config/`
- `state/`
- selected root documentation files

The List Backups button reads backup manifests and reports how many are present.

The Restore Selected Backup button restores the selected backup's:

- `config/`
- `state/`

Before restoring, it creates a pre-restore safety backup.

Docs are backed up but not restored by this first restore layer.

Backup manifests include:

- backup id
- creation time
- reason
- copied entries
- whether config/state/docs were included

## Principle

No autonomous writes without recovery points.
