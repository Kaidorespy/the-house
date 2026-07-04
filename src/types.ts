export type FloorId = "ground" | "upstairs";

export type PersonaState =
  | "idle"
  | "thinking"
  | "talking"
  | "acting"
  | "focused"
  | "moving"
  | "asleep";

export type AnthropicModel =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-5-20250929"
  | "claude-sonnet-4-6"
  | "claude-opus-4-5-20251101"
  | "claude-opus-4-7"
  | "claude-opus-4-8";

export interface Room {
  id: string;
  floor: FloorId;
  name: string;
  purpose: string;
  atmosphere: string;
  layout: string;
  furniture: string[];
  items: string[];
  affordances: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Persona {
  id: string;
  name: string;
  aliases?: string[];
  role: string;
  systemPrompt: string;
  roomId: string;
  state: PersonaState;
  activity: string;
  recentThought: string;
  permissions: string[];
  awareness: PersonaAwareness;
  model: AnthropicModel;
  apiEnabled?: boolean;
  nextActionAfterMinute: number;
  goJuice?: boolean;
  movementIntent?: MovementIntent | null;
  marker: {
    x: number;
    y: number;
  };
  tendencies?: PersonaTendencies;
}

export interface MovementIntent {
  fromRoomId: string;
  toRoomId: string;
  reason: string;
  startedAtMinute: number;
  arrivesAtMinute: number;
}

export interface PersonaTendencies {
  sociability: number;
  restlessness: number;
  focus: number;
  caretaking: number;
  solitude: number;
}

export interface PersonaAwareness {
  houseLogAccess: "none" | "summary" | "full";
  stewardAccess: "none" | "ask" | "ambient";
  librarianAccess: "none" | "ask" | "write";
  hearingRange: "room" | "adjacent" | "house";
  privateRoomAccess: boolean;
}

export interface ActivityEvent {
  id: string;
  time: string;
  persona: string;
  text: string;
  visibility?: ActivityVisibility;
}

export type ActivityVisibilityScope = "private" | "room" | "adjacent" | "house" | "system";

export interface ActivityVisibility {
  scope: ActivityVisibilityScope;
  roomId?: string;
  actorPersonaId?: string;
  directWitnessPersonaIds: string[];
  informedPersonaIds: string[];
  basis: string;
}

export type ConsentState = "known" | "private" | "restricted" | "soft-forgotten" | "deleted";

export interface ConsentPolicy {
  state: ConsentState;
  reason?: string;
  updatedAt: string;
  allowedPersonaIds: string[];
  allowSteward: boolean;
  allowLibrarian: boolean;
}

export type HouseEventKind =
  | "meal"
  | "gathering"
  | "absence"
  | "outside_signal"
  | "season"
  | "guest"
  | "infrastructure"
  | "failure"
  | "memory"
  | "conversation"
  | "user"
  | "system";

export interface HouseEvent {
  id: string;
  day: number;
  time: string;
  kind: HouseEventKind;
  title: string;
  summary: string;
  stewardNote: string;
  sourceActivityIds: string[];
  roomId?: string;
  participantPersonaIds: string[];
  visibility: ActivityVisibility;
  consent: ConsentPolicy;
  tags: string[];
}

export interface PersonaMemoryEntry {
  id: string;
  personaId: string;
  personaName: string;
  day: number;
  createdAtMinute: number;
  emotionalResidue: string;
  mechanicalFacts: string[];
  fragments: string[];
  sourceHouseEventIds: string[];
  sourceActivityIds: string[];
  source?: PersonaMemorySource;
  consent: ConsentPolicy;
}

export interface PersonaMemorySource {
  kind: "nightly_ritual" | "external_transcript" | "direct_room" | "manual";
  label: string;
  filePath?: string | null;
  exportedAt?: string;
  compression: "model" | "deterministic" | "manual";
  transcript?: PersonaMemorySourceTurn[];
}

export interface PersonaMemorySourceTurn {
  speaker: string;
  role: "user" | "persona" | "system" | "unknown";
  text: string;
  index: number;
}

export interface OutsideSignal {
  id: string;
  day: number;
  minuteOfDay: number;
  source: "local_clock" | "open_meteo" | "manual";
  title: string;
  summary: string;
  weekSummary?: string;
  season: "winter" | "spring" | "summer" | "autumn";
  timeOfDay: "night" | "morning" | "afternoon" | "evening";
  temperatureF?: number;
  precipitationInches?: number;
  precipitationProbabilityMax?: number;
  createdAt: string;
  consent: ConsentPolicy;
}

export interface HouseMood {
  day: number;
  label: string;
  weight: number;
  stewardNote: string;
  updatedAtMinute: number;
}

export interface ConversationTurn {
  id: string;
  speaker: string;
  text: string;
  /** ISO timestamp in real wall-clock time. */
  timestamp?: string;
  /** House-day at which this turn happened. */
  day?: number;
  /** Minute-of-day in House time. */
  minuteOfDay?: number;
  /** Origin channel: "room" for ambient room speech, "walkie" for 1:1. */
  channel?: "room" | "walkie" | "system";
}

export interface DirectRoom {
  id: string;
  personaId: string;
  title: string;
  turns: ConversationTurn[];
  createdAt: string;
}

export interface RoomConversation {
  id: string;
  roomId: string;
  participantIds: string[];
  witnessIds: string[];
  turns: ConversationTurn[];
  topicSummary: string;
  emotionalTemperature: "quiet" | "warm" | "tense" | "focused" | "strange";
  startedAtMinute: number;
  lastUpdatedMinute: number;
  newcomerPolicy: "overhear_recent" | "social_read_only" | "closed";
  active: boolean;
}

export interface RelationshipUpdate {
  id: string;
  day: number;
  time: string;
  sourceHouseEventId: string;
  fromPersonaId: string;
  fromPersonaName: string;
  toPersonaId: string;
  toPersonaName: string;
  valence: "warmer" | "cooler" | "steady" | "strained" | "unknown";
  intensity: number;
  summary: string;
  confidence: number;
  tags: string[];
  consent: ConsentPolicy;
}

export type LibrarianRecordType =
  | "event"
  | "fact"
  | "fragment"
  | "tombstone"
  | "preference"
  | "relationship"
  | "relationship_update"
  | "shared_experience"
  | "contradiction"
  | "open_question";

export type LibrarianRecordKind =
  | "remembered_day"
  | "memory_fact"
  | "activity"
  | "house_event"
  | "relationship_update"
  | "fragment"
  | "tombstone"
  | "preference"
  | "open_question"
  | "contradiction";

export type CompressionLevel = "raw" | "day" | "week" | "month" | "year";

export interface LibrarianSource {
  kind: "activity" | "house_event" | "persona_memory" | "conversation" | "direct_room" | "room_conversation" | "manual";
  id: string;
  label: string;
}

export interface LibrarianRecord {
  id: string;
  type: LibrarianRecordType;
  kind?: LibrarianRecordKind;
  personaId?: string;
  day?: number;
  timestamp?: string;
  subject: string;
  predicate: string;
  object: string;
  content?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  source: LibrarianSource;
  consent?: ConsentPolicy;
  published?: boolean;
  tags: string[];
  references?: string[];
  embedding?: number[] | null;
  compressionLevel?: CompressionLevel;
  tombstonedRecordId?: string;
  stale: boolean;
}

export interface LibrarianRecallResult {
  query: string;
  records: LibrarianRecord[];
}

export interface RuntimeConfig {
  tickSeconds: number;
  timeMode: "real" | "accelerated" | "paused";
  presenceMode: "observed" | "away";
  absenceStartedDay?: number | null;
  absenceStartedMinute?: number | null;
  acceleratedMinutesPerTick: number;
  personaModelCallsPerDay: number;
  motionEnabled: boolean;
}

export interface HouseRuntimeState {
  rooms: Room[];
  personas: Persona[];
  activity: ActivityEvent[];
  houseEvents: HouseEvent[];
  personaMemories: PersonaMemoryEntry[];
  houseMood?: HouseMood;
  outsideSignals: OutsideSignal[];
  conversation: ConversationTurn[];
  directRooms: DirectRoom[];
  roomConversations: RoomConversation[];
  relationshipUpdates: RelationshipUpdate[];
  triggeredRooms: Record<string, number>;
  processedNightlyMemoryDays: number[];
  day: number;
  minuteOfDay: number;
  callBudgetUsed: number;
  config: RuntimeConfig;
  /** User's current location in the house. Drives room-chat presence. */
  caseyRoomId?: string;
  /** ISO timestamp when User most recently entered his current room. */
  caseyRoomEnteredAt?: string;
}
