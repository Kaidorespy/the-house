import type { ConsentPolicy, PersonaMemoryEntry } from "../types";

export interface MemoryValidationIssue {
  id: string;
  memoryId?: string;
  severity: "warning" | "error";
  field: string;
  message: string;
}

export interface MemoryValidationResult {
  validMemories: PersonaMemoryEntry[];
  quarantinedMemories: PersonaMemoryEntry[];
  issues: MemoryValidationIssue[];
}

function validConsent(consent: ConsentPolicy | undefined) {
  return Boolean(
    consent &&
      ["known", "private", "restricted", "soft-forgotten", "deleted"].includes(consent.state) &&
      typeof consent.updatedAt === "string" &&
      Array.isArray(consent.allowedPersonaIds)
  );
}

function normalizeMemory(memory: PersonaMemoryEntry): PersonaMemoryEntry {
  return {
    ...memory,
    mechanicalFacts: Array.isArray(memory.mechanicalFacts) ? memory.mechanicalFacts : [],
    fragments: Array.isArray(memory.fragments) ? memory.fragments : [],
    sourceHouseEventIds: Array.isArray(memory.sourceHouseEventIds) ? memory.sourceHouseEventIds : [],
    sourceActivityIds: Array.isArray(memory.sourceActivityIds) ? memory.sourceActivityIds : []
  };
}

export function validatePersonaMemories(input: unknown[]): MemoryValidationResult {
  const seen = new Set<string>();
  const validMemories: PersonaMemoryEntry[] = [];
  const quarantinedMemories: PersonaMemoryEntry[] = [];
  const issues: MemoryValidationIssue[] = [];

  for (const [index, value] of input.entries()) {
    const memory = normalizeMemory(value as PersonaMemoryEntry);
    const memoryId = memory?.id;
    const issueId = (field: string) => `memory-${memoryId ?? index}-${field}`;
    let fatal = false;

    if (!memoryId || typeof memoryId !== "string") {
      issues.push({
        id: issueId("id"),
        memoryId,
        severity: "error",
        field: "id",
        message: "Memory is missing a stable id."
      });
      fatal = true;
    } else if (seen.has(memoryId)) {
      issues.push({
        id: issueId("duplicate"),
        memoryId,
        severity: "warning",
        field: "id",
        message: "Duplicate memory id detected; first record wins."
      });
      continue;
    } else {
      seen.add(memoryId);
    }

    if (!memory.personaId || typeof memory.personaId !== "string") {
      issues.push({
        id: issueId("personaId"),
        memoryId,
        severity: "error",
        field: "personaId",
        message: "Memory is missing persona id."
      });
      fatal = true;
    }

    if (!memory.personaName || typeof memory.personaName !== "string") {
      issues.push({
        id: issueId("personaName"),
        memoryId,
        severity: "error",
        field: "personaName",
        message: "Memory is missing persona name."
      });
      fatal = true;
    }

    if (!Number.isFinite(memory.day) || memory.day < 1 || memory.day > 36600) {
      issues.push({
        id: issueId("day"),
        memoryId,
        severity: "error",
        field: "day",
        message: "Memory has an impossible day value."
      });
      fatal = true;
    }

    if (!memory.emotionalResidue || typeof memory.emotionalResidue !== "string") {
      issues.push({
        id: issueId("emotionalResidue"),
        memoryId,
        severity: "error",
        field: "emotionalResidue",
        message: "Memory is missing emotional residue."
      });
      fatal = true;
    }

    if (!Array.isArray(memory.mechanicalFacts)) {
      issues.push({
        id: issueId("mechanicalFacts"),
        memoryId,
        severity: "warning",
        field: "mechanicalFacts",
        message: "Memory mechanical facts were malformed and normalized."
      });
    }

    if (!memory.source || !memory.source.kind || !memory.source.compression) {
      issues.push({
        id: issueId("source"),
        memoryId,
        severity: "warning",
        field: "source",
        message: "Memory is missing complete source metadata."
      });
    }

    if (!validConsent(memory.consent)) {
      issues.push({
        id: issueId("consent"),
        memoryId,
        severity: "error",
        field: "consent",
        message: "Memory is missing a valid consent policy."
      });
      fatal = true;
    }

    if (fatal) {
      quarantinedMemories.push(memory);
    } else {
      validMemories.push(memory);
    }
  }

  return { validMemories, quarantinedMemories, issues };
}
