# Unobserved House

The House should not perform full autonomy while User is absent.

Presence is part of the simulation economy. When the House is observed, local
motion can proceed normally. When User is away, most residents become
quiescent and the House dreams through ambient state, House events, and nightly
memory.

## Current Implementation

Runtime config has:

```txt
presenceMode: observed | away
absenceStartedDay
absenceStartedMinute
```

Each persona can also have:

```txt
goJuice: boolean
```

When `presenceMode` is `away`:

- residents without go-juice stop normal motion decisions
- their movement intent clears
- their activity becomes quiescent
- time still advances
- nightly memory can still run
- residents with go-juice keep using normal procedural motion

When presence returns:

- the Steward records a rehydration event
- the House log records the absence/return
- residents receive a simple before-state narration

## Design Rule

The House is alive when User is in it. It dreams when User is not.

Go-juice is the explicit exception for residents who should keep moving fast
during absence.
