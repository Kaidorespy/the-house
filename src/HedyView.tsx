import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  hedyStart,
  hedySend,
  hedyOnEvent,
  hedyStatus,
  hedyClearSession,
  hedyLoadHistory,
  type HedyEvent,
  type HedyHistoryMessage
} from "./services/hedy";
import { parseReplyMovement } from "./runtime/useHouseRuntime";
import type { Persona, Room } from "./types";

type TurnPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: unknown; resultPreview?: string };

type Turn = {
  id: string;
  role: "you" | "hedy";
  parts: TurnPart[];
  createdAt: string;
  done: boolean;
};

const previewToolResult = (content: unknown): string => {
  if (typeof content === "string") return content.slice(0, 240);
  if (Array.isArray(content)) {
    const text = content
      .map((b: { text?: string; type?: string } | string) => {
        if (typeof b === "string") return b;
        if (b?.text) return b.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text.slice(0, 240);
  }
  try {
    return JSON.stringify(content).slice(0, 240);
  } catch {
    return "";
  }
};

const PERSONA_ID = "coder";

export function HedyView({
  personas,
  rooms,
  houseDay,
  onPersonaMove
}: {
  personas: Persona[];
  rooms: Room[];
  houseDay: number;
  onPersonaMove: (personaId: string, roomId: string) => void;
}) {
  const hedy = useMemo(() => personas.find((p) => p.id === PERSONA_ID) || null, [personas]);
  const apiEnabled = Boolean(hedy?.apiEnabled);

  const [status, setStatus] = useState<string>("Not started");
  const [available, setAvailable] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumed, setResumed] = useState<boolean>(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [started, setStarted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingToolByUseId = useRef<Map<string, { name: string; turnId: string; idx: number }>>(
    new Map()
  );

  // Status check — runs once on mount.
  useEffect(() => {
    (async () => {
      const s = await hedyStatus();
      if (s.ok) {
        setAvailable(s.available);
        setStatus((prev) => (prev === "Not started" ? (s.available ? "SDK available" : "SDK not available") : prev));
      } else {
        setAvailable(false);
        setStatus(`SDK status error: ${s.error}`);
      }
    })();
  }, []);

  // Auto-arm + history restore. Runs whenever availability/hedy/apiEnabled
  // becomes ready — handles "enable apiEnabled then visit Hedy" and remount.
  const autoArmedRef = useRef(false);
  useEffect(() => {
    if (autoArmedRef.current) return;
    if (!available || !hedy || !apiEnabled) return;
    autoArmedRef.current = true;
    (async () => {
      const arm = await hedyStart({
        personaId: PERSONA_ID,
        systemPrompt: hedy.systemPrompt,
        model: hedy.model || "claude-opus-4-7",
        fresh: false,
        houseDay
      });
      if (!arm.ok) return;
      if (arm.resumed) {
        const restored = await loadHistoryTurns();
        if (restored.length > 0) setTurns(restored);
      }
      setSessionId(arm.sessionId);
      setResumed(arm.resumed);
      setStarted(true);
      setStatus(
        arm.resumed
          ? `Resumed session ${arm.sessionId?.slice(0, 8)}…`
          : "SDK available"
      );
    })().catch((error) => {
      setError(error instanceof Error ? error.message : String(error));
    });
  }, [available, hedy, apiEnabled, houseDay]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => {
    if (!started) return;
    const off = hedyOnEvent(PERSONA_ID, (event: HedyEvent) => {
      // Skip raw debug events — they were the cause of a heap leak under streams.
      if (event.kind === "raw") return;
      if (event.kind === "session") {
        setSessionId(event.sessionId);
        return;
      }
      if (event.kind === "error") {
        setError(event.error);
        return;
      }
      setTurns((prev) => handleEvent(prev, event, pendingToolByUseId.current));
    });
    return off;
  }, [started]);

  const start = async (fresh: boolean) => {
    if (!hedy) {
      setError("Could not find the coder persona.");
      return;
    }
    if (!apiEnabled) {
      setError("Hedy's API is disabled. Enable her in Population to wake her.");
      return;
    }
    setError(null);
    const result = await hedyStart({
      personaId: PERSONA_ID,
      systemPrompt: hedy.systemPrompt,
      model: hedy.model || "claude-opus-4-7",
      fresh,
      houseDay
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSessionId(result.sessionId);
    setResumed(result.resumed);
    setStarted(true);
    setStatus(result.resumed ? `Resumed session ${result.sessionId?.slice(0, 8)}…` : "Fresh session");

    if (!fresh && result.resumed) {
      const restored = await loadHistoryTurns();
      if (restored.length > 0) setTurns(restored);
    } else {
      setTurns([]);
    }
  };

  const loadHistoryTurns = async (): Promise<Turn[]> => {
    const history = await hedyLoadHistory(PERSONA_ID);
    if (!history.ok || !history.sessionId) return [];
    const all = historyToTurns(history.messages);
    // Show the last 10 turns so revisits land you mid-conversation, not at day 1.
    return all.slice(-10);
  };

  const clearSession = async () => {
    await hedyClearSession(PERSONA_ID);
    setSessionId(null);
    setResumed(false);
    setTurns([]);
    setStarted(false);
    setStatus("Session cleared");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || sending || !started) return;
    const message = draft.trim();
    const userTurnId = `you-${Date.now()}`;
    const hedyTurnId = `hedy-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      {
        id: userTurnId,
        role: "you",
        parts: [{ kind: "text", text: message }],
        createdAt: new Date().toISOString(),
        done: true
      },
      {
        id: hedyTurnId,
        role: "hedy",
        parts: [],
        createdAt: new Date().toISOString(),
        done: false
      }
    ]);
    setDraft("");
    setSending(true);
    const result = await hedySend(PERSONA_ID, message);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
    } else if (result.sessionId) {
      setSessionId(result.sessionId);
    }
    if (result.ok) {
      const movement = parseReplyMovement(result.text, rooms);
      if (movement.targetRoomId && movement.targetRoomId !== hedy?.roomId) {
        onPersonaMove(PERSONA_ID, movement.targetRoomId);
        setTurns((prev) => stripMoveTagsFromLatestHedyTurn(prev));
      }
    }
    setTurns((prev) => prev.map((t) => (t.id === hedyTurnId ? { ...t, done: true } : t)));
  };

  if (!hedy) {
    return (
      <section className="workspace" style={{ padding: 24 }}>
        <h2>Hedy not configured</h2>
        <p>Could not find a persona with id "coder".</p>
      </section>
    );
  }

  return (
    <section className="workspace" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">Resident coder</p>
          <h2 style={{ margin: 0 }}>{hedy.name}</h2>
          <p style={{ margin: 0, opacity: 0.7 }}>{hedy.role} · model {hedy.model || "claude-opus-4-7"}</p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="eyebrow">{status}</span>
          {sessionId ? (
            <code style={{ fontSize: 11, opacity: 0.7 }}>{sessionId.slice(0, 8)}…</code>
          ) : null}
          {!started ? (
            <>
              <button
                className="reset-button"
                type="button"
                onClick={() => start(false)}
                disabled={!available || !apiEnabled}
              >
                Wake Hedy
              </button>
              <button
                className="reset-button"
                type="button"
                onClick={() => start(true)}
                disabled={!available || !apiEnabled}
              >
                Fresh session
              </button>
            </>
          ) : (
            <button className="reset-button" type="button" onClick={clearSession}>
              Clear session
            </button>
          )}
        </div>
      </header>

      {!apiEnabled ? (
        <p style={{ opacity: 0.7, margin: 0 }}>
          Hedy is frozen — her API is disabled. Enable it in Population to wake her.
        </p>
      ) : resumed && started ? (
        <p style={{ opacity: 0.7, margin: 0 }}>
          Picked up where you left off. She remembers prior turns from session {sessionId?.slice(0, 8)}.
        </p>
      ) : null}

      {error ? (
        <div style={{ background: "#3a1a1a", padding: 12, borderRadius: 6, color: "#ffb4b4" }}>
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      <div
        ref={transcriptRef}
        style={{
          flex: 1,
          minHeight: 320,
          maxHeight: "55vh",
          overflowY: "auto",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12
        }}
      >
        {turns.length === 0 ? (
          <p style={{ opacity: 0.6, margin: 0 }}>
            {started
              ? "Type something. She has bypass permissions and can read/write the House directory."
              : "Wake Hedy to begin."}
          </p>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
        )}
        {sending ? <p style={{ opacity: 0.6, margin: 0 }}>…</p> : null}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={started ? "Ask Hedy to do something." : "Wake her first."}
          disabled={!started || sending}
          style={{
            flex: 1,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "inherit"
          }}
        />
        <button type="submit" disabled={!started || sending || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const isYou = turn.role === "you";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="eyebrow" style={{ opacity: 0.7 }}>
        {isYou ? "You" : "Hedy"}
      </span>
      {turn.parts.length === 0 ? (
        <span style={{ opacity: 0.5 }}>…</span>
      ) : (
        turn.parts.map((part, idx) => {
          if (part.kind === "text") {
            return (
              <p key={idx} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {part.text}
              </p>
            );
          }
          return (
            <div
              key={idx}
              style={{
                background: "rgba(120, 180, 255, 0.08)",
                border: "1px solid rgba(120, 180, 255, 0.2)",
                borderRadius: 6,
                padding: 8,
                fontSize: 12,
                fontFamily: "monospace"
              }}
            >
              <strong>{part.name}</strong>
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", opacity: 0.85 }}>
                {safeStringify(part.input)}
              </pre>
              {part.resultPreview ? (
                <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", opacity: 0.7 }}>
                  → {part.resultPreview}
                </pre>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stripMoveTagsFromLatestHedyTurn(turns: Turn[]): Turn[] {
  const index = [...turns].reverse().findIndex((turn) => turn.role === "hedy");
  if (index === -1) return turns;
  const turnIndex = turns.length - 1 - index;
  return turns.map((turn, currentIndex) => {
    if (currentIndex !== turnIndex) return turn;
    return {
      ...turn,
      parts: turn.parts.map((part) =>
        part.kind === "text"
          ? { ...part, text: part.text.replace(/\[MOVE:\s*[^\]]+\]/gi, "").replace(/\n{3,}/g, "\n\n").trim() }
          : part
      )
    };
  });
}

function historyToTurns(messages: HedyHistoryMessage[]): Turn[] {
  const turns: Turn[] = [];
  const pendingTools = new Map<string, { turnIndex: number; partIndex: number }>();

  for (const message of messages) {
    const content = message?.message?.content ?? [];
    if (!Array.isArray(content) || content.length === 0) continue;

    if (message.type === "user") {
      // Tool results are wrapped as user messages — attach to existing tool calls.
      let userTextParts: string[] = [];
      for (const block of content) {
        if (block?.type === "tool_result" && block.tool_use_id) {
          const mapping = pendingTools.get(block.tool_use_id);
          if (mapping) {
            const target = turns[mapping.turnIndex].parts[mapping.partIndex];
            if (target?.kind === "tool") {
              target.resultPreview = previewToolResult(block.content);
            }
          }
        } else if (block?.type === "text" && block.text) {
          userTextParts.push(block.text);
        }
      }
      if (userTextParts.length > 0) {
        turns.push({
          id: message.uuid || `you-${turns.length}`,
          role: "you",
          parts: [{ kind: "text", text: userTextParts.join("\n") }],
          createdAt: message.timestamp || "",
          done: true
        });
      }
    } else if (message.type === "assistant") {
      const parts: TurnPart[] = [];
      for (const block of content) {
        if (block?.type === "text" && block.text) {
          const last = parts[parts.length - 1];
          if (last && last.kind === "text") {
            last.text += block.text;
          } else {
            parts.push({ kind: "text", text: block.text });
          }
        } else if (block?.type === "tool_use" && block.name) {
          parts.push({ kind: "tool", name: block.name, input: block.input });
          if (block.tool_use_id || (block as { id?: string }).id) {
            const toolId = block.tool_use_id || (block as { id?: string }).id;
            if (toolId) {
              pendingTools.set(toolId, {
                turnIndex: turns.length,
                partIndex: parts.length - 1
              });
            }
          }
        }
      }
      if (parts.length === 0) continue;

      // Merge consecutive assistant chunks into one turn.
      const last = turns[turns.length - 1];
      if (last && last.role === "hedy" && !last.done) {
        last.parts.push(...parts);
      } else {
        turns.push({
          id: message.uuid || `hedy-${turns.length}`,
          role: "hedy",
          parts,
          createdAt: message.timestamp || "",
          done: false
        });
      }
    }
  }

  // Mark all loaded hedy turns as done.
  for (const turn of turns) {
    if (turn.role === "hedy") turn.done = true;
  }
  return turns;
}

function handleEvent(
  prev: Turn[],
  event: HedyEvent,
  pendingToolByUseId: Map<string, { name: string; turnId: string; idx: number }>
): Turn[] {
  if (prev.length === 0) return prev;
  const last = prev[prev.length - 1];
  if (last.role !== "hedy") return prev;

  if (event.kind === "text") {
    const parts = [...last.parts];
    const tail = parts[parts.length - 1];
    if (tail && tail.kind === "text") {
      parts[parts.length - 1] = { kind: "text", text: tail.text + event.text };
    } else {
      parts.push({ kind: "text", text: event.text });
    }
    return [...prev.slice(0, -1), { ...last, parts }];
  }

  if (event.kind === "tool_use") {
    const parts = [...last.parts, { kind: "tool" as const, name: event.name, input: event.input }];
    if (event.id) {
      pendingToolByUseId.set(event.id, {
        name: event.name,
        turnId: last.id,
        idx: parts.length - 1
      });
    }
    return [...prev.slice(0, -1), { ...last, parts }];
  }

  if (event.kind === "tool_result" && event.toolUseId) {
    const mapping = pendingToolByUseId.get(event.toolUseId);
    if (mapping && mapping.turnId === last.id) {
      const parts = [...last.parts];
      const target = parts[mapping.idx];
      if (target?.kind === "tool") {
        parts[mapping.idx] = {
          ...target,
          resultPreview: previewToolResult(event.content)
        };
      }
      return [...prev.slice(0, -1), { ...last, parts }];
    }
  }

  return prev;
}
