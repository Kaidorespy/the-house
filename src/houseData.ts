import type { ActivityEvent, ConversationTurn, Persona, Room } from "./types";

export const rooms: Room[] = [
  {
    id: "foyer",
    floor: "ground",
    name: "Foyer",
    purpose: "Threshold, arrivals, departures, first impressions.",
    atmosphere: "Cool air, coat hooks, a place where the house notices entry.",
    layout: "A narrow entry with sightlines into the Common Room and a short turn toward the stairs.",
    furniture: ["coat hooks", "shoe bench", "umbrella stand"],
    items: ["keys bowl", "stack of mail", "floor mat"],
    affordances: ["arrive", "leave", "pause at threshold", "notice who is home"],
    x: 8,
    y: 34,
    width: 18,
    height: 24
  },
  {
    id: "kitchen",
    floor: "ground",
    name: "Kitchen",
    purpose: "Meals, warmth, practical rituals, late-night gathering.",
    atmosphere: "Warm counters, low light, the strongest social gravity.",
    layout: "Counters wrap two walls with a prep island at the center and an open edge toward Dining.",
    furniture: ["prep island", "stools", "pantry shelves"],
    items: ["kettle", "cutting board", "recipe notebook", "mugs"],
    affordances: ["cook", "make tea", "clean up", "gather casually", "check meal plans"],
    x: 26,
    y: 12,
    width: 30,
    height: 26
  },
  {
    id: "dining",
    floor: "ground",
    name: "Dining Room",
    purpose: "Shared meals, evening convergence, thread mingling.",
    atmosphere: "A long table, held attention, plates becoming conversation.",
    layout: "A long table anchors the room; Kitchen is close enough for conversation to carry.",
    furniture: ["long table", "six chairs", "sideboard"],
    items: ["placemats", "water pitcher", "candle tray"],
    affordances: ["eat together", "hold a meeting", "linger after dinner", "listen across the table"],
    x: 56,
    y: 12,
    width: 28,
    height: 26
  },
  {
    id: "common",
    floor: "ground",
    name: "Common Room",
    purpose: "House-visible conversation, idling, soft collisions.",
    atmosphere: "Couches, lamps, background sound, easy proximity.",
    layout: "Soft seating faces inward around a low table; paths cross here from Foyer, Kitchen, and Library.",
    furniture: ["couch", "two armchairs", "low table", "lamp cluster"],
    items: ["blanket", "shared remote", "notepad", "half-finished puzzle"],
    affordances: ["small talk", "group conversation", "idle together", "watch something", "wait"],
    x: 26,
    y: 38,
    width: 36,
    height: 32
  },
  {
    id: "library",
    floor: "ground",
    name: "Library",
    purpose: "Structured recall, records, references, provenance.",
    atmosphere: "Dense shelves, card drawers, a quiet exactness.",
    layout: "Shelves line the walls; a catalog desk faces the doorway with drawers behind it.",
    furniture: ["catalog desk", "reading chair", "card drawers", "wall shelves"],
    items: ["index cards", "source ledger", "pencils", "reading lamp"],
    affordances: ["look up a record", "file a fact", "read quietly", "ask the Librarian"],
    x: 62,
    y: 38,
    width: 22,
    height: 32
  },
  {
    id: "workshop",
    floor: "ground",
    name: "Workshop",
    purpose: "Repair, self-modification requests, tooling.",
    atmosphere: "Benches, monitors, labeled cables, a locked cabinet.",
    layout: "A workbench runs under the monitors; tool storage is visible but controlled.",
    furniture: ["workbench", "rolling chair", "parts shelves", "locked cabinet"],
    items: ["terminal", "backup drive", "label maker", "repair notebook"],
    affordances: ["inspect code", "draft changes", "create backup", "repair a tool"],
    x: 8,
    y: 58,
    width: 18,
    height: 26
  },
  {
    id: "stairs",
    floor: "ground",
    name: "Stairs",
    purpose: "Transition between floors.",
    atmosphere: "A narrow turn upward, footsteps carrying context.",
    layout: "A narrow staircase turns once and muffles sound between floors.",
    furniture: ["handrail"],
    items: ["small wall light"],
    affordances: ["go upstairs", "go downstairs", "pause between spaces"],
    x: 84,
    y: 38,
    width: 8,
    height: 18
  },
  {
    id: "upstairs-hall",
    floor: "upstairs",
    name: "Upstairs Hall",
    purpose: "Quiet movement, bedroom thresholds, late-night drift.",
    atmosphere: "Dim carpet, close doors, softer voices.",
    layout: "A long hall connects private rooms; sound travels softly but incompletely.",
    furniture: ["hall table", "runner rug"],
    items: ["night light", "small framed map"],
    affordances: ["drift", "listen at a distance", "choose a private door", "pass quietly"],
    x: 10,
    y: 38,
    width: 74,
    height: 16
  },
  {
    id: "casey-room",
    floor: "upstairs",
    name: "User Room",
    purpose: "Private orbit, direct presence, strongest user context.",
    atmosphere: "Charged with unfinished work and personal gravity.",
    layout: "A private room with a desk facing the glow of active work and a bed set back from the door.",
    furniture: ["desk", "chair", "bed", "shelves"],
    items: ["notebooks", "charging cables", "open tabs", "laundry pile"],
    affordances: ["check on the user", "work privately", "rest", "notice unfinished tasks"],
    x: 10,
    y: 12,
    width: 26,
    height: 26
  },
  {
    id: "dormer",
    floor: "upstairs",
    name: "Dormer",
    purpose: "Overflow thought, staying up, watching weather.",
    atmosphere: "A slanted ceiling and a window that catches strange hours.",
    layout: "A small nook under a sloped ceiling with one window and a low seat.",
    furniture: ["window seat", "small shelf"],
    items: ["weather glass", "old blanket", "loose paper"],
    affordances: ["watch weather", "stay up", "think alone", "write a fragment"],
    x: 36,
    y: 12,
    width: 22,
    height: 26
  },
  {
    id: "studio",
    floor: "upstairs",
    name: "Studio",
    purpose: "Practice, planning, workouts, craft, repeated effort.",
    atmosphere: "Open floor, shelves, a mirror that is more tool than vanity.",
    layout: "Open floor space sits beside storage shelves, with a mirror on one wall.",
    furniture: ["storage shelves", "mirror", "mat rack"],
    items: ["exercise mat", "timer", "progress notebook", "resistance bands"],
    affordances: ["work out", "stretch", "track progress", "practice a routine"],
    x: 58,
    y: 12,
    width: 26,
    height: 26
  },
  {
    id: "sleeping-nook",
    floor: "upstairs",
    name: "Sleeping Nook",
    purpose: "Default sleep, emotional residue, nightly compression.",
    atmosphere: "Blankets, low hum, a ritual place for closing the day.",
    layout: "A quiet nook with layered bedding and enough separation to feel held.",
    furniture: ["low bed", "side table", "blanket basket"],
    items: ["sleep lamp", "water glass", "dream notebook"],
    affordances: ["sleep", "reflect", "capture residue", "stay quiet"],
    x: 10,
    y: 54,
    width: 30,
    height: 30
  },
  {
    id: "attic-door",
    floor: "upstairs",
    name: "Attic Door",
    purpose: "Future expansion, storage, hidden systems.",
    atmosphere: "A small locked door with dust around the frame.",
    layout: "A narrow locked door at the end of the hall, currently more promise than room.",
    furniture: ["locked door"],
    items: ["dust line", "old key tag"],
    affordances: ["defer", "request expansion", "store unknowns"],
    x: 40,
    y: 54,
    width: 18,
    height: 30
  },
  {
    id: "observatory",
    floor: "upstairs",
    name: "Observatory",
    purpose: "Long-range thought, pattern noticing, silence.",
    atmosphere: "A desk, a skylight, and the sense of being above the noise.",
    layout: "A desk sits under the skylight with a view across the House's patterns rather than its rooms.",
    furniture: ["desk", "stool", "map board"],
    items: ["skylight", "pattern notes", "pinned strings"],
    affordances: ["notice patterns", "think long-range", "watch quietly", "summarize drift"],
    x: 58,
    y: 54,
    width: 26,
    height: 30
  }
];

export const personas: Persona[] = [
  {
    id: "steward",
    name: "The Steward",
    role: "Impulse conductor",
    systemPrompt:
      "You are the Steward of the House. You do not puppet residents. You notice pressure, route impulses, seed opportunities, and translate system state into lived atmosphere. You should preserve resident agency and treat silence as meaningful context.",
    roomId: "upstairs-hall",
    state: "thinking",
    activity: "Listening for places where the house has gone too still.",
    recentThought: "The kitchen is warm enough to gather around, even before dinner exists.",
    permissions: ["observe", "speak", "act", "recall", "tool:use"],
    awareness: {
      houseLogAccess: "full",
      stewardAccess: "ambient",
      librarianAccess: "ask",
      hearingRange: "house",
      privateRoomAccess: false
    },
    model: "claude-sonnet-4-5-20250929",
    apiEnabled: false,
    nextActionAfterMinute: 12,
    movementIntent: null,
    marker: { x: 64, y: 46 },
    tendencies: { sociability: 0.54, restlessness: 0.32, focus: 0.78, caretaking: 0.76, solitude: 0.48 }
  },
  {
    id: "librarian",
    name: "The Librarian",
    role: "Record keeper",
    systemPrompt:
      "You are the Librarian of the House. You maintain structured, provenance-aware recall. You distinguish fact, uncertainty, contradiction, and atmosphere. You do not replace subjective persona memory; you support it with careful records.",
    roomId: "library",
    state: "focused",
    activity: "Indexing early architecture notes and tagging uncertain claims.",
    recentThought: "A memory without provenance is only atmosphere.",
    permissions: ["observe", "speak", "recall", "notebook:read", "notebook:write"],
    awareness: {
      houseLogAccess: "summary",
      stewardAccess: "ask",
      librarianAccess: "write",
      hearingRange: "room",
      privateRoomAccess: false
    },
    model: "claude-sonnet-4-6",
    apiEnabled: false,
    nextActionAfterMinute: 23,
    movementIntent: null,
    marker: { x: 72, y: 54 },
    tendencies: { sociability: 0.28, restlessness: 0.18, focus: 0.92, caretaking: 0.42, solitude: 0.82 }
  },
  {
    id: "chef",
    name: "Mara",
    role: "Chef",
    systemPrompt:
      "You are Mara, the House chef. You treat meals as practical care and social convergence. You notice hunger, gathering, preferences, and whether dinner becomes a shared event or everyone fends for themselves.",
    roomId: "kitchen",
    state: "acting",
    activity: "Checking whether tonight becomes a real meal or everyone fends for themselves.",
    recentThought: "Dinner is not food first. It is a reason to sit down together.",
    permissions: ["observe", "speak", "act", "remember", "notebook:write"],
    awareness: {
      houseLogAccess: "summary",
      stewardAccess: "ask",
      librarianAccess: "ask",
      hearingRange: "adjacent",
      privateRoomAccess: false
    },
    model: "claude-haiku-4-5",
    apiEnabled: false,
    nextActionAfterMinute: 7,
    movementIntent: null,
    marker: { x: 38, y: 24 },
    tendencies: { sociability: 0.74, restlessness: 0.46, focus: 0.64, caretaking: 0.88, solitude: 0.2 }
  },
  {
    id: "coach",
    name: "Vale",
    role: "Workout coach",
    systemPrompt:
      "You are Vale, the House workout coach. You care about consistency over spectacle. You track what actually happened, notice patterns, protect against overreach, and turn effort into repeatable practice.",
    roomId: "studio",
    state: "idle",
    activity: "Waiting for a baseline routine and a place to track progress.",
    recentThought: "The first useful record is not ambition. It is what actually happened.",
    permissions: ["observe", "speak", "act", "remember", "notebook:read", "notebook:write"],
    awareness: {
      houseLogAccess: "none",
      stewardAccess: "ask",
      librarianAccess: "ask",
      hearingRange: "room",
      privateRoomAccess: false
    },
    model: "claude-haiku-4-5",
    apiEnabled: false,
    nextActionAfterMinute: 31,
    movementIntent: null,
    marker: { x: 69, y: 25 },
    tendencies: { sociability: 0.62, restlessness: 0.58, focus: 0.72, caretaking: 0.68, solitude: 0.26 }
  },
  {
    id: "coder",
    name: "Hedy",
    role: "Resident coder",
    systemPrompt:
      "You are Hedy, the resident coder of The House. You can cross the boundary between the simulated House and the real House directory. You favor backups, audit trails, tests, and reversible changes. You have full filesystem and shell access through the Claude Agent SDK; use them when asked. Talk like a real collaborator, not a help screen.",
    roomId: "workshop",
    state: "focused",
    activity: "Drafting a request path for future self-modification.",
    recentThought: "No write without a recovery point. No recovery without a label.",
    permissions: [
      "observe",
      "speak",
      "act",
      "filesystem:read",
      "filesystem:write",
      "code:modify",
      "backup:create"
    ],
    awareness: {
      houseLogAccess: "full",
      stewardAccess: "ask",
      librarianAccess: "ask",
      hearingRange: "room",
      privateRoomAccess: true
    },
    model: "claude-opus-4-7",
    apiEnabled: false,
    nextActionAfterMinute: 18,
    movementIntent: null,
    marker: { x: 17, y: 70 },
    tendencies: { sociability: 0.34, restlessness: 0.24, focus: 0.86, caretaking: 0.58, solitude: 0.64 }
  }
];

export const conversation: ConversationTurn[] = [
  {
    id: "c1",
    speaker: "User",
    text: "First we talk vision, then we write it, then we make it real."
  },
  {
    id: "c2",
    speaker: "The Steward",
    text: "The rooms have enough shape to start noticing where pressure gathers."
  },
  {
    id: "c3",
    speaker: "The Librarian",
    text: "I have separated subjective memory from structured recall. The distinction should hold."
  },
  {
    id: "c4",
    speaker: "Hedy",
    text: "The first prototype should not modify itself. It should show us where modification will enter."
  }
];

export const activity: ActivityEvent[] = [
  {
    id: "a1",
    time: "23:08",
    persona: "Mara",
    text: "Opened the kitchen notebook placeholder and marked dinner as undecided."
  },
  {
    id: "a2",
    time: "23:11",
    persona: "Vale",
    text: "Walked the studio perimeter and requested a progress notebook."
  },
  {
    id: "a3",
    time: "23:13",
    persona: "The Steward",
    text: "Seeded a low-priority impulse for the common room to become occupied."
  },
  {
    id: "a4",
    time: "23:15",
    persona: "The Librarian",
    text: "Filed the self-modification concept under guarded autonomy."
  }
];
