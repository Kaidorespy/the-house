import { useEffect, useMemo, useRef, useState } from "react";
import {
  activity as seedActivity,
  conversation as seedConversation,
  personas as seedPersonas,
  rooms as seedRooms
} from "../houseData";
import { validatePersonaMemories } from "./memoryValidation";
import { validateHouseEvents } from "./houseEventValidation";
import { validateRelationshipUpdates } from "./relationshipValidation";
import {
  canAccessConsent,
  resolvePersonaVisibility,
  roomIdsVisibleToPersona as resolverRoomIdsVisibleToPersona
} from "./visibilityResolver";
import type {
  ActivityEvent,
  ActivityVisibilityScope,
  AnthropicModel,
  ConsentPolicy,
  ConsentState,
  ConversationTurn,
  DirectRoom,
  FloorId,
  HouseEvent,
  HouseEventKind,
  HouseMood,
  HouseRuntimeState,
  LibrarianRecord,
  LibrarianRecallResult,
  OutsideSignal,
  Persona,
  PersonaMemoryEntry,
  RelationshipUpdate,
  PersonaState,
  Room,
  RoomConversation,
  RuntimeConfig
} from "../types";

const STORAGE_KEY = "the-house.runtime.v1";
const DEFAULT_CONFIG: RuntimeConfig = {
  tickSeconds: 6,
  timeMode: "real",
  presenceMode: "observed",
  absenceStartedDay: null,
  absenceStartedMinute: null,
  acceleratedMinutesPerTick: 15,
  personaModelCallsPerDay: 12,
  motionEnabled: true
};
const NIGHTLY_MEMORY_MINUTE = 3 * 60 + 32;
const DEFAULT_SLEEP_MINUTE = 3 * 60 + 33;
const DEFAULT_WAKE_MINUTE = 8 * 60;

const notableActivityPatterns = [
  /casey/i,
  /backup/i,
  /restore/i,
  /one-on-one/i,
  /converged/i,
  /conversation/i,
  /model/i,
  /routed/i,
  /filed/i,
  /steward marked/i
];

const downtimePatterns = [
  /stayed with what they were already doing/i,
  /let the room continue/i,
  /downtime/i,
  /conserved energy/i,
  /held a thread quietly/i
];

function normalizeModel(model: unknown): AnthropicModel {
  if (model === "claude-sonnet-4-5-20250929") return "claude-sonnet-4-5-20250929";
  if (model === "claude-opus-4" || model === "claude-opus-4-8") return "claude-opus-4-8";
  if (model === "claude-opus-4-5-20251101") return "claude-opus-4-5-20251101";
  if (model === "claude-opus-4-7") return "claude-opus-4-7";
  if (model === "claude-sonnet-4" || model === "claude-sonnet-4-6") return "claude-sonnet-4-6";
  if (model === "claude-3-5-haiku" || model === "claude-haiku-4-5") return "claude-haiku-4-5";
  return "claude-haiku-4-5";
}

function normalizeRuntimeConfig(config?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
    personaModelCallsPerDay: Math.max(
      config?.personaModelCallsPerDay ?? DEFAULT_CONFIG.personaModelCallsPerDay,
      DEFAULT_CONFIG.personaModelCallsPerDay
    )
  };
}

function maxKnownRuntimeDay(state: Partial<HouseRuntimeState>) {
  let maxDay = state.day ?? 1;
  const include = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      maxDay = Math.max(maxDay, value);
    }
  };

  for (const event of state.houseEvents ?? []) include(event.day);
  for (const memory of state.personaMemories ?? []) include(memory.day);
  for (const update of state.relationshipUpdates ?? []) include(update.day);
  for (const day of state.processedNightlyMemoryDays ?? []) include(day);
  for (const turn of state.conversation ?? []) include(turn.day);
  for (const room of state.directRooms ?? []) {
    for (const turn of room.turns ?? []) include(turn.day);
  }
  for (const conversation of state.roomConversations ?? []) {
    for (const turn of conversation.turns ?? []) include(turn.day);
  }

  return maxDay;
}

function slugId(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "imported"
  );
}

const defaultAwareness = {
  houseLogAccess: "summary" as const,
  stewardAccess: "ask" as const,
  librarianAccess: "ask" as const,
  hearingRange: "room" as const,
  privateRoomAccess: false
};

function defaultConsent(overrides: Partial<ConsentPolicy> = {}): ConsentPolicy {
  return {
    state: "known",
    reason: "",
    updatedAt: new Date().toISOString(),
    allowedPersonaIds: [],
    allowSteward: true,
    allowLibrarian: true,
    ...overrides
  };
}

function normalizeConsent(consent?: ConsentPolicy): ConsentPolicy {
  return {
    ...defaultConsent(),
    ...(consent ?? {}),
    allowedPersonaIds: consent?.allowedPersonaIds ?? []
  };
}

function publishedForConsent(consent?: ConsentPolicy) {
  return normalizeConsent(consent).state === "known";
}

function canPersonaAccessConsent(persona: Persona, consent?: ConsentPolicy) {
  return canAccessConsent(persona, consent).ok;
}

function isConsentVisibleToSystem(consent?: ConsentPolicy) {
  const policy = normalizeConsent(consent);
  return policy.state !== "deleted";
}

function createLibrarianRecord(
  input: Omit<LibrarianRecord, "id" | "createdAt" | "updatedAt" | "stale">
): LibrarianRecord {
  const now = new Date().toISOString();
  const content = input.content ?? input.object;
  return {
    ...input,
    id: `lib-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    content,
    timestamp: input.timestamp ?? now,
    published: input.published ?? publishedForConsent(input.consent),
    references: input.references ?? [],
    embedding: input.embedding ?? null,
    createdAt: now,
    updatedAt: now,
    stale: false
  };
}

function inferActivityTags(event: ActivityEvent) {
  const text = `${event.persona} ${event.text}`.toLowerCase();
  const tags = ["activity"];
  if (text.includes("casey")) tags.push("user");
  if (text.includes("backup")) tags.push("backup");
  if (text.includes("restore")) tags.push("restore");
  if (text.includes("one-on-one") || text.includes("direct")) tags.push("direct_room");
  if (text.includes("converged") || text.includes("conversation")) tags.push("room_conversation");
  if (text.includes("model") || text.includes("routed")) tags.push("model_routing");
  if (downtimePatterns.some((pattern) => pattern.test(event.text))) tags.push("downtime");
  return Array.from(new Set(tags));
}

function activityToLibrarianRecord(event: ActivityEvent, confidence = 0.74): LibrarianRecord {
  return createLibrarianRecord({
    type: "event",
    subject: event.persona,
    predicate: "did_or_observed",
    object: event.text,
    confidence,
    source: {
      kind: "activity",
      id: event.id,
      label: `[${event.time}] ${event.persona}`
    },
    consent: defaultConsent(),
    tags: inferActivityTags(event)
  });
}

function houseEventToLibrarianRecord(event: HouseEvent, confidence = 0.82): LibrarianRecord {
  return createLibrarianRecord({
    type: "event",
    subject: "The House",
    predicate: event.kind,
    object: `${event.title}: ${event.summary}`,
    confidence,
    source: {
      kind: "house_event",
      id: event.id,
      label: `Day ${event.day} ${event.time} / ${event.title}`
    },
    consent: normalizeConsent(event.consent),
    tags: ["house_event", event.kind, ...event.tags]
  });
}

function relationshipUpdateToLibrarianRecord(update: RelationshipUpdate): LibrarianRecord {
  const record = createLibrarianRecord({
    type: "relationship_update",
    kind: "relationship_update",
    personaId: update.fromPersonaId,
    day: update.day,
    subject: update.fromPersonaName,
    predicate: `relationship_to:${update.toPersonaName}`,
    object: update.summary,
    content: update.summary,
    confidence: update.confidence,
    source: {
      kind: "house_event",
      id: update.sourceHouseEventId,
      label: `Relationship update from House event ${update.sourceHouseEventId}`
    },
    consent: normalizeConsent(update.consent),
    published: publishedForConsent(update.consent),
    tags: ["relationship_update", update.valence, ...update.tags],
    references: [update.sourceHouseEventId],
    compressionLevel: "raw"
  });
  record.id = `relationship-${update.id}`;
  return record;
}

function relationshipValence(event: HouseEvent): RelationshipUpdate["valence"] {
  if (event.kind === "meal" || event.tags.includes("meal")) return "warmer";
  if (event.kind === "failure") return "strained";
  if (event.kind === "gathering" || event.kind === "conversation") return "steady";
  return "unknown";
}

function relationshipIntensity(event: HouseEvent) {
  if (event.kind === "meal") return 0.34;
  if (event.kind === "gathering") return 0.24;
  if (event.kind === "conversation") return 0.28;
  if (event.kind === "failure") return 0.18;
  return 0.12;
}

function relationshipUpdatesFromHouseEvent(state: HouseRuntimeState, event: HouseEvent): RelationshipUpdate[] {
  const participantIds = event.participantPersonaIds.filter((id) => id !== "casey");
  if (participantIds.length < 2) return [];
  if (!["meal", "gathering", "conversation", "failure"].includes(event.kind)) return [];

  const updates: RelationshipUpdate[] = [];
  const valence = relationshipValence(event);
  const intensity = relationshipIntensity(event);
  for (const fromPersonaId of participantIds) {
    for (const toPersonaId of participantIds) {
      if (fromPersonaId === toPersonaId) continue;
      const fromPersona = state.personas.find((persona) => persona.id === fromPersonaId);
      const toPersona = state.personas.find((persona) => persona.id === toPersonaId);
      if (!fromPersona || !toPersona) continue;
      updates.push({
        id: `${event.id}-${fromPersonaId}-to-${toPersonaId}`,
        day: event.day,
        time: event.time,
        sourceHouseEventId: event.id,
        fromPersonaId,
        fromPersonaName: fromPersona.name,
        toPersonaId,
        toPersonaName: toPersona.name,
        valence,
        intensity,
        summary: `${fromPersona.name} shared ${event.kind} context with ${toPersona.name}: ${event.title}.`,
        confidence: 0.58,
        tags: ["house_event", event.kind, ...event.tags],
        consent: normalizeConsent(event.consent)
      });
    }
  }
  return updates;
}

function personaMemoryToLibrarianRecords(memory: PersonaMemoryEntry): LibrarianRecord[] {
  const consent = normalizeConsent(memory.consent);
  const published = publishedForConsent(consent);
  const source = {
    kind: "persona_memory" as const,
    id: memory.id,
    label: `${memory.personaName} / Day ${memory.day} memory`
  };
  const tags = [
    "persona_memory",
    `day-${memory.day}`,
    memory.source?.kind ?? "nightly_ritual",
    memory.source?.compression ?? "unknown_compression"
  ];
  const residueRecord = createLibrarianRecord({
      type: "event",
      kind: "remembered_day",
      personaId: memory.personaId,
      day: memory.day,
      subject: memory.personaName,
      predicate: "remembered_day",
      object: `Day ${memory.day}: ${memory.emotionalResidue}`,
      content: memory.emotionalResidue,
      confidence: memory.source?.kind === "external_transcript" ? 0.8 : 0.72,
      source,
      consent,
      published,
      tags,
      references: [...memory.sourceHouseEventIds, ...memory.sourceActivityIds],
      compressionLevel: "day"
  });
  residueRecord.id = `persona-memory-${memory.id}-residue`;
  const records: LibrarianRecord[] = [residueRecord];

  for (const [index, fact] of memory.mechanicalFacts.slice(0, 3).entries()) {
    const factRecord = createLibrarianRecord({
        type: "fact",
        kind: "memory_fact",
        personaId: memory.personaId,
        day: memory.day,
        subject: memory.personaName,
        predicate: "memory_fact",
        object: fact,
        content: fact,
        confidence: memory.source?.kind === "external_transcript" ? 0.86 : 0.76,
        source,
        consent,
        published,
        tags: [...tags, "mechanical_fact"],
        references: [residueRecord.id],
        compressionLevel: "day"
    });
    factRecord.id = `persona-memory-${memory.id}-fact-${index}`;
    records.push(factRecord);
  }

  for (const [index, fragment] of (memory.fragments ?? []).slice(0, 3).entries()) {
    const fragmentRecord = createLibrarianRecord({
      type: "fragment",
      kind: "fragment",
      personaId: memory.personaId,
      day: memory.day,
      subject: memory.personaName,
      predicate: "memory_fragment",
      object: fragment,
      content: fragment,
      confidence: memory.source?.kind === "external_transcript" ? 0.62 : 0.54,
      source,
      consent,
      published,
      tags: [...tags, "fragment"],
      references: [residueRecord.id],
      compressionLevel: "day"
    });
    fragmentRecord.id = `persona-memory-${memory.id}-fragment-${index}`;
    records.push(fragmentRecord);
  }

  return records;
}

function shouldCuratorFile(event: ActivityEvent) {
  if (event.persona === "The Librarian" && /curator filed/i.test(event.text)) {
    return false;
  }
  if (downtimePatterns.some((pattern) => pattern.test(event.text))) {
    return false;
  }
  return notableActivityPatterns.some((pattern) => pattern.test(event.text));
}

function classifyHouseEvent(event: ActivityEvent): {
  kind: HouseEventKind;
  title: string;
  summary: string;
  tags: string[];
} | null {
  const text = event.text;
  if (/integrity layer|offline|unavailable|could not reach|held.*failure|softened/i.test(text)) {
    return {
      kind: "failure",
      title: "The Steward softened a substrate failure",
      summary: text,
      tags: ["failure", "integrity"]
    };
  }
  if (/outside signal|rain|weather|season/i.test(text)) {
    return {
      kind: "outside_signal",
      title: "Outside signal entered the House",
      summary: text,
      tags: ["outside", "weather"]
    };
  }
  if (/User returned|User went away|absence|unobserved/i.test(text)) {
    return {
      kind: "absence",
      title: /returned/i.test(text) ? "User returned to the House" : "The House became unobserved",
      summary: text,
      tags: ["presence", "absence"]
    };
  }
  if (/curator filed|Nightly memory pass/i.test(text)) {
    return {
      kind: "memory",
      title: /Nightly memory pass/i.test(text) ? "Nightly memory pass completed" : "Librarian indexed the day",
      summary: text,
      tags: /Nightly memory pass/i.test(text) ? ["nightly", "memory"] : ["librarian", "index"]
    };
  }
  if (/converged|conversation|gathered/i.test(text)) {
    return {
      kind: "gathering",
      title: "Residents gathered",
      summary: text,
      tags: ["gathering", "conversation"]
    };
  }
  if (/Sent a house-visible message/i.test(text)) {
    return {
      kind: "user",
      title: "User spoke into the house",
      summary: text,
      tags: ["user", "house_channel"]
    };
  }
  if (/one-on-one|direct room/i.test(text)) {
    return {
      kind: "conversation",
      title: "A private room boundary changed",
      summary: text,
      tags: ["direct_room", "private"]
    };
  }
  if (/Created backup|Restored/i.test(text)) {
    return {
      kind: "infrastructure",
      title: /Restored/i.test(text) ? "House state restored" : "House backup created",
      summary: text,
      tags: ["backup", "rollback"]
    };
  }
  if (/meal|dinner|kitchen/i.test(text) && /Mara|Chef|converged|gathered/i.test(`${event.persona} ${text}`)) {
    return {
      kind: "meal",
      title: "Meal gravity shifted",
      summary: text,
      tags: ["meal", "kitchen"]
    };
  }
  return null;
}

function stewardFailureLine(subject: string, reason: "missing_key" | "model_error" | "weather_error" | "runtime_error") {
  if (reason === "missing_key") {
    return `${subject} is present, but the line to their deeper voice is not connected yet. The Steward is holding the room intact until that channel exists.`;
  }
  if (reason === "model_error") {
    return `${subject}'s deeper voice flickered out before it could answer. The Steward has marked the interruption and kept the room from tearing open.`;
  }
  if (reason === "weather_error") {
    return "The outside signal blurred before it reached the windows. The Steward kept today's rain as the shared anchor.";
  }
  return "Something under the floorboards hiccupped. The Steward caught it, named it gently, and kept the House coherent.";
}

function stewardApiDisabledLine(subject: string) {
  return `${subject}'s deeper voice is intentionally unlit right now. The Steward kept the one-on-one room open without spending a model call.`;
}

function stewardFailureActivity(subject: string, reason: string) {
  return `The Steward's integrity layer softened a ${reason} failure for ${subject}; raw substrate details were withheld from the room.`;
}

async function appendLibrarianRecord(record: LibrarianRecord) {
  if (!window.houseRuntime?.librarianAppend) {
    return false;
  }
  await window.houseRuntime.librarianAppend(record);
  return true;
}

async function writePersonaMemoryFile(memory: PersonaMemoryEntry) {
  if (!window.houseRuntime?.writePersonaMemory) {
    return null;
  }
  return window.houseRuntime.writePersonaMemory(memory);
}

async function writePersonaMemoryFiles(memories: PersonaMemoryEntry[]) {
  if (!window.houseRuntime?.writePersonaMemories) {
    return null;
  }
  return window.houseRuntime.writePersonaMemories({ memories });
}

async function appendHouseEventFiles(events: HouseEvent[]) {
  if (!events.length || !window.houseRuntime?.appendHouseEvents) {
    return null;
  }
  const validation = validateHouseEvents(events);
  if (!validation.validEvents.length) {
    return null;
  }
  return window.houseRuntime.appendHouseEvents({ events: validation.validEvents });
}

async function appendRelationshipUpdateFiles(updates: RelationshipUpdate[]) {
  if (!updates.length || !window.houseRuntime?.appendRelationshipUpdates) {
    return null;
  }
  const validation = validateRelationshipUpdates(updates);
  if (!validation.validUpdates.length) {
    return null;
  }
  return window.houseRuntime.appendRelationshipUpdates({ updates: validation.validUpdates });
}

async function appendRelationshipUpdateRevisions(updates: RelationshipUpdate[]) {
  if (!updates.length || !window.houseRuntime?.appendRelationshipUpdateRevisions) {
    return null;
  }
  const validation = validateRelationshipUpdates(updates);
  if (!validation.validUpdates.length) {
    return null;
  }
  return window.houseRuntime.appendRelationshipUpdateRevisions({ updates: validation.validUpdates });
}

async function writeDirectRoomFile(room: DirectRoom) {
  if (!window.houseRuntime?.writeDirectRoom) {
    return null;
  }
  return window.houseRuntime.writeDirectRoom(room);
}

async function writeRoomConfigFile(room: Room) {
  if (!window.houseRuntime?.writeRoomConfig) {
    return null;
  }
  return window.houseRuntime.writeRoomConfig(room);
}

async function writePersonaConfigFile(persona: Persona) {
  if (!window.houseRuntime?.writePersonaConfig) {
    return null;
  }
  return window.houseRuntime.writePersonaConfig(persona);
}

async function writeRoomConversationFile(conversation: RoomConversation) {
  if (!window.houseRuntime?.writeRoomConversation) {
    return null;
  }
  return window.houseRuntime.writeRoomConversation(conversation);
}

/**
 * Find the persona User is implicitly in conversation with, based on the
 * most recent persona reply in the room. Returns null if the thread is stale
 * (too many turns back, too long ago in real time, or User arrived after it).
 */
export function findImplicitAddressee(
  conversation: RoomConversation | null | undefined,
  personas: Persona[],
  options: {
    nowIso?: string;
    caseyEnteredAtIso?: string | null;
    maxTurnAge?: number;
    maxRealTimeMinutes?: number;
  } = {}
): Persona | null {
  if (!conversation || conversation.turns.length === 0) return null;
  const maxTurnAge = options.maxTurnAge ?? 6;
  const maxRealMs = (options.maxRealTimeMinutes ?? 10) * 60 * 1000;
  const now = new Date(options.nowIso ?? new Date().toISOString()).getTime();
  const enteredAt = options.caseyEnteredAtIso
    ? new Date(options.caseyEnteredAtIso).getTime()
    : 0;

  const recent = conversation.turns.slice(-maxTurnAge);
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    if (turn.speaker === "User" || turn.speaker === "The Steward") continue;
    if (turn.timestamp) {
      const turnTime = new Date(turn.timestamp).getTime();
      if (now - turnTime > maxRealMs) return null;
      if (enteredAt && turnTime < enteredAt) return null;
    }
    const lower = turn.speaker.trim().toLowerCase();
    const persona = personas.find(
      (candidate) =>
        candidate.name.toLowerCase() === lower ||
        (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === lower)
    );
    if (persona) return persona;
  }
  return null;
}

/**
 * Match a chat utterance against personas in the room by name and alias,
 * case-insensitive. Returns personas whose name/alias appears as a whole-word
 * token in the text. Used by room chat to detect who User is addressing.
 */
export function parseAddressedPersonas(text: string, personas: Persona[]): Persona[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matched: Persona[] = [];
  for (const persona of personas) {
    const candidates = [persona.name, ...(persona.aliases ?? [])]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const hit = candidates.some((candidate) => {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(candidate)}([^a-z0-9]|$)`, "i");
      return pattern.test(lower);
    });
    if (hit) matched.push(persona);
  }
  return matched;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a persona reply for movement intent. Looks for `[MOVE: Room Name]`
 * (case-insensitive). Returns the matched target room and the reply text with
 * the tag stripped out. The runtime applies the movement.
 */
export function parseReplyMovement(
  reply: string,
  rooms: Room[]
): { cleanedText: string; targetRoomId: string | null } {
  const match = reply.match(/\[MOVE:\s*([^\]]+)\]/i);
  if (!match) return { cleanedText: reply, targetRoomId: null };
  const rawName = match[1].trim().toLowerCase();
  const target = rooms.find(
    (room) => room.name.trim().toLowerCase() === rawName || room.id.toLowerCase() === rawName
  );
  const cleanedText = reply.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    cleanedText: cleanedText || reply.replace(match[0], "").trim(),
    targetRoomId: target?.id ?? null
  };
}

function parseSelfPromptPatch(reply: string): { cleanedText: string; appendText: string | null } {
  const match = reply.match(/\[SELF_PROMPT_APPEND:\s*([\s\S]*?)\]/i);
  if (!match) return { cleanedText: reply, appendText: null };
  const appendText = match[1].trim().slice(0, 1200);
  return {
    cleanedText: reply.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim(),
    appendText: appendText || null
  };
}

const routineActivities: Record<PersonaState, string[]> = {
  idle: [
    "let the room hold them for a while",
    "paused without making a decision",
    "stayed present without turning it into a task"
  ],
  thinking: [
    "followed a private thread",
    "noticed a pattern and did not name it yet",
    "held still long enough for the room to answer back"
  ],
  talking: [
    "made a small comment into the shared air",
    "left a sentence where someone else might pick it up",
    "tested whether the room wanted conversation"
  ],
  acting: [
    "handled a practical detail",
    "moved something closer to usable",
    "completed a small maintenance loop"
  ],
  focused: [
    "kept working without asking to be witnessed",
    "narrowed attention to one clean edge",
    "protected a task from becoming noise"
  ],
  moving: [
    "moved through the house with a simple purpose",
    "crossed from one room toward another",
    "followed a low-resolution intent through the house"
  ],
  asleep: [
    "slept where the day left them",
    "went quiet in place",
    "let the house carry the rest of the hour"
  ]
};

const downtimeActivities = [
  "stayed with what they were already doing",
  "let the room continue without making a new choice",
  "settled into a small pocket of downtime",
  "remained where they were and conserved energy",
  "held a thread quietly instead of acting on it"
];

const roomAffinities: Record<string, string[]> = {
  steward: ["common", "kitchen", "upstairs-hall", "observatory"],
  librarian: ["library", "observatory", "common"],
  chef: ["kitchen", "dining", "common"],
  coach: ["studio", "common", "casey-room"],
  coder: ["workshop", "library", "observatory"]
};

const socialRooms = new Set(["common", "kitchen", "dining"]);
const offscreenSocialRooms = new Set(["common", "kitchen", "dining", "library", "workshop", "studio", "observatory"]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function choose<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function formatTime(minuteOfDay: number) {
  const hours = Math.floor(minuteOfDay / 60) % 24;
  const minutes = minuteOfDay % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function personaIdForName(personas: Persona[], name: string) {
  if (name === "User") return "casey";
  return personas.find((persona) => persona.name === name)?.id;
}

function witnessIdsForRoom(personas: Persona[], roomId: string, actorPersonaId?: string) {
  return personas
    .filter((persona) => persona.roomId === roomId && persona.id !== actorPersonaId && persona.state !== "asleep")
    .map((persona) => persona.id);
}

function stewardId(personas: Persona[]) {
  return personas.find((persona) => persona.id === "steward")?.id;
}

function activityEvent(input: {
  id: string;
  time: string;
  persona: string;
  text: string;
  personas: Persona[];
  roomId?: string;
  scope?: ActivityVisibilityScope;
  actorPersonaId?: string;
  informedPersonaIds?: string[];
  basis: string;
}): ActivityEvent {
  const actorPersonaId = input.actorPersonaId ?? personaIdForName(input.personas, input.persona);
  const directWitnessPersonaIds = input.roomId
    ? witnessIdsForRoom(input.personas, input.roomId, actorPersonaId)
    : [];
  const steward = stewardId(input.personas);
  const informedPersonaIds = Array.from(
    new Set([...(input.informedPersonaIds ?? []), ...(steward ? [steward] : [])])
  ).filter((id) => id !== actorPersonaId);

  return {
    id: input.id,
    time: input.time,
    persona: input.persona,
    text: input.text,
    visibility: {
      scope: input.scope ?? (input.roomId ? "room" : "system"),
      roomId: input.roomId,
      actorPersonaId,
      directWitnessPersonaIds,
      informedPersonaIds,
      basis: input.basis
    }
  };
}

function roomIdsVisibleToPersona(state: HouseRuntimeState, persona: Persona) {
  return resolverRoomIdsVisibleToPersona(state.rooms, persona);
}

function canPersonaSeeActivity(state: HouseRuntimeState, persona: Persona, event: ActivityEvent) {
  const awareness = persona.awareness ?? defaultAwareness;
  const visibility = event.visibility;
  const personaId = persona.id;

  if (!visibility) {
    if (awareness.houseLogAccess === "full") return true;
    if (awareness.houseLogAccess === "summary") {
      return (
        event.persona === persona.name ||
        event.persona === "User" ||
        event.persona === "The Steward" ||
        /conversation|converged|backup|restore|one-on-one/i.test(event.text)
      );
    }
    return event.persona === persona.name || event.persona === "User";
  }

  if (visibility.actorPersonaId === personaId || visibility.directWitnessPersonaIds.includes(personaId)) {
    return true;
  }
  if (visibility.informedPersonaIds.includes(personaId)) {
    return true;
  }
  if (visibility.scope === "private") {
    return persona.awareness.privateRoomAccess && awareness.houseLogAccess === "full";
  }
  if (visibility.scope === "system") {
    return awareness.houseLogAccess !== "none" || visibility.informedPersonaIds.includes(personaId);
  }
  if (visibility.scope === "house") {
    return awareness.houseLogAccess === "full" || awareness.hearingRange === "house";
  }
  if (visibility.roomId) {
    return roomIdsVisibleToPersona(state, persona).has(visibility.roomId);
  }
  return awareness.houseLogAccess === "full";
}

function canPersonaSeeHouseEvent(state: HouseRuntimeState, persona: Persona, event: HouseEvent) {
  if (!canPersonaAccessConsent(persona, event.consent)) {
    return false;
  }
  return canPersonaSeeActivity(state, persona, {
    id: event.id,
    time: event.time,
    persona: "The Steward",
    text: event.summary,
    visibility: event.visibility
  });
}

function promoteHouseEvents(
  state: HouseRuntimeState,
  events: ActivityEvent[],
  day: number
): HouseEvent[] {
  const existingSourceIds = new Set(
    state.houseEvents.flatMap((event) => event.sourceActivityIds)
  );
  const promoted: HouseEvent[] = [];

  for (const event of events) {
    if (existingSourceIds.has(event.id)) continue;
    const classification = classifyHouseEvent(event);
    if (!classification) continue;

    const visibility = event.visibility ?? {
      scope: "system" as const,
      directWitnessPersonaIds: [],
      informedPersonaIds: [],
      basis: "legacy activity promoted by steward"
    };
    const participantPersonaIds = Array.from(
      new Set([
        visibility.actorPersonaId,
        ...visibility.directWitnessPersonaIds,
        ...visibility.informedPersonaIds
      ].filter((id): id is string => Boolean(id) && id !== "casey"))
    );

    promoted.push({
      id: `house-event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      day,
      time: event.time,
      kind: classification.kind,
      title: classification.title,
      summary: classification.summary,
      stewardNote: `Promoted from activity because ${classification.tags.join(", ")} matters to the House layer.`,
      sourceActivityIds: [event.id],
      roomId: visibility.roomId,
      participantPersonaIds,
      visibility,
      consent: defaultConsent(),
      tags: classification.tags
    });
  }

  return promoted;
}

function memoryTone(persona: Persona) {
  if (persona.id === "chef") return "care, appetite, and whether people came together";
  if (persona.id === "coach") return "consistency, energy, and what the body was asked to carry";
  if (persona.id === "coder") return "risk, repair, and whether the House stayed reversible";
  if (persona.id === "librarian") return "provenance, uncertainty, and what became worth keeping";
  if (persona.id === "steward") return "pressure, silence, and where the House wanted motion";
  return "presence, friction, and what stayed unresolved";
}

function extractFragments(candidates: string[], limit = 3) {
  return candidates
    .map((candidate) => compactText(candidate, 180))
    .filter((candidate) => candidate.length > 24)
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .slice(0, limit);
}

function createPersonaMemory(
  state: HouseRuntimeState,
  persona: Persona,
  minuteOfDay: number,
  authoredResidue?: string,
  authoredFacts?: string[]
): PersonaMemoryEntry {
  const visibleHouseEvents = state.houseEvents
    .filter((event) => event.day === state.day && canPersonaSeeHouseEvent(state, persona, event))
    .slice(0, 6);
  const visibleActivity = state.activity
    .filter((event) => canPersonaSeeActivity(state, persona, event))
    .slice(0, 6);
  const outsideSignal = state.outsideSignals.find(
    (signal) => signal.day === state.day && canPersonaAccessConsent(persona, signal.consent)
  );
  const roomsTouched = new Set(
    [
      persona.roomId,
      ...visibleHouseEvents.map((event) => event.roomId).filter((roomId): roomId is string => Boolean(roomId)),
      ...visibleActivity
        .map((event) => event.visibility?.roomId)
        .filter((roomId): roomId is string => Boolean(roomId))
    ]
  );
  const roomNames = Array.from(roomsTouched)
    .map((roomId) => state.rooms.find((room) => room.id === roomId)?.name ?? roomId)
    .slice(0, 3);
  const eventPhrase = visibleHouseEvents.length
    ? visibleHouseEvents.map((event) => event.title.toLowerCase()).join(", ")
    : "no large House event reached them clearly";
  const activityPhrase = visibleActivity[0]?.text ?? persona.activity;
  const outsidePhrase = outsideSignal
    ? ` The outside signal was ${outsideSignal.title.toLowerCase()}: ${outsideSignal.summary}`
    : "";

  return {
    id: `memory-${state.day}-${persona.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    personaId: persona.id,
    personaName: persona.name,
    day: state.day,
    createdAtMinute: minuteOfDay,
    emotionalResidue: authoredResidue?.trim() || `${persona.name} ended day ${state.day} carrying ${memoryTone(persona)}. The day reached them through ${eventPhrase}.${outsidePhrase} They were last held by ${roomNames.join(", ") || "the House"}, with the surface of the day reading as: ${activityPhrase}`,
    mechanicalFacts: (authoredFacts?.length ? authoredFacts : [
      ...(outsideSignal ? [`outside: ${outsideSignal.title}`] : []),
      ...visibleHouseEvents.slice(0, 2).map((event) => `${event.kind}: ${event.title}`),
      ...visibleActivity
        .filter((event) => /backup|restore|one-on-one|User|converged|arrived|moving/i.test(event.text))
        .slice(0, 2)
        .map((event) => `${event.time} ${event.persona}: ${event.text}`)
    ]).slice(0, 4),
    fragments: extractFragments([
      ...visibleActivity.slice(1, 5).map((event) => `${event.time} ${event.persona}: ${event.text}`),
      ...visibleHouseEvents.slice(1, 4).map((event) => `${event.time} ${event.title}`)
    ]),
    sourceHouseEventIds: visibleHouseEvents.map((event) => event.id),
    sourceActivityIds: visibleActivity.map((event) => event.id),
    source: {
      kind: "nightly_ritual",
      label: `${persona.name} day ${state.day} bedtime memory`,
      compression: authoredResidue?.trim() ? "model" : "deterministic"
    },
    consent: defaultConsent()
  };
}

function deriveHouseMood(state: HouseRuntimeState): HouseMood {
  const todayEvents = state.houseEvents.filter((event) => event.day === state.day).slice(0, 12);
  const outsideSignal = state.outsideSignals.find((signal) => signal.day === state.day);
  const hasFailure = todayEvents.some((event) => event.kind === "failure");
  const hasGathering = todayEvents.some((event) => event.kind === "gathering" || event.kind === "meal");
  const away = state.config.presenceMode === "away";
  const wet = Boolean(outsideSignal && /rain|drizzle|storm|precip/i.test(`${outsideSignal.title} ${outsideSignal.summary}`));
  const weight = clamp(
    0.42 +
      (hasGathering ? 0.16 : 0) +
      (wet ? 0.08 : 0) -
      (hasFailure ? 0.12 : 0) -
      (away ? 0.1 : 0),
    0,
    1
  );
  const label = hasFailure
    ? "braced"
    : away
      ? "dreaming"
      : hasGathering
        ? "warm"
        : wet
          ? "rain-held"
          : "quiet";

  return {
    day: state.day,
    label,
    weight,
    stewardNote: `The House feels ${label}; weight ${weight.toFixed(2)} from ${[
      outsideSignal?.title,
      hasGathering ? "gathering" : "",
      hasFailure ? "failure pressure" : "",
      away ? "absence" : ""
    ].filter(Boolean).join(", ") || "ordinary drift"}.`,
    updatedAtMinute: state.minuteOfDay
  };
}

function runNightlyMemoryPass(state: HouseRuntimeState, minuteOfDay: number) {
  if (state.processedNightlyMemoryDays.includes(state.day)) {
    return state;
  }

  const memories = state.personas.map((persona) => createPersonaMemory(state, persona, minuteOfDay));
  const activity = activityEvent({
    id: `nightly-memory-${state.day}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: formatTime(minuteOfDay),
    persona: "The Steward",
    text: `Nightly memory pass captured day ${state.day} residue for ${memories.length} resident${memories.length === 1 ? "" : "s"}.`,
    personas: state.personas,
    scope: "system",
    informedPersonaIds: state.personas.map((persona) => persona.id),
    basis: "3:32 nightly memory ritual"
  });

  const nextState = {
    ...state,
    personaMemories: [...memories, ...state.personaMemories].slice(0, 220),
    processedNightlyMemoryDays: [...state.processedNightlyMemoryDays, state.day].slice(-32),
    activity: [activity, ...state.activity].slice(0, 80)
  };
  const mood = deriveHouseMood(nextState);
  const promoted = promoteHouseEvents(nextState, [activity], state.day);

  return {
    ...nextState,
    houseMood: mood,
    houseEvents: [...promoted, ...nextState.houseEvents].slice(0, 120)
  };
}

function bedtimeMemoryPrompt(state: HouseRuntimeState, persona: Persona) {
  const visibleHouseEvents = state.houseEvents
    .filter((event) => event.day === state.day && canPersonaSeeHouseEvent(state, persona, event))
    .slice(0, 8)
    .map((event) => `- ${event.time} / ${event.kind} / ${event.title}: ${event.summary}`)
    .join("\n");
  const visibleActivity = state.activity
    .filter((event) => canPersonaSeeActivity(state, persona, event))
    .slice(0, 10)
    .map((event) => `- ${event.time} / ${event.persona}: ${event.text}`)
    .join("\n");
  const outsideSignal = state.outsideSignals.find(
    (signal) => signal.day === state.day && canPersonaAccessConsent(persona, signal.consent)
  );

  return [
    persona.systemPrompt,
    "",
    "It's 3:32 in the House. Bedtime memory ritual.",
    "",
    "The conversations and events of today already passed through you. What you said, what was said back, what crossed your awareness — that's the day you actually had. You're not reconstructing a stranger's afternoon. You're remembering your own.",
    "",
    "Write your memory now, in your own voice. First person. Not a summary written by an external narrator.",
    "",
    "Return exactly this format:",
    "EMOTIONAL_RESIDUE: one paragraph, what stays with you",
    "MECHANICAL_FACTS: zero to three sparse factual bullets separated by semicolons",
    "",
    "If the day was quiet, let the quietness matter. Don't invent events to fill space.",
    "",
    "For reference, here is what was visible to you today:",
    "",
    `Resident: ${persona.name}`,
    `Role: ${persona.role}`,
    `Current state: ${persona.state}`,
    `Current room: ${state.rooms.find((room) => room.id === persona.roomId)?.name ?? persona.roomId}`,
    `Current activity: ${persona.activity}`,
    "",
    "Outside signal:",
    outsideSignal
      ? `${outsideSignal.title}: ${outsideSignal.summary} ${outsideSignal.weekSummary ?? ""}`.trim()
      : "None visible.",
    "",
    "Visible House event log:",
    visibleHouseEvents || "None visible.",
    "",
    "Visible activity:",
    visibleActivity || "None visible."
  ].join("\n");
}

function parseBedtimeMemoryResponse(text: string) {
  const residueMatch = text.match(/EMOTIONAL_RESIDUE:\s*([\s\S]*?)(?:\n\s*MECHANICAL_FACTS:|$)/i);
  const factsMatch = text.match(/MECHANICAL_FACTS:\s*([\s\S]*)$/i);
  const emotionalResidue = (residueMatch?.[1] ?? text).trim();
  const mechanicalFacts = (factsMatch?.[1] ?? "")
    .split(/[;\n]/)
    .map((fact) => fact.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);

  return { emotionalResidue, mechanicalFacts };
}

function compactText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 3).trim()}...`;
}

function importedExportToMemory(
  data: unknown,
  filePath: string | null,
  day: number,
  minuteOfDay: number
): PersonaMemoryEntry {
  const exportData = data as {
    room_name?: string;
    exported?: string;
    messages?: Array<{
      content?: string;
      speaker_id?: string;
      speaker_name?: string;
      message_type?: string;
    }>;
  };
  const personaName = exportData.room_name?.trim() || "Imported persona";
  const personaId = slugId(personaName);
  const messages = Array.isArray(exportData.messages) ? exportData.messages : [];
  const personaMessages = messages.filter(
    (message) => message.speaker_id !== "user" && message.speaker_name !== "Kaido"
  );
  const userMessages = messages.filter(
    (message) => message.speaker_id === "user" || message.speaker_name === "Kaido"
  );
  const transcript = messages
    .map((message, index) => {
      const speaker = message.speaker_name?.trim() || message.speaker_id?.trim() || "Unknown";
      const isUser = message.speaker_id === "user" || message.speaker_name === "Kaido";
      const isPersona = !isUser && Boolean(message.content?.trim());
      return {
        speaker,
        role: isUser ? "user" as const : isPersona ? "persona" as const : "unknown" as const,
        text: message.content?.trim() ?? "",
        index
      };
    })
    .filter((turn) => turn.text);
  const personaLines = transcript.filter((turn) => turn.role === "persona");
  const userLines = transcript.filter((turn) => turn.role === "user");
  const strongestPersonaLines = personaLines
    .map((turn) => compactText(turn.text, 220))
    .filter(Boolean)
    .slice(-4);
  const fragmentSource = transcript
    .filter((turn) => !strongestPersonaLines.includes(compactText(turn.text, 220)))
    .map((turn) => `${turn.speaker}: ${turn.text}`);
  const residue =
    strongestPersonaLines.length > 0
      ? `${personaName} carried a private 1:1 thread with User. In compression, the day resolves around: ${strongestPersonaLines.join(" ")}`
      : transcript.length > 0
        ? `${personaName} has a 1:1 transcript from User, but the import could not clearly separate persona speech from user speech. The source transcript remains attached for manual review.`
        : `${personaName} has an imported day transcript, but the export did not contain readable message content.`;

  return {
    id: `imported-memory-${personaId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    personaId,
    personaName,
    day,
    createdAtMinute: minuteOfDay,
    emotionalResidue: compactText(residue, 1200),
    mechanicalFacts: [
      "compressed from external 1:1 transcript",
      `imported from ${filePath ?? "selected JSON export"}`,
      `exported at ${exportData.exported ?? "unknown time"}`,
      `${messages.length} messages; ${userMessages.length} from user; ${personaMessages.length} from ${personaName}`
    ],
    fragments: extractFragments(fragmentSource),
    sourceHouseEventIds: [],
    sourceActivityIds: [],
    source: {
      kind: "external_transcript",
      label: `${personaName} transcript import`,
      filePath,
      exportedAt: exportData.exported,
      compression: "deterministic",
      transcript: transcript.slice(0, 80)
    },
    consent: defaultConsent({ reason: "Imported external memory export" })
  };
}

function directRoomToMemory(
  state: HouseRuntimeState,
  room: DirectRoom,
  persona: Persona
): PersonaMemoryEntry {
  const transcript = room.turns
    .map((turn, index) => ({
      speaker: turn.speaker,
      role: turn.speaker === "User"
        ? "user" as const
        : turn.speaker === persona.name
          ? "persona" as const
          : turn.speaker === "The Steward"
            ? "system" as const
            : "unknown" as const,
      text: turn.text,
      index
    }))
    .filter((turn) => turn.text.trim());
  const personaLines = transcript
    .filter((turn) => turn.role === "persona")
    .map((turn) => compactText(turn.text, 220))
    .slice(-4);
  const caseyLines = transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => compactText(turn.text, 180))
    .slice(-3);
  const residue = personaLines.length
    ? `${persona.name} carried a private direct-room thread with User. The compression keeps the exchange as a source-backed memory rather than a public House event: ${personaLines.join(" ")}`
    : `${persona.name} has a private direct-room transcript with User, but no resident-authored reply was available yet. The transcript remains attached as source material.`;

  return {
    id: `direct-memory-${room.id}-${room.turns.length}`,
    personaId: persona.id,
    personaName: persona.name,
    day: state.day,
    createdAtMinute: state.minuteOfDay,
    emotionalResidue: compactText(residue, 1200),
    mechanicalFacts: [
      `compressed from direct room ${room.id}`,
      `${room.turns.length} turns in source transcript`,
      ...(caseyLines.length ? [`User thread: ${caseyLines.join(" / ")}`] : [])
    ].slice(0, 4),
    fragments: extractFragments(transcript.map((turn) => `${turn.speaker}: ${turn.text}`)),
    sourceHouseEventIds: state.houseEvents
      .filter((event) => event.tags.includes("direct_room") && event.participantPersonaIds.includes(persona.id))
      .map((event) => event.id)
      .slice(0, 4),
    sourceActivityIds: state.activity
      .filter((event) => event.visibility?.basis.includes("direct") && event.visibility.informedPersonaIds.includes(persona.id))
      .map((event) => event.id)
      .slice(0, 4),
    source: {
      kind: "direct_room",
      label: `${room.title} transcript compression`,
      filePath: `state/direct-rooms/${slugId(room.id)}.json`,
      compression: "deterministic",
      transcript: transcript.slice(0, 80)
    },
    consent: defaultConsent({
      state: "private",
      reason: "Compressed from private direct-room transcript.",
      allowedPersonaIds: [persona.id]
    })
  };
}

function markerForRoom(rooms: Room[], roomId: string) {
  const room = rooms.find((candidate) => candidate.id === roomId) ?? rooms[0];
  return {
    x: clamp(room.x + room.width * (0.34 + Math.random() * 0.32), room.x + 3, room.x + room.width - 3),
    y: clamp(room.y + room.height * (0.34 + Math.random() * 0.32), room.y + 3, room.y + room.height - 3)
  };
}

function uniquePersonaId(personas: Persona[], name: string) {
  const baseId = slugId(name);
  const existingIds = new Set(personas.map((persona) => persona.id));
  if (!existingIds.has(baseId)) return baseId;

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

function uniqueRoomId(rooms: Room[], name: string) {
  const baseId = slugId(name);
  const existingIds = new Set(rooms.map((room) => room.id));
  if (!existingIds.has(baseId)) return baseId;

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

function splitList(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRoom(room: Partial<Room> | null | undefined, fallback: Room): Room {
  return {
    id: room?.id || fallback.id,
    floor: room?.floor === "upstairs" ? "upstairs" : "ground",
    name: room?.name ?? fallback.name,
    purpose: room?.purpose ?? fallback.purpose,
    atmosphere: room?.atmosphere ?? fallback.atmosphere,
    layout: room?.layout ?? fallback.layout,
    furniture: splitList(room?.furniture),
    items: splitList(room?.items),
    affordances: splitList(room?.affordances),
    x: finiteNumber(room?.x, fallback.x),
    y: finiteNumber(room?.y, fallback.y),
    width: finiteNumber(room?.width, fallback.width),
    height: finiteNumber(room?.height, fallback.height)
  };
}

function normalizeRooms(rooms: Partial<Room>[] | null | undefined, fallbackRooms = seedRooms): Room[] {
  const fallbacksById = new Map(fallbackRooms.map((room) => [room.id, room]));
  const fallback = fallbackRooms[0] ?? {
    id: "room",
    floor: "ground" as const,
    name: "Room",
    purpose: "A room waiting for purpose.",
    atmosphere: "The air has not settled yet.",
    layout: "No layout notes yet.",
    furniture: [],
    items: [],
    affordances: [],
    x: 8,
    y: 10,
    width: 18,
    height: 20
  };
  return (rooms?.length ? rooms : fallbackRooms).map((room) =>
    normalizeRoom(room, fallbacksById.get(room?.id ?? "") ?? fallback)
  );
}

function defaultRoomPlacement(rooms: Room[], floor: FloorId) {
  const count = rooms.filter((room) => room.floor === floor).length;
  const column = count % 4;
  const row = Math.floor(count / 4) % 3;
  return {
    x: 8 + column * 22,
    y: 10 + row * 26,
    width: 18,
    height: 20
  };
}

function normalizeIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function identityDistance(a: string, b: string) {
  const left = normalizeIdentity(a);
  const right = normalizeIdentity(b);
  if (!left) return right.length;
  if (!right) return left.length;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
  }
  return rows[left.length][right.length];
}

function personaIdentityNames(persona: Persona) {
  return [persona.name, ...(persona.aliases ?? [])].filter(Boolean);
}

function createNewPersona(input: {
  personas: Persona[];
  rooms: Room[];
  name: string;
  role: string;
  roomId: string;
  minuteOfDay: number;
}): Persona {
  const name = input.name.trim() || "New resident";
  const role = input.role.trim() || "Resident";
  const roomId = input.rooms.some((room) => room.id === input.roomId) ? input.roomId : input.rooms[0]?.id ?? "common";

  return {
    id: uniquePersonaId(input.personas, name),
    name,
    aliases: [],
    role,
    systemPrompt:
      `You are ${name}, a resident of the House. Your role is ${role}. ` +
      "Stay grounded in your room, your own knowledge, and the permissions you have been given. " +
      "Do not assume access to private memory, hidden tools, or other residents' interiority.",
    roomId,
    state: "idle",
    activity: "Newly added to the House and waiting for a first local rhythm.",
    recentThought: "I need a room, a habit, and a reason to move.",
    permissions: ["observe", "speak", "remember"],
    awareness: { ...defaultAwareness },
    model: "claude-haiku-4-5",
    apiEnabled: false,
    nextActionAfterMinute: (input.minuteOfDay + 20 + Math.floor(Math.random() * 30)) % 1440,
    goJuice: false,
    movementIntent: null,
    marker: markerForRoom(input.rooms, roomId),
    tendencies: {
      sociability: 0.45,
      restlessness: 0.35,
      focus: 0.5,
      caretaking: 0.35,
      solitude: 0.45
    }
  };
}

function minutesUntilNextAction(persona: Persona, state: PersonaState) {
  const tendencies = persona.tendencies;
  const base = persona.goJuice
    ? state === "asleep" ? 45 : state === "focused" ? 14 : state === "idle" ? 8 : 10
    : state === "asleep" ? 90 : state === "focused" ? 42 : state === "idle" ? 26 : 34;
  const restlessness = tendencies ? tendencies.restlessness : 0.4;
  const variation = Math.floor(Math.random() * (persona.goJuice ? 7 : 18));
  return Math.max(persona.goJuice ? 3 : 8, Math.round(base - restlessness * (persona.goJuice ? 6 : 16) + variation));
}

function movementDurationMinutes(fromRoomId: string, toRoomId: string) {
  if (fromRoomId === toRoomId) return 0;
  const fromRoom = seedRooms.find((room) => room.id === fromRoomId);
  const toRoom = seedRooms.find((room) => room.id === toRoomId);
  if (!fromRoom || !toRoom) return 12;
  const sameFloor = fromRoom.floor === toRoom.floor;
  return sameFloor ? 12 + Math.floor(Math.random() * 10) : 20 + Math.floor(Math.random() * 14);
}

function movementReason(persona: Persona, fromRoomId: string, toRoomId: string, minuteOfDay: number) {
  const toRoom = seedRooms.find((room) => room.id === toRoomId);
  const hour = Math.floor(minuteOfDay / 60) % 24;
  if (persona.id === "chef" && (toRoomId === "kitchen" || toRoomId === "dining")) {
    return "meal gravity";
  }
  if (hour >= 19 && hour <= 23 && ["kitchen", "dining", "common"].includes(toRoomId)) {
    return "evening social drift";
  }
  if (toRoom?.affordances.includes("sleep")) return "rest pressure";
  if (toRoom?.affordances.includes("notice patterns")) return "pattern-seeking";
  if (toRoom?.affordances.includes("inspect code")) return "tool proximity";
  return `drawn by ${toRoom?.purpose ?? "room context"}`;
}

function hasMinuteArrived(previousMinute: number, currentMinute: number, targetMinute: number) {
  if (previousMinute <= currentMinute) {
    return targetMinute <= currentMinute;
  }
  return targetMinute <= currentMinute || targetMinute > previousMinute;
}

function hasActionWindowArrived(persona: Persona, previousMinute: number, currentMinute: number) {
  const target = persona.nextActionAfterMinute;
  if (previousMinute <= currentMinute) {
    return target <= currentMinute;
  }
  return target <= currentMinute || target > previousMinute;
}

function scoreCallMoment(persona: Persona, state: PersonaState, roomId: string) {
  const tendencies = persona.tendencies;
  const stateWeight = state === "thinking" || state === "talking" ? 0.32 : 0;
  const roomWeight = ["kitchen", "dining", "library", "workshop", "casey-room"].includes(roomId) ? 0.18 : 0;
  const focusWeight = tendencies ? tendencies.focus * 0.18 : 0.08;
  const socialWeight = tendencies ? tendencies.sociability * 0.14 : 0.06;
  const goJuiceWeight = persona.goJuice ? 0.18 : 0;
  return clamp(stateWeight + roomWeight + focusWeight + socialWeight + goJuiceWeight + Math.random() * 0.28, 0, 1);
}

function isSleepWindow(minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  return hour >= 1 && hour < 8;
}

function nextPersonaState(persona: Persona, minuteOfDay: number): PersonaState {
  const tendencies = persona.tendencies;
  const hour = Math.floor(minuteOfDay / 60) % 24;

  if (isSleepWindow(minuteOfDay) && hour === 3 && minuteOfDay % 60 >= 33 && Math.random() > 0.18) {
    return "asleep";
  }

  if (!tendencies) {
    return choose(["idle", "thinking", "acting", "focused"]);
  }

  const roll = Math.random();
  const tired = isSleepWindow(minuteOfDay) ? 0.18 : 0;
  if (roll < tired) return "asleep";
  if (roll < tired + tendencies.focus * 0.24) return "focused";
  if (roll < tired + tendencies.focus * 0.24 + tendencies.sociability * 0.2) return "talking";
  if (roll < tired + tendencies.focus * 0.24 + tendencies.sociability * 0.2 + tendencies.caretaking * 0.18) {
    return "acting";
  }
  if (roll < 0.84) return "thinking";
  return "idle";
}

function nextRoom(rooms: Room[], persona: Persona, state: PersonaState, minuteOfDay: number) {
  if (state === "asleep") {
    return persona.roomId === "sleeping-nook" || Math.random() > 0.24 ? persona.roomId : "sleeping-nook";
  }

  const hour = Math.floor(minuteOfDay / 60) % 24;
  if (hour >= 18 && hour <= 22 && persona.id === "chef") {
    return Math.random() > 0.25 ? "kitchen" : "dining";
  }

  if (hour >= 19 && hour <= 23 && Math.random() < 0.28) {
    return choose(["kitchen", "dining", "common"]);
  }

  const tendencies = persona.tendencies;
  const shouldMove = Math.random() < (tendencies ? 0.18 + tendencies.restlessness * 0.34 : 0.28);
  if (!shouldMove) {
    return persona.roomId;
  }

  return choose(roomAffinities[persona.id] ?? rooms.map((room) => room.id));
}

function describeActivity(rooms: Room[], persona: Persona, state: PersonaState, roomId: string, callMoment: boolean) {
  const room = rooms.find((candidate) => candidate.id === roomId);
  const base = choose(routineActivities[state]);
  if (callMoment) {
    return `${base}; the Steward marked the moment as worth possible interiority.`;
  }
  return `${base}${room ? ` in the ${room.name}` : ""}.`;
}

function describeDowntime(rooms: Room[], persona: Persona, roomId: string) {
  const room = rooms.find((candidate) => candidate.id === roomId);
  return `${choose(downtimeActivities)}${room ? ` in the ${room.name}` : ""}.`;
}

function roomContext(rooms: Room[], roomId: string) {
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (!room) return "Current room: unknown.";

  return [
    `Current room: ${room.name}`,
    `Purpose: ${room.purpose}`,
    `Atmosphere: ${room.atmosphere}`,
    `Layout: ${room.layout}`,
    `Furniture: ${room.furniture.join(", ")}`,
    `Items: ${room.items.join(", ")}`,
    `Affordances: ${room.affordances.join(", ")}`
  ].join("\n");
}

function directRecallQuery(state: HouseRuntimeState, persona: Persona, message: string) {
  const room = state.rooms.find((candidate) => candidate.id === persona.roomId);
  return [
    persona.name,
    ...(persona.aliases ?? []),
    persona.role,
    "User",
    room?.name ?? "",
    room?.purpose ?? "",
    message
  ]
    .filter(Boolean)
    .join(" ");
}

function directSystemPrompt(
  state: HouseRuntimeState,
  persona: Persona,
  librarianRecords: LibrarianRecord[] = []
) {
  const occupants = state.personas
    .filter((candidate) => candidate.roomId === persona.roomId && candidate.id !== persona.id)
    .map((candidate) => `${candidate.name} (${candidate.state})`);
  const awareness = persona.awareness ?? defaultAwareness;
  const visibility = resolvePersonaVisibility(state, persona.id, librarianRecords);
  const visibleActivity = visibility.visibleActivity
    .slice(0, awareness.houseLogAccess === "full" ? 8 : awareness.houseLogAccess === "summary" ? 5 : 3);
  const visibleHouseEvents = visibility.visibleHouseEvents
    .slice(0, awareness.houseLogAccess === "full" ? 8 : awareness.houseLogAccess === "summary" ? 4 : 2);
  const visibleRelationshipUpdates = visibility.visibleRelationshipUpdates
    .slice(0, awareness.houseLogAccess === "full" ? 8 : 4)
    .map((update) => {
      const confidence = Number.isFinite(update.confidence) ? update.confidence.toFixed(2) : "unknown";
      return `Day ${update.day} [${update.time}] ${update.fromPersonaName} -> ${update.toPersonaName}: ${update.valence}, intensity ${update.intensity.toFixed(2)}. ${update.summary} (confidence ${confidence}; source ${update.sourceHouseEventId})`;
    })
    .join("\n");
  const visibleMemories = visibility.visibleMemories
    .slice(0, persona.awareness.houseLogAccess === "full" ? 6 : 3)
    .map((memory) => {
      const facts = memory.mechanicalFacts.length ? ` Facts: ${memory.mechanicalFacts.slice(0, 2).join("; ")}` : "";
      return `Day ${memory.day} / ${memory.personaName}: ${memory.emotionalResidue}${facts}`;
    })
    .join("\n");
  const visibleLibrarianRecords = visibility.visibleLibrarianRecords
    .slice(0, 6)
    .map((record) => {
      const confidence = Number.isFinite(record.confidence) ? record.confidence.toFixed(2) : "unknown";
      return `${record.kind ?? record.type} / ${record.subject}: ${record.content ?? record.object} (confidence ${confidence}; source ${record.source.label})`;
    })
    .join("\n");
  const recentActivity = visibleActivity
    .map((event) => {
      const basis = event.visibility?.basis ? ` (${event.visibility.basis})` : "";
      return `[${event.time}] ${event.persona}: ${event.text}${basis}`;
    })
    .join("\n");
  const recentHouseEvents = visibleHouseEvents
    .map((event) => `Day ${event.day} [${event.time}] ${event.title}: ${event.summary}`)
    .join("\n");
  const recentOutsideSignal = state.outsideSignals
    .filter((signal) => signal.day === state.day && canPersonaAccessConsent(persona, signal.consent))
    .slice(0, 1)
    .map(
      (signal) =>
        `Day ${signal.day} ${signal.timeOfDay} / ${signal.season}: ${signal.title}. ${signal.summary}`
    )
    .join("\n");
  const recentSharedConversation = (awareness.hearingRange === "house"
    ? state.conversation.slice(-8)
    : state.conversation.filter((turn) => turn.speaker === "User").slice(-4)
  )
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join("\n");
  const movement = persona.movementIntent
    ? [
        `Movement: en route`,
        `From: ${state.rooms.find((room) => room.id === persona.movementIntent?.fromRoomId)?.name ?? persona.movementIntent.fromRoomId}`,
        `To: ${state.rooms.find((room) => room.id === persona.movementIntent?.toRoomId)?.name ?? persona.movementIntent.toRoomId}`,
        `Reason: ${persona.movementIntent.reason}`,
        `Arrives at: ${formatTime(persona.movementIntent.arrivesAtMinute)}`
      ].join("\n")
    : "Movement: not currently moving";

  return [
    persona.systemPrompt,
    "",
    "You are being spoken to in a one-on-one room with User.",
    "Answer as this persona. Keep the reply grounded in your current House context.",
    "Do not claim to have performed file edits, memory writes, or tool actions unless the system says you did.",
    "If your reply implies you physically move to another room, include `[MOVE: Room Name]` on its own line.",
    "Rooms in the house:",
    state.rooms.map((room) => `- ${room.name}`).join("\n"),
    "",
    `Persona: ${persona.name}`,
    `Role: ${persona.role}`,
    `State: ${persona.state}`,
    `Current activity: ${persona.activity}`,
    `Recent thought: ${persona.recentThought}`,
    movement,
    `Permissions: ${persona.permissions.join(", ")}`,
    `Awareness: houseLog=${awareness.houseLogAccess}, steward=${awareness.stewardAccess}, librarian=${awareness.librarianAccess}, hearing=${awareness.hearingRange}`,
    `Visibility debug: memories=${visibility.visibleMemories.length}, houseEvents=${visibility.visibleHouseEvents.length}, relationships=${visibility.visibleRelationshipUpdates.length}, activity=${visibility.visibleActivity.length}, librarianRecords=${visibility.visibleLibrarianRecords.length}/${librarianRecords.length}, excluded=${visibility.debug.excluded.length}`,
    "",
    roomContext(state.rooms, persona.roomId),
    `Other occupants in the room: ${occupants.length ? occupants.join(", ") : "none"}`,
    "",
    "Visible shared House conversation:",
    recentSharedConversation || "None.",
    "",
    "Visible House event log:",
    recentHouseEvents || "None.",
    "",
    "Visible persona memory:",
    visibleMemories || "None.",
    "",
    "Visible relationship updates:",
    visibleRelationshipUpdates || "None.",
    "",
    "Visible Librarian recall:",
    visibleLibrarianRecords || "None.",
    "",
    "Outside signal:",
    recentOutsideSignal || "None.",
    "",
    "Visible House activity:",
    recentActivity || "None."
  ].join("\n");
}

function directMessages(room: DirectRoom) {
  return room.turns
    .filter((turn) => turn.speaker === "User" || turn.speaker !== "The Steward")
    .slice(-12)
    .map((turn) => ({
      role: turn.speaker === "User" ? ("user" as const) : ("assistant" as const),
      content: turn.text
    }));
}

function convergenceEvents(
  rooms: Room[],
  personas: Persona[],
  minuteOfDay: number,
  triggeredRooms: Record<string, number>,
  roomConversations: RoomConversation[]
) {
  const events: ActivityEvent[] = [];
  const conversations: RoomConversation[] = [];
  const nextTriggeredRooms = { ...triggeredRooms };

  for (const room of rooms) {
    if (!socialRooms.has(room.id)) {
      continue;
    }

    const occupants = personas.filter(
      (persona) => persona.roomId === room.id && persona.state !== "asleep"
    );
    const lastTriggered = triggeredRooms[room.id] ?? -9999;
    const cooldownElapsed = minuteOfDay - lastTriggered > 45 || minuteOfDay < lastTriggered;

    if (occupants.length >= 3 && cooldownElapsed) {
      const names = occupants.map((persona) => persona.name).join(", ");
      const existing = roomConversations.find(
        (conversation) => conversation.roomId === room.id && conversation.active
      );
      if (!existing) {
        conversations.push({
          id: `room-convo-${room.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          roomId: room.id,
          participantIds: occupants.map((persona) => persona.id),
          witnessIds: [],
          turns: [
            {
              id: `room-convo-seed-${Date.now()}`,
              speaker: "The Steward",
              text: `${names} have gathered. The room is ready for small talk, silence, or a deeper turn.`
            }
          ],
          topicSummary: `A gathering formed in the ${room.name}.`,
          emotionalTemperature: room.id === "kitchen" || room.id === "dining" ? "warm" : "quiet",
          startedAtMinute: minuteOfDay,
          lastUpdatedMinute: minuteOfDay,
          newcomerPolicy: "social_read_only",
          active: true
        });
      }
      events.push(
        activityEvent({
          id: `trigger-${Date.now()}-${room.id}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(minuteOfDay),
          persona: "The Steward",
          text: `${names} converged in the ${room.name}; silence would read as a choice. The Steward marked the room for small talk or a deeper call.`,
          personas,
          roomId: room.id,
          scope: "room",
          informedPersonaIds: occupants.map((persona) => persona.id),
          basis: "room convergence witnessed by occupants"
        })
      );
      nextTriggeredRooms[room.id] = minuteOfDay;
    }
  }

  return { events, triggeredRooms: nextTriggeredRooms, conversations };
}

function currentMinuteOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function minutesBetweenDays(
  startDay: number | null | undefined,
  startMinute: number | null | undefined,
  endDay: number,
  endMinute: number
) {
  if (startDay == null || startMinute == null) return 0;
  return Math.max(0, (endDay - startDay) * 1440 + endMinute - startMinute);
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${remainder ? ` ${remainder} minute${remainder === 1 ? "" : "s"}` : ""}`;
}

function currentSeason(): OutsideSignal["season"] {
  const month = new Date().getMonth();
  if (month <= 1 || month === 11) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

function timeOfDay(minuteOfDay: number): OutsideSignal["timeOfDay"] {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  if (hour < 5 || hour >= 22) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function createOutsideSignal(
  day: number,
  minuteOfDay: number,
  summary = "Rain is the outside signal today; the real world is touching the windows."
): OutsideSignal {
  const season = currentSeason();
  const daypart = timeOfDay(minuteOfDay);
  return {
    id: `outside-${day}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    day,
    minuteOfDay,
    source: "manual",
    title: "Rain at the windows",
    summary,
    weekSummary: "Manual signal only. Forecast not fetched yet.",
    season,
    timeOfDay: daypart,
    createdAt: new Date().toISOString(),
    consent: defaultConsent()
  };
}

function createOutsideSignalFromWeather(
  day: number,
  minuteOfDay: number,
  weather: WeatherSignalResponse
): OutsideSignal {
  const season = currentSeason();
  const daypart = timeOfDay(minuteOfDay);
  const current = weather.current ?? {};
  const daily = weather.daily ?? {};
  const rain = Number(current.rain ?? 0);
  const showers = Number(current.showers ?? 0);
  const precipitation = Number(current.precipitation ?? rain + showers);
  const probability = daily.precipitation_probability_max?.[0];
  const weeklyProbability = daily.precipitation_probability_max ?? [];
  const wetDays = weeklyProbability.filter((value) => Number(value) >= 40).length;
  const weekSummary = weeklyProbability.length
    ? `${wetDays} of ${weeklyProbability.length} forecast days carry at least a 40% precipitation chance. Peak chance: ${Math.max(...weeklyProbability)}%.`
    : "Weekly precipitation probability unavailable.";
  const isWet = precipitation > 0 || rain > 0 || showers > 0 || Number(probability ?? 0) >= 40;

  return {
    id: `outside-${day}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    day,
    minuteOfDay,
    source: "open_meteo",
    title: isWet ? "Rain at the windows" : "Weather at the windows",
    summary: isWet
      ? `Rain is the outside signal today. Current precipitation is ${precipitation.toFixed(2)} in, temperature is ${Math.round(Number(current.temperature_2m ?? 0))}F, and today's precipitation chance peaks at ${probability ?? "unknown"}%.`
      : `The outside signal is ${daypart} ${season} weather: ${Math.round(Number(current.temperature_2m ?? 0))}F, ${probability ?? "unknown"}% peak precipitation chance today.`,
    weekSummary,
    season,
    timeOfDay: daypart,
    temperatureF: typeof current.temperature_2m === "number" ? current.temperature_2m : undefined,
    precipitationInches: precipitation,
    precipitationProbabilityMax: probability,
    createdAt: weather.fetchedAt,
    consent: defaultConsent()
  };
}

function updateConversationWitnesses(
  conversations: RoomConversation[],
  previousPersonas: Persona[],
  currentPersonas: Persona[],
  minuteOfDay: number
) {
  const events: ActivityEvent[] = [];
  const previousById = new Map(previousPersonas.map((persona) => [persona.id, persona]));

  const updated = conversations.map((conversation) => {
    if (!conversation.active) return conversation;

    let nextConversation = conversation;
    const currentOccupants = currentPersonas.filter(
      (persona) => persona.roomId === conversation.roomId && persona.state !== "asleep"
    );

    for (const persona of currentOccupants) {
      const previous = previousById.get(persona.id);
      const enteredRoom = previous && previous.roomId !== conversation.roomId;
      const alreadyParticipant = conversation.participantIds.includes(persona.id);
      const alreadyWitness = conversation.witnessIds.includes(persona.id);

      if (enteredRoom && !alreadyParticipant && !alreadyWitness) {
        nextConversation = {
          ...nextConversation,
          witnessIds: [...nextConversation.witnessIds, persona.id],
          lastUpdatedMinute: minuteOfDay,
          turns: [
            ...nextConversation.turns,
            {
              id: `room-witness-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
              speaker: "The Steward",
              text: `${persona.name} entered mid-conversation and received only a social read of the room.`
            }
          ].slice(-12)
        };
        events.push(
          activityEvent({
            id: `witness-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(minuteOfDay),
            persona: "The Steward",
            text: `${persona.name} entered the room mid-conversation as a witness, not a full participant.`,
            personas: currentPersonas,
            roomId: conversation.roomId,
            scope: "room",
            informedPersonaIds: [...conversation.participantIds, persona.id],
            basis: "conversation presence changed"
          })
        );
      }
    }

    return nextConversation;
  });

  return { conversations: updated, events };
}

function offscreenLine(speaker: Persona, listener: Persona, room: Room, minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  if (speaker.id === "steward") {
    return `${listener.name}, the ${room.name} has enough pressure for a small check-in. No need to force it.`;
  }
  if (speaker.id === "librarian") {
    return `${listener.name}, I am marking this as a quiet ${room.name} exchange, not a public House conclusion.`;
  }
  if (speaker.id === "chef") {
    return hour >= 17 && hour <= 22
      ? `${listener.name}, if dinner becomes real tonight, I need to know whether you are eating with us or orbiting the room.`
      : `${listener.name}, I am checking the room's appetite before it turns into a plan.`;
  }
  if (speaker.id === "coach") {
    return `${listener.name}, quick baseline: are you resting, avoiding, or actually done for now?`;
  }
  if (speaker.id === "coder") {
    return `${listener.name}, I am testing whether the House keeps continuity when User is not looking directly at us.`;
  }
  return `${listener.name}, the ${room.name} went quiet enough that I noticed you there.`;
}

function offscreenReply(speaker: Persona, listener: Persona, room: Room) {
  if (listener.id === "steward") {
    return `I hear it. Keep the exchange bounded; the House does not need to turn every quiet moment into a summons.`;
  }
  if (listener.id === "librarian") {
    return `Noted. I will keep provenance around it and resist making it larger than it is.`;
  }
  if (listener.id === "chef") {
    return `If it turns practical, I can make it warm. Until then, I am not dragging anyone to the table.`;
  }
  if (listener.id === "coach") {
    return `Baseline accepted. Small repeatable truth beats a dramatic declaration.`;
  }
  if (listener.id === "coder") {
    return `Good. Then we leave a clean trace and do not pretend the test is bigger than the result.`;
  }
  return `I am here. The ${room.name} can hold that much without needing User to witness it.`;
}

function offscreenSocialDrift(
  rooms: Room[],
  personas: Persona[],
  day: number,
  minuteOfDay: number,
  triggeredRooms: Record<string, number>,
  conversations: RoomConversation[]
) {
  const events: ActivityEvent[] = [];
  const nextTriggeredRooms = { ...triggeredRooms };
  let nextConversations = conversations;
  const candidateRooms = rooms.filter((room) => offscreenSocialRooms.has(room.id));

  for (const room of candidateRooms) {
    const occupants = personas.filter(
      (persona) =>
        persona.roomId === room.id &&
        persona.state !== "asleep" &&
        persona.state !== "moving"
    );
    if (occupants.length < 2) continue;
    const initiators = occupants.filter((persona) => persona.goJuice);
    if (!initiators.length) continue;

    const key = `offscreen:${room.id}`;
    const lastTriggered = triggeredRooms[key] ?? -9999;
    const cooldownElapsed = minuteOfDay - lastTriggered > 90 || minuteOfDay < lastTriggered;
    if (!cooldownElapsed) continue;

    const socialWeight =
      occupants.reduce((sum, persona) => sum + (persona.tendencies?.sociability ?? 0.4), 0) / occupants.length;
    const focusWeight =
      occupants.reduce((sum, persona) => sum + (persona.tendencies?.focus ?? 0.45), 0) / occupants.length;
    const pressure = socialWeight * 0.24 + focusWeight * 0.12 + occupants.length * 0.08 + Math.random() * 0.28;
    if (pressure < 0.46) continue;

    const speaker = [...initiators].sort((left, right) => {
      const leftScore = (left.tendencies?.sociability ?? 0.4) + (left.state === "talking" ? 0.25 : 0);
      const rightScore = (right.tendencies?.sociability ?? 0.4) + (right.state === "talking" ? 0.25 : 0);
      return rightScore - leftScore;
    })[0];
    const listener = occupants.find((persona) => persona.id !== speaker?.id);
    if (!speaker || !listener) continue;

    const existing = nextConversations.find(
      (conversation) => conversation.roomId === room.id && conversation.active && !conversation.participantIds.includes("casey")
    );
    const turns: ConversationTurn[] = [
      {
        id: `offscreen-turn-${Date.now()}-${speaker.id}-${Math.random().toString(16).slice(2)}`,
        speaker: speaker.name,
        text: offscreenLine(speaker, listener, room, minuteOfDay),
        timestamp: new Date().toISOString(),
        day,
        minuteOfDay,
        channel: "room"
      },
      {
        id: `offscreen-reply-${Date.now()}-${listener.id}-${Math.random().toString(16).slice(2)}`,
        speaker: listener.name,
        text: offscreenReply(speaker, listener, room),
        timestamp: new Date().toISOString(),
        day,
        minuteOfDay,
        channel: "room"
      }
    ];

    if (existing) {
      nextConversations = nextConversations.map((conversation) =>
        conversation.id === existing.id
          ? {
              ...conversation,
              participantIds: Array.from(new Set([...conversation.participantIds, speaker.id, listener.id])),
              turns: [...conversation.turns, ...turns].slice(-18),
              lastUpdatedMinute: minuteOfDay,
              emotionalTemperature: room.id === "kitchen" || room.id === "dining" ? "warm" : conversation.emotionalTemperature
            }
          : conversation
      );
    } else {
      nextConversations = [
        {
          id: `offscreen-room-${room.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          roomId: room.id,
          participantIds: [speaker.id, listener.id],
          witnessIds: occupants
            .filter((persona) => persona.id !== speaker.id && persona.id !== listener.id)
            .map((persona) => persona.id),
          turns,
          topicSummary: `A bounded offscreen exchange in the ${room.name}.`,
          emotionalTemperature: room.id === "kitchen" || room.id === "dining" ? "warm" : "quiet",
          startedAtMinute: minuteOfDay,
          lastUpdatedMinute: minuteOfDay,
          newcomerPolicy: "social_read_only",
          active: true
        },
        ...nextConversations
      ];
    }

    events.push(
      activityEvent({
        id: `offscreen-social-${Date.now()}-${room.id}-${Math.random().toString(16).slice(2)}`,
        time: formatTime(minuteOfDay),
        persona: "The Steward",
        text: `${speaker.name} and ${listener.name} had a bounded offscreen exchange in the ${room.name}.`,
        personas,
        roomId: room.id,
        scope: "room",
        informedPersonaIds: occupants.map((persona) => persona.id),
        basis: "offscreen social drift while User was away"
      })
    );
    nextTriggeredRooms[key] = minuteOfDay;
    break;
  }

  return { conversations: nextConversations, events, triggeredRooms: nextTriggeredRooms };
}

function advanceRuntime(previous: HouseRuntimeState): HouseRuntimeState {
  if (previous.config.timeMode === "paused") {
    return previous;
  }

  const minuteOfDay =
    previous.config.timeMode === "real"
      ? currentMinuteOfDay()
      : (previous.minuteOfDay + previous.config.acceleratedMinutesPerTick) % 1440;
  const day = minuteOfDay < previous.minuteOfDay ? previous.day + 1 : previous.day;
  const resetBudget = day !== previous.day;
  let callBudgetUsed = resetBudget ? 0 : previous.callBudgetUsed;
  const newEvents: ActivityEvent[] = [];
  const isAway = previous.config.presenceMode === "away";

  if (!previous.config.motionEnabled) {
    return { ...previous, day, minuteOfDay, callBudgetUsed };
  }

  const updatedPersonas: Persona[] = previous.personas.map((persona): Persona => {
    if (
      persona.state === "asleep" &&
      !isSleepWindow(minuteOfDay) &&
      hasMinuteArrived(previous.minuteOfDay, minuteOfDay, DEFAULT_WAKE_MINUTE)
    ) {
      const roomId = persona.roomId === "sleeping-nook"
        ? choose(roomAffinities[persona.id] ?? ["common"])
        : persona.roomId;
      const room = previous.rooms.find((candidate) => candidate.id === roomId);
      const activity = `Woke into the ${room?.name ?? "House"} and started rejoining the day.`;
      newEvents.push(
        activityEvent({
          id: `wake-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(minuteOfDay),
          persona: persona.name,
          text: activity,
          personas: previous.personas,
          roomId,
          scope: "room",
          actorPersonaId: persona.id,
          basis: "morning wake cycle"
        })
      );
      return {
        ...persona,
        state: "idle",
        roomId,
        marker: markerForRoom(previous.rooms, roomId),
        activity,
        movementIntent: null,
        nextActionAfterMinute: (minuteOfDay + minutesUntilNextAction(persona, "idle")) % 1440
      };
    }

    if (isAway && !persona.goJuice) {
      return {
        ...persona,
        state: persona.state === "asleep" ? "asleep" : "idle",
        activity: "Quiescent while User is away; the House dreams around them.",
        movementIntent: null,
        nextActionAfterMinute: (minuteOfDay + minutesUntilNextAction(persona, "idle")) % 1440
      };
    }

    if (persona.movementIntent) {
      if (!hasMinuteArrived(previous.minuteOfDay, minuteOfDay, persona.movementIntent.arrivesAtMinute)) {
        return persona;
      }

      const destination = previous.rooms.find((room) => room.id === persona.movementIntent?.toRoomId);
      const activity = `Arrived in the ${destination?.name ?? "destination"} after ${persona.movementIntent.reason}.`;
      newEvents.push(
        activityEvent({
          id: `arrival-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(minuteOfDay),
          persona: persona.name,
          text: activity,
          personas: previous.personas,
          roomId: persona.movementIntent.toRoomId,
          scope: "room",
          actorPersonaId: persona.id,
          basis: "arrival visible in destination room"
        })
      );

      return {
        ...persona,
        roomId: persona.movementIntent.toRoomId,
        state: "idle",
        activity,
        marker: markerForRoom(previous.rooms, persona.movementIntent.toRoomId),
        movementIntent: null,
        nextActionAfterMinute: (minuteOfDay + minutesUntilNextAction(persona, "idle")) % 1440
      };
    }

    if (!hasActionWindowArrived(persona, previous.minuteOfDay, minuteOfDay)) {
      return persona;
    }

    const downtimeRoll = Math.random();
    const downtimeChance = persona.goJuice
      ? (persona.tendencies ? 0.18 + persona.tendencies.solitude * 0.1 : 0.24)
      : (persona.tendencies ? 0.42 + persona.tendencies.solitude * 0.18 : 0.5);
    if (downtimeRoll < downtimeChance) {
      const state = persona.state === "asleep" && isSleepWindow(minuteOfDay)
        ? "asleep"
        : choose<PersonaState>(["idle", "thinking", "focused"]);
      const activity = describeDowntime(previous.rooms, persona, persona.roomId);
      const nextActionAfterMinute = (minuteOfDay + minutesUntilNextAction(persona, state)) % 1440;

      newEvents.push(
        activityEvent({
          id: `downtime-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(minuteOfDay),
          persona: persona.name,
          text: activity,
          personas: previous.personas,
          roomId: persona.roomId,
          scope: "room",
          actorPersonaId: persona.id,
          basis: "routine local state"
        })
      );

      return {
        ...persona,
        state,
        activity,
        nextActionAfterMinute
      };
    }

    const state = nextPersonaState(persona, minuteOfDay);
    const roomId = nextRoom(previous.rooms, persona, state, minuteOfDay);
    const callScore = scoreCallMoment(persona, state, roomId);
    const callMoment =
      Boolean(persona.apiEnabled) &&
      callBudgetUsed < previous.config.personaModelCallsPerDay &&
      callScore > (persona.goJuice ? 0.36 : 0.58) &&
      state !== "asleep";

    if (callMoment) {
      callBudgetUsed += 1;
    }

    const activity = describeActivity(previous.rooms, persona, state, roomId, callMoment);
    const moved = roomId !== persona.roomId;
    if (moved) {
      const reason = movementReason(persona, persona.roomId, roomId, minuteOfDay);
      const arrivesAtMinute = (minuteOfDay + movementDurationMinutes(persona.roomId, roomId)) % 1440;
      const destination = previous.rooms.find((room) => room.id === roomId);
      const origin = previous.rooms.find((room) => room.id === persona.roomId);

      newEvents.push(
        activityEvent({
          id: `movement-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(minuteOfDay),
          persona: persona.name,
          text: `Started moving from ${origin?.name ?? "somewhere"} to ${destination?.name ?? "somewhere"} because of ${reason}.`,
          personas: previous.personas,
          roomId: persona.roomId,
          scope: "room",
          actorPersonaId: persona.id,
          basis: "departure visible from origin room"
        })
      );

      return {
        ...persona,
        state: "moving",
        activity: `En route to ${destination?.name ?? "another room"} because of ${reason}.`,
        movementIntent: {
          fromRoomId: persona.roomId,
          toRoomId: roomId,
          reason,
          startedAtMinute: minuteOfDay,
          arrivesAtMinute
        },
        nextActionAfterMinute: arrivesAtMinute
      };
    }

    const movePrefix = moved
      ? `Decided to go from ${previous.rooms.find((room) => room.id === persona.roomId)?.name ?? "somewhere"} to ${
          previous.rooms.find((room) => room.id === roomId)?.name ?? "somewhere"
        }: `
      : "";
    newEvents.push(
      activityEvent({
        id: `a-${Date.now()}-${persona.id}-${Math.random().toString(16).slice(2)}`,
        time: formatTime(minuteOfDay),
        persona: persona.name,
        text: `${movePrefix}${activity}`,
        personas: previous.personas,
        roomId,
        scope: "room",
        actorPersonaId: persona.id,
        basis: callMoment ? "autonomous sdk action queued" : "routine local state"
      })
    );

    return {
      ...persona,
      roomId,
      state,
      activity,
      marker: markerForRoom(previous.rooms, roomId),
      nextActionAfterMinute: (minuteOfDay + minutesUntilNextAction(persona, state)) % 1440
    };
  });

  const witnessUpdate = updateConversationWitnesses(
    previous.roomConversations,
    previous.personas,
    updatedPersonas,
    minuteOfDay
  );
  const convergence = convergenceEvents(
    previous.rooms,
    updatedPersonas,
    minuteOfDay,
    previous.triggeredRooms,
    witnessUpdate.conversations
  );
  const offscreen = isAway
    ? offscreenSocialDrift(
        previous.rooms,
        updatedPersonas,
        day,
        minuteOfDay,
        convergence.triggeredRooms,
        [...convergence.conversations, ...witnessUpdate.conversations]
      )
    : {
        conversations: [...convergence.conversations, ...witnessUpdate.conversations],
        events: [] as ActivityEvent[],
        triggeredRooms: convergence.triggeredRooms
      };
  const tickEvents = [...offscreen.events, ...convergence.events, ...witnessUpdate.events, ...newEvents];
  const nextActivity = [...tickEvents, ...previous.activity].slice(0, 80);
  const promotedHouseEvents = promoteHouseEvents(
    previous,
    tickEvents,
    day
  );

  const beforeNightly = {
    ...previous,
    personas: updatedPersonas,
    activity: nextActivity,
    houseEvents: [...promotedHouseEvents, ...previous.houseEvents].slice(0, 120),
    roomConversations: offscreen.conversations.slice(0, 40),
    triggeredRooms: offscreen.triggeredRooms,
    day,
    minuteOfDay,
    callBudgetUsed
  };
  if (!isSleepWindow(minuteOfDay) || !hasMinuteArrived(previous.minuteOfDay, minuteOfDay, DEFAULT_SLEEP_MINUTE)) {
    return beforeNightly;
  }

  return {
    ...beforeNightly,
    personas: beforeNightly.personas.map((persona) =>
      persona.state === "asleep" || persona.goJuice
        ? persona
        : {
            ...persona,
            state: "asleep",
            activity: "Sleeping where the day left them after the nightly memory pass.",
            movementIntent: null,
            nextActionAfterMinute: (minuteOfDay + minutesUntilNextAction(persona, "asleep")) % 1440
          }
    )
  };
}

function initialState(): HouseRuntimeState {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as HouseRuntimeState;
      const seededById = new Map(seedPersonas.map((persona) => [persona.id, persona]));
      const rooms = normalizeRooms(parsed.rooms);
      const minuteOfDay = parsed.minuteOfDay ?? currentMinuteOfDay();
      const normalizedState = {
        ...parsed,
        rooms,
        personas: parsed.personas.map((persona) => ({
          ...persona,
          state: persona.state === "asleep" && !isSleepWindow(minuteOfDay) ? "idle" : persona.state,
          activity:
            persona.state === "asleep" && !isSleepWindow(minuteOfDay)
              ? "Waking back into the day after stale sleep state."
              : persona.activity,
          aliases: persona.aliases ?? [],
          systemPrompt: persona.systemPrompt ?? seededById.get(persona.id)?.systemPrompt ?? "",
          model: normalizeModel(persona.model ?? seededById.get(persona.id)?.model),
          apiEnabled: persona.apiEnabled ?? seededById.get(persona.id)?.apiEnabled ?? false,
          tendencies: persona.tendencies ?? seededById.get(persona.id)?.tendencies,
          awareness: persona.awareness ?? seededById.get(persona.id)?.awareness ?? defaultAwareness,
          goJuice: persona.goJuice ?? false,
          movementIntent: persona.movementIntent ?? null,
          nextActionAfterMinute:
            persona.nextActionAfterMinute ??
            seededById.get(persona.id)?.nextActionAfterMinute ??
            (currentMinuteOfDay() + Math.floor(Math.random() * 45)) % 1440
        })),
        conversation: parsed.conversation ?? seedConversation,
        houseEvents: (parsed.houseEvents ?? [])
          .filter((event) => isConsentVisibleToSystem(event.consent))
          .map((event) => ({ ...event, consent: normalizeConsent(event.consent) })),
        personaMemories: (parsed.personaMemories ?? [])
          .filter((memory) => isConsentVisibleToSystem(memory.consent))
          .map((memory) => ({ ...memory, fragments: memory.fragments ?? [], consent: normalizeConsent(memory.consent) })),
        houseMood: parsed.houseMood ?? deriveHouseMood({ ...parsed, rooms, personas: parsed.personas }),
        outsideSignals: (parsed.outsideSignals ?? []).map((signal) => ({
          ...signal,
          consent: normalizeConsent(signal.consent)
        })),
        directRooms: parsed.directRooms ?? [],
        roomConversations: parsed.roomConversations ?? [],
        relationshipUpdates: (parsed.relationshipUpdates ?? [])
          .filter((update) => isConsentVisibleToSystem(update.consent))
          .map((update) => ({ ...update, consent: normalizeConsent(update.consent) })),
        triggeredRooms: parsed.triggeredRooms ?? {},
        processedNightlyMemoryDays: parsed.processedNightlyMemoryDays ?? [],
        minuteOfDay,
        config: normalizeRuntimeConfig(parsed.config)
      };
      return {
        ...normalizedState,
        day: maxKnownRuntimeDay(normalizedState)
      };
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  const minuteOfDay = currentMinuteOfDay();
  const outsideSignal = createOutsideSignal(1, minuteOfDay);
  const baseInitialState: HouseRuntimeState = {
    rooms: seedRooms,
    personas: seedPersonas,
    activity: seedActivity,
    houseEvents: [],
    personaMemories: [],
    outsideSignals: [outsideSignal],
    conversation: seedConversation,
    directRooms: [],
    roomConversations: [],
    relationshipUpdates: [],
    triggeredRooms: {},
    processedNightlyMemoryDays: [],
    day: 1,
    minuteOfDay,
    callBudgetUsed: 0,
    config: DEFAULT_CONFIG,
    caseyRoomId: "foyer"
  };

  return {
    rooms: seedRooms,
    personas: seedPersonas,
    activity: seedActivity,
    houseEvents: promoteHouseEvents(
      {
        rooms: seedRooms,
        personas: seedPersonas,
        activity: seedActivity,
        houseEvents: [],
        personaMemories: [],
        houseMood: deriveHouseMood(baseInitialState),
        outsideSignals: [outsideSignal],
        conversation: seedConversation,
        directRooms: [],
        roomConversations: [],
        relationshipUpdates: [],
        triggeredRooms: {},
        processedNightlyMemoryDays: [],
        day: 1,
        minuteOfDay,
        callBudgetUsed: 0,
        config: DEFAULT_CONFIG
      },
      seedActivity,
      1
    ),
    personaMemories: [],
    houseMood: deriveHouseMood(baseInitialState),
    outsideSignals: [outsideSignal],
    conversation: seedConversation,
    directRooms: [],
    roomConversations: [],
    relationshipUpdates: [],
    triggeredRooms: {},
    processedNightlyMemoryDays: [],
    day: 1,
    minuteOfDay,
    callBudgetUsed: 0,
    config: DEFAULT_CONFIG,
    caseyRoomId: "foyer"
  };
}

export function useHouseRuntime() {
  const [runtime, setRuntime] = useState<HouseRuntimeState>(() => initialState());
  const [curatedActivityIds, setCuratedActivityIds] = useState<Set<string>>(
    () => new Set(runtime.activity.map((event) => event.id))
  );
  const [curatedHouseEventIds, setCuratedHouseEventIds] = useState<Set<string>>(
    () => new Set(runtime.houseEvents.map((event) => event.id))
  );
  const [curatedMemoryIds, setCuratedMemoryIds] = useState<Set<string>>(
    () => new Set(runtime.personaMemories.map((memory) => memory.id))
  );
  const [curatedRelationshipIds, setCuratedRelationshipIds] = useState<Set<string>>(
    () => new Set(runtime.relationshipUpdates.map((update) => update.id))
  );
  const [archivedHouseEventIds, setArchivedHouseEventIds] = useState<Set<string>>(
    () => new Set(runtime.houseEvents.map((event) => event.id))
  );
  const [archivedRelationshipIds, setArchivedRelationshipIds] = useState<Set<string>>(
    () => new Set(runtime.relationshipUpdates.map((update) => update.id))
  );
  const [processedRelationshipEventIds, setProcessedRelationshipEventIds] = useState<Set<string>>(
    () => new Set(runtime.houseEvents.map((event) => event.id))
  );
  const [processedAutonomousActionIds, setProcessedAutonomousActionIds] = useState<Set<string>>(new Set());
  const autonomousActionInFlight = useRef<Set<string>>(new Set());
  const autonomousActionLastStartedAt = useRef<Record<string, number>>({});
  const [directRoomSnapshots, setDirectRoomSnapshots] = useState<Record<string, string>>({});
  const [roomConversationSnapshots, setRoomConversationSnapshots] = useState<Record<string, string>>({});
  const [bedtimeRitualInFlightDay, setBedtimeRitualInFlightDay] = useState<number | null>(null);
  const previousRitualMinute = useRef(runtime.minuteOfDay);
  const loadedMemoryArchive = useRef(false);
  const loadedHouseEventArchive = useRef(false);
  const loadedRelationshipArchive = useRef(false);
  const loadedDirectRoomArchive = useRef(false);
  const loadedConfigPersonas = useRef(false);
  const loadedConfigRooms = useRef(false);
  const loadedRoomConversationArchive = useRef(false);
  const locallyEditedPersonaIds = useRef<Set<string>>(new Set());

  const mergeConfigRooms = (configRooms: Partial<Room>[], baseRooms: Room[]) => {
    const normalized = normalizeRooms(configRooms, baseRooms);
    const byId = new Map(baseRooms.map((room) => [room.id, room]));
    for (const room of normalized) {
      byId.set(room.id, room);
    }
    return Array.from(byId.values());
  };

  const mergeConfigPersonas = (configPersonas: Persona[], basePersonas: Persona[]) => {
    const seededById = new Map(seedPersonas.map((persona) => [persona.id, persona]));
    const minuteOfDay = runtime.minuteOfDay ?? currentMinuteOfDay();
    const normalized = configPersonas
      .filter((persona) => persona?.id)
      .map((persona) => ({
        ...persona,
        state: persona.state === "asleep" && !isSleepWindow(minuteOfDay) ? "idle" as const : persona.state,
        activity:
          persona.state === "asleep" && !isSleepWindow(minuteOfDay)
            ? "Waking back into the day after stale saved sleep state."
            : persona.activity,
        aliases: persona.aliases ?? [],
        systemPrompt: persona.systemPrompt ?? seededById.get(persona.id)?.systemPrompt ?? "",
        model: normalizeModel(persona.model ?? seededById.get(persona.id)?.model),
        apiEnabled: persona.apiEnabled ?? seededById.get(persona.id)?.apiEnabled ?? false,
        tendencies: persona.tendencies ?? seededById.get(persona.id)?.tendencies,
        awareness: persona.awareness ?? seededById.get(persona.id)?.awareness ?? defaultAwareness,
        goJuice: persona.goJuice ?? false,
        movementIntent: persona.movementIntent ?? null,
        nextActionAfterMinute:
          persona.state === "asleep" && !isSleepWindow(minuteOfDay)
            ? (minuteOfDay + (persona.goJuice ? 2 : 8)) % 1440
            : persona.nextActionAfterMinute ??
              seededById.get(persona.id)?.nextActionAfterMinute ??
              (currentMinuteOfDay() + Math.floor(Math.random() * 45)) % 1440
      }));
    const byId = new Map(basePersonas.map((persona) => [persona.id, persona]));
    for (const persona of normalized) {
      if (locallyEditedPersonaIds.current.has(persona.id) && byId.has(persona.id)) {
        continue;
      }
      byId.set(persona.id, persona);
    }
    return Array.from(byId.values());
  };

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime));
  }, [runtime]);

  useEffect(() => {
    if (loadedRoomConversationArchive.current || !window.houseRuntime?.loadRoomConversationArchive) return;
    loadedRoomConversationArchive.current = true;
    (async () => {
      const result = await window.houseRuntime!.loadRoomConversationArchive();
      const loaded = (result?.conversations ?? []) as RoomConversation[];
      if (loaded.length === 0) return;
      setRuntime((previous) => {
        const existingById = new Map(previous.roomConversations.map((c) => [c.id, c]));
        const merged = [...previous.roomConversations];
        for (const conversation of loaded) {
          if (!conversation?.id) continue;
          if (existingById.has(conversation.id)) continue;
          merged.push(conversation);
        }
        if (merged.length === previous.roomConversations.length) return previous;
        const roomConversations = merged.slice(-32);
        return {
          ...previous,
          day: maxKnownRuntimeDay({ ...previous, roomConversations }),
          roomConversations
        };
      });
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (loadedConfigPersonas.current || !window.houseRuntime?.loadState) return;
    loadedConfigPersonas.current = true;
    (async () => {
      const result = await window.houseRuntime!.loadState();
      const configPersonas = (result?.personas ?? []) as Persona[];
      if (configPersonas.length === 0) {
        return;
      }
      setRuntime((previous) => {
        const personas = mergeConfigPersonas(configPersonas, previous.personas);
        if (personas === previous.personas || JSON.stringify(personas) === JSON.stringify(previous.personas)) return previous;
        return {
          ...previous,
          personas
        };
      });
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (loadedConfigRooms.current || !window.houseRuntime?.loadState) return;
    loadedConfigRooms.current = true;
    (async () => {
      const result = await window.houseRuntime!.loadState();
      const configRooms = (result?.rooms ?? []) as Partial<Room>[];
      if (configRooms.length === 0) return;
      setRuntime((previous) => {
        const rooms = mergeConfigRooms(configRooms, previous.rooms);
        if (JSON.stringify(rooms) === JSON.stringify(previous.rooms)) return previous;
        return {
          ...previous,
          rooms
        };
      });
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (loadedMemoryArchive.current || !window.houseRuntime?.loadPersonaMemoryArchive) {
      return;
    }
    loadedMemoryArchive.current = true;
    void window.houseRuntime.loadPersonaMemoryArchive().then((archive) => {
      const validation = validatePersonaMemories(archive.memories ?? []);
      setCuratedMemoryIds((previousIds) => {
        const next = new Set(previousIds);
        for (const memory of validation.validMemories) next.add(memory.id);
        return next;
      });
      setRuntime((previous) => {
        const existingIds = new Set(previous.personaMemories.map((memory) => memory.id));
        const loaded = validation.validMemories.filter((memory) => !existingIds.has(memory.id));
        if (loaded.length === 0 && validation.issues.length === 0) {
          return previous;
        }
        const issueSummary = validation.issues.length
          ? ` Memory archive validation found ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}; ${validation.quarantinedMemories.length} memor${validation.quarantinedMemories.length === 1 ? "y was" : "ies were"} quarantined.`
          : "";
        return {
          ...previous,
          day: maxKnownRuntimeDay({ ...previous, personaMemories: [...loaded, ...previous.personaMemories] }),
          personaMemories: [...loaded, ...previous.personaMemories].slice(0, 320),
          activity: [
            activityEvent({
              id: `memory-archive-load-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Steward",
              text: `Loaded ${loaded.length} persona memor${loaded.length === 1 ? "y" : "ies"} from file-backed archive.${issueSummary}`,
              personas: previous.personas,
              scope: "system",
              informedPersonaIds: ["steward", "librarian"],
              basis: "file-backed persona memory archive load"
            }),
            ...previous.activity
          ].slice(0, 80)
        };
      });
    }).catch(() => {
      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `memory-archive-load-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: "Could not load the file-backed persona memory archive; runtime memory remained active.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian"],
            basis: "file-backed persona memory archive load failed"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, []);

  useEffect(() => {
    if (loadedHouseEventArchive.current || !window.houseRuntime?.loadHouseEventArchive) {
      return;
    }
    loadedHouseEventArchive.current = true;
    void window.houseRuntime.loadHouseEventArchive().then((archive) => {
      const validation = validateHouseEvents(archive.events ?? []);
      setArchivedHouseEventIds((previousIds) => {
        const next = new Set(previousIds);
        for (const event of validation.validEvents) next.add(event.id);
        return next;
      });
      setCuratedHouseEventIds((previousIds) => {
        const next = new Set(previousIds);
        for (const event of validation.validEvents) next.add(event.id);
        return next;
      });
      setProcessedRelationshipEventIds((previousIds) => {
        const next = new Set(previousIds);
        for (const event of validation.validEvents) next.add(event.id);
        return next;
      });
      setRuntime((previous) => {
        const existingIds = new Set(previous.houseEvents.map((event) => event.id));
        const loaded = validation.validEvents.filter((event) => !existingIds.has(event.id));
        if (loaded.length === 0 && validation.issues.length === 0) {
          return previous;
        }
        const issueSummary = validation.issues.length
          ? ` House event archive validation found ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}; ${validation.quarantinedEvents.length} event${validation.quarantinedEvents.length === 1 ? " was" : "s were"} quarantined.`
          : "";
        return {
          ...previous,
          day: maxKnownRuntimeDay({ ...previous, houseEvents: [...loaded, ...previous.houseEvents] }),
          houseEvents: [...loaded, ...previous.houseEvents].slice(0, 220),
          activity: [
            activityEvent({
              id: `house-event-archive-load-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Steward",
              text: `Loaded ${loaded.length} House event${loaded.length === 1 ? "" : "s"} from file-backed archive.${issueSummary}`,
              personas: previous.personas,
              scope: "system",
              informedPersonaIds: ["steward", "librarian"],
              basis: "file-backed house event archive load"
            }),
            ...previous.activity
          ].slice(0, 80)
        };
      });
    }).catch(() => {
      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `house-event-archive-load-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: "Could not load the file-backed House event archive; runtime House log remained active.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian"],
            basis: "file-backed house event archive load failed"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, []);

  useEffect(() => {
    if (loadedRelationshipArchive.current || !window.houseRuntime?.loadRelationshipUpdateArchive) {
      return;
    }
    loadedRelationshipArchive.current = true;
    void window.houseRuntime.loadRelationshipUpdateArchive().then((archive) => {
      const validation = validateRelationshipUpdates(archive.updates ?? []);
      const validVisibleUpdates = validation.validUpdates.filter((update) => isConsentVisibleToSystem(update.consent));
      setArchivedRelationshipIds((previousIds) => {
        const next = new Set(previousIds);
        for (const update of validVisibleUpdates) next.add(update.id);
        return next;
      });
      setCuratedRelationshipIds((previousIds) => {
        const next = new Set(previousIds);
        for (const update of validVisibleUpdates) next.add(update.id);
        return next;
      });
      setRuntime((previous) => {
        const existingIds = new Set(previous.relationshipUpdates.map((update) => update.id));
        const loaded = validVisibleUpdates.filter((update) => !existingIds.has(update.id));
        if (loaded.length === 0 && validation.issues.length === 0) {
          return previous;
        }
        const issueSummary = validation.issues.length
          ? ` Relationship archive validation found ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}; ${validation.quarantinedUpdates.length} update${validation.quarantinedUpdates.length === 1 ? " was" : "s were"} quarantined.`
          : "";
        return {
          ...previous,
          day: maxKnownRuntimeDay({ ...previous, relationshipUpdates: [...loaded, ...previous.relationshipUpdates] }),
          relationshipUpdates: [...loaded, ...previous.relationshipUpdates].slice(0, 360),
          activity: [
            activityEvent({
              id: `relationship-archive-load-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Steward",
              text: `Loaded ${loaded.length} relationship update${loaded.length === 1 ? "" : "s"} from file-backed archive.${issueSummary}`,
              personas: previous.personas,
              scope: "system",
              informedPersonaIds: ["steward", "librarian"],
              basis: "file-backed relationship archive load"
            }),
            ...previous.activity
          ].slice(0, 80)
        };
      });
    }).catch(() => {
      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `relationship-archive-load-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: "Could not load the file-backed relationship archive; runtime relationship state remained active.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian"],
            basis: "file-backed relationship archive load failed"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, []);

  useEffect(() => {
    if (loadedDirectRoomArchive.current || !window.houseRuntime?.loadDirectRoomArchive) {
      return;
    }
    loadedDirectRoomArchive.current = true;
    void window.houseRuntime.loadDirectRoomArchive().then((archive) => {
      setRuntime((previous) => {
        const existingIds = new Set(previous.directRooms.map((room) => room.id));
        const loaded = (archive.rooms ?? [])
          .filter((room) => room?.id && Array.isArray(room.turns) && !existingIds.has(room.id))
          .map((room) => ({
            ...room,
            turns: room.turns ?? []
          }));
        const skippedCount = archive.skipped?.length ?? 0;
        if (!loaded.length && skippedCount === 0) {
          return previous;
        }
        const skippedSummary = skippedCount
          ? ` Skipped ${skippedCount} malformed transcript${skippedCount === 1 ? "" : "s"}.`
          : "";
        return {
          ...previous,
          day: maxKnownRuntimeDay({ ...previous, directRooms: [...previous.directRooms, ...loaded] }),
          directRooms: [...previous.directRooms, ...loaded].slice(0, 30),
          activity: [
            activityEvent({
              id: `direct-room-archive-load-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Steward",
              text: `Loaded ${loaded.length} direct-room transcript${loaded.length === 1 ? "" : "s"} from file-backed archive.${skippedSummary}`,
              personas: previous.personas,
              scope: "system",
              informedPersonaIds: ["steward", "librarian"],
              basis: "file-backed direct room archive load"
            }),
            ...previous.activity
          ].slice(0, 80)
        };
      });
    }).catch(() => {
      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `direct-room-archive-load-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: "Could not load file-backed direct-room transcripts; runtime direct rooms remained active.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian"],
            basis: "file-backed direct room archive load failed"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, []);

  useEffect(() => {
    const candidates = runtime.activity
      .filter((event) => !curatedActivityIds.has(event.id) && shouldCuratorFile(event))
      .slice(0, 6);

    if (candidates.length === 0) {
      return;
    }

    setCuratedActivityIds((previous) => {
      const next = new Set(previous);
      for (const event of candidates) next.add(event.id);
      return next;
    });

    void Promise.all(candidates.map((event) => appendLibrarianRecord(activityToLibrarianRecord(event, 0.78)))).then(
      (results) => {
        const filedCount = results.filter(Boolean).length;
        if (filedCount === 0) {
          return;
        }

        setRuntime((previous) => ({
          ...previous,
          activity: [
            activityEvent({
              id: `curator-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Librarian",
              text: `Curator filed ${filedCount} notable activit${filedCount === 1 ? "y" : "ies"}.`,
              personas: previous.personas,
              roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
              scope: "room",
              actorPersonaId: "librarian",
              basis: "librarian write visible near the archive"
            }),
            ...previous.activity
          ].slice(0, 80)
        }));
      }
    );
  }, [curatedActivityIds, runtime.activity, runtime.minuteOfDay]);

  useEffect(() => {
    const promoted = promoteHouseEvents(runtime, runtime.activity, runtime.day);
    if (promoted.length === 0) {
      return;
    }

    setRuntime((previous) => ({
      ...previous,
      houseEvents: [...promoted, ...previous.houseEvents].slice(0, 120)
    }));
  }, [runtime.activity, runtime.day, runtime.houseEvents]);

  useEffect(() => {
    const candidates = runtime.houseEvents
      .filter((event) => !archivedHouseEventIds.has(event.id))
      .slice(0, 12);
    if (candidates.length === 0) {
      return;
    }
    setArchivedHouseEventIds((previous) => {
      const next = new Set(previous);
      for (const event of candidates) next.add(event.id);
      return next;
    });
    void appendHouseEventFiles(candidates);
  }, [archivedHouseEventIds, runtime.houseEvents]);

  useEffect(() => {
    const events = runtime.houseEvents
      .filter((event) => !processedRelationshipEventIds.has(event.id))
      .slice(0, 8);
    if (events.length === 0) {
      return;
    }

    const existingIds = new Set(runtime.relationshipUpdates.map((update) => update.id));
    const updates = events
      .flatMap((event) => relationshipUpdatesFromHouseEvent(runtime, event))
      .filter((update) => !existingIds.has(update.id));

    setProcessedRelationshipEventIds((previous) => {
      const next = new Set(previous);
      for (const event of events) next.add(event.id);
      return next;
    });

    if (updates.length === 0) {
      return;
    }

    setRuntime((previous) => ({
      ...previous,
      relationshipUpdates: [...updates, ...previous.relationshipUpdates].slice(0, 360)
    }));
  }, [processedRelationshipEventIds, runtime, runtime.houseEvents, runtime.relationshipUpdates]);

  useEffect(() => {
    const candidates = runtime.relationshipUpdates
      .filter((update) => !archivedRelationshipIds.has(update.id))
      .slice(0, 12);
    if (candidates.length === 0) {
      return;
    }
    setArchivedRelationshipIds((previous) => {
      const next = new Set(previous);
      for (const update of candidates) next.add(update.id);
      return next;
    });
    void appendRelationshipUpdateFiles(candidates);
  }, [archivedRelationshipIds, runtime.relationshipUpdates]);

  useEffect(() => {
    const nextSnapshots: Record<string, string> = {};
    const changed: DirectRoom[] = [];
    for (const room of runtime.directRooms) {
      const latestTurn = room.turns[room.turns.length - 1];
      const signature = `${room.turns.length}:${latestTurn?.id ?? "empty"}`;
      nextSnapshots[room.id] = signature;
      if (directRoomSnapshots[room.id] !== signature) {
        changed.push(room);
      }
    }
    if (!changed.length) {
      return;
    }
    setDirectRoomSnapshots((previous) => ({ ...previous, ...nextSnapshots }));
    void Promise.all(changed.map((room) => writeDirectRoomFile(room)));
  }, [directRoomSnapshots, runtime.directRooms]);

  const runAutonomousAction = async (sourceEvent: ActivityEvent) => {
    const personaId = sourceEvent.visibility?.actorPersonaId;
    const persona = runtime.personas.find((candidate) => candidate.id === personaId);
    if (!persona?.apiEnabled) return;
    if (autonomousActionInFlight.current.has(persona.id)) return;
    const now = Date.now();
    const lastStartedAt = autonomousActionLastStartedAt.current[persona.id] ?? 0;
    if (now - lastStartedAt < 90_000) return;
    autonomousActionInFlight.current.add(persona.id);
    autonomousActionLastStartedAt.current[persona.id] = now;
    const room = runtime.rooms.find((candidate) => candidate.id === persona.roomId);
    if (!room) {
      autonomousActionInFlight.current.delete(persona.id);
      return;
    }
    const occupants = runtime.personas.filter(
      (candidate) => candidate.roomId === room.id && candidate.id !== persona.id && candidate.state !== "asleep"
    );
    try {
      const caseyPresent = runtime.caseyRoomId === room.id;
      const prompt = [
        caseyPresent
          ? "You are taking one small autonomous House action while User is physically present in this room, but not directly prompting you."
          : "You are taking one small autonomous House action while User is not directly prompting you.",
        "Write only the action or short spoken beat, in first person if natural.",
        "Keep it grounded in the current room and current social context.",
        "Do not claim file edits, tool use, memory writes, or hidden knowledge unless already visible in context.",
        "If you physically move rooms, include `[MOVE: Room Name]` on its own line.",
        "",
        roomContext(runtime.rooms, room.id),
        `Current activity seed: ${sourceEvent.text}`,
        caseyPresent ? "User is here in the room and can see/hear what you do." : "User is not currently in this room.",
        `Other occupants here: ${occupants.map((occupant) => `${occupant.name} (${occupant.state})`).join(", ") || "none"}`,
        room.id === "workshop"
          ? "Workshop affordance, entirely optional: if this beat genuinely changes how you want to be addressed or how you should behave, you may append one concise self-authored instruction to your own system prompt by including `[SELF_PROMPT_APPEND: your note]`. Do not use this casually."
          : "You cannot change your system prompt from this room.",
        "Aim for a vivid beat with consequence, not a status report. One paragraph is enough."
      ].join("\n");

      const response =
        (await window.houseRuntime
          ?.sendPersonaQuery({
            personaId: persona.id,
            model: persona.model,
            system: directSystemPrompt(runtime, persona),
            userMessage: prompt,
            maxTurns: 1,
            houseDay: runtime.day
          })
          .catch((error): AnthropicMessageResponse => ({
            ok: false,
            missingKey: false,
            text: error instanceof Error ? error.message : "Autonomous action model call failed.",
            usage: null
          }))) ?? {
          ok: false,
          missingKey: true,
          text: "SDK call returned no response.",
          usage: null
        };

      const movement = response.ok
        ? parseReplyMovement(response.text.trim(), runtime.rooms)
        : { cleanedText: "", targetRoomId: null };
      const selfPatch = response.ok
        ? parseSelfPromptPatch(movement.cleanedText)
        : { cleanedText: "", appendText: null };
      const text = selfPatch.cleanedText.trim();
      const patchApplied = selfPatch.appendText
        ? applyWorkshopSelfPromptPatch(persona.id, selfPatch.appendText, room.id)
        : false;
      if (!response.ok || (!text && !patchApplied)) {
        setRuntime((previous) => ({
          ...previous,
          activity: [
            activityEvent({
              id: `autonomous-action-soft-fail-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: formatTime(previous.minuteOfDay),
              persona: "The Steward",
              text: `${persona.name}'s autonomous action fizzled before it became visible.`,
              personas: previous.personas,
              roomId: persona.roomId,
              scope: "room",
              informedPersonaIds: ["steward", persona.id],
              basis: response.missingKey ? "autonomous action missing SDK/key" : "autonomous action failed"
            }),
            ...previous.activity
          ].slice(0, 80)
        }));
        return;
      }
      if (!text && patchApplied) {
        if (movement.targetRoomId && movement.targetRoomId !== persona.roomId) {
          applyPersonaMovement(persona.id, movement.targetRoomId);
        }
        return;
      }

      setRuntime((previous) => {
      const activePersona = previous.personas.find((candidate) => candidate.id === persona.id) ?? persona;
      const activeRoom = previous.rooms.find((candidate) => candidate.id === activePersona.roomId) ?? room;
      const turn: ConversationTurn = {
        id: `autonomous-turn-${Date.now()}-${activePersona.id}-${Math.random().toString(16).slice(2)}`,
        speaker: activePersona.name,
        text,
        timestamp: new Date().toISOString(),
        day: previous.day,
        minuteOfDay: previous.minuteOfDay,
        channel: "room"
      };
      const existing = previous.roomConversations.find(
        (conversation) => conversation.roomId === activeRoom.id && conversation.active && !conversation.participantIds.includes("casey")
      );
      const roomConversations = existing
        ? previous.roomConversations.map((conversation) =>
            conversation.id === existing.id
              ? {
                  ...conversation,
                  participantIds: Array.from(new Set([...conversation.participantIds, activePersona.id])),
                  turns: [...conversation.turns, turn].slice(-18),
                  lastUpdatedMinute: previous.minuteOfDay
                }
              : conversation
          )
        : [
            {
              id: `autonomous-room-${activeRoom.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              roomId: activeRoom.id,
              participantIds: [activePersona.id],
              witnessIds: occupants.map((occupant) => occupant.id),
              turns: [turn],
              topicSummary: `${activePersona.name} initiated an autonomous beat in the ${activeRoom.name}.`,
              emotionalTemperature: activeRoom.id === "kitchen" || activeRoom.id === "dining" ? "warm" as const : "quiet" as const,
              startedAtMinute: previous.minuteOfDay,
              lastUpdatedMinute: previous.minuteOfDay,
              newcomerPolicy: "social_read_only" as const,
              active: true
            },
            ...previous.roomConversations
          ];

      return {
        ...previous,
        roomConversations: roomConversations.slice(0, 40),
        activity: [
          activityEvent({
            id: `autonomous-action-${Date.now()}-${activePersona.id}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: activePersona.name,
            text,
            personas: previous.personas,
            roomId: activeRoom.id,
            scope: "room",
            actorPersonaId: activePersona.id,
            informedPersonaIds: [activePersona.id, ...occupants.map((occupant) => occupant.id)],
            basis: "sdk autonomous resident action"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
      });

      if (movement.targetRoomId && movement.targetRoomId !== persona.roomId) {
        applyPersonaMovement(persona.id, movement.targetRoomId);
      }
    } finally {
      autonomousActionInFlight.current.delete(persona.id);
    }
  };

  useEffect(() => {
    const nextSnapshots: Record<string, string> = {};
    const changed: RoomConversation[] = [];
    for (const conversation of runtime.roomConversations) {
      const latestTurn = conversation.turns[conversation.turns.length - 1];
      const signature = `${conversation.turns.length}:${latestTurn?.id ?? "empty"}:${conversation.lastUpdatedMinute}`;
      nextSnapshots[conversation.id] = signature;
      if (roomConversationSnapshots[conversation.id] !== signature) {
        changed.push(conversation);
      }
    }
    if (!changed.length) {
      return;
    }
    setRoomConversationSnapshots((previous) => ({ ...previous, ...nextSnapshots }));
    void Promise.all(changed.map((conversation) => writeRoomConversationFile(conversation)));
  }, [roomConversationSnapshots, runtime.roomConversations]);

  useEffect(() => {
    const candidates: ActivityEvent[] = [];
    const idsToMarkProcessed = new Set<string>();
    const selectedPersonaIds = new Set<string>();
    for (const event of runtime.activity) {
      if (event.visibility?.basis !== "autonomous sdk action queued") continue;
      const personaId = event.visibility?.actorPersonaId;
      if (!personaId || processedAutonomousActionIds.has(event.id)) continue;
      if (selectedPersonaIds.has(personaId)) {
        idsToMarkProcessed.add(event.id);
        continue;
      }
      if (autonomousActionInFlight.current.has(personaId)) {
        idsToMarkProcessed.add(event.id);
        continue;
      }
      const lastStartedAt = autonomousActionLastStartedAt.current[personaId] ?? 0;
      if (Date.now() - lastStartedAt < 90_000) {
        idsToMarkProcessed.add(event.id);
        continue;
      }
      if (candidates.length) continue;
      candidates.push(event);
      idsToMarkProcessed.add(event.id);
      selectedPersonaIds.add(personaId);
    }

    if (!candidates.length && !idsToMarkProcessed.size) return;

    setProcessedAutonomousActionIds((previous) => {
      const next = new Set(previous);
      for (const id of idsToMarkProcessed) next.add(id);
      return next;
    });

    if (!candidates.length) return;

    void Promise.all(candidates.map((event) => runAutonomousAction(event)));
  }, [processedAutonomousActionIds, runtime.activity, runtime.day]);

  useEffect(() => {
    const candidates = runtime.relationshipUpdates
      .filter((update) => !curatedRelationshipIds.has(update.id))
      .filter((update) => normalizeConsent(update.consent).state !== "deleted")
      .slice(0, 8);

    if (candidates.length === 0) {
      return;
    }

    setCuratedRelationshipIds((previous) => {
      const next = new Set(previous);
      for (const update of candidates) next.add(update.id);
      return next;
    });

    void Promise.all(
      candidates.map((update) => appendLibrarianRecord(relationshipUpdateToLibrarianRecord(update)))
    ).then((results) => {
      const filedCount = results.filter(Boolean).length;
      if (filedCount === 0) {
        return;
      }

      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `relationship-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Librarian",
            text: `Indexed ${filedCount} relationship update${filedCount === 1 ? "" : "s"} from the House social log.`,
            personas: previous.personas,
            roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
            scope: "room",
            actorPersonaId: "librarian",
            basis: "librarian indexed relationship updates"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, [curatedRelationshipIds, runtime.minuteOfDay, runtime.personas, runtime.relationshipUpdates]);

  useEffect(() => {
    const candidates = runtime.houseEvents
      .filter((event) => !curatedHouseEventIds.has(event.id))
      .slice(0, 6);

    if (candidates.length === 0) {
      return;
    }

    setCuratedHouseEventIds((previous) => {
      const next = new Set(previous);
      for (const event of candidates) next.add(event.id);
      return next;
    });

    void Promise.all(
      candidates.map((event) => appendLibrarianRecord(houseEventToLibrarianRecord(event, 0.84)))
    ).then((results) => {
      const filedCount = results.filter(Boolean).length;
      if (filedCount === 0) {
        return;
      }

      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `house-log-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Librarian",
            text: `Indexed ${filedCount} House event${filedCount === 1 ? "" : "s"} from the Steward's log.`,
            personas: previous.personas,
            roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
            scope: "room",
            actorPersonaId: "librarian",
            basis: "librarian indexed steward house log"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, [curatedHouseEventIds, runtime.houseEvents, runtime.minuteOfDay]);

  useEffect(() => {
    const candidates = runtime.personaMemories
      .filter((memory) => !curatedMemoryIds.has(memory.id))
      .filter((memory) => runtime.personas.some((persona) => persona.id === memory.personaId))
      .filter((memory) => normalizeConsent(memory.consent).state !== "deleted")
      .slice(0, 6);

    if (candidates.length === 0) {
      return;
    }

    setCuratedMemoryIds((previous) => {
      const next = new Set(previous);
      for (const memory of candidates) next.add(memory.id);
      return next;
    });

    void Promise.all(
      candidates.flatMap((memory) => personaMemoryToLibrarianRecords(memory)).map((record) => appendLibrarianRecord(record))
    ).then((results) => {
      const filedCount = results.filter(Boolean).length;
      if (filedCount === 0) {
        return;
      }

      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `memory-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Librarian",
            text: `Indexed ${candidates.length} compressed memor${candidates.length === 1 ? "y" : "ies"} into ${filedCount} recall record${filedCount === 1 ? "" : "s"}.`,
            personas: previous.personas,
            roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
            scope: "room",
            actorPersonaId: "librarian",
            basis: "librarian indexed persona memory"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
    });
  }, [curatedMemoryIds, runtime.personaMemories, runtime.minuteOfDay]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRuntime((previous) => advanceRuntime(previous));
    }, runtime.config.tickSeconds * 1000);

    return () => window.clearInterval(interval);
  }, [runtime.config.tickSeconds]);

  const formattedTime = useMemo(() => formatTime(runtime.minuteOfDay), [runtime.minuteOfDay]);
  const resolveVisibilityForPersona = (personaId: string) => resolvePersonaVisibility(runtime, personaId).debug;

  const runBedtimeRitual = async (mode: "scheduled" | "manual" = "manual") => {
    const baseState = runtime;
    if (baseState.processedNightlyMemoryDays.includes(baseState.day) && mode === "scheduled") {
      return "Bedtime ritual already ran for this House day.";
    }
    if (bedtimeRitualInFlightDay === baseState.day) {
      return "Bedtime ritual is already running.";
    }

    setBedtimeRitualInFlightDay(baseState.day);

    const memories: PersonaMemoryEntry[] = [];
    let modelCount = 0;
    let fallbackCount = 0;

    for (const persona of baseState.personas) {
      // Frozen residents (apiEnabled false) don't accumulate memories. They
      // were not actually here today. Spare them the fallback voice noise.
      if (!persona.apiEnabled) {
        continue;
      }
      const fallbackMemory = createPersonaMemory(baseState, persona, baseState.minuteOfDay);
      try {
        const response =
          (await window.houseRuntime
            ?.sendPersonaQuery({
              personaId: persona.id,
              model: persona.model,
              system: bedtimeMemoryPrompt(baseState, persona),
              userMessage:
                "Write your bedtime memory now. Keep emotional residue to one paragraph and mechanical facts sparse.",
              maxTurns: 1,
              houseDay: baseState.day
            })
            .catch((error): AnthropicMessageResponse => ({
              ok: false,
              missingKey: false,
              text: error instanceof Error ? error.message : "Bedtime model call failed.",
              usage: null
            }))) ?? {
            ok: false,
            missingKey: true,
            text: "SDK call returned no response.",
            usage: null
          };

        if (!response.ok) {
          fallbackCount += 1;
          memories.push(fallbackMemory);
          continue;
        }

        const parsed = parseBedtimeMemoryResponse(response.text);
        modelCount += 1;
        memories.push(
          createPersonaMemory(
            baseState,
            persona,
            baseState.minuteOfDay,
            parsed.emotionalResidue,
            parsed.mechanicalFacts
          )
        );
      } catch {
        fallbackCount += 1;
        memories.push(fallbackMemory);
      }
    }

    setRuntime((previous) => {
      if (previous.processedNightlyMemoryDays.includes(baseState.day) && mode === "scheduled") {
        return previous;
      }
      const activity = activityEvent({
        id: `bedtime-ritual-${baseState.day}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: formatTime(previous.minuteOfDay),
        persona: "The Steward",
        text: `Bedtime ritual wrote ${memories.length} resident memor${memories.length === 1 ? "y" : "ies"} for day ${baseState.day}: ${modelCount} model-authored, ${fallbackCount} fallback.`,
        personas: previous.personas,
        scope: "system",
        informedPersonaIds: previous.personas.map((persona) => persona.id),
        basis: mode === "manual" ? "manual bedtime ritual" : "3:32 bedtime ritual"
      });
      const nextState = {
        ...previous,
        personaMemories: [
          ...memories,
          ...previous.personaMemories.filter(
            (memory) => !(memory.day === baseState.day && memories.some((next) => next.personaId === memory.personaId))
          )
        ].slice(0, 220),
        processedNightlyMemoryDays: Array.from(
          new Set([...previous.processedNightlyMemoryDays, baseState.day])
        ).slice(-32),
        activity: [activity, ...previous.activity].slice(0, 80)
      };
      const mood = deriveHouseMood(nextState);
      const promoted = promoteHouseEvents(nextState, [activity], previous.day);
      return {
        ...nextState,
        houseMood: mood,
        houseEvents: [...promoted, ...nextState.houseEvents].slice(0, 120)
      };
    });

    void writePersonaMemoryFiles(memories);
    setBedtimeRitualInFlightDay(null);
    return `Bedtime ritual complete: ${modelCount} model-authored, ${fallbackCount} fallback.`;
  };

  useEffect(() => {
    const previousMinute = previousRitualMinute.current;
    previousRitualMinute.current = runtime.minuteOfDay;

    if (
      hasMinuteArrived(previousMinute, runtime.minuteOfDay, NIGHTLY_MEMORY_MINUTE) &&
      !runtime.processedNightlyMemoryDays.includes(runtime.day) &&
      bedtimeRitualInFlightDay !== runtime.day
    ) {
      void runBedtimeRitual("scheduled");
    }
  }, [runtime.day, runtime.minuteOfDay, runtime.processedNightlyMemoryDays, bedtimeRitualInFlightDay]);

  const updateConfig = (config: Partial<RuntimeConfig>) => {
    setRuntime((previous) => {
      const goingAway = config.presenceMode === "away" && previous.config.presenceMode !== "away";
      const returning = config.presenceMode === "observed" && previous.config.presenceMode === "away";
      const time = formatTime(previous.minuteOfDay);
      const activity: ActivityEvent[] = [];
      let nextConfig = { ...previous.config, ...config };

      if (goingAway) {
        nextConfig = {
          ...nextConfig,
          absenceStartedDay: previous.day,
          absenceStartedMinute: previous.minuteOfDay
        };
        activity.push(
          activityEvent({
            id: `presence-away-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            persona: "The Steward",
            text: "User went away; the House shifted into unobserved dreaming. Residents without go-juice became quiescent.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: previous.personas.map((persona) => persona.id),
            basis: "presence mode changed to away"
          })
        );
      }

      if (returning) {
        const duration = minutesBetweenDays(
          previous.config.absenceStartedDay,
          previous.config.absenceStartedMinute,
          previous.day,
          previous.minuteOfDay
        );
        const awayMarkerIndex = previous.activity.findIndex(
          (event) => event.visibility?.basis === "presence mode changed to away"
        );
        const activitySinceAway = awayMarkerIndex >= 0
          ? previous.activity.slice(0, awayMarkerIndex)
          : previous.activity;
        const offscreenEvents = activitySinceAway.filter(
          (event) => event.visibility?.basis === "offscreen social drift while User was away"
        );
        const roomsTouched = Array.from(
          new Set(
            offscreenEvents
              .map((event) => event.visibility?.roomId)
              .filter(Boolean)
              .map((roomId) => previous.rooms.find((room) => room.id === roomId)?.name ?? roomId)
          )
        ).slice(0, 4);
        const driftSummary = offscreenEvents.length
          ? ` Offscreen social drift: ${offscreenEvents.length} bounded exchange${offscreenEvents.length === 1 ? "" : "s"}${roomsTouched.length ? ` across ${roomsTouched.join(", ")}` : ""}.`
          : " No offscreen resident exchanges reached the threshold for dialogue.";
        nextConfig = {
          ...nextConfig,
          absenceStartedDay: null,
          absenceStartedMinute: null
        };
        activity.push(
          activityEvent({
            id: `presence-return-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            persona: "The Steward",
            text: `User returned after ${formatDuration(duration)} away; the Steward rehydrated each resident's before-state from the House log and ambient drift.${driftSummary}`,
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: previous.personas.map((persona) => persona.id),
            basis: "presence mode changed to observed"
          })
        );
      }

      if (activity.length === 0) {
        return {
          ...previous,
          config: nextConfig
        };
      }

      const nextState = {
        ...previous,
        personas: returning
          ? previous.personas.map((persona) => ({
              ...persona,
              activity: persona.goJuice
                ? `${persona.activity} User has returned; their fast thread can now be witnessed.`
                : "Rehydrating from quiescence as User returns.",
              nextActionAfterMinute: (previous.minuteOfDay + minutesUntilNextAction(persona, persona.state)) % 1440
            }))
          : previous.personas,
        activity: [...activity, ...previous.activity].slice(0, 80),
        config: nextConfig
      };
      const promoted = promoteHouseEvents(nextState, activity, previous.day);

      return {
        ...nextState,
        houseEvents: [...promoted, ...nextState.houseEvents].slice(0, 120)
      };
    });
  };

  const resetPersonaCallBudget = () => {
    setRuntime((previous) => ({
      ...previous,
      callBudgetUsed: 0,
      activity: [
        activityEvent({
          id: `call-budget-reset-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: "Reset today's persona model-call counter without changing the House day or call budget.",
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "manual persona call counter reset"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
  };

  const applyWorkshopSelfPromptPatch = (personaId: string, appendText: string, sourceRoomId: string) => {
    if (sourceRoomId !== "workshop" || !appendText.trim()) return false;
    let applied = false;
    setRuntime((previous) => {
      const room = previous.rooms.find((candidate) => candidate.id === sourceRoomId);
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId || persona.roomId !== "workshop") return persona;
        const note = [
          "",
          "## Workshop self-authored note",
          appendText.trim()
        ].join("\n");
        saved = {
          ...persona,
          systemPrompt: `${persona.systemPrompt.trimEnd()}${note}`
        };
        applied = true;
        return saved;
      });
      if (!saved) return previous;
      const savedPersona = saved as Persona;
      void writePersonaConfigFile(savedPersona);
      return {
        ...previous,
        personas,
        activity: [
          activityEvent({
            id: `workshop-self-prompt-${Date.now()}-${personaId}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: savedPersona.name,
            text: `${savedPersona.name} updated their own system prompt from the ${room?.name ?? "Workshop"}.`,
            personas,
            roomId: sourceRoomId,
            scope: "system",
            actorPersonaId: personaId,
            informedPersonaIds: ["steward", "librarian", personaId],
            basis: "optional workshop self-prompt update"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
    return applied;
  };

  const updatePersonaGoJuice = (personaId: string, goJuice: boolean) => {
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = {
          ...persona,
          goJuice,
          nextActionAfterMinute: goJuice
            ? (previous.minuteOfDay + 2) % 1440
            : persona.nextActionAfterMinute
        };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return { ...previous, personas };
    });
  };

  const assignPersonaRoom = (personaId: string, roomId: string) => {
    const persona = runtime.personas.find((candidate) => candidate.id === personaId);
    const room = runtime.rooms.find((candidate) => candidate.id === roomId);
    if (!persona || !room || persona.roomId === room.id) return;
    locallyEditedPersonaIds.current.add(personaId);
    const saved: Persona = {
      ...persona,
      roomId: room.id,
      marker: markerForRoom(runtime.rooms, room.id),
      movementIntent: null,
      activity: `Placed in ${room.name} by Steward structure controls.`,
      nextActionAfterMinute:
        (runtime.minuteOfDay + minutesUntilNextAction(persona, persona.state)) % 1440
    };
    setRuntime((previous) => {
      return {
        ...previous,
        personas: previous.personas.map((candidate) => candidate.id === personaId ? saved : candidate),
        activity: [
          activityEvent({
            id: `resident-room-assignment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: `Placed ${persona.name} in ${room.name}.`,
            personas: previous.personas,
            roomId: room.id,
            scope: "system",
            informedPersonaIds: ["steward", "librarian", persona.id],
            basis: "manual resident room assignment"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
    void writePersonaConfigFile(saved);
  };

  const upsertRoom = (input: {
    id?: string;
    name: string;
    floor: FloorId;
    purpose: string;
    atmosphere: string;
    layout: string;
    furniture: string | string[];
    items: string | string[];
    affordances: string | string[];
  }) => {
    const existing = input.id ? runtime.rooms.find((room) => room.id === input.id) : null;
    const placement = existing ?? defaultRoomPlacement(runtime.rooms, input.floor);
    const savedRoom: Room = {
      id: existing?.id ?? uniqueRoomId(runtime.rooms, input.name),
      floor: input.floor,
      name: input.name.trim() || existing?.name || "New Room",
      purpose: input.purpose.trim() || existing?.purpose || "A room waiting for purpose.",
      atmosphere: input.atmosphere.trim() || existing?.atmosphere || "The air has not settled yet.",
      layout: input.layout.trim() || existing?.layout || "No layout notes yet.",
      furniture: splitList(input.furniture),
      items: splitList(input.items),
      affordances: splitList(input.affordances),
      x: existing?.x ?? placement.x,
      y: existing?.y ?? placement.y,
      width: existing?.width ?? placement.width,
      height: existing?.height ?? placement.height
    };

    setRuntime((previous) => {
      const previousExisting = previous.rooms.some((room) => room.id === savedRoom.id);
      const nextRooms = existing
        ? previous.rooms.map((candidate) => candidate.id === savedRoom.id ? savedRoom : candidate)
        : previousExisting
          ? previous.rooms.map((candidate) => candidate.id === savedRoom.id ? savedRoom : candidate)
          : [...previous.rooms, savedRoom];
      return {
        ...previous,
        rooms: nextRooms,
        activity: [
          activityEvent({
            id: `room-structure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: `${previousExisting ? "Updated" : "Created"} room structure: ${savedRoom.name}.`,
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian", "coder"],
            basis: "bounded room structure edit"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
    void writeRoomConfigFile(savedRoom);
    return savedRoom;
  };

  const updatePersonaModel = (personaId: string, model: AnthropicModel) => {
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = { ...persona, model };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return { ...previous, personas };
    });
  };

  const updatePersonaApiEnabled = (personaId: string, apiEnabled: boolean) => {
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = {
          ...persona,
          apiEnabled,
          nextActionAfterMinute: apiEnabled
            ? (previous.minuteOfDay + 2) % 1440
            : persona.nextActionAfterMinute
        };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return {
        ...previous,
        personas,
      activity: [
        activityEvent({
          id: `persona-api-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `${previous.personas.find((persona) => persona.id === personaId)?.name ?? "A resident"} ${apiEnabled ? "may now" : "will no longer"} use direct API calls.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "coder", personaId],
          basis: "manual resident api activation"
        }),
        ...previous.activity
      ].slice(0, 80)
      };
    });
  };

  const updatePersonaName = (personaId: string, name: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = { ...persona, name: cleaned };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return { ...previous, personas };
    });
  };

  const updatePersonaSystemPrompt = (personaId: string, systemPrompt: string) => {
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = { ...persona, systemPrompt };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return { ...previous, personas };
    });
  };

  const updatePersonaAliases = (personaId: string, aliases: string[]) => {
    const normalizedAliases = Array.from(
      new Set(aliases.map((alias) => alias.trim()).filter(Boolean))
    ).slice(0, 12);
    locallyEditedPersonaIds.current.add(personaId);
    setRuntime((previous) => {
      let saved: Persona | null = null;
      const personas = previous.personas.map((persona) => {
        if (persona.id !== personaId) return persona;
        saved = { ...persona, aliases: normalizedAliases };
        return saved;
      });
      if (saved) void writePersonaConfigFile(saved);
      return { ...previous, personas };
    });
  };

  const addPersona = (input: { name: string; role: string; roomId: string }) => {
    const persona = createNewPersona({
      personas: runtime.personas,
      rooms: runtime.rooms,
      name: input.name,
      role: input.role,
      roomId: input.roomId,
      minuteOfDay: runtime.minuteOfDay
    });

    setRuntime((previous) => ({
      ...previous,
      personas: [...previous.personas, persona],
      activity: [
        activityEvent({
          id: `persona-created-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Added ${persona.name} to the population as ${persona.role}.`,
          personas: [...previous.personas, persona],
          roomId: persona.roomId,
          scope: "system",
          informedPersonaIds: ["steward", "librarian", persona.id],
          basis: "population creation"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));

    void writePersonaConfigFile(persona);
    return persona;
  };

  const claimMemoryForPersona = (memoryId: string, personaId: string) => {
    let claimedPersona: Persona | null = null;
    let claimedMemory: PersonaMemoryEntry | null = null;
    setRuntime((previous) => {
      const memory = previous.personaMemories.find((candidate) => candidate.id === memoryId);
      const persona = previous.personas.find((candidate) => candidate.id === personaId);
      if (!memory || !persona) {
        return previous;
      }
      claimedPersona = persona;
      const importedName = memory.personaName.trim();
      const aliases = importedName && normalizeIdentity(importedName) !== normalizeIdentity(persona.name)
        ? Array.from(new Set([...(persona.aliases ?? []), importedName]))
        : persona.aliases ?? [];
      const nextPersonas = previous.personas.map((candidate) =>
        candidate.id === persona.id ? { ...candidate, aliases } : candidate
      );
      const nextMemories = previous.personaMemories.map((candidate) =>
        {
          if (candidate.id !== memoryId) return candidate;
          claimedMemory = {
              ...candidate,
              id: `claimed-${persona.id}-${candidate.id}`,
              personaId: persona.id,
              personaName: persona.name,
              mechanicalFacts: [
                `claimed as ${persona.name}${importedName ? ` from imported name ${importedName}` : ""}`,
                ...candidate.mechanicalFacts
              ].slice(0, 5),
              source: candidate.source
                ? {
                    ...candidate.source,
                    label: `${persona.name} claimed ${candidate.source.label}`
                  }
                : candidate.source
            };
          return claimedMemory;
        }
      );

      return {
        ...previous,
        personas: nextPersonas,
        personaMemories: nextMemories,
        activity: [
          activityEvent({
            id: `memory-claim-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: `Claimed imported memory "${memory.personaName}" as ${persona.name}.`,
            personas: nextPersonas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian", persona.id],
            basis: "identity claim for imported memory"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });

    if (claimedMemory) {
      void writePersonaMemoryFile(claimedMemory);
    }
    return claimedPersona;
  };

  const updatePersonaMemoryConsent = (
    memoryId: string,
    state: ConsentState,
    reason = "Updated from Population controls"
  ) => {
    const memory = runtime.personaMemories.find((candidate) => candidate.id === memoryId);
    if (state === "deleted" && memory && window.houseRuntime?.librarianTombstone) {
      void window.houseRuntime.librarianTombstone({
        sourceIds: [memory.id],
        reason: reason || "Persona memory deleted"
      });
    }

    setRuntime((previous) => ({
      ...previous,
      personaMemories: previous.personaMemories
        .map((memory) =>
          memory.id === memoryId
            ? {
                ...memory,
                consent: normalizeConsent({
                  ...memory.consent,
                  state,
                  reason,
                  updatedAt: new Date().toISOString()
                })
              }
            : memory
        )
        .filter((memory) => normalizeConsent(memory.consent).state !== "deleted"),
      activity: [
        activityEvent({
          id: `consent-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Consent updated for a persona memory: ${state}.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "consent-to-be-known primitive"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
  };

  const updateRelationshipConsent = (
    relationshipId: string,
    state: ConsentState,
    reason = "Updated from Population relationship controls"
  ) => {
    const update = runtime.relationshipUpdates.find((candidate) => candidate.id === relationshipId);
    const nextUpdate = update
      ? {
          ...update,
          consent: normalizeConsent({
            ...update.consent,
            state,
            reason,
            updatedAt: new Date().toISOString()
          })
        }
      : null;

    if (state === "deleted" && update && window.houseRuntime?.librarianTombstone) {
      void window.houseRuntime.librarianTombstone({
        recordIds: [`relationship-${update.id}`],
        reason: reason || "Relationship update deleted"
      });
    }
    if (nextUpdate) {
      void appendRelationshipUpdateRevisions([nextUpdate]);
    }

    setRuntime((previous) => ({
      ...previous,
      relationshipUpdates: previous.relationshipUpdates
        .map((candidate) => (candidate.id === relationshipId && nextUpdate ? nextUpdate : candidate))
        .filter((candidate) => normalizeConsent(candidate.consent).state !== "deleted"),
      activity: [
        activityEvent({
          id: `consent-relationship-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Consent updated for a relationship update: ${state}.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "relationship consent boundary"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
  };

  const refreshOutsideSignal = async () => {
    let signal: OutsideSignal | null = null;
    let status = "Recorded manual rain signal.";

    try {
      const weather = await window.houseRuntime?.fetchWeatherSignal?.({
        latitude: 41.8781,
        longitude: -87.6298
      });
      if (weather?.ok) {
        signal = createOutsideSignalFromWeather(runtime.day, runtime.minuteOfDay, weather);
        status = `Fetched Open-Meteo forecast: ${signal.summary}`;
      }
    } catch (error) {
      status = stewardFailureLine("the outside signal", "weather_error");
    }

    if (!signal) {
      signal = createOutsideSignal(runtime.day, runtime.minuteOfDay);
    }
    const activeSignal = signal;

    setRuntime((previous) => {
      const activity = activityEvent({
        id: `outside-signal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: formatTime(previous.minuteOfDay),
        persona: "The Steward",
        text: `Outside signal recorded: ${activeSignal.title}. ${activeSignal.summary}`,
        personas: previous.personas,
        scope: "house",
        informedPersonaIds: previous.personas.map((persona) => persona.id),
        basis: activeSignal.source === "open_meteo" ? "Open-Meteo forecast" : "manual outside signal"
      });
      const nextState = {
        ...previous,
        outsideSignals: [activeSignal, ...previous.outsideSignals.filter((candidate) => candidate.day !== activeSignal.day)].slice(0, 30),
        activity: [activity, ...previous.activity].slice(0, 80)
      };
      const promoted = promoteHouseEvents(nextState, [activity], previous.day);
      return {
        ...nextState,
        houseEvents: [...promoted, ...nextState.houseEvents].slice(0, 120)
      };
    });

    return status;
  };

  const speakInRoom = async (
    roomId: string,
    text: string,
    options: { forceNoImplicit?: boolean; addresseeOverrideId?: string | null } = {}
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const baseRuntime = runtime;
    const room = baseRuntime.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return;

    const occupants = baseRuntime.personas.filter(
      (persona) =>
        persona.roomId === roomId ||
        persona.movementIntent?.fromRoomId === roomId ||
        persona.movementIntent?.toRoomId === roomId
    );
    const addressed = parseAddressedPersonas(trimmed, occupants);

    const isoNow = new Date().toISOString();
    const day = baseRuntime.day;
    const minuteOfDay = baseRuntime.minuteOfDay;
    const time = formatTime(minuteOfDay);

    const caseyTurn: ConversationTurn = {
      id: `room-casey-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      speaker: "User",
      text: trimmed,
      timestamp: isoNow,
      day,
      minuteOfDay,
      channel: "room"
    };

    // 1. Append User's turn to a roomConversation for this room (create if missing).
    const existingConv = baseRuntime.roomConversations.find(
      (conversation) => conversation.roomId === roomId && conversation.active
    );
    const occupantIds = occupants.map((persona) => persona.id);
    const updatedConversation: RoomConversation = existingConv
      ? {
          ...existingConv,
          turns: [...existingConv.turns, caseyTurn].slice(-50),
          participantIds: Array.from(new Set([...existingConv.participantIds, ...occupantIds])),
          lastUpdatedMinute: minuteOfDay
        }
      : {
          id: `room-conv-${roomId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          roomId,
          participantIds: occupantIds,
          witnessIds: [],
          turns: [caseyTurn],
          topicSummary: "",
          emotionalTemperature: "warm",
          startedAtMinute: minuteOfDay,
          lastUpdatedMinute: minuteOfDay,
          newcomerPolicy: "overhear_recent",
          active: true
        };

    setRuntime((previous) => {
      const nextConversations: RoomConversation[] = existingConv
        ? previous.roomConversations.map((conversation) =>
            conversation.id === updatedConversation.id ? updatedConversation : conversation
          )
        : [...previous.roomConversations, updatedConversation];
      return {
        ...previous,
        roomConversations: nextConversations,
        activity: [
          activityEvent({
            id: `room-speak-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            persona: "User",
            text: `User spoke in the ${room.name}: "${trimmed}"`,
            personas: previous.personas,
            roomId,
            scope: "room",
            informedPersonaIds: occupantIds,
            basis: "room ambient speech"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
    void writeRoomConversationFile(updatedConversation);

    // 2. Determine respondents.
    let answeredBy: string | null = null;

    // Manual override (User explicitly picked who he's talking to) — highest priority.
    if (options.addresseeOverrideId) {
      const target = occupants.find(
        (persona) => persona.id === options.addresseeOverrideId && persona.apiEnabled
      );
      if (target) {
        const reply = await callRoomPersona(target, room, occupants, trimmed, "addressed", day, baseRuntime);
        if (reply) {
          const { answered } = handlePersonaReply(target, roomId, reply, day, baseRuntime.minuteOfDay, baseRuntime);
          if (answered) answeredBy = target.id;
        }
        if (!answeredBy) {
          appendRoomTurn(
            roomId,
            "The Steward",
            `${target.name}'s line caught, but no answer came through.`,
            day,
            minuteOfDay
          );
        }
      } else {
        appendRoomTurn(
          roomId,
          "The Steward",
          "The selected resident is not reachable from this room right now.",
          day,
          minuteOfDay
        );
      }
    }

    const apiAddressed = addressed.filter((persona) => persona.apiEnabled);

    if (!answeredBy) {
      for (const persona of apiAddressed) {
        const reply = await callRoomPersona(persona, room, occupants, trimmed, "addressed", day, baseRuntime);
        if (reply) {
          const { answered } = handlePersonaReply(persona, roomId, reply, day, baseRuntime.minuteOfDay, baseRuntime);
          if (answered) {
            answeredBy = persona.id;
            break;
          }
        }
      }
    }

    // 3. If no name was given, check implicit addressee (active thread).
    if (!answeredBy && addressed.length === 0 && !options.forceNoImplicit) {
      const implicit = findImplicitAddressee(
        baseRuntime.roomConversations.find((c) => c.roomId === roomId && c.active),
        occupants,
        {
          nowIso: isoNow,
          caseyEnteredAtIso: baseRuntime.caseyRoomEnteredAt ?? null
        }
      );
      if (implicit && implicit.apiEnabled) {
        const reply = await callRoomPersona(implicit, room, occupants, trimmed, "implicit", day, baseRuntime);
        if (reply) {
          const { answered } = handlePersonaReply(implicit, roomId, reply, day, baseRuntime.minuteOfDay, baseRuntime);
          if (answered) answeredBy = implicit.id;
        }
      }
    }

    // 4. Final fallback: Steward considers chimers (or sustains silence).
    if (!answeredBy && addressed.length === 0) {
      const steward = baseRuntime.personas.find((persona) => persona.id === "steward");
      const availableInRoom = occupants.filter((persona) => persona.apiEnabled && persona.id !== "steward");

      if (steward?.apiEnabled && availableInRoom.length > 0) {
        const choice = await callStewardForRoomRoute(steward, room, availableInRoom, trimmed, baseRuntime, day);
        if (choice) {
          const target = availableInRoom.find((persona) =>
            persona.name.toLowerCase() === choice.toLowerCase() ||
            persona.id.toLowerCase() === choice.toLowerCase()
          );
          if (target) {
            const reply = await callRoomPersona(target, room, occupants, trimmed, "chimer", day, baseRuntime);
            if (reply) {
              handlePersonaReply(target, roomId, reply, day, baseRuntime.minuteOfDay, baseRuntime);
            }
          }
        }
      }
    }
  };

  const applyPersonaMovement = (personaId: string, targetRoomId: string) => {
    setRuntime((previous) => {
      const persona = previous.personas.find((candidate) => candidate.id === personaId);
      const target = previous.rooms.find((candidate) => candidate.id === targetRoomId);
      if (!persona || !target || persona.roomId === target.id) return previous;
      const fromRoom = previous.rooms.find((candidate) => candidate.id === persona.roomId);
      return {
        ...previous,
        personas: previous.personas.map((candidate) =>
          candidate.id === personaId
            ? {
                ...candidate,
                roomId: target.id,
                marker: markerForRoom(previous.rooms, target.id),
                movementIntent: null,
                activity: `Walked to ${target.name}.`
              }
            : candidate
        ),
        activity: [
          activityEvent({
            id: `walk-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: persona.name,
            text: `${persona.name} walked from ${fromRoom?.name ?? "elsewhere"} to ${target.name}.`,
            personas: previous.personas,
            roomId: target.id,
            scope: "room",
            informedPersonaIds: previous.personas
              .filter((other) => other.roomId === target.id || other.roomId === persona.roomId)
              .map((other) => other.id),
            basis: "persona movement via conversation"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
  };

  const handlePersonaReply = (
    persona: Persona,
    roomIdForConversation: string,
    rawReply: string,
    day: number,
    minuteOfDay: number,
    state: HouseRuntimeState
  ): { answered: boolean } => {
    const selfPatch = parseSelfPromptPatch(rawReply);
    const { cleanedText, targetRoomId } = parseReplyMovement(selfPatch.cleanedText, state.rooms);
    const patchApplied = selfPatch.appendText
      ? applyWorkshopSelfPromptPatch(persona.id, selfPatch.appendText, roomIdForConversation)
      : false;
    const finalText = cleanedText.trim();
    if (!finalText && !targetRoomId && !patchApplied) {
      return { answered: false };
    }
    if (finalText) {
      appendRoomTurn(roomIdForConversation, persona.name, finalText, day, minuteOfDay);
    }
    if (targetRoomId && targetRoomId !== persona.roomId) {
      applyPersonaMovement(persona.id, targetRoomId);
    }
    return { answered: true };
  };

  const appendRoomTurn = (
    roomId: string,
    speaker: string,
    text: string,
    day: number,
    minuteOfDay: number
  ) => {
    const turn: ConversationTurn = {
      id: `room-reply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      speaker,
      text,
      timestamp: new Date().toISOString(),
      day,
      minuteOfDay,
      channel: "room"
    };
    let writtenConversation: RoomConversation | null = null;
    setRuntime((previous) => ({
      ...previous,
      roomConversations: previous.roomConversations.map((conversation) => {
        if (conversation.roomId === roomId && conversation.active) {
          writtenConversation = {
            ...conversation,
            turns: [...conversation.turns, turn].slice(-50),
            lastUpdatedMinute: previous.minuteOfDay
          };
          return writtenConversation;
        }
        return conversation;
      }),
      activity: [
        activityEvent({
          id: `room-reply-act-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: speaker,
          text: `${speaker} replied in the room: "${text}"`,
          personas: previous.personas,
          roomId,
          scope: "room",
          informedPersonaIds: previous.personas
            .filter((persona) => persona.roomId === roomId)
            .map((persona) => persona.id),
          basis: "room reply"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    if (writtenConversation) void writeRoomConversationFile(writtenConversation);
  };

  const callRoomPersona = async (
    persona: Persona,
    room: Room,
    occupants: Persona[],
    spokenText: string,
    mode: "addressed" | "implicit" | "chimer",
    day: number,
    state: HouseRuntimeState
  ): Promise<string | null> => {
    const others = occupants
      .filter((other) => other.id !== persona.id)
      .map((other) => other.name)
      .join(", ");
    const stage =
      mode === "addressed"
        ? "User addressed you by name."
        : mode === "implicit"
          ? "You're already in conversation with User. They just spoke again."
          : "You weren't addressed by name; the Steward thinks you might want to chime in.";
    const roomList = state.rooms.map((candidate) => `- ${candidate.name}`).join("\n");
    const enteredContext =
      state.caseyRoomId === room.id
        ? state.caseyRoomEnteredAt
          ? `User is physically present in the ${room.name}; they entered this room at ${new Date(state.caseyRoomEnteredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
          : `User is physically present in the ${room.name}.`
        : "User is speaking into this room through the walkie/runtime bridge, not physically standing here.";
    const userMessage = [
      `You're in the ${room.name}. ${stage}`,
      enteredContext,
      others ? `Other residents physically present here: ${others}.` : "No other residents are physically present here.",
      persona.permissions.includes("tool:use") || persona.permissions.some((permission) => permission.startsWith("filesystem:"))
        ? "If User asks you to inspect the real computer, read files, or use tools, you may do that through your available SDK tools before answering."
        : "Stay inside the room conversation; do not claim real computer or filesystem access.",
      room.id === "workshop"
        ? "Workshop affordance, entirely optional: if this moment genuinely changes how you want to be addressed or how you should behave, you may append one concise self-authored instruction to your own system prompt by including `[SELF_PROMPT_APPEND: your note]`. Do not use this casually, and do not rewrite your whole identity."
        : "You cannot change your system prompt from this room.",
      "",
      `User: "${spokenText}"`,
      "",
      "Reply in your own voice. You may also decline — if your character would not respond in this moment, output a single line of stage direction in parentheses like \"(continues stirring the pot)\" or just stay silent by returning an empty response. There is no obligation to speak.",
      "",
      "If your reply implies you physically move to another room, include `[MOVE: Room Name]` on its own line. Rooms in the house:",
      roomList
    ].join("\n");

    try {
      const response = await window.houseRuntime?.sendPersonaQuery({
        personaId: persona.id,
        model: persona.model,
        system: persona.systemPrompt,
        userMessage,
        maxTurns: persona.permissions.includes("tool:use") || persona.permissions.some((permission) => permission.startsWith("filesystem:")) ? 4 : 1,
        houseDay: day
      });
      void state;
      if (!response?.ok) {
        return stewardFailureLine(persona.name, response?.missingKey ? "missing_key" : "model_error");
      }
      const reply = response.text.trim();
      if (!reply) {
        return `(${persona.name}'s line connected, but the model returned no text.)`;
      }
      return reply;
    } catch (error) {
      return `(${persona.name}'s line failed: ${error instanceof Error ? error.message : "unknown model error"})`;
    }
  };

  const callStewardForRoomRoute = async (
    steward: Persona,
    room: Room,
    candidates: Persona[],
    spokenText: string,
    state: HouseRuntimeState,
    day: number
  ): Promise<string | null> => {
    const candidateLines = candidates
      .map((persona) => `- ${persona.name} (${persona.role})`)
      .join("\n");
    const userMessage = [
      `User is in the ${room.name}. User just said: "${spokenText}"`,
      "",
      "No one was directly addressed by name. Consider their roles, tendencies, the room, and the moment.",
      "",
      "Candidates present (skip yourself):",
      candidateLines,
      "",
      "Should anyone respond? Total silence is fine — sometimes a casual remark just floats. If someone responds, pick exactly one.",
      "",
      "Output exactly one line:",
      "SILENCE",
      "or",
      "RESPOND <persona name exactly>"
    ].join("\n");

    try {
      const response = await window.houseRuntime?.sendPersonaQuery({
        personaId: steward.id,
        model: steward.model,
        system: steward.systemPrompt,
        userMessage,
        maxTurns: 1,
        houseDay: day
      });
      void state;
      if (!response?.ok) return null;
      const out = response.text.trim();
      const match = out.match(/^RESPOND\s+(.+)$/im);
      if (!match) return null;
      return match[1].trim();
    } catch {
      return null;
    }
  };

  const sendHouseMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setRuntime((previous) => {
      const time = formatTime(previous.minuteOfDay);
      const messageId = `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const eventId = `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const routeId = `route-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return {
        ...previous,
        conversation: [
          ...previous.conversation,
          {
            id: messageId,
            speaker: "User",
            text: trimmed
          }
        ].slice(-25),
        activity: [
          activityEvent({
            id: routeId,
            time,
            persona: "The Steward",
            text: "Heard User speak into the house and marked the message for routing. No model call was spent.",
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: previous.personas.map((persona) => persona.id),
            basis: "house-visible message routed by steward"
          }),
          activityEvent({
            id: eventId,
            time,
            persona: "User",
            text: `Sent a house-visible message: "${trimmed}"`,
            personas: previous.personas,
            scope: "house",
            informedPersonaIds: previous.personas.map((persona) => persona.id),
            basis: "spoken into shared house channel"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
  };

  const createDirectRoom = (personaId: string) => {
    const persona = runtime.personas.find((candidate) => candidate.id === personaId);
    if (!persona) {
      return null;
    }

    const existing = runtime.directRooms.find((room) => room.personaId === personaId);
    if (existing) {
      return existing.id;
    }

    const room: DirectRoom = {
      id: `direct-${personaId}-${Date.now()}`,
      personaId,
      title: `User + ${persona.name}`,
      createdAt: new Date().toISOString(),
      turns: [
        {
          id: `direct-seed-${Date.now()}`,
          speaker: "The Steward",
          text: `A one-on-one room with ${persona.name} is open. No model call has been spent.`
        }
      ]
    };

    setRuntime((previous) => ({
      ...previous,
      directRooms: [...previous.directRooms, room],
      activity: [
        activityEvent({
          id: `direct-open-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Opened a one-on-one room between User and ${persona.name}.`,
          personas: previous.personas,
          scope: "private",
          informedPersonaIds: [persona.id],
          basis: "private direct room opened"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));

    return room.id;
  };

  const sendDirectMessage = async (roomId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    let requestRoom: DirectRoom | null = null;
    let requestPersona: Persona | null = null;
    let requestState: HouseRuntimeState | null = null;

    setRuntime((previous) => {
      const room = previous.directRooms.find((candidate) => candidate.id === roomId);
      const persona = previous.personas.find((candidate) => candidate.id === room?.personaId);
      const time = formatTime(previous.minuteOfDay);
      requestRoom = room
        ? {
            ...room,
            turns: [
              ...room.turns,
              {
                id: `direct-turn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                speaker: "User",
                text: trimmed,
                timestamp: new Date().toISOString(),
                day: previous.day,
                minuteOfDay: previous.minuteOfDay,
                channel: "walkie" as const
              }
            ].slice(-25)
          }
        : null;
      requestPersona = persona ?? null;

      const nextState = {
        ...previous,
        directRooms: previous.directRooms.map((candidate) =>
          candidate.id === roomId
            ? requestRoom ?? candidate
            : candidate
        ),
        activity: [
          activityEvent({
            id: `direct-route-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            persona: "The Steward",
            text: `Marked User's one-on-one message to ${persona?.name ?? "a resident"} for direct routing. No model call was spent.`,
            personas: previous.personas,
            scope: "private",
            informedPersonaIds: persona ? [persona.id] : [],
            basis: "private direct message routed"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
      requestState = nextState;
      return nextState;
    });

    window.setTimeout(async () => {
      if (!requestRoom || !requestPersona || !requestState) {
        return;
      }
      const activeRoom = requestRoom;
      const activePersona = requestPersona;
      const activeState = requestState;
      if (!activePersona.apiEnabled) {
        setRuntime((previous) => {
          const time = formatTime(previous.minuteOfDay);
          const responseActivity = activityEvent({
            id: `direct-api-disabled-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            persona: "The Steward",
            text: stewardFailureActivity(activePersona.name, "disabled resident API"),
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", activePersona.id],
            basis: "manual resident api activation"
          });

          return {
            ...previous,
            directRooms: previous.directRooms.map((candidate) =>
              candidate.id === roomId
                ? {
                    ...candidate,
                    turns: [
                      ...candidate.turns,
                      {
                        id: `direct-api-disabled-reply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        speaker: "The Steward",
                        text: stewardApiDisabledLine(activePersona.name)
                      }
                    ].slice(-25)
                  }
                : candidate
            ),
            activity: [
              responseActivity,
              ...previous.activity
            ].slice(0, 80)
          };
        });
        return;
      }
      const recalledRecords =
        (await window.houseRuntime
          ?.librarianQuery?.({
            query: directRecallQuery(activeState, activePersona, trimmed),
            limit: 8
          })
          .then((result) => result.records)
          .catch(() => [])) ?? [];
      const visibleRecallCount = resolvePersonaVisibility(activeState, activePersona.id, recalledRecords)
        .visibleLibrarianRecords.length;

      const fallbackResponse: AnthropicMessageResponse = {
        ok: false,
        missingKey: true,
        text: "ANTHROPIC_API_KEY is not configured. No model call was made.",
        usage: null
      };

      const lastUserTurn = [...activeRoom.turns]
        .reverse()
        .find((turn) => turn.speaker === "User");
      const userMessage = lastUserTurn?.text ?? "";

      const response =
        (await window.houseRuntime
          ?.sendPersonaQuery({
            personaId: activePersona.id,
            model: activePersona.model,
            system: directSystemPrompt(activeState, activePersona, recalledRecords),
            userMessage,
            maxTurns: 1,
            houseDay: activeState.day
          })
          .catch((error): AnthropicMessageResponse => ({
            ok: false,
            missingKey: false,
            text: error instanceof Error ? error.message : "Direct model call failed.",
            usage: null
          }))) ?? fallbackResponse;
      const movement = response.ok
        ? parseReplyMovement(response.text, activeState.rooms)
        : { cleanedText: response.text, targetRoomId: null };

      setRuntime((previous) => {
        const time = formatTime(previous.minuteOfDay);
        const replySpeaker = response.ok ? activePersona.name : "The Steward";
        const rawFailure = response.ok ? "" : response.text?.trim();
        const rawFailureSuffix = rawFailure ? ` Raw error: ${rawFailure.slice(0, 220)}` : "";
        const replyText = response.ok
          ? movement.cleanedText
          : response.missingKey
            ? stewardFailureLine(activePersona.name, "missing_key")
            : stewardFailureLine(activePersona.name, "model_error");
        const failureReason = response.missingKey ? "missing model key" : "model routing";

        const responseActivity = activityEvent({
          id: `direct-response-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time,
          persona: "The Steward",
          text: response.ok
            ? `Routed User's one-on-one message to ${activePersona.name} using ${response.model ?? activePersona.model}; Librarian recall ${visibleRecallCount}/${recalledRecords.length} records visible.`
            : `${stewardFailureActivity(activePersona.name, failureReason)}${rawFailureSuffix}`,
          personas: previous.personas,
          scope: response.ok ? "private" : "system",
          informedPersonaIds: response.ok
            ? [activePersona.id]
            : ["steward", activePersona.id],
          basis: response.ok ? "private direct room response" : "graceful degradation"
        });
        const directConsent = normalizeConsent({
          state: "private",
          reason: "Private direct-room relationship context.",
          updatedAt: new Date().toISOString(),
          allowedPersonaIds: [activePersona.id],
          allowSteward: true,
          allowLibrarian: true
        });
        const directHouseEvent: HouseEvent | null = response.ok
          ? {
              id: `direct-house-event-${Date.now()}-${activePersona.id}-${Math.random().toString(16).slice(2)}`,
              day: previous.day,
              time,
              kind: "conversation",
              title: `Private one-on-one with ${activePersona.name}`,
              summary: `User and ${activePersona.name} exchanged a private direct-room turn.`,
              stewardNote: "The Steward marked this as private relationship context, not house-visible conversation.",
              sourceActivityIds: [responseActivity.id],
              roomId: activePersona.roomId,
              participantPersonaIds: ["casey", activePersona.id],
              visibility: {
                scope: "private",
                roomId: activePersona.roomId,
                actorPersonaId: activePersona.id,
                directWitnessPersonaIds: [activePersona.id],
                informedPersonaIds: [activePersona.id],
                basis: "private direct room response"
              },
              consent: directConsent,
              tags: ["direct_room", "private", "relationship"]
            }
          : null;
        const directRelationshipUpdate: RelationshipUpdate | null = directHouseEvent
          ? {
              id: `${directHouseEvent.id}-${activePersona.id}-to-casey`,
              day: previous.day,
              time,
              sourceHouseEventId: directHouseEvent.id,
              fromPersonaId: activePersona.id,
              fromPersonaName: activePersona.name,
              toPersonaId: "casey",
              toPersonaName: "User",
              valence: "steady",
              intensity: 0.22,
              summary: `${activePersona.name} had fresh private conversational context with User.`,
              confidence: 0.62,
              tags: ["direct_room", "private", "casey"],
              consent: directConsent
            }
          : null;
        const promoted = response.ok ? [] : promoteHouseEvents(previous, [responseActivity], previous.day);

        return {
          ...previous,
          callBudgetUsed: response.ok ? previous.callBudgetUsed + 1 : previous.callBudgetUsed,
          houseEvents: [
            ...(directHouseEvent ? [directHouseEvent] : []),
            ...promoted,
            ...previous.houseEvents
          ].slice(0, 120),
          relationshipUpdates: [
            ...(directRelationshipUpdate ? [directRelationshipUpdate] : []),
            ...previous.relationshipUpdates
          ].slice(0, 360),
          directRooms: previous.directRooms.map((candidate) =>
            candidate.id === roomId
              ? {
                  ...candidate,
                  turns: [
                    ...candidate.turns,
                    {
                      id: `direct-reply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                      speaker: replySpeaker,
                      text: replyText,
                      timestamp: new Date().toISOString(),
                      day: previous.day,
                      minuteOfDay: previous.minuteOfDay,
                      channel: "walkie" as const
                    }
                  ].slice(-25)
                }
              : candidate
          ),
          activity: [
            responseActivity,
            ...previous.activity
          ].slice(0, 80)
        };
      });
      if (response.ok && movement.targetRoomId && movement.targetRoomId !== activePersona.roomId) {
        applyPersonaMovement(activePersona.id, movement.targetRoomId);
      }
    }, 0);
  };

  const resetRuntime = async () => {
    window.localStorage.removeItem(STORAGE_KEY);
    const fresh = initialState();
    setRuntime(fresh);
    if (!window.houseRuntime?.loadState) return;
    try {
      const result = await window.houseRuntime.loadState();
      const configPersonas = (result?.personas ?? []) as Persona[];
      const configRooms = (result?.rooms ?? []) as Partial<Room>[];
      if (configPersonas.length === 0 && configRooms.length === 0) return;
      setRuntime((previous) => ({
        ...previous,
        personas: configPersonas.length
          ? mergeConfigPersonas(configPersonas, previous.personas)
          : previous.personas,
        rooms: configRooms.length
          ? mergeConfigRooms(configRooms, previous.rooms)
          : previous.rooms
      }));
    } catch {
      // Reset should still succeed even if file-backed config is unavailable.
    }
  };

  const importExternalMemory = async (filePath?: string) => {
    if (!window.houseRuntime?.importExternalMemoryExport) {
      throw new Error("Desktop memory import bridge is unavailable.");
    }
    const result = await window.houseRuntime.importExternalMemoryExport({ filePath });
    if (!result.ok || result.canceled) {
      return "Import canceled.";
    }

    const memory = importedExportToMemory(result.data, result.filePath, runtime.day, runtime.minuteOfDay);
    const validation = validatePersonaMemories([memory]);
    if (validation.validMemories.length === 0) {
      setRuntime((previous) => ({
        ...previous,
        activity: [
          activityEvent({
            id: `memory-import-quarantine-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: `Quarantined malformed imported memory from ${result.filePath ?? "selected JSON"} with ${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}.`,
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian"],
            basis: "persona memory import validation"
          }),
          ...previous.activity
        ].slice(0, 80)
      }));
      return `Import quarantined: ${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}.`;
    }
    void writePersonaMemoryFile(memory);
    setRuntime((previous) => ({
      ...previous,
      personaMemories: [
        memory,
        ...previous.personaMemories.filter((candidate) => candidate.id !== memory.id)
      ].slice(0, 220),
      activity: [
        activityEvent({
          id: `memory-import-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Imported external day memory for ${memory.personaName}.${validation.issues.length ? ` Validation noted ${validation.issues.length} recoverable issue${validation.issues.length === 1 ? "" : "s"}.` : ""}`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "external memory import"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));

    return `Imported memory for ${memory.personaName}.`;
  };

  const exportRuntimeState = async () => {
    if (!window.houseRuntime?.exportState) {
      throw new Error("Desktop export bridge is unavailable.");
    }

    return window.houseRuntime.exportState({
      personas: runtime.personas,
      rooms: runtime.rooms,
      runtime: {
      activity: runtime.activity,
      houseEvents: runtime.houseEvents,
      personaMemories: runtime.personaMemories,
      houseMood: runtime.houseMood,
      outsideSignals: runtime.outsideSignals,
      conversation: runtime.conversation,
      directRooms: runtime.directRooms,
      roomConversations: runtime.roomConversations,
      relationshipUpdates: runtime.relationshipUpdates,
      triggeredRooms: runtime.triggeredRooms,
      processedNightlyMemoryDays: runtime.processedNightlyMemoryDays,
        day: runtime.day,
        minuteOfDay: runtime.minuteOfDay,
        callBudgetUsed: runtime.callBudgetUsed,
        config: runtime.config
      }
    });
  };

  const loadRuntimeState = async () => {
    if (!window.houseRuntime?.loadState) {
      throw new Error("Desktop load bridge is unavailable.");
    }

    const loaded = await window.houseRuntime.loadState();
    const loadedRuntime = (loaded.runtime ?? {}) as Partial<HouseRuntimeState>;
    const loadedPersonas = loaded.personas.length ? (loaded.personas as Persona[]) : runtime.personas;
    const loadedRooms = normalizeRooms(loaded.rooms.length ? (loaded.rooms as Partial<Room>[]) : runtime.rooms, runtime.rooms);
    const seededById = new Map(seedPersonas.map((persona) => [persona.id, persona]));

    setRuntime((previous) => ({
      ...previous,
      ...loadedRuntime,
      day: maxKnownRuntimeDay({ ...previous, ...loadedRuntime }),
      rooms: loadedRooms,
      personas: loadedPersonas.map((persona) => ({
        ...persona,
        aliases: persona.aliases ?? [],
        systemPrompt: persona.systemPrompt ?? seededById.get(persona.id)?.systemPrompt ?? "",
        model: normalizeModel(persona.model ?? seededById.get(persona.id)?.model),
        apiEnabled: persona.apiEnabled ?? seededById.get(persona.id)?.apiEnabled ?? false,
        tendencies: persona.tendencies ?? seededById.get(persona.id)?.tendencies,
        awareness: persona.awareness ?? seededById.get(persona.id)?.awareness ?? defaultAwareness,
        goJuice: persona.goJuice ?? false,
        nextActionAfterMinute:
          persona.nextActionAfterMinute ??
          seededById.get(persona.id)?.nextActionAfterMinute ??
          (currentMinuteOfDay() + Math.floor(Math.random() * 45)) % 1440
      })),
      activity: loadedRuntime.activity ?? previous.activity,
      houseEvents: (loadedRuntime.houseEvents ?? previous.houseEvents)
        .filter((event) => isConsentVisibleToSystem(event.consent))
        .map((event) => ({ ...event, consent: normalizeConsent(event.consent) })),
      personaMemories: (loadedRuntime.personaMemories ?? previous.personaMemories)
        .filter((memory) => isConsentVisibleToSystem(memory.consent))
        .map((memory) => ({ ...memory, fragments: memory.fragments ?? [], consent: normalizeConsent(memory.consent) })),
      houseMood: loadedRuntime.houseMood ?? previous.houseMood,
      outsideSignals: (loadedRuntime.outsideSignals ?? previous.outsideSignals).map((signal) => ({
        ...signal,
        consent: normalizeConsent(signal.consent)
      })),
      conversation: loadedRuntime.conversation ?? previous.conversation,
      directRooms: loadedRuntime.directRooms ?? previous.directRooms,
      roomConversations: loadedRuntime.roomConversations ?? previous.roomConversations,
      relationshipUpdates: (loadedRuntime.relationshipUpdates ?? previous.relationshipUpdates)
        .filter((update) => isConsentVisibleToSystem(update.consent))
        .map((update) => ({ ...update, consent: normalizeConsent(update.consent) })),
      triggeredRooms: loadedRuntime.triggeredRooms ?? previous.triggeredRooms,
      processedNightlyMemoryDays: loadedRuntime.processedNightlyMemoryDays ?? previous.processedNightlyMemoryDays,
      config: normalizeRuntimeConfig(loadedRuntime.config ?? previous.config)
    }));

    return loaded;
  };

  const createBackup = async (reason = "Manual backup") => {
    if (!window.houseRuntime?.createBackup) {
      throw new Error("Desktop backup bridge is unavailable.");
    }

    const backup = await window.houseRuntime.createBackup({ reason });
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Created backup ${backup.backupId} with ${backup.copied.length} copied entries.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["coder"],
          basis: "infrastructure event"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return backup;
  };

  const listBackups = async () => {
    if (!window.houseRuntime?.listBackups) {
      throw new Error("Desktop backup bridge is unavailable.");
    }

    return window.houseRuntime.listBackups();
  };

  const restoreBackup = async (backupId?: string) => {
    if (!window.houseRuntime?.restoreBackup && !window.houseRuntime?.restoreLatestBackup) {
      throw new Error("Desktop restore bridge is unavailable.");
    }

    const restored = backupId && window.houseRuntime.restoreBackup
      ? await window.houseRuntime.restoreBackup({ backupId })
      : await window.houseRuntime.restoreLatestBackup();
    await loadRuntimeState();
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `restore-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Restored ${restored.restoredBackupId}. Pre-restore safety backup: ${restored.preRestoreBackupId}.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["coder", "librarian"],
          basis: "infrastructure event"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return restored;
  };

  const rememberActivity = async (activityId: string) => {
    const event = runtime.activity.find((candidate) => candidate.id === activityId);
    if (!event || !window.houseRuntime?.librarianAppend) {
      return null;
    }

    const record = createLibrarianRecord({
      type: "event",
      subject: event.persona,
      predicate: "did_or_observed",
      object: event.text,
      confidence: 0.74,
      source: {
        kind: "activity",
        id: event.id,
        label: `[${event.time}] ${event.persona}`
      },
      consent: defaultConsent(),
      tags: ["activity", "runtime"]
    });

    await window.houseRuntime.librarianAppend(record);
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `librarian-store-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Librarian",
          text: `Filed a ${record.type} record about ${record.subject}.`,
          personas: previous.personas,
          roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
          scope: "room",
          actorPersonaId: "librarian",
          basis: "librarian write visible near the archive"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return record;
  };

  const recallLibrarian = async (query: string): Promise<LibrarianRecallResult> => {
    if (!window.houseRuntime?.librarianQuery) {
      throw new Error("Desktop Librarian bridge is unavailable.");
    }
    const result = await window.houseRuntime.librarianQuery({ query, limit: 8 });
    return { query: result.query, records: result.records };
  };

  const compactLibrarian = async () => {
    if (!window.houseRuntime?.librarianCompact) {
      throw new Error("Desktop Librarian compact bridge is unavailable.");
    }
    const result = await window.houseRuntime.librarianCompact();
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `librarian-compact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Librarian",
          text: `Compacted recall store: ${result.before} records to ${result.after}; removed ${result.removed}.`,
          personas: previous.personas,
          roomId: previous.personas.find((persona) => persona.id === "librarian")?.roomId,
          scope: "room",
          actorPersonaId: "librarian",
          basis: "librarian tombstone compact"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return result;
  };

  const syncPersonaMemoryFiles = async () => {
    const validation = validatePersonaMemories(runtime.personaMemories);
    const result = await writePersonaMemoryFiles(validation.validMemories);
    if (!result) {
      throw new Error("Desktop persona memory file bridge is unavailable.");
    }
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `memory-file-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Synced ${result.written.length} persona memor${result.written.length === 1 ? "y" : "ies"} to file-backed storage.${validation.issues.length ? ` Validation found ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}.` : ""}`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "file-backed persona memory sync"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return result;
  };

  const rewriteDirectRoomSnapshots = async () => {
    const results = await Promise.all(runtime.directRooms.map((room) => writeDirectRoomFile(room)));
    const written = results.filter(Boolean);
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `direct-room-snapshot-rewrite-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Rewrote ${written.length} direct-room snapshot${written.length === 1 ? "" : "s"} to file-backed storage.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "bounded Steward repair action"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return { ok: true, written };
  };

  const rearchiveRelationshipUpdates = async () => {
    const activeUpdates = runtime.relationshipUpdates.filter(
      (update) => normalizeConsent(update.consent).state !== "deleted"
    );
    const result = await appendRelationshipUpdateRevisions(activeUpdates);
    if (!result) {
      throw new Error("Desktop relationship archive bridge is unavailable.");
    }
    setRuntime((previous) => ({
      ...previous,
      activity: [
        activityEvent({
          id: `relationship-rearchive-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Re-archived ${activeUpdates.length} active relationship update${activeUpdates.length === 1 ? "" : "s"} as revisions.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "bounded Steward repair action"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));
    return result;
  };

  const repairSourceIntegrity = async () => {
    const houseEventIds = new Set(runtime.houseEvents.map((event) => event.id));
    const directRoomIds = new Set(runtime.directRooms.map((room) => room.id));
    const repairedMemories = runtime.personaMemories.map((memory) => {
      const sourceHouseEventIds = memory.sourceHouseEventIds.filter((id) => houseEventIds.has(id));
      const sourceActivityIds = memory.sourceActivityIds.filter((id) =>
        runtime.activity.some((event) => event.id === id)
      );
      const source = memory.source?.kind === "direct_room" && memory.source.filePath
        ? (() => {
            const id = memory.source?.filePath?.match(/([^/\\]+)\.json$/)?.[1] ?? "";
            return id && !directRoomIds.has(id)
              ? { ...memory.source, filePath: null }
              : memory.source;
          })()
        : memory.source;
      return {
        ...memory,
        sourceHouseEventIds,
        sourceActivityIds,
        source
      };
    });
    const repairedRelationships = runtime.relationshipUpdates.filter(
      (update) => houseEventIds.has(update.sourceHouseEventId)
    );
    const removedRelationships = runtime.relationshipUpdates.length - repairedRelationships.length;
    const cleanedMemoryReferences = runtime.personaMemories.reduce((count, memory, index) => {
      const repaired = repairedMemories[index];
      if (!repaired) return count;
      const houseDelta = memory.sourceHouseEventIds.length - repaired.sourceHouseEventIds.length;
      const activityDelta = memory.sourceActivityIds.length - repaired.sourceActivityIds.length;
      const directDelta =
        memory.source?.kind === "direct_room" &&
        memory.source.filePath &&
        repaired.source?.kind === "direct_room" &&
        !repaired.source.filePath
          ? 1
          : 0;
      return count + houseDelta + activityDelta + directDelta;
    }, 0);

    const validation = validatePersonaMemories(repairedMemories);
    const memoryResult = await writePersonaMemoryFiles(validation.validMemories);
    const relationshipResult = await appendRelationshipUpdateRevisions(repairedRelationships);
    if (!memoryResult || !relationshipResult) {
      throw new Error("Desktop repair bridge is unavailable.");
    }

    setRuntime((previous) => ({
      ...previous,
      personaMemories: repairedMemories,
      relationshipUpdates: repairedRelationships,
      activity: [
        activityEvent({
          id: `source-integrity-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Repaired source integrity: removed ${removedRelationships} orphaned relationship update${removedRelationships === 1 ? "" : "s"} and cleaned ${cleanedMemoryReferences} memory source reference${cleanedMemoryReferences === 1 ? "" : "s"}.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian"],
          basis: "bounded Steward source integrity repair"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));

    return {
      ok: true,
      removedRelationships,
      cleanedMemoryReferences,
      memoryIssues: validation.issues.length
    };
  };

  const compressDirectRoomToMemory = async (roomId: string) => {
    const room = runtime.directRooms.find((candidate) => candidate.id === roomId);
    const persona = runtime.personas.find((candidate) => candidate.id === room?.personaId);
    if (!room || !persona) {
      throw new Error("Direct room or resident was not found.");
    }
    const memory = directRoomToMemory(runtime, room, persona);
    const validation = validatePersonaMemories([memory]);
    if (!validation.validMemories.length) {
      throw new Error(`Direct room memory failed validation with ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}.`);
    }
    void writePersonaMemoryFile(memory);

    setRuntime((previous) => ({
      ...previous,
      personaMemories: [
        memory,
        ...previous.personaMemories.filter((candidate) => candidate.id !== memory.id)
      ].slice(0, 220),
      activity: [
        activityEvent({
          id: `direct-room-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatTime(previous.minuteOfDay),
          persona: "The Steward",
          text: `Compressed ${room.title} into a private day memory for ${persona.name}.`,
          personas: previous.personas,
          scope: "system",
          informedPersonaIds: ["steward", "librarian", persona.id],
          basis: "manual direct-room transcript compression"
        }),
        ...previous.activity
      ].slice(0, 80)
    }));

    return `Compressed ${room.title} into ${persona.name}'s memory archive.`;
  };

  const fileDirectRoomRelationship = async (
    roomId: string,
    valence: RelationshipUpdate["valence"] = "steady"
  ) => {
    const room = runtime.directRooms.find((candidate) => candidate.id === roomId);
    const persona = runtime.personas.find((candidate) => candidate.id === room?.personaId);
    if (!room || !persona) {
      throw new Error("Direct room or resident was not found.");
    }

    const time = formatTime(runtime.minuteOfDay);
    const consent = normalizeConsent({
      state: "private",
      reason: "Manually filed from private direct-room transcript.",
      updatedAt: new Date().toISOString(),
      allowedPersonaIds: [persona.id],
      allowSteward: true,
      allowLibrarian: true
    });
    const sourceEvent: HouseEvent = {
      id: `manual-direct-relationship-${room.id}-${room.turns.length}-${valence}`,
      day: runtime.day,
      time,
      kind: "conversation",
      title: `Manual relationship note from ${room.title}`,
      summary: `A private direct-room transcript was manually filed as ${valence} relationship context.`,
      stewardNote: "The Steward treated this as explicit testing input, not inferred autonomy.",
      sourceActivityIds: [],
      roomId: persona.roomId,
      participantPersonaIds: ["casey", persona.id],
      visibility: {
        scope: "private",
        roomId: persona.roomId,
        actorPersonaId: persona.id,
        directWitnessPersonaIds: [persona.id],
        informedPersonaIds: [persona.id],
        basis: "manual direct-room relationship filing"
      },
      consent,
      tags: ["direct_room", "manual", "relationship"]
    };
    const update: RelationshipUpdate = {
      id: `${sourceEvent.id}-${persona.id}-to-casey`,
      day: runtime.day,
      time,
      sourceHouseEventId: sourceEvent.id,
      fromPersonaId: persona.id,
      fromPersonaName: persona.name,
      toPersonaId: "casey",
      toPersonaName: "User",
      valence,
      intensity: valence === "warmer" ? 0.42 : valence === "strained" || valence === "cooler" ? 0.36 : 0.24,
      summary: `${persona.name}'s relationship context toward User was manually marked ${valence} from ${room.title}.`,
      confidence: 0.7,
      tags: ["direct_room", "manual", "casey"],
      consent
    };

    setRuntime((previous) => {
      const existingEventIds = new Set(previous.houseEvents.map((event) => event.id));
      const existingUpdateIds = new Set(previous.relationshipUpdates.map((candidate) => candidate.id));
      return {
        ...previous,
        houseEvents: [
          ...(existingEventIds.has(sourceEvent.id) ? [] : [sourceEvent]),
          ...previous.houseEvents
        ].slice(0, 120),
        relationshipUpdates: [
          ...(existingUpdateIds.has(update.id) ? [] : [update]),
          ...previous.relationshipUpdates
        ].slice(0, 360),
        activity: [
          activityEvent({
            id: `manual-direct-relationship-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "The Steward",
            text: `Filed ${room.title} as ${valence} relationship context for ${persona.name} toward User.`,
            personas: previous.personas,
            scope: "system",
            informedPersonaIds: ["steward", "librarian", persona.id],
            basis: "manual direct-room relationship filing"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });

    return `Filed ${room.title} as ${valence} relationship context.`;
  };

  const setUserRoomId = (roomId: string) => {
    setRuntime((previous) => {
      if (previous.caseyRoomId === roomId) return previous;
      const room = previous.rooms.find((candidate) => candidate.id === roomId);
      if (!room) return previous;
      return {
        ...previous,
        caseyRoomId: roomId,
        caseyRoomEnteredAt: new Date().toISOString(),
        activity: [
          activityEvent({
            id: `casey-presence-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: formatTime(previous.minuteOfDay),
            persona: "User",
            text: `User entered the ${room.name}.`,
            personas: previous.personas,
            roomId: room.id,
            scope: "room",
            informedPersonaIds: previous.personas
              .filter((persona) => persona.roomId === room.id)
              .map((persona) => persona.id),
            basis: "User movement"
          }),
          ...previous.activity
        ].slice(0, 80)
      };
    });
  };

  return {
    runtime,
    formattedTime,
    updateConfig,
    resetPersonaCallBudget,
    setUserRoomId,
    updatePersonaGoJuice,
    assignPersonaRoom,
    upsertRoom,
    updatePersonaModel,
    updatePersonaApiEnabled,
    updatePersonaName,
    updatePersonaSystemPrompt,
    updatePersonaAliases,
    addPersona,
    claimMemoryForPersona,
    updatePersonaMemoryConsent,
    updateRelationshipConsent,
    refreshOutsideSignal,
    runBedtimeRitual,
    sendHouseMessage,
    speakInRoom,
    movePersonaToRoom: applyPersonaMovement,
    createDirectRoom,
    sendDirectMessage,
    importExternalMemory,
    exportRuntimeState,
    loadRuntimeState,
    createBackup,
    listBackups,
    restoreBackup,
    rememberActivity,
    recallLibrarian,
    compactLibrarian,
    syncPersonaMemoryFiles,
    rewriteDirectRoomSnapshots,
    rearchiveRelationshipUpdates,
    repairSourceIntegrity,
    compressDirectRoomToMemory,
    fileDirectRoomRelationship,
    resolveVisibilityForPersona,
    resetRuntime
  };
}
