# Known Gaps

This file lists things that may feel unfinished during testing but are not
automatically bugs. Use it to keep the testing pass focused.

## Testing Priority

During testing, fix UI or behavior immediately only when it blocks the test,
hides state, causes accidental data loss, or makes the result impossible to
interpret. Everything else can be recorded here and handled after the House
survives the shake test.

## Intentional Gaps

- Autopilot behavior is still low-resolution. It creates motion and logs, not
deep resident cognition.
- Movement can still feel mechanical. Staggering, pauses, room routes, and
arrival texture are not final.
- Residents do not yet author rich autonomous thought during idle time.
- Group conversation triggers exist as architecture pressure, but the full
model-driven social layer is not built.
- Weekly, monthly, and yearly compression are deferred.
- Embeddings and vector recall are deferred until JSONL memory and consent
contracts prove stable.
- Room editing does not yet support draggable blueprint geometry, doors,
adjacency, room retirement, or room privacy rules.
- Persona residence is manually adjustable, but full file-backed persona config
ownership is still future work.
- The resident coder does not yet have hands.
- Self-modification, stasis mode, and rollback protocols are design targets, not
active resident powers.
- Persona-specific operational notebooks are not built yet.
- Weather is a first outside signal, not a full environmental simulation.
- House mood is early and should be treated as a signal placeholder.
- Visual polish, animation polish, audio, and richer room views are deliberately
behind testing.

## UI Notes To Capture During Testing

Use short notes like:

- `Blocking:` a control prevents a test or hides the result.
- `Ambiguous:` the UI makes it unclear what happened.
- `Risky:` the UI makes destructive action too easy.
- `Polish:` spacing, hierarchy, color, animation, labels, or layout preference.

Blocking, ambiguous, and risky notes can interrupt testing. Polish notes should
usually wait.

## Captured During Testing

- `Polish:` Input fields are single-line `<input>`. Want `Shift+Enter` and
  `Ctrl+J` for newlines; means switching to `<textarea>` with custom Enter
  submit handler.
- `Polish:` Persona replies render as plain text including asterisks. Want
  inline markdown rendering for italics (`*text*`) and bold (`**text**`) in
  room chat and walkie-talkie turns. Plus probably whitespace-preserving
  paragraphs.
