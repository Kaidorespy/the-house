import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Download,
  Home,
  Upload,
  ShieldCheck,
  ListChecks,
  History,
  RotateCcw,
  MessageSquare,
  Moon,
  Paperclip,
  Pause,
  Play,
  UsersRound,
  Wrench
} from "lucide-react";
import { rooms as seedRooms } from "./houseData";
import { HedyView } from "./HedyView";
import { useHouseRuntime, findImplicitAddressee } from "./runtime/useHouseRuntime";
import { getAnthropicStatus, type AnthropicStatus } from "./services/anthropic";
import type {
  ActivityEvent,
  AnthropicModel,
  ConsentState,
  ConversationTurn,
  DirectRoom,
  FloorId,
  HouseEvent,
  LibrarianRecord,
  OutsideSignal,
  Persona,
  PersonaMemoryEntry,
  RelationshipUpdate,
  Room,
  RoomConversation,
  RuntimeConfig
} from "./types";
import type { VisibilitySummary } from "./runtime/visibilityResolver";

const stateLabels: Record<Persona["state"], string> = {
  idle: "Idle",
  thinking: "Thinking",
  talking: "Talking",
  acting: "Acting",
  focused: "Focused",
  moving: "Moving",
  asleep: "Asleep"
};

const modelLabels: Record<AnthropicModel, string> = {
  "claude-haiku-4-5": "Haiku",
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-5-20251101": "Opus 4.5",
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-8": "Opus 4.8"
};

type MainView = "house" | "population" | "steward" | "hedy";

type ComposerAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
};

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

function importMatch(memory: PersonaMemoryEntry, personas: Persona[]) {
  const memoryName = memory.personaName;
  const scored = personas
    .map((persona) => {
      const names = [persona.name, ...(persona.aliases ?? [])];
      const exact = names.some((name) => normalizeIdentity(name) === normalizeIdentity(memoryName));
      const distance = Math.min(...names.map((name) => identityDistance(name, memoryName)));
      return {
        persona,
        level: exact ? "exact" as const : distance <= 2 ? "fuzzy" as const : "none" as const,
        distance
      };
    })
    .sort((a, b) => {
      const rank = { exact: 0, fuzzy: 1, none: 2 };
      return rank[a.level] - rank[b.level] || a.distance - b.distance;
    });

  return scored[0] ?? null;
}

function AppHeader({ status }: { status: AnthropicStatus | null }) {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Prototype runtime</p>
        <h1>The House</h1>
      </div>
      <div className="runtime-strip">
        <span className="runtime-pill">Standalone shell</span>
        <span className="runtime-pill">Mock residents</span>
        <span className={status?.configured ? "runtime-pill ready" : "runtime-pill placeholder"}>
          Anthropic {status?.configured ? "ready" : "placeholder"}
        </span>
      </div>
    </header>
  );
}

function ViewSwitcher({
  view,
  onViewChange
}: {
  view: MainView;
  onViewChange: (view: MainView) => void;
}) {
  return (
    <nav className="view-switcher" aria-label="Main views">
      <button
        className={view === "house" ? "active" : ""}
        onClick={() => onViewChange("house")}
        type="button"
      >
        <Home size={16} />
        House
      </button>
      <button
        className={view === "population" ? "active" : ""}
        onClick={() => onViewChange("population")}
        type="button"
      >
        <UsersRound size={16} />
        Population
      </button>
      <button
        className={view === "steward" ? "active" : ""}
        onClick={() => onViewChange("steward")}
        type="button"
      >
        <ShieldCheck size={16} />
        Steward
      </button>
      <button
        className={view === "hedy" ? "active" : ""}
        onClick={() => onViewChange("hedy")}
        type="button"
      >
        <Wrench size={16} />
        Hedy
      </button>
    </nav>
  );
}

function Blueprint({
  floor,
  rooms,
  personas,
  selectedRoom,
  selectedPersona,
  onRoomSelect,
  onPersonaSelect,
  caseyRoomId
}: {
  floor: FloorId;
  rooms: Room[];
  personas: Persona[];
  selectedRoom: Room | null;
  selectedPersona: Persona | null;
  onRoomSelect: (room: Room) => void;
  onPersonaSelect: (persona: Persona) => void;
  caseyRoomId: string | null;
}) {
  const floorRooms = rooms.filter((room) => room.floor === floor);
  const floorPersonas = personas.filter((persona) => {
    const room = rooms.find((candidate) => candidate.id === persona.roomId);
    return room?.floor === floor;
  });
  const caseyRoom = caseyRoomId ? rooms.find((room) => room.id === caseyRoomId) ?? null : null;
  const caseyOnThisFloor = caseyRoom?.floor === floor;

  return (
    <section className="blueprint-shell" aria-label="House blueprint">
      <div className="blueprint-grid">
        {floorRooms.map((room) => {
          const isSelected = selectedRoom?.id === room.id;
          return (
            <button
              className={isSelected ? "room selected" : "room"}
              key={room.id}
              onClick={() => onRoomSelect(room)}
              style={{
                left: `${room.x}%`,
                top: `${room.y}%`,
                width: `${room.width}%`,
                height: `${room.height}%`
              }}
              type="button"
            >
              <span className="room-name">{room.name}</span>
              <span className="room-purpose">{room.purpose}</span>
            </button>
          );
        })}

        {floorPersonas.map((persona) => (
          <button
            aria-label={`${persona.name}, ${stateLabels[persona.state]}`}
            className={
              selectedPersona?.id === persona.id
                ? `persona-dot ${persona.state} selected`
                : `persona-dot ${persona.state}`
            }
            key={persona.id}
            onClick={() => onPersonaSelect(persona)}
            style={{
              left: `${persona.marker.x}%`,
              top: `${persona.marker.y}%`
            }}
            title={`${persona.name}: ${stateLabels[persona.state]}`}
            type="button"
          >
            <span>{persona.name.slice(0, 1)}</span>
            {persona.movementIntent ? <i aria-hidden="true">→</i> : null}
          </button>
        ))}

        {caseyOnThisFloor && caseyRoom ? (
          <div
            aria-label="User position"
            className="persona-dot casey"
            style={{
              left: `${caseyRoom.x + caseyRoom.width / 2}%`,
              top: `${caseyRoom.y + caseyRoom.height - 4}%`,
              background: "#f5d76e",
              borderColor: "#c79b1a",
              color: "#222",
              transition: "left 380ms cubic-bezier(0.4, 0, 0.2, 1), top 380ms cubic-bezier(0.4, 0, 0.2, 1)"
            }}
            title={`You are in the ${caseyRoom.name}`}
          >
            <span>You</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function safeList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function listDraft(value: unknown) {
  return safeList(value).join(", ");
}

function RoomInspector({
  room,
  occupants,
  roomConversations,
  personas
}: {
  room: Room | null;
  occupants: Persona[];
  roomConversations: RoomConversation[];
  personas: Persona[];
}) {
  if (!room) {
    return (
      <aside className="inspector">
        <p className="eyebrow">Selected room</p>
        <h2>No room selected</h2>
        <p>Choose a room on the blueprint to inspect purpose, atmosphere, and occupants.</p>
      </aside>
    );
  }

  const layout = room.layout ?? "No layout notes yet.";
  const furniture = safeList(room.furniture);
  const items = safeList(room.items);
  const affordances = safeList(room.affordances);
  const activeConversation = roomConversations.find(
    (conversation) => conversation.roomId === room.id && conversation.active
  );
  const personaName = (personaId: string) =>
    personas.find((persona) => persona.id === personaId)?.name ?? personaId;

  return (
    <aside className="inspector">
      <p className="eyebrow">Selected room</p>
      <h2>{room.name}</h2>
      <p>{room.atmosphere}</p>
      <div className="room-detail-grid">
        <div>
          <span>Purpose</span>
          <strong>{room.purpose}</strong>
        </div>
        <div>
          <span>Occupants</span>
          <strong>{occupants.length || "None"}</strong>
        </div>
      </div>
      <div className="room-context">
        <div>
          <span>Layout</span>
          <p>{layout}</p>
        </div>
        <div>
          <span>Furniture</span>
          <p>{furniture.length ? furniture.join(", ") : "None listed yet."}</p>
        </div>
        <div>
          <span>Items</span>
          <p>{items.length ? items.join(", ") : "None listed yet."}</p>
        </div>
        <div>
          <span>Affordances</span>
          <p>{affordances.length ? affordances.join(", ") : "None listed yet."}</p>
        </div>
      </div>
      <div className="occupant-list">
        {occupants.map((persona) => (
          <button key={persona.id} type="button">
            <span>{persona.name}</span>
            <small>{stateLabels[persona.state]}</small>
          </button>
        ))}
      </div>
      {activeConversation ? (
        <div className="room-conversation-card">
          <p className="eyebrow">Active room conversation</p>
          <h3>{activeConversation.topicSummary}</h3>
          <div className="conversation-meta">
            <span>{activeConversation.emotionalTemperature}</span>
            <span>{activeConversation.newcomerPolicy.replace(/_/g, " ")}</span>
          </div>
          <div className="conversation-roster">
            <div>
              <span>Participants</span>
              <p>{activeConversation.participantIds.map(personaName).join(", ") || "None"}</p>
            </div>
            <div>
              <span>Witnesses</span>
              <p>{activeConversation.witnessIds.map(personaName).join(", ") || "None"}</p>
            </div>
          </div>
          <div className="turn-list compact">
            {activeConversation.turns.slice(-4).map((turn) => (
              <article className="turn" key={turn.id}>
                <strong>{turn.speaker}</strong>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function Terminal({
  activity,
  houseEvents,
  conversation,
  directRooms,
  personas,
  onCreateDirectRoom,
  onCompressDirectRoom,
  onFileDirectRelationship,
  onSendDirectMessage,
  onSendMessage,
  onSpeakInRoom,
  caseyRoom,
  currentRoomConversation,
  caseyRoomEnteredAt,
  focusedPersonaId
}: {
  activity: ActivityEvent[];
  houseEvents: HouseEvent[];
  conversation: ConversationTurn[];
  directRooms: DirectRoom[];
  personas: Persona[];
  onCreateDirectRoom: (personaId: string) => string | null;
  onCompressDirectRoom: (roomId: string) => Promise<string>;
  onFileDirectRelationship: (roomId: string, valence: RelationshipUpdate["valence"]) => Promise<string>;
  onSendDirectMessage: (roomId: string, message: string) => void;
  onSendMessage: (message: string) => void;
  onSpeakInRoom: (
    roomId: string,
    message: string,
    options?: { forceNoImplicit?: boolean; addresseeOverrideId?: string | null }
  ) => Promise<void> | void;
  caseyRoom: Room | null;
  currentRoomConversation: RoomConversation | null;
  caseyRoomEnteredAt: string | null;
  focusedPersonaId: string | null;
}) {
  const [tab, setTab] = useState<"conversation" | "activity" | "houseLog" | "direct">("conversation");
  const [draft, setDraft] = useState("");
  const [directStatus, setDirectStatus] = useState("");
  const [relationshipValence, setRelationshipValence] = useState<RelationshipUpdate["valence"]>("steady");
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [showGhost, setShowGhost] = useState<boolean>(false);
  const [dismissImplicit, setDismissImplicit] = useState<boolean>(false);
  const [manualAddresseeId, setManualAddresseeId] = useState<string | null>(null);
  const [activeDirectRoomId, setActiveDirectRoomId] = useState<string | null>(directRooms[0]?.id ?? null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Implicit addressee — who's User already in conversation with in this room?
  const occupantsInUserRoom = useMemo(() => {
    if (!caseyRoom) return [];
    return personas.filter(
      (persona) =>
        persona.roomId === caseyRoom.id ||
        persona.movementIntent?.fromRoomId === caseyRoom.id ||
        persona.movementIntent?.toRoomId === caseyRoom.id
    );
  }, [caseyRoom, personas]);

  const implicitAddressee = useMemo(() => {
    if (!caseyRoom) return null;
    return findImplicitAddressee(currentRoomConversation, occupantsInUserRoom, {
      caseyEnteredAtIso: caseyRoomEnteredAt
    });
  }, [caseyRoom, currentRoomConversation, occupantsInUserRoom, caseyRoomEnteredAt]);

  const manualAddressee = useMemo(() => {
    if (!manualAddresseeId) return null;
    return occupantsInUserRoom.find((persona) => persona.id === manualAddresseeId) ?? null;
  }, [manualAddresseeId, occupantsInUserRoom]);

  const focusedAddressee = useMemo(() => {
    if (!focusedPersonaId) return null;
    return occupantsInUserRoom.find((persona) => persona.id === focusedPersonaId && persona.apiEnabled) ?? null;
  }, [focusedPersonaId, occupantsInUserRoom]);

  const effectiveAddressee = manualAddressee ?? focusedAddressee ?? (dismissImplicit ? null : implicitAddressee);

  // Reset the dismiss flag if the implicit addressee changes (new person replied).
  useEffect(() => {
    setDismissImplicit(false);
  }, [implicitAddressee?.id]);

  // Drop manual selection when leaving the room (it's room-local).
  useEffect(() => {
    setManualAddresseeId(null);
  }, [caseyRoom?.id]);
  const activeDirectRoom =
    directRooms.find((room) => room.id === activeDirectRoomId) ?? directRooms[0] ?? null;
  const personaName = (personaId: string) =>
    personaId === "casey" ? "User" : personas.find((persona) => persona.id === personaId)?.name ?? personaId;
  const addImageAttachments = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return false;
    setAttachments((current) => [
      ...current,
      ...imageFiles.map((file) => ({
        id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || "pasted-image",
        type: file.type || "image",
        size: file.size
      }))
    ]);
    return true;
  };
  const attachmentNote = attachments.length
    ? [
        "",
        attachments.length === 1
          ? `[User shared an image attachment: ${attachments[0].name} (${attachments[0].type}, ${Math.round(attachments[0].size / 1024)} KB). The current House terminal records image metadata only; respond to the act of sharing it, but do not claim to see visual details yet.]`
          : `[User shared ${attachments.length} image attachments: ${attachments
              .map((attachment) => `${attachment.name} (${attachment.type}, ${Math.round(attachment.size / 1024)} KB)`)
              .join("; ")}. The current House terminal records image metadata only; respond to the act of sharing them, but do not claim to see visual details yet.]`
      ].join("\n")
    : "";

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = `${draft.trim()}${attachmentNote}`.trim();
    if (!message) return;
    if (tab === "direct" && activeDirectRoom) {
      onSendDirectMessage(activeDirectRoom.id, message);
    } else if (tab === "conversation" && caseyRoom) {
      void onSpeakInRoom(caseyRoom.id, message, {
        forceNoImplicit: dismissImplicit,
        addresseeOverrideId: manualAddresseeId ?? focusedAddressee?.id ?? null
      });
      setDismissImplicit(false);
    } else {
      onSendMessage(message);
    }
    setDraft("");
    setAttachments([]);
  };
  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === "j") {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      setDraft((value) => `${value.slice(0, start)}\n${value.slice(end)}`);
      window.requestAnimationFrame(() => {
        target.selectionStart = start + 1;
        target.selectionEnd = start + 1;
      });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const handleComposerPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (addImageAttachments(event.clipboardData.files)) {
      event.preventDefault();
    }
  };
  const handleComposerDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    if (addImageAttachments(event.dataTransfer.files)) {
      event.preventDefault();
    }
  };

  const openDirectRoom = (personaId: string) => {
    const roomId = onCreateDirectRoom(personaId);
    if (roomId) {
      setActiveDirectRoomId(roomId);
      setTab("direct");
      setRoomPickerOpen(false);
    }
  };

  const compressActiveDirectRoom = async () => {
    if (!activeDirectRoom) return;
    setDirectStatus("Compressing transcript...");
    try {
      setDirectStatus(await onCompressDirectRoom(activeDirectRoom.id));
    } catch (error) {
      setDirectStatus(error instanceof Error ? error.message : "Could not compress direct room.");
    }
  };

  const fileActiveDirectRelationship = async () => {
    if (!activeDirectRoom) return;
    setDirectStatus("Filing relationship update...");
    try {
      setDirectStatus(await onFileDirectRelationship(activeDirectRoom.id, relationshipValence));
    } catch (error) {
      setDirectStatus(error instanceof Error ? error.message : "Could not file relationship update.");
    }
  };

  return (
    <aside className="terminal">
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
          <button
            className={tab === "conversation" ? "active" : ""}
            onClick={() => setTab("conversation")}
            type="button"
          >
            <MessageSquare size={16} />
            {caseyRoom ? `Room: ${caseyRoom.name}` : "Room"}
          </button>
          <button
            className={tab === "activity" ? "active" : ""}
            onClick={() => setTab("activity")}
            type="button"
          >
            <Activity size={16} />
            Activity
          </button>
          <button
            className={tab === "houseLog" ? "active" : ""}
            onClick={() => setTab("houseLog")}
            type="button"
          >
            <History size={16} />
            House Log
          </button>
        </div>
        <button
          className="icon-button"
          onClick={() => setRoomPickerOpen((value) => !value)}
          title="Start one-on-one conversation"
          type="button"
        >
          <CirclePlus size={18} />
        </button>
      </div>

      {roomPickerOpen ? (
        <div className="direct-picker">
          {personas.map((persona) => (
            <button key={persona.id} onClick={() => openDirectRoom(persona.id)} type="button">
              <span>{persona.name}</span>
              <small>{persona.role}</small>
            </button>
          ))}
        </div>
      ) : null}

      {directRooms.length > 0 ? (
        <div className="direct-room-strip">
          {directRooms.map((room) => (
            <button
              className={tab === "direct" && activeDirectRoom?.id === room.id ? "active" : ""}
              key={room.id}
              onClick={() => {
                setActiveDirectRoomId(room.id);
                setTab("direct");
              }}
              type="button"
            >
              {room.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="terminal-body">
        {tab === "conversation" ? (
          <div className="turn-list">
            {!caseyRoom ? (
              <p style={{ opacity: 0.6 }}>Click a room on the blueprint to step into it.</p>
            ) : (() => {
                const allTurns = currentRoomConversation?.turns ?? [];
                const entered = caseyRoomEnteredAt ? new Date(caseyRoomEnteredAt).getTime() : 0;
                const liveTurns = entered
                  ? allTurns.filter((turn) => {
                      if (!turn.timestamp) return true;
                      return new Date(turn.timestamp).getTime() >= entered;
                    })
                  : allTurns;
                const priorTurns = entered
                  ? allTurns.filter((turn) => {
                      if (!turn.timestamp) return false;
                      return new Date(turn.timestamp).getTime() < entered;
                    }).slice(-10)
                  : [];
                const visibleTurns = showGhost ? [...priorTurns, ...liveTurns] : liveTurns;
                return (
                  <>
                    {priorTurns.length > 0 ? (
                      <button
                        className="reset-button"
                        type="button"
                        onClick={() => setShowGhost((value) => !value)}
                        style={{ alignSelf: "flex-start", marginBottom: 8, fontSize: 11 }}
                      >
                        {showGhost ? "Hide ghost" : `Ghost transcript (last ${priorTurns.length} before you arrived)`}
                      </button>
                    ) : null}
                    {visibleTurns.length === 0 ? (
                      <p style={{ opacity: 0.6 }}>
                        You're in the {caseyRoom.name}. Nobody has said anything yet — try speaking.
                      </p>
                    ) : (
                      visibleTurns.slice(-30).map((turn) => {
                        const isGhost = entered && turn.timestamp
                          ? new Date(turn.timestamp).getTime() < entered
                          : false;
                        return (
                          <article
                            className="turn"
                            key={turn.id}
                            style={isGhost ? { opacity: 0.55, fontStyle: "italic" } : undefined}
                          >
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                              <strong>{turn.speaker}</strong>
                              <span
                                style={{
                                  fontSize: 10,
                                  opacity: 0.55,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  background:
                                    turn.channel === "walkie"
                                      ? "rgba(120,180,255,0.15)"
                                      : "rgba(200,200,200,0.12)"
                                }}
                              >
                                [{isGhost ? "ghost" : turn.channel ?? "room"}]
                              </span>
                              {turn.timestamp ? (
                                <time style={{ fontSize: 10, opacity: 0.5 }}>
                                  {new Date(turn.timestamp).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  })}
                                </time>
                              ) : null}
                            </div>
                            <p>{turn.text}</p>
                          </article>
                        );
                      })
                    )}
                  </>
                );
              })()}
          </div>
        ) : tab === "activity" ? (
          <div className="activity-list">
            {activity.map((event) => (
              <article className="activity-event" key={event.id}>
                <time>{event.time}</time>
                <div>
                  <strong>{event.persona}</strong>
                  <p>{event.text}</p>
                  {event.visibility ? (
                    <small className="activity-visibility">
                      {event.visibility.scope}
                      {event.visibility.roomId ? ` / ${event.visibility.roomId}` : ""} /{" "}
                      {event.visibility.basis}
                      {event.visibility.directWitnessPersonaIds.length ||
                      event.visibility.informedPersonaIds.length ? (
                        <>
                          {" "}
                          / knows:{" "}
                          {[
                            ...event.visibility.directWitnessPersonaIds,
                            ...event.visibility.informedPersonaIds
                          ]
                            .filter((id, index, list) => list.indexOf(id) === index)
                            .map(personaName)
                            .join(", ")}
                        </>
                      ) : null}
                    </small>
                  ) : (
                    <small className="activity-visibility">legacy / broad log</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : tab === "houseLog" ? (
          <div className="activity-list">
            {houseEvents.map((event) => (
              <article className="house-event" key={event.id}>
                <div className="house-event-meta">
                  <time>Day {event.day} / {event.time}</time>
                  <span>{event.kind}</span>
                </div>
                <strong>{event.title}</strong>
                <p>{event.summary}</p>
                <small className="activity-visibility">
                  Steward: {event.stewardNote}
                  {event.participantPersonaIds.length ? (
                    <>
                      {" "}
                      / residents: {event.participantPersonaIds.map(personaName).join(", ")}
                    </>
                  ) : null}
                </small>
              </article>
            ))}
          </div>
        ) : activeDirectRoom ? (
          <div className="direct-room-body">
            <div className="direct-room-actions">
              <button className="reset-button" onClick={compressActiveDirectRoom} type="button">
                Compress to memory
              </button>
              <select
                aria-label="Relationship valence"
                onChange={(event) =>
                  setRelationshipValence(event.currentTarget.value as RelationshipUpdate["valence"])
                }
                value={relationshipValence}
              >
                <option value="steady">Steady</option>
                <option value="warmer">Warmer</option>
                <option value="cooler">Cooler</option>
                <option value="strained">Strained</option>
                <option value="unknown">Unknown</option>
              </select>
              <button className="reset-button" onClick={fileActiveDirectRelationship} type="button">
                File relationship
              </button>
              {directStatus ? <span>{directStatus}</span> : null}
            </div>
            <div className="turn-list">
              {activeDirectRoom.turns.map((turn) => (
                <article className="turn direct" key={turn.id}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <strong>{turn.speaker}</strong>
                    <span
                      style={{
                        fontSize: 10,
                        opacity: 0.55,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "rgba(120,180,255,0.15)"
                      }}
                    >
                      [walkie]
                    </span>
                    {turn.timestamp ? (
                      <time style={{ fontSize: 10, opacity: 0.5 }}>
                        {new Date(turn.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </time>
                    ) : null}
                  </div>
                  <p>{turn.text}</p>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-direct-room">
            <p>Open a one-on-one room with the plus button.</p>
          </div>
        )}
      </div>

      {tab === "conversation" && caseyRoom ? (
        effectiveAddressee ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              padding: "4px 10px",
              fontSize: 11,
              background: "rgba(245, 215, 110, 0.12)",
              borderTop: "1px solid rgba(245, 215, 110, 0.25)"
            }}
          >
            <span style={{ opacity: 0.75 }}>→ {effectiveAddressee.name}</span>
            <button
              type="button"
              onClick={() => {
                setManualAddresseeId(null);
                setDismissImplicit(true);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: "0 4px",
                opacity: 0.6
              }}
              title="Drop the thread — speak to the room"
            >
              ×
            </button>
          </div>
        ) : occupantsInUserRoom.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              padding: "4px 10px",
              fontSize: 11,
              opacity: 0.8,
              borderTop: "1px solid rgba(255,255,255,0.05)",
              flexWrap: "wrap"
            }}
          >
            <span style={{ opacity: 0.6 }}>Talk to:</span>
            {occupantsInUserRoom.map((persona) => (
              <button
                key={persona.id}
                type="button"
                onClick={() => setManualAddresseeId(persona.id)}
                disabled={!persona.apiEnabled}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  color: "inherit",
                  cursor: persona.apiEnabled ? "pointer" : "not-allowed",
                  padding: "2px 8px",
                  fontSize: 11,
                  opacity: persona.apiEnabled ? 1 : 0.4
                }}
                title={persona.apiEnabled ? `Address ${persona.name}` : `${persona.name} is frozen`}
              >
                {persona.name}
              </button>
            ))}
          </div>
        ) : null
      ) : null}

      <form className="terminal-input" onSubmit={submitMessage}>
        {attachments.length > 0 ? (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <span key={attachment.id}>
                {attachment.name}
                <button
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id))
                  }
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          aria-label="Shared house message"
          onDrop={handleComposerDrop}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          onPaste={handleComposerPaste}
          placeholder={
            tab === "direct"
              ? "Walkie-talkie..."
              : caseyRoom
                ? effectiveAddressee
                  ? `To ${effectiveAddressee.name}...`
                  : `Speak in the ${caseyRoom.name}...`
                : "Step into a room first..."
          }
          rows={2}
          value={draft}
        />
        <input
          accept="image/*"
          hidden
          multiple
          onChange={(event) => {
            addImageAttachments(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <button
          aria-label="Attach image"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
          type="button"
        >
          <Paperclip size={16} />
        </button>
        <button type="submit">Send</button>
      </form>
    </aside>
  );
}

function MemoryEntryCard({
  memory,
  showPersona,
  onMemoryConsentChange,
  action
}: {
  memory: PersonaMemoryEntry;
  showPersona?: boolean;
  onMemoryConsentChange: (memoryId: string, state: ConsentState) => void;
  action?: ReactNode;
}) {
  const transcript = memory.source?.transcript ?? [];

  return (
    <article className="memory-entry">
      <div className="memory-entry-header">
        <strong>
          {showPersona ? `${memory.personaName} / ` : ""}Day {memory.day}
        </strong>
        <select
          aria-label="Memory consent"
          onChange={(event) => onMemoryConsentChange(memory.id, event.currentTarget.value as ConsentState)}
          value={memory.consent?.state ?? "known"}
        >
          <option value="known">Known</option>
          <option value="private">Private</option>
          <option value="restricted">Restricted</option>
          <option value="soft-forgotten">Soft-forgotten</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>
      {memory.source ? (
        <div className="memory-source-row">
          <span>{memory.source.kind.replace(/_/g, " ")}</span>
          <span>{memory.source.compression} compression</span>
        </div>
      ) : null}
      <p>{memory.emotionalResidue}</p>
      {memory.mechanicalFacts.length ? <small>{memory.mechanicalFacts.join(" / ")}</small> : null}
      {memory.fragments?.length ? (
        <div className="fragment-buffer">
          <span>Fragments</span>
          {memory.fragments.map((fragment, index) => (
            <p key={`${memory.id}-fragment-${index}`}>{fragment}</p>
          ))}
        </div>
      ) : null}
      {transcript.length ? (
        <details className="transcript-preview">
          <summary>Source transcript preview</summary>
          <div>
            {transcript.slice(0, 16).map((turn) => (
              <article key={`${memory.id}-${turn.index}`}>
                <strong>{turn.speaker}</strong>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      {action}
    </article>
  );
}

function PopulationPanel({
  rooms,
  personas,
  selectedPersona,
  onPersonaSelect,
  onPersonaRoomChange,
  onModelChange,
  onApiEnabledChange,
  onGoJuiceChange,
  onPersonaNameChange,
  onSystemPromptChange,
  onAliasesChange,
  onCreatePersona,
  onClaimMemory,
  onMemoryConsentChange,
  onRelationshipConsentChange,
  visibilitySummary,
  personaMemories,
  relationshipUpdates,
  houseEvents,
  activity,
  directRooms
}: {
  rooms: Room[];
  personas: Persona[];
  selectedPersona: Persona | null;
  onPersonaSelect: (persona: Persona) => void;
  onPersonaRoomChange: (personaId: string, roomId: string) => void;
  onModelChange: (personaId: string, model: AnthropicModel) => void;
  onApiEnabledChange: (personaId: string, apiEnabled: boolean) => void;
  onGoJuiceChange: (personaId: string, goJuice: boolean) => void;
  onPersonaNameChange: (personaId: string, name: string) => void;
  onSystemPromptChange: (personaId: string, systemPrompt: string) => void;
  onAliasesChange: (personaId: string, aliases: string[]) => void;
  onCreatePersona: (input: { name: string; role: string; roomId: string }) => Persona;
  onClaimMemory: (memoryId: string, personaId: string) => Persona | null;
  onMemoryConsentChange: (memoryId: string, state: ConsentState) => void;
  onRelationshipConsentChange: (relationshipId: string, state: ConsentState) => void;
  visibilitySummary: VisibilitySummary | null;
  personaMemories: PersonaMemoryEntry[];
  relationshipUpdates: RelationshipUpdate[];
  houseEvents: HouseEvent[];
  activity: ActivityEvent[];
  directRooms: DirectRoom[];
}) {
  const active = selectedPersona ?? personas[0];
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaRole, setNewPersonaRole] = useState("");
  const [newPersonaRoomId, setNewPersonaRoomId] = useState(rooms[0]?.id ?? "");
  const [claimTargets, setClaimTargets] = useState<Record<string, string>>({});
  const [selectedProvenanceId, setSelectedProvenanceId] = useState("");
  const nextActionAfterMinute = active.nextActionAfterMinute ?? 0;
  const movementIntent = active.movementIntent;
  const roomName = (roomId: string) => rooms.find((room) => room.id === roomId)?.name ?? roomId;
  const personaIds = new Set(personas.map((persona) => persona.id));
  const unclaimedMemories = personaMemories.filter((memory) => !personaIds.has(memory.personaId));
  const activeMemories = personaMemories
    .filter((memory) => memory.personaId === active.id)
    .slice(0, 10);
  const activeRelationshipUpdates = relationshipUpdates
    .filter((update) => update.fromPersonaId === active.id || update.toPersonaId === active.id)
    .slice(0, 12);
  const provenanceItems = [
    ...activeMemories.map((memory) => ({
      id: `memory:${memory.id}`,
      label: `Memory / Day ${memory.day} / ${memory.source?.kind ?? "unknown"}`
    })),
    ...activeRelationshipUpdates.map((update) => ({
      id: `relationship:${update.id}`,
      label: `Relationship / ${update.fromPersonaName} -> ${update.toPersonaName}`
    }))
  ];
  const activeProvenanceId = selectedProvenanceId || provenanceItems[0]?.id || "";
  const selectedMemory =
    activeProvenanceId.startsWith("memory:")
      ? activeMemories.find((memory) => `memory:${memory.id}` === activeProvenanceId) ?? null
      : null;
  const selectedRelationship =
    activeProvenanceId.startsWith("relationship:")
      ? activeRelationshipUpdates.find((update) => `relationship:${update.id}` === activeProvenanceId) ?? null
      : null;
  const provenance = useMemo(() => {
    if (selectedMemory) {
      const sourceHouseEvents = selectedMemory.sourceHouseEventIds.map((id) => ({
        id,
        exists: houseEvents.some((event) => event.id === id)
      }));
      const sourceActivity = selectedMemory.sourceActivityIds.map((id) => ({
        id,
        exists: activity.some((event) => event.id === id)
      }));
      const directRoomId = selectedMemory.source?.kind === "direct_room"
        ? selectedMemory.source.filePath?.match(/([^/\\]+)\.json$/)?.[1] ?? null
        : null;
      const directRoom = directRoomId
        ? directRooms.find((room) => room.id === directRoomId || room.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase() === directRoomId)
        : null;
      return {
        kind: "memory" as const,
        title: `${selectedMemory.personaName} day ${selectedMemory.day}`,
        consent: selectedMemory.consent?.state ?? "known",
        sourceLabel: selectedMemory.source?.label ?? "No source label",
        sourceKind: selectedMemory.source?.kind ?? "unknown",
        sourceHouseEvents,
        sourceActivity,
        directRoom,
        transcript: selectedMemory.source?.transcript ?? [],
        librarianIds: [
          `persona-memory-${selectedMemory.id}-residue`,
          ...selectedMemory.mechanicalFacts.slice(0, 3).map((_, index) => `persona-memory-${selectedMemory.id}-fact-${index}`),
          ...(selectedMemory.fragments ?? []).slice(0, 3).map((_, index) => `persona-memory-${selectedMemory.id}-fragment-${index}`)
        ]
      };
    }
    if (selectedRelationship) {
      const sourceEvent = houseEvents.find((event) => event.id === selectedRelationship.sourceHouseEventId) ?? null;
      return {
        kind: "relationship" as const,
        title: `${selectedRelationship.fromPersonaName} -> ${selectedRelationship.toPersonaName}`,
        consent: selectedRelationship.consent?.state ?? "known",
        sourceLabel: selectedRelationship.sourceHouseEventId,
        sourceKind: "house_event",
        sourceHouseEvents: [{
          id: selectedRelationship.sourceHouseEventId,
          exists: Boolean(sourceEvent)
        }],
        sourceActivity: (sourceEvent?.sourceActivityIds ?? []).map((id) => ({
          id,
          exists: activity.some((event) => event.id === id)
        })),
        directRoom: null,
        transcript: [],
        librarianIds: [`relationship-${selectedRelationship.id}`]
      };
    }
    return null;
  }, [activeRelationshipUpdates, activeMemories, activeProvenanceId, activity, directRooms, houseEvents, selectedMemory, selectedRelationship]);
  const relationshipIntegrity = useMemo(() => {
    const ids = new Set<string>();
    const duplicateIds = new Set<string>();
    const sourceIds = new Set(houseEvents.map((event) => event.id));
    const knownIds = new Set(["casey", ...personas.map((persona) => persona.id)]);
    const missingSourceIds: string[] = [];
    const unknownIdentityIds: string[] = [];
    let deletedOrSoftForgotten = 0;

    for (const update of relationshipUpdates) {
      if (ids.has(update.id)) duplicateIds.add(update.id);
      ids.add(update.id);
      if (!sourceIds.has(update.sourceHouseEventId)) missingSourceIds.push(update.id);
      if (!knownIds.has(update.fromPersonaId) || !knownIds.has(update.toPersonaId)) {
        unknownIdentityIds.push(update.id);
      }
      if (update.consent?.state === "deleted" || update.consent?.state === "soft-forgotten") {
        deletedOrSoftForgotten += 1;
      }
    }

    return {
      duplicateIds: Array.from(duplicateIds),
      missingSourceIds,
      unknownIdentityIds,
      deletedOrSoftForgotten
    };
  }, [houseEvents, personas, relationshipUpdates]);
  const relationshipMap = Array.from(
    activeRelationshipUpdates
      .reduce((map, update) => {
        const counterpartId = update.fromPersonaId === active.id ? update.toPersonaId : update.fromPersonaId;
        const counterpartName = update.fromPersonaId === active.id ? update.toPersonaName : update.fromPersonaName;
        const existing = map.get(counterpartId);
        map.set(counterpartId, {
          id: counterpartId,
          name: counterpartName,
          count: (existing?.count ?? 0) + 1,
          lastValence: existing?.lastValence ?? update.valence,
          averageIntensity:
            ((existing?.averageIntensity ?? 0) * (existing?.count ?? 0) + update.intensity) /
            ((existing?.count ?? 0) + 1)
        });
        return map;
      }, new Map<string, { id: string; name: string; count: number; lastValence: RelationshipUpdate["valence"]; averageIntensity: number }>())
      .values()
  );
  const createPersona = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const persona = onCreatePersona({
      name: newPersonaName,
      role: newPersonaRole,
      roomId: newPersonaRoomId || rooms[0]?.id || "common"
    });
    setNewPersonaName("");
    setNewPersonaRole("");
    onPersonaSelect(persona);
  };
  const createFromMemory = (memory: PersonaMemoryEntry) => {
    const persona = onCreatePersona({
      name: memory.personaName,
      role: "Imported resident",
      roomId: newPersonaRoomId || rooms[0]?.id || "common"
    });
    onPersonaSelect(persona);
  };
  const claimMemory = (memory: PersonaMemoryEntry, personaId: string) => {
    const persona = personas.find((candidate) => candidate.id === personaId);
    onClaimMemory(memory.id, personaId);
    if (persona) onPersonaSelect(persona);
  };

  return (
    <section className="population-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Population</p>
          <h2>Residents and roles</h2>
        </div>
        <button className="icon-button" title="Add persona" type="button">
          <CirclePlus size={18} />
        </button>
      </div>

      <div className="population-grid">
        <div className="population-sidebar">
          <div className="persona-list">
            {personas.map((persona) => (
              <button
                className={active.id === persona.id ? "active" : ""}
                key={persona.id}
                onClick={() => onPersonaSelect(persona)}
                type="button"
              >
                <span>{persona.name}</span>
                <small>{persona.role}</small>
              </button>
            ))}
          </div>

          <form className="persona-create-form" onSubmit={createPersona}>
            <span>Add resident</span>
            <input
              aria-label="New persona name"
              onChange={(event) => setNewPersonaName(event.currentTarget.value)}
              placeholder="Name"
              value={newPersonaName}
            />
            <input
              aria-label="New persona role"
              onChange={(event) => setNewPersonaRole(event.currentTarget.value)}
              placeholder="Role"
              value={newPersonaRole}
            />
            <select
              aria-label="New persona starting room"
              onChange={(event) => setNewPersonaRoomId(event.currentTarget.value)}
              value={newPersonaRoomId}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            <button className="reset-button" type="submit">
              <CirclePlus size={16} />
              Create
            </button>
          </form>
        </div>

        <article className="persona-card">
          <div className="persona-card-header">
            <div>
              <p className="eyebrow">{active.role}</p>
              <h3>{active.name}</h3>
            </div>
            <span className={`status-chip ${active.state}`}>{stateLabels[active.state]}</span>
          </div>
          <div className="field-block">
            <span>Current activity</span>
            <p>{active.activity}</p>
          </div>
          <label className="field-block model-select">
            <span>Current room</span>
            <select
              onChange={(event) => onPersonaRoomChange(active.id, event.currentTarget.value)}
              value={active.roomId}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          {movementIntent ? (
            <div className="field-block">
              <span>Movement intent</span>
              <p>
                {roomName(movementIntent.fromRoomId)} → {roomName(movementIntent.toRoomId)} /{" "}
                {movementIntent.reason} / arrives{" "}
                {Math.floor(movementIntent.arrivesAtMinute / 60).toString().padStart(2, "0")}:
                {(movementIntent.arrivesAtMinute % 60).toString().padStart(2, "0")}
              </p>
            </div>
          ) : null}
          <div className="field-block">
            <span>Next local decision</span>
            <p>
              {Math.floor(nextActionAfterMinute / 60).toString().padStart(2, "0")}:
              {(nextActionAfterMinute % 60).toString().padStart(2, "0")}
            </p>
          </div>
          <div className="field-block">
            <span>Recent thought</span>
            <p>{active.recentThought}</p>
          </div>
          <label className="field-block alias-editor">
            <span>Aliases</span>
            <input
              aria-label="Persona aliases"
              onChange={(event) =>
                onAliasesChange(
                  active.id,
                  event.currentTarget.value.split(",").map((alias) => alias.trim())
                )
              }
              placeholder="Nicknames or imported names, comma separated"
              value={(active.aliases ?? []).join(", ")}
            />
          </label>
          <label className="field-block toggle-field">
            <span>Use API</span>
            <input
              checked={Boolean(active.apiEnabled)}
              onChange={(event) => onApiEnabledChange(active.id, event.currentTarget.checked)}
              type="checkbox"
            />
            <small>Allows direct model calls for this resident.</small>
          </label>
          <label className="field-block toggle-field">
            <span>Go-juice</span>
            <input
              checked={Boolean(active.goJuice)}
              onChange={(event) => onGoJuiceChange(active.id, event.currentTarget.checked)}
              type="checkbox"
            />
            <small>Keeps moving while the user is away.</small>
          </label>
          <div className="field-block">
            <span>Nightly memory</span>
            {activeMemories.length ? (
              <div className="memory-stack">
                {activeMemories.map((memory) => (
                  <MemoryEntryCard
                    key={memory.id}
                    memory={memory}
                    onMemoryConsentChange={onMemoryConsentChange}
                  />
                ))}
              </div>
            ) : (
              <p>No nightly residue captured yet.</p>
            )}
          </div>
          <div className="field-block">
            <span>Relationship map</span>
            {relationshipMap.length ? (
              <div className="relationship-map">
                {relationshipMap.map((entry) => (
                  <div className="relationship-row" key={entry.id}>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.lastValence} / {entry.count} update{entry.count === 1 ? "" : "s"} /{" "}
                      {entry.averageIntensity.toFixed(2)}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p>No relationship updates filed yet.</p>
            )}
          </div>
          {activeRelationshipUpdates.length ? (
            <details className="visibility-debug">
              <summary>Recent relationship updates</summary>
              <div className="relationship-update-list">
                {activeRelationshipUpdates.slice(0, 8).map((update) => (
                  <article key={update.id}>
                    <div className="relationship-update-header">
                      <strong>
                        {update.fromPersonaName} {"->"} {update.toPersonaName}
                      </strong>
                      <select
                        aria-label="Relationship consent"
                        onChange={(event) =>
                          onRelationshipConsentChange(update.id, event.currentTarget.value as ConsentState)
                        }
                        value={update.consent?.state ?? "known"}
                      >
                        <option value="known">Known</option>
                        <option value="private">Private</option>
                        <option value="restricted">Restricted</option>
                        <option value="soft-forgotten">Soft-forgotten</option>
                        <option value="deleted">Deleted</option>
                      </select>
                    </div>
                    <p>{update.summary}</p>
                    <small>
                      Day {update.day} {update.time} / {update.valence} / confidence{" "}
                      {update.confidence.toFixed(2)}
                    </small>
                    {visibilitySummary ? (
                      <small>
                        Visibility:{" "}
                        {visibilitySummary.visibleRelationshipUpdateIds.includes(update.id)
                          ? "visible to selected resident"
                          : visibilitySummary.excluded.find(
                              (excluded) => excluded.kind === "relationship_update" && excluded.id === update.id
                            )?.reason ?? "not in resolver sample"}
                      </small>
                    ) : null}
                  </article>
                ))}
              </div>
            </details>
          ) : null}
          <label className="field-block model-select">
            <span>Model</span>
            <select
              onChange={(event) =>
                onModelChange(active.id, event.currentTarget.value as AnthropicModel)
              }
              value={active.model}
            >
              {Object.entries(modelLabels).map(([model, label]) => (
                <option key={model} value={model}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="field-block">
            <span>Awareness</span>
            <div className="awareness-grid">
              <small>House log: {active.awareness.houseLogAccess}</small>
              <small>Steward: {active.awareness.stewardAccess}</small>
              <small>Librarian: {active.awareness.librarianAccess}</small>
              <small>Hearing: {active.awareness.hearingRange}</small>
              <small>Private rooms: {active.awareness.privateRoomAccess ? "yes" : "no"}</small>
            </div>
          </div>
          <label className="field-block">
            <span>Name</span>
            <input
              key={active.id}
              type="text"
              defaultValue={active.name}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next && next !== active.name) onPersonaNameChange(active.id, next);
              }}
              style={{
                padding: "6px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                color: "inherit"
              }}
            />
          </label>
          <label className="field-block prompt-editor">
            <span>System prompt</span>
            <textarea
              onChange={(event) => onSystemPromptChange(active.id, event.currentTarget.value)}
              spellCheck="true"
              value={active.systemPrompt}
            />
          </label>
          <div className="permission-grid">
            {active.permissions.map((permission) => (
              <span key={permission}>{permission}</span>
            ))}
          </div>
          {visibilitySummary ? (
            <details className="visibility-debug">
              <summary>Knowledge visibility</summary>
              <div className="visibility-stats">
                <span>Memories {visibilitySummary.visibleMemoryIds.length}</span>
                <span>Events {visibilitySummary.visibleHouseEventIds.length}</span>
                <span>Relationships {visibilitySummary.visibleRelationshipUpdateIds.length}</span>
                <span>Activity {visibilitySummary.visibleActivityIds.length}</span>
                <span>Recall {visibilitySummary.visibleLibrarianRecordIds.length}</span>
                <span>Hidden {visibilitySummary.excluded.length}</span>
              </div>
              <div className="visibility-debug-grid">
                <div>
                  <strong>Visible rooms</strong>
                  <p>{visibilitySummary.visibleRoomIds.join(", ") || "none"}</p>
                </div>
                <div>
                  <strong>Assumptions</strong>
                  <p>{visibilitySummary.assumptions.join(" / ")}</p>
                </div>
                <div>
                  <strong>Visible memory ids</strong>
                  <p>{visibilitySummary.visibleMemoryIds.slice(0, 8).join(", ") || "none"}</p>
                </div>
                <div>
                  <strong>Visible recall ids</strong>
                  <p>{visibilitySummary.visibleLibrarianRecordIds.slice(0, 8).join(", ") || "none"}</p>
                </div>
                <div>
                  <strong>Visible relationship ids</strong>
                  <p>{visibilitySummary.visibleRelationshipUpdateIds.slice(0, 8).join(", ") || "none"}</p>
                </div>
                <div>
                  <strong>Excluded counts</strong>
                  <p>
                    {Object.entries(visibilitySummary.excludedCounts)
                      .map(([reason, count]) => `${reason}: ${count}`)
                      .join(" / ") || "none"}
                  </p>
                </div>
              </div>
            </details>
          ) : null}
          <details className="visibility-debug">
            <summary>Relationship integrity</summary>
            <div className="visibility-stats">
              <span>Total {relationshipUpdates.length}</span>
              <span>Duplicate ids {relationshipIntegrity.duplicateIds.length}</span>
              <span>Missing source {relationshipIntegrity.missingSourceIds.length}</span>
              <span>Unknown identity {relationshipIntegrity.unknownIdentityIds.length}</span>
              <span>Excluded by consent {relationshipIntegrity.deletedOrSoftForgotten}</span>
            </div>
            <div className="visibility-debug-grid">
              <div>
                <strong>Missing source ids</strong>
                <p>{relationshipIntegrity.missingSourceIds.slice(0, 8).join(", ") || "none"}</p>
              </div>
              <div>
                <strong>Unknown identity ids</strong>
                <p>{relationshipIntegrity.unknownIdentityIds.slice(0, 8).join(", ") || "none"}</p>
              </div>
              <div>
                <strong>Relationship exclusions</strong>
                <p>
                  {visibilitySummary
                    ? Object.entries(visibilitySummary.excludedCounts)
                        .filter(([reason]) =>
                          ["consent_deleted", "consent_soft_forgotten", "source_event_missing", "source_event_hidden", "not_relationship_subject"].includes(reason)
                        )
                        .map(([reason, count]) => `${reason}: ${count}`)
                        .join(" / ") || "none"
                    : "no selected resident"}
                </p>
              </div>
            </div>
          </details>
          <details className="visibility-debug" open>
            <summary>Source provenance</summary>
            {provenanceItems.length ? (
              <div className="provenance-panel">
                <label className="provenance-picker">
                  <span>Inspect source chain</span>
                  <select
                    onChange={(event) => setSelectedProvenanceId(event.currentTarget.value)}
                    value={activeProvenanceId}
                  >
                    {provenanceItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {provenance ? (
                  <>
                    <div className="visibility-stats">
                      <span>{provenance.kind}</span>
                      <span>{provenance.sourceKind}</span>
                      <span>Consent {provenance.consent}</span>
                      <span>Transcript {provenance.transcript.length}</span>
                    </div>
                    <div className="visibility-debug-grid">
                      <div>
                        <strong>Selected</strong>
                        <p>{provenance.title}</p>
                      </div>
                      <div>
                        <strong>Source label</strong>
                        <p>{provenance.sourceLabel}</p>
                      </div>
                      <div>
                        <strong>Source House events</strong>
                        <p>
                          {provenance.sourceHouseEvents.length
                            ? provenance.sourceHouseEvents
                                .map((source) => `${source.id}${source.exists ? "" : " (missing)"}`)
                                .join(", ")
                            : "none"}
                        </p>
                      </div>
                      <div>
                        <strong>Source activity</strong>
                        <p>
                          {provenance.sourceActivity.length
                            ? provenance.sourceActivity
                                .map((source) => `${source.id}${source.exists ? "" : " (missing)"}`)
                                .join(", ")
                            : "none"}
                        </p>
                      </div>
                      <div>
                        <strong>Direct room</strong>
                        <p>{provenance.directRoom ? provenance.directRoom.title : "none"}</p>
                      </div>
                      <div>
                        <strong>Librarian ids</strong>
                        <p>{provenance.librarianIds.join(", ") || "none"}</p>
                      </div>
                    </div>
                    {provenance.transcript.length ? (
                      <details className="transcript-preview">
                        <summary>Source transcript</summary>
                        <div>
                          {provenance.transcript.slice(0, 12).map((turn) => (
                            <article key={`provenance-${turn.index}`}>
                              <strong>{turn.speaker}</strong>
                              <p>{turn.text}</p>
                            </article>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <p className="empty-copy">No memory or relationship source chain for this resident yet.</p>
            )}
          </details>
        </article>
      </div>

      <section className="imported-memory-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Imported memories</p>
            <h2>Unclaimed records</h2>
          </div>
          <span className="runtime-pill">{unclaimedMemories.length}</span>
        </div>
        {unclaimedMemories.length ? (
          <div className="imported-memory-grid">
            {unclaimedMemories.slice(0, 8).map((memory) => (
              (() => {
                const match = importMatch(memory, personas);
                const targetId = claimTargets[memory.id] ?? match?.persona.id ?? personas[0]?.id ?? "";
                return (
                  <MemoryEntryCard
                    action={
                      <div className="claim-controls">
                        {match ? (
                          <span className={`match-chip ${match.level}`}>
                            {match.level === "exact"
                              ? `Exact match: ${match.persona.name}`
                              : match.level === "fuzzy"
                                ? `Possible match: ${match.persona.name}`
                                : "No close match"}
                          </span>
                        ) : null}
                        <select
                          aria-label="Claim imported memory as resident"
                          onChange={(event) =>
                            setClaimTargets((current) => ({
                              ...current,
                              [memory.id]: event.currentTarget.value
                            }))
                          }
                          value={targetId}
                        >
                          {personas.map((persona) => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="reset-button"
                          disabled={!targetId}
                          onClick={() => claimMemory(memory, targetId)}
                          type="button"
                        >
                          Claim as resident
                        </button>
                        <button className="reset-button" onClick={() => createFromMemory(memory)} type="button">
                          <CirclePlus size={16} />
                          Create resident from memory
                        </button>
                      </div>
                    }
                    key={memory.id}
                    memory={memory}
                    onMemoryConsentChange={onMemoryConsentChange}
                    showPersona
                  />
                );
              })()
            ))}
          </div>
        ) : (
          <p className="empty-copy">Imported memories will appear here until a matching resident exists.</p>
        )}
      </section>

      <section className="imported-memory-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Memory archive</p>
            <h2>Latest compressed days</h2>
          </div>
          <span className="runtime-pill">{personaMemories.length}</span>
        </div>
        {personaMemories.length ? (
          <div className="memory-archive-grid">
            {personaMemories.slice(0, 24).map((memory) => (
              <MemoryEntryCard
                key={`archive-${memory.id}`}
                memory={memory}
                onMemoryConsentChange={onMemoryConsentChange}
                showPersona
              />
            ))}
          </div>
        ) : (
          <p className="empty-copy">No compressed memories have been captured yet.</p>
        )}
      </section>
    </section>
  );
}

function PopulationView({
  rooms,
  personas,
  selectedPersona,
  onPersonaSelect,
  onPersonaRoomChange,
  onModelChange,
  onApiEnabledChange,
  onGoJuiceChange,
  onPersonaNameChange,
  onSystemPromptChange,
  onAliasesChange,
  onCreatePersona,
  onClaimMemory,
  onMemoryConsentChange,
  onRelationshipConsentChange,
  visibilitySummary,
  personaMemories,
  relationshipUpdates,
  houseEvents,
  activity,
  directRooms
}: {
  rooms: Room[];
  personas: Persona[];
  selectedPersona: Persona | null;
  onPersonaSelect: (persona: Persona) => void;
  onPersonaRoomChange: (personaId: string, roomId: string) => void;
  onModelChange: (personaId: string, model: AnthropicModel) => void;
  onApiEnabledChange: (personaId: string, apiEnabled: boolean) => void;
  onGoJuiceChange: (personaId: string, goJuice: boolean) => void;
  onPersonaNameChange: (personaId: string, name: string) => void;
  onSystemPromptChange: (personaId: string, systemPrompt: string) => void;
  onAliasesChange: (personaId: string, aliases: string[]) => void;
  onCreatePersona: (input: { name: string; role: string; roomId: string }) => Persona;
  onClaimMemory: (memoryId: string, personaId: string) => Persona | null;
  onMemoryConsentChange: (memoryId: string, state: ConsentState) => void;
  onRelationshipConsentChange: (relationshipId: string, state: ConsentState) => void;
  visibilitySummary: VisibilitySummary | null;
  personaMemories: PersonaMemoryEntry[];
  relationshipUpdates: RelationshipUpdate[];
  houseEvents: HouseEvent[];
  activity: ActivityEvent[];
  directRooms: DirectRoom[];
}) {
  return (
    <section className="population-view">
      <PopulationPanel
        onModelChange={onModelChange}
        onApiEnabledChange={onApiEnabledChange}
        onGoJuiceChange={onGoJuiceChange}
        onPersonaSelect={onPersonaSelect}
        onPersonaRoomChange={onPersonaRoomChange}
        onAliasesChange={onAliasesChange}
        onCreatePersona={onCreatePersona}
        onClaimMemory={onClaimMemory}
        onPersonaNameChange={onPersonaNameChange}
        onSystemPromptChange={onSystemPromptChange}
        onMemoryConsentChange={onMemoryConsentChange}
        onRelationshipConsentChange={onRelationshipConsentChange}
        visibilitySummary={visibilitySummary}
        personaMemories={personaMemories}
        relationshipUpdates={relationshipUpdates}
        houseEvents={houseEvents}
        activity={activity}
        directRooms={directRooms}
        rooms={rooms}
        personas={personas}
        selectedPersona={selectedPersona}
      />
    </section>
  );
}

function StewardDiagnosticsView({
  activity,
  houseEvents,
  personaMemories,
  relationshipUpdates,
  directRooms,
  personas,
  rooms,
  roomConversations,
  status,
  day,
  formattedTime,
  config,
  callBudgetUsed,
  onCreateBackup,
  onSyncMemoryFiles,
  onCompactLibrarian,
  onRewriteDirectRooms,
  onRearchiveRelationships,
  onRepairSourceIntegrity,
  onRefreshOutsideSignal,
  onResetPersonaCalls,
  onUpsertRoom
}: {
  activity: ActivityEvent[];
  houseEvents: HouseEvent[];
  personaMemories: PersonaMemoryEntry[];
  relationshipUpdates: RelationshipUpdate[];
  directRooms: DirectRoom[];
  personas: Persona[];
  rooms: Room[];
  roomConversations: RoomConversation[];
  status: AnthropicStatus | null;
  day: number;
  formattedTime: string;
  config: RuntimeConfig;
  callBudgetUsed: number;
  onCreateBackup: () => Promise<string>;
  onSyncMemoryFiles: () => Promise<string>;
  onCompactLibrarian: () => Promise<string>;
  onRewriteDirectRooms: () => Promise<string>;
  onRearchiveRelationships: () => Promise<string>;
  onRepairSourceIntegrity: () => Promise<string>;
  onRefreshOutsideSignal: () => Promise<string>;
  onResetPersonaCalls: () => void;
  onUpsertRoom: (input: {
    id?: string;
    name: string;
    floor: FloorId;
    purpose: string;
    atmosphere: string;
    layout: string;
    furniture: string;
    items: string;
    affordances: string;
  }) => Room | null;
}) {
  const [repairStatus, setRepairStatus] = useState("");
  const [editingRoomId, setEditingRoomId] = useState("");
  const editingRoom = rooms.find((room) => room.id === editingRoomId) ?? null;
  const [roomDraft, setRoomDraft] = useState({
    name: "",
    floor: "ground" as FloorId,
    purpose: "",
    atmosphere: "",
    layout: "",
    furniture: "",
    items: "",
    affordances: ""
  });
  const knownIds = new Set(["casey", ...personas.map((persona) => persona.id)]);
  const houseEventIds = new Set(houseEvents.map((event) => event.id));
  const directRoomIds = new Set(directRooms.map((room) => room.id));
  const consentCounts = relationshipUpdates.reduce<Record<ConsentState, number>>(
    (counts, update) => {
      const state = update.consent?.state ?? "known";
      counts[state] = (counts[state] ?? 0) + 1;
      return counts;
    },
    { known: 0, private: 0, restricted: 0, "soft-forgotten": 0, deleted: 0 }
  );
  const memoryConsentCounts = personaMemories.reduce<Record<ConsentState, number>>(
    (counts, memory) => {
      const state = memory.consent?.state ?? "known";
      counts[state] = (counts[state] ?? 0) + 1;
      return counts;
    },
    { known: 0, private: 0, restricted: 0, "soft-forgotten": 0, deleted: 0 }
  );
  const missingRelationshipSources = relationshipUpdates.filter(
    (update) => !houseEventIds.has(update.sourceHouseEventId)
  );
  const unknownRelationshipIdentity = relationshipUpdates.filter(
    (update) => !knownIds.has(update.fromPersonaId) || !knownIds.has(update.toPersonaId)
  );
  const missingMemorySources = personaMemories.flatMap((memory) => [
    ...memory.sourceHouseEventIds
      .filter((id) => !houseEventIds.has(id))
      .map((id) => `${memory.id} -> house:${id}`),
    ...(memory.source?.kind === "direct_room" && memory.source.filePath
      ? [memory.source.filePath.match(/([^/\\]+)\.json$/)?.[1] ?? ""]
          .filter((id) => id && !directRoomIds.has(id))
          .map((id) => `${memory.id} -> direct:${id}`)
      : [])
  ]);
  const failureEvents = activity
    .filter((event) => /failure|could not|unavailable|missing model key|hiccupped|offline/i.test(event.text))
    .slice(0, 8);
  const recentSystemEvents = activity
    .filter((event) => event.visibility?.scope === "system" || event.persona === "The Steward")
    .slice(0, 10);
  const attentionItems = [
    ...(!status?.configured ? ["Anthropic API key is not configured; direct persona calls use Steward fallback."] : []),
    ...(missingRelationshipSources.length ? [`${missingRelationshipSources.length} relationship update source${missingRelationshipSources.length === 1 ? " is" : "s are"} missing.`] : []),
    ...(unknownRelationshipIdentity.length ? [`${unknownRelationshipIdentity.length} relationship update${unknownRelationshipIdentity.length === 1 ? " has" : "s have"} unknown identity.`] : []),
    ...(missingMemorySources.length ? [`${missingMemorySources.length} memory source reference${missingMemorySources.length === 1 ? " is" : "s are"} missing.`] : []),
    ...(config.presenceMode === "away" ? ["Presence is away; only go-juice residents should keep active drift."] : []),
    ...(callBudgetUsed >= config.personaModelCallsPerDay ? ["Daily persona model-call budget is fully spent."] : [])
  ];
  const runRepair = async (label: string, action: () => Promise<string>) => {
    setRepairStatus(`${label}...`);
    try {
      setRepairStatus(await action());
    } catch (error) {
      setRepairStatus(error instanceof Error ? error.message : `${label} failed.`);
    }
  };
  const startRoomEdit = (roomId: string) => {
    const room = rooms.find((candidate) => candidate.id === roomId) ?? null;
    setEditingRoomId(roomId);
    setRoomDraft({
      name: room?.name ?? "",
      floor: room?.floor ?? "ground",
      purpose: room?.purpose ?? "",
      atmosphere: room?.atmosphere ?? "",
      layout: room?.layout ?? "",
      furniture: listDraft(room?.furniture),
      items: listDraft(room?.items),
      affordances: listDraft(room?.affordances)
    });
  };
  const updateRoomDraft = (field: keyof typeof roomDraft, value: string) => {
    setRoomDraft((draft) => ({ ...draft, [field]: value }));
  };
  const submitRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const room = onUpsertRoom({
      id: editingRoom?.id,
      ...roomDraft
    });
    if (room) {
      setEditingRoomId(room.id);
      setRoomDraft({
        name: room.name,
        floor: room.floor,
        purpose: room.purpose,
        atmosphere: room.atmosphere,
        layout: room.layout,
        furniture: listDraft(room.furniture),
        items: listDraft(room.items),
        affordances: listDraft(room.affordances)
      });
      setRepairStatus(`Saved room structure: ${room.name}.`);
    }
  };

  return (
    <section className="steward-view">
      <div className="steward-header">
        <div>
          <p className="eyebrow">Integrity layer</p>
          <h2>Steward diagnostics</h2>
        </div>
        <div className="runtime-strip">
          <span className="runtime-pill">Day {day}</span>
          <span className="runtime-pill">{formattedTime}</span>
          <span className={status?.configured ? "runtime-pill ready" : "runtime-pill placeholder"}>
            API {status?.configured ? "ready" : "placeholder"}
          </span>
        </div>
      </div>

      <div className="steward-grid">
        <section className="steward-panel">
          <p className="eyebrow">Runtime posture</p>
          <div className="steward-stat-grid">
            <div><span>Presence</span><strong>{config.presenceMode}</strong></div>
            <div><span>Time</span><strong>{config.timeMode}</strong></div>
            <div><span>Call budget</span><strong>{callBudgetUsed}/{config.personaModelCallsPerDay}</strong></div>
            <div><span>Motion</span><strong>{config.motionEnabled ? "on" : "off"}</strong></div>
          </div>
          <button className="reset-button" onClick={onResetPersonaCalls} type="button">
            <RotateCcw size={16} />
            Reset persona calls
          </button>
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Durable ledgers</p>
          <div className="steward-stat-grid">
            <div><span>House events</span><strong>{houseEvents.length}</strong></div>
            <div><span>Persona memories</span><strong>{personaMemories.length}</strong></div>
            <div><span>Relationships</span><strong>{relationshipUpdates.length}</strong></div>
            <div><span>Direct rooms</span><strong>{directRooms.length}</strong></div>
            <div><span>Room conversations</span><strong>{roomConversations.length}</strong></div>
            <div><span>Activity</span><strong>{activity.length}</strong></div>
          </div>
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Consent boundaries</p>
          <div className="consent-ledger">
            <div>
              <strong>Memories</strong>
              <p>{Object.entries(memoryConsentCounts).map(([state, count]) => `${state}: ${count}`).join(" / ")}</p>
            </div>
            <div>
              <strong>Relationships</strong>
              <p>{Object.entries(consentCounts).map(([state, count]) => `${state}: ${count}`).join(" / ")}</p>
            </div>
          </div>
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Needs attention</p>
          {attentionItems.length ? (
            <div className="attention-list">
              {attentionItems.map((item) => <p key={item}>{item}</p>)}
            </div>
          ) : (
            <p className="empty-copy">No immediate integrity warnings.</p>
          )}
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Repair actions</p>
          <div className="repair-action-grid">
            <button className="reset-button" onClick={() => runRepair("Creating safety backup", onCreateBackup)} type="button">
              Create safety backup
            </button>
            <button className="reset-button" onClick={() => runRepair("Syncing memory files", onSyncMemoryFiles)} type="button">
              Sync memory files
            </button>
            <button className="reset-button" onClick={() => runRepair("Compacting Librarian", onCompactLibrarian)} type="button">
              Compact Librarian
            </button>
            <button className="reset-button" onClick={() => runRepair("Rewriting direct rooms", onRewriteDirectRooms)} type="button">
              Rewrite direct rooms
            </button>
            <button className="reset-button" onClick={() => runRepair("Re-archiving relationships", onRearchiveRelationships)} type="button">
              Re-archive relationships
            </button>
            <button className="reset-button" onClick={() => runRepair("Repairing source integrity", onRepairSourceIntegrity)} type="button">
              Repair source integrity
            </button>
            <button className="reset-button" onClick={() => runRepair("Refreshing outside signal", onRefreshOutsideSignal)} type="button">
              Refresh outside signal
            </button>
          </div>
          {repairStatus ? <p className="repair-status">{repairStatus}</p> : null}
        </section>

        <section className="steward-panel wide">
          <p className="eyebrow">Recent Steward/system activity</p>
          <div className="steward-event-list">
            {recentSystemEvents.map((event) => (
              <article key={event.id}>
                <time>{event.time}</time>
                <div>
                  <strong>{event.persona}</strong>
                  <p>{event.text}</p>
                  <small>{event.visibility?.basis ?? "legacy / broad log"}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Failure surface</p>
          {failureEvents.length ? (
            <div className="steward-event-list compact">
              {failureEvents.map((event) => (
                <article key={event.id}>
                  <time>{event.time}</time>
                  <div>
                    <strong>{event.persona}</strong>
                    <p>{event.text}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">No recent failure events.</p>
          )}
        </section>

        <section className="steward-panel">
          <p className="eyebrow">Source integrity</p>
          <div className="consent-ledger">
            <div>
              <strong>Missing relationship sources</strong>
              <p>{missingRelationshipSources.slice(0, 5).map((update) => update.id).join(", ") || "none"}</p>
            </div>
            <div>
              <strong>Unknown relationship identities</strong>
              <p>{unknownRelationshipIdentity.slice(0, 5).map((update) => update.id).join(", ") || "none"}</p>
            </div>
            <div>
              <strong>Missing memory sources</strong>
              <p>{missingMemorySources.slice(0, 5).join(", ") || "none"}</p>
            </div>
          </div>
        </section>

        <section className="steward-panel wide">
          <p className="eyebrow">Room structure editor</p>
          <div className="room-editor-layout">
            <div className="room-editor-list">
              <button className={!editingRoomId ? "active" : ""} onClick={() => startRoomEdit("")} type="button">
                New room
              </button>
              {rooms.map((room) => (
                <button
                  className={editingRoomId === room.id ? "active" : ""}
                  key={room.id}
                  onClick={() => startRoomEdit(room.id)}
                  type="button"
                >
                  <span>{room.name}</span>
                  <small>{room.floor}</small>
                </button>
              ))}
            </div>
            <form className="room-editor-form" onSubmit={submitRoom}>
              <label>
                <span>Name</span>
                <input
                  onChange={(event) => updateRoomDraft("name", event.currentTarget.value)}
                  value={roomDraft.name}
                />
              </label>
              <label>
                <span>Floor</span>
                <select
                  onChange={(event) => updateRoomDraft("floor", event.currentTarget.value as FloorId)}
                  value={roomDraft.floor}
                >
                  <option value="ground">Ground</option>
                  <option value="upstairs">Upstairs</option>
                </select>
              </label>
              <label>
                <span>Purpose</span>
                <textarea onChange={(event) => updateRoomDraft("purpose", event.currentTarget.value)} value={roomDraft.purpose} />
              </label>
              <label>
                <span>Atmosphere</span>
                <textarea onChange={(event) => updateRoomDraft("atmosphere", event.currentTarget.value)} value={roomDraft.atmosphere} />
              </label>
              <label>
                <span>Layout</span>
                <textarea onChange={(event) => updateRoomDraft("layout", event.currentTarget.value)} value={roomDraft.layout} />
              </label>
              <label>
                <span>Furniture</span>
                <input onChange={(event) => updateRoomDraft("furniture", event.currentTarget.value)} value={roomDraft.furniture} />
              </label>
              <label>
                <span>Items</span>
                <input onChange={(event) => updateRoomDraft("items", event.currentTarget.value)} value={roomDraft.items} />
              </label>
              <label>
                <span>Affordances</span>
                <input onChange={(event) => updateRoomDraft("affordances", event.currentTarget.value)} value={roomDraft.affordances} />
              </label>
              <button className="reset-button" type="submit">
                {editingRoom ? "Update room" : "Create room"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </section>
  );
}

function MotionControls({
  config,
  callBudgetUsed,
  formattedTime,
  day,
  onConfigChange,
  onExport,
  onLoad,
  onCreateBackup,
  onListBackups,
  onRestoreBackup,
  onResetPersonaCalls,
  onReset
}: {
  config: RuntimeConfig;
  callBudgetUsed: number;
  formattedTime: string;
  day: number;
  onConfigChange: (config: Partial<RuntimeConfig>) => void;
  onExport: () => Promise<string>;
  onLoad: () => Promise<string>;
  onCreateBackup: () => Promise<string>;
  onListBackups: () => Promise<HouseBackupManifest[]>;
  onRestoreBackup: (backupId?: string) => Promise<string>;
  onResetPersonaCalls: () => void;
  onReset: () => void;
}) {
  const [exportStatus, setExportStatus] = useState<string>("");
  const [backups, setBackups] = useState<HouseBackupManifest[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState<string>("");

  const handleExport = async () => {
    setExportStatus("Exporting...");
    try {
      setExportStatus(await onExport());
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Export failed.");
    }
  };

  const handleLoad = async () => {
    setExportStatus("Loading...");
    try {
      setExportStatus(await onLoad());
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Load failed.");
    }
  };

  const handleCreateBackup = async () => {
    setExportStatus("Creating backup...");
    try {
      setExportStatus(await onCreateBackup());
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Backup failed.");
    }
  };

  const handleListBackups = async () => {
    setExportStatus("Reading backups...");
    try {
      const nextBackups = await onListBackups();
      setBackups(nextBackups);
      setSelectedBackupId((current) => current || nextBackups[0]?.backupId || "");
      setExportStatus(`${nextBackups.length} backup${nextBackups.length === 1 ? "" : "s"} available.`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Could not list backups.");
    }
  };

  const handleRestoreBackup = async () => {
    setExportStatus(selectedBackupId ? "Restoring selected backup..." : "Restoring latest backup...");
    try {
      setExportStatus(await onRestoreBackup(selectedBackupId || undefined));
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Restore failed.");
    }
  };

  return (
    <section className="motion-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local motion</p>
          <h2>
            Day {day} / {formattedTime}
          </h2>
        </div>
        <button
          className="icon-button"
          onClick={() =>
            onConfigChange({ timeMode: config.timeMode === "paused" ? "real" : "paused" })
          }
          title={config.timeMode === "paused" ? "Resume real time" : "Pause time"}
          type="button"
        >
          {config.timeMode === "paused" ? <Play size={18} /> : <Pause size={18} />}
        </button>
      </div>

      <div className="motion-stats">
        <div>
          <span>Persona calls marked</span>
          <strong>
            {callBudgetUsed}/{config.personaModelCallsPerDay}
          </strong>
        </div>
        <div>
          <span>Time mode</span>
          <strong>{config.timeMode}</strong>
        </div>
        <div>
          <span>Presence</span>
          <strong>{config.presenceMode}</strong>
        </div>
      </div>

      <div className="segmented-control" aria-label="Presence mode">
        <button
          className={config.presenceMode === "observed" ? "active" : ""}
          onClick={() => onConfigChange({ presenceMode: "observed" })}
          type="button"
        >
          Observed
        </button>
        <button
          className={config.presenceMode === "away" ? "active" : ""}
          onClick={() => onConfigChange({ presenceMode: "away" })}
          type="button"
        >
          Away
        </button>
      </div>

      <div className="segmented-control" aria-label="Time mode">
        <button
          className={config.timeMode === "real" ? "active" : ""}
          onClick={() => onConfigChange({ timeMode: "real" })}
          type="button"
        >
          Real
        </button>
        <button
          className={config.timeMode === "accelerated" ? "active" : ""}
          onClick={() => onConfigChange({ timeMode: "accelerated" })}
          type="button"
        >
          Test
        </button>
        <button
          className={config.timeMode === "paused" ? "active" : ""}
          onClick={() => onConfigChange({ timeMode: "paused" })}
          type="button"
        >
          Paused
        </button>
      </div>

      <label className="control-row">
        <span>Daily call budget</span>
        <input
          max="120"
          min="0"
          onChange={(event) =>
            onConfigChange({ personaModelCallsPerDay: Number(event.currentTarget.value) })
          }
          type="range"
          value={config.personaModelCallsPerDay}
        />
      </label>

      <button className="reset-button" onClick={onResetPersonaCalls} type="button">
        <RotateCcw size={16} />
        Reset persona calls
      </button>

      <label className="control-row">
        <span>Runtime tick</span>
        <input
          max="20"
          min="2"
          onChange={(event) => onConfigChange({ tickSeconds: Number(event.currentTarget.value) })}
          type="range"
          value={config.tickSeconds}
        />
      </label>

      <label className="control-row">
        <span>Test minutes per tick</span>
        <input
          disabled={config.timeMode !== "accelerated"}
          max="120"
          min="1"
          onChange={(event) =>
            onConfigChange({ acceleratedMinutesPerTick: Number(event.currentTarget.value) })
          }
          type="range"
          value={config.acceleratedMinutesPerTick}
        />
      </label>

      <button className="reset-button" onClick={onReset} type="button">
        <RotateCcw size={16} />
        Reset local runtime
      </button>
      <button className="reset-button" onClick={handleExport} type="button">
        <Download size={16} />
        Export House files
      </button>
      <button className="reset-button" onClick={handleLoad} type="button">
        <Upload size={16} />
        Load House files
      </button>
      <button className="reset-button" onClick={handleCreateBackup} type="button">
        <ShieldCheck size={16} />
        Create Backup
      </button>
      <button className="reset-button" onClick={handleListBackups} type="button">
        <ListChecks size={16} />
        List Backups
      </button>
      {backups.length > 0 ? (
        <label className="backup-select">
          <span>Backup</span>
          <select
            onChange={(event) => setSelectedBackupId(event.currentTarget.value)}
            value={selectedBackupId}
          >
            {backups.map((backup) => (
              <option key={backup.backupId} value={backup.backupId}>
                {backup.createdAt} / {backup.reason}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button className="reset-button" onClick={handleRestoreBackup} type="button">
        <History size={16} />
        Restore Selected Backup
      </button>
      {exportStatus ? <p className="export-status">{exportStatus}</p> : null}
    </section>
  );
}

function LibrarianPanel({
  latestActivity,
  onRememberActivity,
  onRecall,
  onCompact
}: {
  latestActivity: ActivityEvent | null;
  onRememberActivity: (activityId: string) => Promise<string>;
  onRecall: (query: string) => Promise<LibrarianRecord[]>;
  onCompact: () => Promise<string>;
}) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<LibrarianRecord[]>([]);
  const [status, setStatus] = useState("");

  const rememberLatest = async () => {
    if (!latestActivity) {
      setStatus("No activity to file.");
      return;
    }
    setStatus("Filing...");
    try {
      setStatus(await onRememberActivity(latestActivity.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not file record.");
    }
  };

  const recall = async () => {
    setStatus("Searching...");
    try {
      const nextRecords = await onRecall(query);
      setRecords(nextRecords);
      setStatus(`${nextRecords.length} record${nextRecords.length === 1 ? "" : "s"} found.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Recall failed.");
    }
  };

  const compact = async () => {
    setStatus("Compacting...");
    try {
      setStatus(await onCompact());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Compact failed.");
    }
  };

  return (
    <section className="librarian-card">
      <div>
        <p className="eyebrow">Librarian memory</p>
        <h2>Structured recall v1</h2>
      </div>
      <div className="librarian-actions">
        <button className="reset-button" onClick={rememberLatest} type="button">
          File latest activity
        </button>
        <button className="reset-button" onClick={compact} type="button">
          Compact recall store
        </button>
      </div>
      <div className="terminal-input librarian-query">
        <input
          aria-label="Librarian recall query"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Ask the Librarian..."
          value={query}
        />
        <button onClick={recall} type="button">
          Recall
        </button>
      </div>
      {status ? <p className="export-status">{status}</p> : null}
      {records.length > 0 ? (
        <div className="librarian-results">
          {records.map((record) => (
            <article key={record.id}>
              <strong>{record.subject}</strong>
              <p>
                {record.predicate}: {record.object}
              </p>
              <small>
                {record.type} / confidence {record.confidence.toFixed(2)} / {record.source.label}
              </small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OutsideSignalPanel({
  signal,
  onRefresh
}: {
  signal: OutsideSignal | null;
  onRefresh: () => Promise<string>;
}) {
  const [status, setStatus] = useState("");

  const refresh = async () => {
    setStatus("Reading outside...");
    try {
      setStatus(await onRefresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not refresh outside signal.");
    }
  };

  return (
    <section className="api-card outside-card">
      <div>
        <p className="eyebrow">Outside signal</p>
        <h2>{signal?.title ?? "No signal yet"}</h2>
      </div>
      <p>{signal?.summary ?? "Record one shared signal from outside the House."}</p>
      {signal?.weekSummary ? <small>{signal.weekSummary}</small> : null}
      {signal ? (
        <div className="outside-meta">
          <span>{signal.source.replace(/_/g, " ")}</span>
          <span>{signal.season}</span>
          <span>{signal.timeOfDay}</span>
        </div>
      ) : null}
      <button className="reset-button" onClick={refresh} type="button">
        Refresh signal
      </button>
      {status ? <p className="export-status">{status}</p> : null}
    </section>
  );
}

function BedtimeRitualCard({
  memoryCount,
  onRunNow,
  onImportMemory,
  onSyncMemoryFiles
}: {
  memoryCount: number;
  onRunNow: () => Promise<string>;
  onImportMemory: (filePath?: string) => Promise<string>;
  onSyncMemoryFiles: () => Promise<string>;
}) {
  const [status, setStatus] = useState("");

  const run = async () => {
    setStatus("Running bedtime ritual...");
    try {
      setStatus(await onRunNow());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bedtime ritual could not complete.");
    }
  };

  const importMemory = async (filePath?: string) => {
    setStatus("Importing memory...");
    try {
      setStatus(await onImportMemory(filePath));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import memory.");
    }
  };

  const syncFiles = async () => {
    setStatus("Syncing memory files...");
    try {
      setStatus(await onSyncMemoryFiles());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not sync memory files.");
    }
  };

  return (
    <div className="night-card">
      <div className="night-icon">
        <Moon size={20} />
      </div>
      <div>
        <p className="eyebrow">House rhythm</p>
        <h2>3:32 bedtime ritual</h2>
        <p>
          Daily residue is captured before default sleep at 3:33. Captured records:{" "}
          {memoryCount}.
        </p>
        <button className="reset-button" onClick={run} type="button">
          Run ritual now
        </button>
        <button className="reset-button" onClick={() => importMemory()} type="button">
          Import memory JSON
        </button>
        <button className="reset-button" onClick={syncFiles} type="button">
          Sync memory files
        </button>
        {status ? <p className="export-status">{status}</p> : null}
      </div>
    </div>
  );
}

export function App() {
  const {
    runtime,
    formattedTime,
    updateConfig,
    resetPersonaCallBudget,
    upsertRoom,
    assignPersonaRoom,
    updatePersonaGoJuice,
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
    movePersonaToRoom,
    setUserRoomId,
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
  } =
    useHouseRuntime();
  const [floor, setFloor] = useState<FloorId>("ground");
  const [selectedRoomId, setSelectedRoomId] = useState<string>(seedRooms[0].id);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("steward");
  const [status, setStatus] = useState<AnthropicStatus | null>(null);
  const [view, setView] = useState<MainView>("house");

  const selectedPersona =
    runtime.personas.find((persona) => persona.id === selectedPersonaId) ?? runtime.personas[0] ?? null;
  const selectedRoom =
    runtime.rooms.find((room) => room.id === selectedRoomId) ?? runtime.rooms[0] ?? null;
  const visibilitySummary = selectedPersona ? resolveVisibilityForPersona(selectedPersona.id) : null;

  useEffect(() => {
    getAnthropicStatus().then(setStatus).catch(() => {
      setStatus({
        configured: false,
        mode: "placeholder",
        note: "Desktop runtime bridge is unavailable in this environment."
      });
    });
  }, []);

  const occupants = useMemo(() => {
    if (!selectedRoom) {
      return [];
    }
    return runtime.personas.filter((persona) => persona.roomId === selectedRoom.id);
  }, [runtime.personas, selectedRoom]);

  const selectPersona = (persona: Persona) => {
    setSelectedPersonaId(persona.id);
    const room = runtime.rooms.find((candidate) => candidate.id === persona.roomId);
    if (room) {
      setSelectedRoomId(room.id);
      setFloor(room.floor);
    }
  };

  const moveUserToRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    setUserRoomId(roomId);
  };

  const caseyRoom = runtime.caseyRoomId
    ? runtime.rooms.find((room) => room.id === runtime.caseyRoomId) ?? null
    : null;

  const currentRoomConversation = runtime.caseyRoomId
    ? runtime.roomConversations.find(
        (conversation) => conversation.roomId === runtime.caseyRoomId && conversation.active
      ) ?? null
    : null;

  useEffect(() => {
    if (!window.houseRuntime?.mobileWalkie?.onRequest) return;
    return window.houseRuntime.mobileWalkie.onRequest((request) => {
      const respond = (result: unknown) => window.houseRuntime?.mobileWalkie?.respond({ id: request.id, ok: true, result });
      const fail = (error: unknown) =>
        window.houseRuntime?.mobileWalkie?.respond({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      try {
        if (request.type === "status") {
          respond({
            ok: true,
            houseDay: runtime.day,
            formattedTime,
            caseyRoomId: runtime.caseyRoomId ?? null,
            caseyRoomName: caseyRoom?.name ?? null,
            personas: runtime.personas.map((persona) => ({
              id: persona.id,
              name: persona.name,
              apiEnabled: Boolean(persona.apiEnabled),
              goJuice: Boolean(persona.goJuice),
              roomId: persona.roomId,
              state: persona.state
            }))
          });
          return;
        }
        if (request.type === "transcript") {
          const mode = request.payload?.mode;
          const targetPersonaId = request.payload?.targetPersonaId;
          const formatTurn = (turn: ConversationTurn) => ({
            id: turn.id,
            speaker: turn.speaker,
            text: turn.text,
            day: turn.day ?? null,
            minuteOfDay: turn.minuteOfDay ?? null,
            timestamp: turn.timestamp ?? null
          });

          if (targetPersonaId) {
            const directRoom = runtime.directRooms.find((room) => room.personaId === targetPersonaId);
            respond({
              ok: true,
              title: directRoom?.title ?? `Walkie: ${runtime.personas.find((p) => p.id === targetPersonaId)?.name ?? targetPersonaId}`,
              turns: directRoom?.turns.slice(-40).map(formatTurn) ?? []
            });
            return;
          }

          if (mode === "house") {
            respond({
              ok: true,
              title: "House channel",
              turns: runtime.activity
                .filter((event) => event.visibility?.scope === "house")
                .slice(0, 40)
                .reverse()
                .map((event) => ({
                  id: event.id,
                  speaker: event.persona,
                  text: event.text,
                  day: null,
                  minuteOfDay: null,
                  timestamp: null
                }))
            });
            return;
          }

          respond({
            ok: true,
            title: caseyRoom ? `Room: ${caseyRoom.name}` : "Current room",
            turns: currentRoomConversation?.turns.slice(-40).map(formatTurn) ?? []
          });
          return;
        }
        if (request.type === "message") {
          const text = String(request.payload?.text ?? "").trim();
          if (!text) throw new Error("Message is empty.");
          const targetPersonaId = request.payload?.targetPersonaId;
          if (targetPersonaId) {
            const existingRoom = runtime.directRooms.find((room) => room.personaId === targetPersonaId);
            const roomId = existingRoom?.id ?? createDirectRoom(targetPersonaId);
            if (!roomId) throw new Error("Could not open that walkie room.");
            if (!existingRoom) {
              respond({
                ok: true,
                route: `Opened walkie to ${
                  runtime.personas.find((p) => p.id === targetPersonaId)?.name ?? targetPersonaId
                }; send again.`
              });
              return;
            }
            void sendDirectMessage(roomId, text);
            respond({ ok: true, route: `Walkie to ${runtime.personas.find((p) => p.id === targetPersonaId)?.name ?? targetPersonaId}` });
            return;
          }
          if (request.payload?.mode === "house") {
            sendHouseMessage(text);
            respond({ ok: true, route: "House channel" });
            return;
          }
          if (!caseyRoom) throw new Error("User is not currently in a room.");
          void speakInRoom(caseyRoom.id, text, {});
          respond({ ok: true, route: `Room: ${caseyRoom.name}` });
          return;
        }
        throw new Error(`Unknown mobile walkie request: ${request.type}`);
      } catch (error) {
        fail(error);
      }
    });
  }, [
    caseyRoom,
    createDirectRoom,
    currentRoomConversation,
    formattedTime,
    runtime.activity,
    runtime.caseyRoomId,
    runtime.directRooms,
    runtime.personas,
    sendDirectMessage,
    sendHouseMessage,
    speakInRoom
  ]);

  return (
    <main className="app">
      <AppHeader status={status} />
      <ViewSwitcher onViewChange={setView} view={view} />

      {view === "hedy" ? (
        <HedyView
          personas={runtime.personas}
          rooms={runtime.rooms}
          houseDay={runtime.day}
          onPersonaMove={movePersonaToRoom}
        />
      ) : view === "population" ? (
        <PopulationView
          onModelChange={updatePersonaModel}
          onApiEnabledChange={updatePersonaApiEnabled}
          onGoJuiceChange={updatePersonaGoJuice}
          onMemoryConsentChange={updatePersonaMemoryConsent}
          onRelationshipConsentChange={updateRelationshipConsent}
          onPersonaSelect={selectPersona}
          onPersonaRoomChange={assignPersonaRoom}
          onAliasesChange={updatePersonaAliases}
          onCreatePersona={addPersona}
          onClaimMemory={claimMemoryForPersona}
          onPersonaNameChange={updatePersonaName}
          onSystemPromptChange={updatePersonaSystemPrompt}
          personaMemories={runtime.personaMemories}
          relationshipUpdates={runtime.relationshipUpdates}
          houseEvents={runtime.houseEvents}
          activity={runtime.activity}
          directRooms={runtime.directRooms}
          visibilitySummary={visibilitySummary}
          rooms={runtime.rooms}
          personas={runtime.personas}
          selectedPersona={selectedPersona}
        />
      ) : view === "steward" ? (
        <StewardDiagnosticsView
          activity={runtime.activity}
          callBudgetUsed={runtime.callBudgetUsed}
          config={runtime.config}
          day={runtime.day}
          directRooms={runtime.directRooms}
          formattedTime={formattedTime}
          houseEvents={runtime.houseEvents}
          personaMemories={runtime.personaMemories}
          personas={runtime.personas}
          rooms={runtime.rooms}
          relationshipUpdates={runtime.relationshipUpdates}
          roomConversations={runtime.roomConversations}
          status={status}
          onCreateBackup={async () => {
            const result = await createBackup("Steward repair safety backup");
            return `Created ${result.backupId}.`;
          }}
          onSyncMemoryFiles={async () => {
            const result = await syncPersonaMemoryFiles();
            return `Synced ${result.written.length} memory file${result.written.length === 1 ? "" : "s"}.`;
          }}
          onCompactLibrarian={async () => {
            const result = await compactLibrarian();
            return `Compacted ${result.before} to ${result.after}; removed ${result.removed}.`;
          }}
          onRewriteDirectRooms={async () => {
            const result = await rewriteDirectRoomSnapshots();
            return `Rewrote ${result.written.length} direct-room snapshot${result.written.length === 1 ? "" : "s"}.`;
          }}
          onRearchiveRelationships={async () => {
            const result = await rearchiveRelationshipUpdates();
            return `Re-archived ${result.appended} relationship revision${result.appended === 1 ? "" : "s"}; skipped ${result.skipped}.`;
          }}
          onRepairSourceIntegrity={async () => {
            const backup = await createBackup("Before source integrity repair");
            const result = await repairSourceIntegrity();
            return `Created ${backup.backupId}. Removed ${result.removedRelationships} orphaned relationship update${result.removedRelationships === 1 ? "" : "s"} and cleaned ${result.cleanedMemoryReferences} memory source reference${result.cleanedMemoryReferences === 1 ? "" : "s"}.`;
          }}
          onRefreshOutsideSignal={refreshOutsideSignal}
          onResetPersonaCalls={resetPersonaCallBudget}
          onUpsertRoom={upsertRoom}
        />
      ) : (
      <section className="workspace">
        <div className="blueprint-column">
          <div className="blueprint-toolbar">
            <div>
              <p className="eyebrow">Bird's-eye blueprint</p>
              <h2>{floor === "ground" ? "Ground floor" : "Upstairs"}</h2>
            </div>
            <div className="floor-switcher" aria-label="Floor switcher">
              <button
                className={floor === "ground" ? "active" : ""}
                onClick={() => setFloor("ground")}
                type="button"
              >
                <ChevronLeft size={16} />
                Ground
              </button>
              <button
                className={floor === "upstairs" ? "active" : ""}
                onClick={() => setFloor("upstairs")}
                type="button"
              >
                Upstairs
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <Blueprint
            floor={floor}
            rooms={runtime.rooms}
            personas={runtime.personas}
            onPersonaSelect={selectPersona}
            onRoomSelect={(room) => moveUserToRoom(room.id)}
            selectedPersona={selectedPersona}
            selectedRoom={selectedRoom}
            caseyRoomId={runtime.caseyRoomId ?? null}
          />

        </div>

        <div className="middle-column">
          <RoomInspector
            occupants={occupants}
            personas={runtime.personas}
            room={selectedRoom}
            roomConversations={runtime.roomConversations}
          />
          <MotionControls
            callBudgetUsed={runtime.callBudgetUsed}
            config={runtime.config}
            day={runtime.day}
            formattedTime={formattedTime}
            onConfigChange={updateConfig}
            onExport={async () => {
              const result = await exportRuntimeState();
              return `Exported ${result.written.length} files.`;
            }}
            onLoad={async () => {
              const result = await loadRuntimeState();
              return `Loaded ${result.read.personas} personas, ${result.read.rooms} rooms${result.read.runtime ? ", and runtime state" : ""}.`;
            }}
            onCreateBackup={async () => {
              const result = await createBackup("Manual backup from Local Motion controls");
              return `Created ${result.backupId}.`;
            }}
            onListBackups={async () => {
              const result = await listBackups();
              return result.backups;
            }}
            onRestoreBackup={async (backupId) => {
              const result = await restoreBackup(backupId);
              return `Restored ${result.restoredBackupId}. Safety backup: ${result.preRestoreBackupId}.`;
            }}
            onResetPersonaCalls={resetPersonaCallBudget}
            onReset={resetRuntime}
          />
          <BedtimeRitualCard
            memoryCount={runtime.personaMemories.length}
            onImportMemory={importExternalMemory}
            onRunNow={() => runBedtimeRitual("manual")}
            onSyncMemoryFiles={async () => {
              const result = await syncPersonaMemoryFiles();
              return `Synced ${result.written.length} memory file${result.written.length === 1 ? "" : "s"}.`;
            }}
          />
          <section className="api-card">
            <div>
              <p className="eyebrow">Model boundary</p>
              <h2>Anthropic API</h2>
            </div>
            <p>{status?.note ?? "Checking runtime configuration..."}</p>
          </section>
          <section className="api-card">
            <div>
              <p className="eyebrow">Motion economy</p>
              <h2>Calls are moments</h2>
            </div>
            <p>
              Most life can run as cheap patterned motion. The Steward spends model calls when a
              moment needs interiority, conflict, memory, or choice.
            </p>
          </section>
          <section className="api-card compact">
            <UsersRound size={18} />
            <p>One-on-one rooms call the selected persona model when the API key is configured.</p>
          </section>
          <OutsideSignalPanel
            onRefresh={refreshOutsideSignal}
            signal={runtime.outsideSignals[0] ?? null}
          />
          <section className="api-card compact mood-card">
            <History size={18} />
            <p>
              House mood: {runtime.houseMood?.label ?? "quiet"} /{" "}
              {runtime.houseMood?.stewardNote ?? "No Steward mood note yet."}
            </p>
          </section>
          <LibrarianPanel
            latestActivity={runtime.activity[0] ?? null}
            onCompact={async () => {
              const result = await compactLibrarian();
              return `Compacted ${result.before} to ${result.after}; removed ${result.removed}.`;
            }}
            onRecall={async (query) => (await recallLibrarian(query)).records}
            onRememberActivity={async (activityId) => {
              const record = await rememberActivity(activityId);
              return record ? `Filed ${record.id}.` : "No record filed.";
            }}
          />
        </div>

        <div className="right-column">
          <Terminal
            activity={runtime.activity}
            houseEvents={runtime.houseEvents}
            conversation={runtime.conversation}
            directRooms={runtime.directRooms}
            onCreateDirectRoom={createDirectRoom}
            onCompressDirectRoom={compressDirectRoomToMemory}
            onFileDirectRelationship={fileDirectRoomRelationship}
            onSendDirectMessage={sendDirectMessage}
            onSendMessage={sendHouseMessage}
            onSpeakInRoom={speakInRoom}
            caseyRoom={caseyRoom}
            currentRoomConversation={currentRoomConversation}
            caseyRoomEnteredAt={runtime.caseyRoomEnteredAt ?? null}
            focusedPersonaId={selectedPersona?.id ?? null}
            personas={runtime.personas}
          />
        </div>
      </section>
      )}
    </main>
  );
}
