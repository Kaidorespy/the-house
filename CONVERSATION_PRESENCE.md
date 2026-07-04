# Conversation Presence

Room conversation is not paint on the wall.

If people talk in a room, the conversation is an event with participants,
location, start time, partial transcript, and current momentum. A person who
walks in later does not automatically know everything that was said before.

## Room Conversations

A room conversation should track:

- Room id.
- Active participants.
- Start time.
- Recent turns.
- Topic summary.
- Emotional temperature.
- Whether the conversation is public, private, or incidental.
- Whether newcomers are noticed.

## Joining Mid-Conversation

When a persona enters a room with an active conversation, they may receive:

- The last few visible turns if they plausibly heard them.
- A brief social read of the room.
- A cheap summary from the Steward if needed.
- Nothing, if they entered too late or are distracted.

The system should distinguish:

- What happened.
- Who witnessed it.
- Who remembers it.
- Who can later ask the Librarian about it.

## Leaving

When a participant leaves, they carry their own context forward. The room does
not retain their whole subjective interpretation for everyone else.

## Principle

Conversations belong to participants and witnesses, not to the room surface.

## Current Implementation

The runtime stores active `roomConversations`.

When three or more awake residents converge in a social room, the House creates
a room conversation with participants and a Steward seed turn.

When a resident enters later, they are added as a witness. They do not become a
full participant by default and do not automatically inherit the whole prior
conversation.

Direct one-on-one rooms are now file-backed separately from runtime snapshots.
Each direct room is written as:

```txt
state/direct-rooms/<room-id>.json
```

The file is a full transcript snapshot. It updates when the room opens, when
User sends a private turn, and when a resident or Steward response is added.
Startup loads these snapshots and merges missing direct rooms by id.

The direct-room view includes a manual "Compress to memory" control. This turns
the selected transcript into a private persona Day memory with the transcript
attached as source material. It is deterministic for now and does not spend a
model call.

The same view includes manual relationship filing. A transcript can be marked
steady, warmer, cooler, strained, or unknown, producing a private
resident-to-User relationship update with a source House event.
