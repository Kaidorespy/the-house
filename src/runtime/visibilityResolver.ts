import type {
  ActivityEvent,
  ConsentPolicy,
  HouseEvent,
  HouseRuntimeState,
  LibrarianRecord,
  Persona,
  PersonaMemoryEntry,
  RelationshipUpdate,
  Room
} from "../types";

export type VisibilityExclusionReason =
  | "persona_not_found"
  | "unclaimed_import"
  | "consent_deleted"
  | "consent_soft_forgotten"
  | "consent_private"
  | "consent_restricted"
  | "not_witnessed"
  | "room_awareness"
  | "house_log_access"
  | "unpublished"
  | "source_event_missing"
  | "source_event_hidden"
  | "not_relationship_subject";

export interface VisibilityDebugRecord {
  id: string;
  kind: "memory" | "house_event" | "activity" | "relationship_update" | "librarian_record";
  reason: VisibilityExclusionReason;
}

export interface VisibilitySummary {
  visibleMemoryIds: string[];
  visibleHouseEventIds: string[];
  visibleActivityIds: string[];
  visibleRelationshipUpdateIds: string[];
  visibleLibrarianRecordIds: string[];
  excludedCounts: Record<VisibilityExclusionReason, number>;
  excluded: VisibilityDebugRecord[];
  visibleRoomIds: string[];
  assumptions: string[];
}

export interface VisibilityResolution {
  persona: Persona | null;
  visibleMemories: PersonaMemoryEntry[];
  visibleHouseEvents: HouseEvent[];
  visibleActivity: ActivityEvent[];
  visibleRelationshipUpdates: RelationshipUpdate[];
  visibleLibrarianRecords: LibrarianRecord[];
  debug: VisibilitySummary;
}

const defaultAwareness = {
  houseLogAccess: "summary" as const,
  stewardAccess: "ask" as const,
  librarianAccess: "ask" as const,
  hearingRange: "room" as const,
  privateRoomAccess: false
};

function normalizeConsent(consent?: ConsentPolicy): ConsentPolicy {
  return {
    state: "known",
    reason: "",
    updatedAt: new Date().toISOString(),
    allowSteward: true,
    allowLibrarian: true,
    ...(consent ?? {}),
    allowedPersonaIds: consent?.allowedPersonaIds ?? []
  };
}

type ConsentAccessResult = { ok: true } | { ok: false; reason: VisibilityExclusionReason };

export function canAccessConsent(persona: Persona, consent?: ConsentPolicy): ConsentAccessResult {
  const policy = normalizeConsent(consent);
  if (policy.state === "deleted") return { ok: false, reason: "consent_deleted" as const };
  if (policy.state === "soft-forgotten") return { ok: false, reason: "consent_soft_forgotten" as const };
  if (policy.state === "known") return { ok: true };
  if (persona.id === "steward" && policy.allowSteward) return { ok: true };
  if (persona.id === "librarian" && policy.allowLibrarian) return { ok: true };
  if (policy.allowedPersonaIds.includes(persona.id)) return { ok: true };
  if (persona.awareness.privateRoomAccess && persona.awareness.houseLogAccess === "full") return { ok: true };
  return {
    ok: false,
    reason: policy.state === "private" ? "consent_private" as const : "consent_restricted" as const
  };
}

export function roomIdsVisibleToPersona(rooms: Room[], persona: Persona) {
  const awareness = persona.awareness ?? defaultAwareness;
  const currentRoom = rooms.find((room) => room.id === persona.roomId);
  if (awareness.hearingRange === "house") {
    return new Set(rooms.map((room) => room.id));
  }

  const visible = new Set([persona.roomId]);
  if (awareness.hearingRange === "adjacent" && currentRoom) {
    for (const room of rooms) {
      const horizontalTouch =
        currentRoom.floor === room.floor &&
        Math.abs(currentRoom.x + currentRoom.width / 2 - (room.x + room.width / 2)) < 42 &&
        Math.abs(currentRoom.y + currentRoom.height / 2 - (room.y + room.height / 2)) < 34;
      if (horizontalTouch) visible.add(room.id);
    }
  }
  return visible;
}

function pushExcluded(
  excluded: VisibilityDebugRecord[],
  counts: Record<VisibilityExclusionReason, number>,
  record: VisibilityDebugRecord
) {
  excluded.push(record);
  counts[record.reason] = (counts[record.reason] ?? 0) + 1;
}

function activityVisibility(
  state: HouseRuntimeState,
  persona: Persona,
  event: ActivityEvent,
  visibleRoomIds: Set<string>
): { ok: true } | { ok: false; reason: VisibilityExclusionReason } {
  const awareness = persona.awareness ?? defaultAwareness;
  const visibility = event.visibility;
  const personaId = persona.id;

  if (!visibility) {
    if (awareness.houseLogAccess === "full") return { ok: true };
    if (
      awareness.houseLogAccess === "summary" &&
      (event.persona === persona.name ||
        event.persona === "User" ||
        event.persona === "The Steward" ||
        /conversation|converged|backup|restore|one-on-one/i.test(event.text))
    ) {
      return { ok: true };
    }
    if (event.persona === persona.name || event.persona === "User") return { ok: true };
    return { ok: false, reason: "house_log_access" };
  }

  if (visibility.actorPersonaId === personaId || visibility.directWitnessPersonaIds.includes(personaId)) {
    return { ok: true };
  }
  if (visibility.informedPersonaIds.includes(personaId)) {
    return { ok: true };
  }
  if (visibility.scope === "private") {
    return persona.awareness.privateRoomAccess && awareness.houseLogAccess === "full"
      ? { ok: true }
      : { ok: false, reason: "not_witnessed" };
  }
  if (visibility.scope === "system") {
    return awareness.houseLogAccess !== "none" || visibility.informedPersonaIds.includes(personaId)
      ? { ok: true }
      : { ok: false, reason: "house_log_access" };
  }
  if (visibility.scope === "house") {
    return awareness.houseLogAccess === "full" || awareness.hearingRange === "house"
      ? { ok: true }
      : { ok: false, reason: "house_log_access" };
  }
  if (visibility.roomId) {
    return visibleRoomIds.has(visibility.roomId)
      ? { ok: true }
      : { ok: false, reason: "room_awareness" };
  }
  return awareness.houseLogAccess === "full" ? { ok: true } : { ok: false, reason: "house_log_access" };
}

export function resolvePersonaVisibility(
  state: HouseRuntimeState,
  personaId: string,
  librarianRecords: LibrarianRecord[] = []
): VisibilityResolution {
  const persona = state.personas.find((candidate) => candidate.id === personaId) ?? null;
  const counts = {} as Record<VisibilityExclusionReason, number>;
  const excluded: VisibilityDebugRecord[] = [];
  if (!persona) {
    return {
      persona: null,
      visibleMemories: [],
      visibleHouseEvents: [],
      visibleActivity: [],
      visibleRelationshipUpdates: [],
      visibleLibrarianRecords: [],
      debug: {
        visibleMemoryIds: [],
        visibleHouseEventIds: [],
        visibleActivityIds: [],
        visibleRelationshipUpdateIds: [],
        visibleLibrarianRecordIds: [],
        excludedCounts: { persona_not_found: 1 } as Record<VisibilityExclusionReason, number>,
        excluded: [],
        visibleRoomIds: [],
        assumptions: ["No matching persona was found."]
      }
    };
  }

  const visibleRoomIds = roomIdsVisibleToPersona(state.rooms, persona);
  const residentIds = new Set(state.personas.map((resident) => resident.id));

  const visibleMemories = state.personaMemories.filter((memory) => {
    if (!residentIds.has(memory.personaId)) {
      pushExcluded(excluded, counts, { id: memory.id, kind: "memory", reason: "unclaimed_import" });
      return false;
    }
    if (memory.personaId !== persona.id && persona.awareness.houseLogAccess !== "full") {
      pushExcluded(excluded, counts, { id: memory.id, kind: "memory", reason: "not_witnessed" });
      return false;
    }
    const consent = canAccessConsent(persona, memory.consent);
    if (!consent.ok) {
      pushExcluded(excluded, counts, { id: memory.id, kind: "memory", reason: consent.reason });
      return false;
    }
    return true;
  });

  const visibleActivity = state.activity.filter((event) => {
    const result = activityVisibility(state, persona, event, visibleRoomIds);
    if (!result.ok) {
      pushExcluded(excluded, counts, { id: event.id, kind: "activity", reason: result.reason });
      return false;
    }
    return true;
  });

  const visibleHouseEvents = state.houseEvents.filter((event) => {
    const consent = canAccessConsent(persona, event.consent);
    if (!consent.ok) {
      pushExcluded(excluded, counts, { id: event.id, kind: "house_event", reason: consent.reason });
      return false;
    }
    const result = activityVisibility(
      state,
      persona,
      { id: event.id, time: event.time, persona: "The Steward", text: event.summary, visibility: event.visibility },
      visibleRoomIds
    );
    if (!result.ok) {
      pushExcluded(excluded, counts, { id: event.id, kind: "house_event", reason: result.reason });
      return false;
    }
    return true;
  });
  const visibleHouseEventIds = new Set(visibleHouseEvents.map((event) => event.id));

  const visibleRelationshipUpdates = state.relationshipUpdates.filter((update) => {
    const consent = canAccessConsent(persona, update.consent);
    if (!consent.ok) {
      pushExcluded(excluded, counts, { id: update.id, kind: "relationship_update", reason: consent.reason });
      return false;
    }
    if (persona.id === "steward" || persona.id === "librarian" || persona.awareness.houseLogAccess === "full") {
      return true;
    }
    if (update.fromPersonaId === persona.id) {
      return true;
    }
    const sourceExists = state.houseEvents.some((event) => event.id === update.sourceHouseEventId);
    if (!sourceExists) {
      pushExcluded(excluded, counts, { id: update.id, kind: "relationship_update", reason: "source_event_missing" });
      return false;
    }
    if (update.toPersonaId === persona.id && visibleHouseEventIds.has(update.sourceHouseEventId)) {
      return true;
    }
    if (visibleHouseEventIds.has(update.sourceHouseEventId) && update.tags.includes("house_event")) {
      return true;
    }
    pushExcluded(excluded, counts, {
      id: update.id,
      kind: "relationship_update",
      reason: update.toPersonaId === persona.id ? "source_event_hidden" : "not_relationship_subject"
    });
    return false;
  });

  const visibleLibrarianRecords = librarianRecords.filter((record) => {
    if (record.published === false && persona.id !== "librarian" && persona.id !== "steward") {
      pushExcluded(excluded, counts, { id: record.id, kind: "librarian_record", reason: "unpublished" });
      return false;
    }
    const consent = canAccessConsent(persona, record.consent);
    if (!consent.ok) {
      pushExcluded(excluded, counts, { id: record.id, kind: "librarian_record", reason: consent.reason });
      return false;
    }
    return true;
  });

  return {
    persona,
    visibleMemories,
    visibleHouseEvents,
    visibleActivity,
    visibleRelationshipUpdates,
    visibleLibrarianRecords,
    debug: {
      visibleMemoryIds: visibleMemories.map((memory) => memory.id),
      visibleHouseEventIds: visibleHouseEvents.map((event) => event.id),
      visibleActivityIds: visibleActivity.map((event) => event.id),
      visibleRelationshipUpdateIds: visibleRelationshipUpdates.map((update) => update.id),
      visibleLibrarianRecordIds: visibleLibrarianRecords.map((record) => record.id),
      excludedCounts: counts,
      excluded,
      visibleRoomIds: Array.from(visibleRoomIds),
      assumptions: [
        `Hearing range: ${persona.awareness.hearingRange}`,
        `House log access: ${persona.awareness.houseLogAccess}`,
        `Private room access: ${persona.awareness.privateRoomAccess ? "yes" : "no"}`
      ]
    }
  };
}
