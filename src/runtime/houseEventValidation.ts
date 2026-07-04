import type { ActivityVisibility, ConsentPolicy, HouseEvent } from "../types";

export interface HouseEventValidationIssue {
  id: string;
  eventId?: string;
  severity: "warning" | "error";
  field: string;
  message: string;
}

export interface HouseEventValidationResult {
  validEvents: HouseEvent[];
  quarantinedEvents: HouseEvent[];
  issues: HouseEventValidationIssue[];
}

function validConsent(consent: ConsentPolicy | undefined) {
  return Boolean(
    consent &&
      ["known", "private", "restricted", "soft-forgotten", "deleted"].includes(consent.state) &&
      typeof consent.updatedAt === "string" &&
      Array.isArray(consent.allowedPersonaIds)
  );
}

function validVisibility(visibility: ActivityVisibility | undefined) {
  return Boolean(
    visibility &&
      ["private", "room", "adjacent", "house", "system"].includes(visibility.scope) &&
      Array.isArray(visibility.directWitnessPersonaIds) &&
      Array.isArray(visibility.informedPersonaIds) &&
      typeof visibility.basis === "string"
  );
}

export function validateHouseEvents(input: unknown[]): HouseEventValidationResult {
  const seen = new Set<string>();
  const validEvents: HouseEvent[] = [];
  const quarantinedEvents: HouseEvent[] = [];
  const issues: HouseEventValidationIssue[] = [];

  for (const [index, value] of input.entries()) {
    const event = value as HouseEvent;
    const eventId = event?.id;
    const issueId = (field: string) => `house-event-${eventId ?? index}-${field}`;
    let fatal = false;

    if (!eventId || typeof eventId !== "string") {
      issues.push({ id: issueId("id"), eventId, severity: "error", field: "id", message: "House event is missing id." });
      fatal = true;
    } else if (seen.has(eventId)) {
      issues.push({ id: issueId("duplicate"), eventId, severity: "warning", field: "id", message: "Duplicate House event id detected; first record wins." });
      continue;
    } else {
      seen.add(eventId);
    }

    if (!Number.isFinite(event.day) || event.day < 1 || event.day > 36600) {
      issues.push({ id: issueId("day"), eventId, severity: "error", field: "day", message: "House event has impossible day value." });
      fatal = true;
    }

    if (!event.kind || typeof event.kind !== "string") {
      issues.push({ id: issueId("kind"), eventId, severity: "error", field: "kind", message: "House event is missing kind." });
      fatal = true;
    }

    if (!event.title || typeof event.title !== "string") {
      issues.push({ id: issueId("title"), eventId, severity: "error", field: "title", message: "House event is missing title." });
      fatal = true;
    }

    if (!event.summary || typeof event.summary !== "string") {
      issues.push({ id: issueId("summary"), eventId, severity: "error", field: "summary", message: "House event is missing summary." });
      fatal = true;
    }

    if (!validConsent(event.consent)) {
      issues.push({ id: issueId("consent"), eventId, severity: "error", field: "consent", message: "House event is missing valid consent." });
      fatal = true;
    }

    if (!validVisibility(event.visibility)) {
      issues.push({ id: issueId("visibility"), eventId, severity: "error", field: "visibility", message: "House event has malformed visibility." });
      fatal = true;
    }

    if (!Array.isArray(event.sourceActivityIds) || !Array.isArray(event.participantPersonaIds) || !Array.isArray(event.tags)) {
      issues.push({ id: issueId("arrays"), eventId, severity: "warning", field: "arrays", message: "House event arrays were malformed." });
    }

    if (fatal) {
      quarantinedEvents.push(event);
    } else {
      validEvents.push({
        ...event,
        sourceActivityIds: Array.isArray(event.sourceActivityIds) ? event.sourceActivityIds : [],
        participantPersonaIds: Array.isArray(event.participantPersonaIds) ? event.participantPersonaIds : [],
        tags: Array.isArray(event.tags) ? event.tags : []
      });
    }
  }

  return { validEvents, quarantinedEvents, issues };
}
