# Outside Signal

The House needs one small signal from the actual world.

This should not become a news feed or a surveillance layer. It is a grounding
primitive: one shared external fact that touches every resident and keeps the
House from becoming hermetic.

## Current Implementation

The runtime stores `outsideSignals`.

The first signal is weather. It uses Open-Meteo when available:

- no API key
- no sign-up
- forecast endpoint
- current precipitation and temperature
- weekly precipitation probability

The default coordinate is Chicago/Central until the House has a location
setting. If the network call fails, the House falls back to a manual signal:

```txt
Rain is the outside signal today.
```

The signal is promoted into the House event log as `outside_signal`, appears in
persona direct-call context, and is included in nightly memory.

## Design Rule

One signal is enough.

The signal should be small enough for everyone in the House to share, but open
enough for each resident to interpret differently.

## Future Work

- Add a location setting.
- Add a daily automatic refresh guard.
- Let the user choose signal type: weather, song, quote, or curated fragment.
- Persist fetched forecast payloads under `state/outside/`.
