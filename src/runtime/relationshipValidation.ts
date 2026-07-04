import type { ConsentPolicy, RelationshipUpdate } from "../types";

export interface RelationshipValidationIssue {
  id: string;
  updateId?: string;
  severity: "warning" | "error";
  field: string;
  message: string;
}

export interface RelationshipValidationResult {
  validUpdates: RelationshipUpdate[];
  quarantinedUpdates: RelationshipUpdate[];
  issues: RelationshipValidationIssue[];
}

function validConsent(consent: ConsentPolicy | undefined) {
  return Boolean(
    consent &&
      ["known", "private", "restricted", "soft-forgotten", "deleted"].includes(consent.state) &&
      typeof consent.updatedAt === "string" &&
      Array.isArray(consent.allowedPersonaIds)
  );
}

export function validateRelationshipUpdates(input: unknown[]): RelationshipValidationResult {
  const seen = new Set<string>();
  const validUpdates: RelationshipUpdate[] = [];
  const quarantinedUpdates: RelationshipUpdate[] = [];
  const issues: RelationshipValidationIssue[] = [];

  for (const [index, value] of input.entries()) {
    const update = value as RelationshipUpdate;
    const updateId = update?.id;
    const issueId = (field: string) => `relationship-${updateId ?? index}-${field}`;
    let fatal = false;

    if (!updateId || typeof updateId !== "string") {
      issues.push({ id: issueId("id"), updateId, severity: "error", field: "id", message: "Relationship update is missing id." });
      fatal = true;
    } else if (seen.has(updateId)) {
      issues.push({ id: issueId("duplicate"), updateId, severity: "warning", field: "id", message: "Duplicate relationship update id detected; first record wins." });
      continue;
    } else {
      seen.add(updateId);
    }

    if (!Number.isFinite(update.day) || update.day < 1 || update.day > 36600) {
      issues.push({ id: issueId("day"), updateId, severity: "error", field: "day", message: "Relationship update has impossible day value." });
      fatal = true;
    }

    if (!update.sourceHouseEventId || typeof update.sourceHouseEventId !== "string") {
      issues.push({ id: issueId("sourceHouseEventId"), updateId, severity: "error", field: "sourceHouseEventId", message: "Relationship update is missing source House event id." });
      fatal = true;
    }

    if (!update.fromPersonaId || !update.fromPersonaName || !update.toPersonaId || !update.toPersonaName) {
      issues.push({ id: issueId("personas"), updateId, severity: "error", field: "personas", message: "Relationship update is missing from/to persona identity." });
      fatal = true;
    }

    if (!update.summary || typeof update.summary !== "string") {
      issues.push({ id: issueId("summary"), updateId, severity: "error", field: "summary", message: "Relationship update is missing summary." });
      fatal = true;
    }

    if (!["warmer", "cooler", "steady", "strained", "unknown"].includes(update.valence)) {
      issues.push({ id: issueId("valence"), updateId, severity: "warning", field: "valence", message: "Relationship update has unknown valence." });
    }

    if (!Number.isFinite(update.intensity) || update.intensity < 0 || update.intensity > 1) {
      issues.push({ id: issueId("intensity"), updateId, severity: "warning", field: "intensity", message: "Relationship update intensity was outside 0..1." });
    }

    if (!validConsent(update.consent)) {
      issues.push({ id: issueId("consent"), updateId, severity: "error", field: "consent", message: "Relationship update is missing valid consent." });
      fatal = true;
    }

    if (fatal) {
      quarantinedUpdates.push(update);
    } else {
      validUpdates.push({
        ...update,
        valence: ["warmer", "cooler", "steady", "strained", "unknown"].includes(update.valence) ? update.valence : "unknown",
        intensity: Number.isFinite(update.intensity) ? Math.max(0, Math.min(1, update.intensity)) : 0,
        confidence: Number.isFinite(update.confidence) ? Math.max(0, Math.min(1, update.confidence)) : 0.5,
        tags: Array.isArray(update.tags) ? update.tags : []
      });
    }
  }

  return { validUpdates, quarantinedUpdates, issues };
}
