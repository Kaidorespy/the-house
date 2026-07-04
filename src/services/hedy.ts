export type HedyToolUse = {
  id?: string;
  name: string;
  input?: unknown;
};

export type HedyEvent =
  | { kind: "raw"; eventType: string; event: unknown }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id?: string; name: string; input?: unknown }
  | { kind: "tool_result"; toolUseId?: string; isError: boolean; content: unknown }
  | { kind: "system"; subtype: string | null }
  | { kind: "session"; sessionId: string }
  | { kind: "done"; result: unknown; usage: unknown; stopReason: string | null }
  | { kind: "error"; error: string };

export type HedyStartRequest = {
  personaId: string;
  systemPrompt: string;
  model?: string;
  cwd?: string;
  fresh?: boolean;
  houseDay?: number;
};

export type HedyStartResult =
  | {
      ok: true;
      personaId: string;
      sessionId: string | null;
      resumed: boolean;
      cwd: string;
      model: string;
      dayRolled?: boolean;
      memoriesLoaded?: number;
    }
  | { ok: false; error: string };

export type HedySendResult =
  | { ok: true; text: string; sessionId: string | null; toolUses: HedyToolUse[] }
  | { ok: false; error: string };

export type HedyStatusResult =
  | { ok: true; available: boolean; exports: string[]; active: string[] }
  | { ok: false; available: false; error: string };

export type HedyHistoryMessage = {
  type: "user" | "assistant" | string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
};

export type HedyHistoryResult =
  | { ok: true; sessionId: string | null; messages: HedyHistoryMessage[] }
  | { ok: false; error: string };

type HedyBridge = {
  status: () => Promise<HedyStatusResult>;
  start: (req: HedyStartRequest) => Promise<HedyStartResult>;
  send: (req: { personaId: string; message: string }) => Promise<HedySendResult>;
  stop: (req: { personaId: string }) => Promise<{ ok: boolean }>;
  clearSession: (req: { personaId: string }) => Promise<{ ok: boolean }>;
  loadHistory: (req: { personaId: string }) => Promise<HedyHistoryResult>;
  onEvent: (personaId: string, listener: (event: HedyEvent) => void) => () => void;
};

const bridge = (): HedyBridge | null => {
  const runtime = (window as unknown as { houseRuntime?: { hedy?: HedyBridge } }).houseRuntime;
  return runtime?.hedy ?? null;
};

export async function hedyStatus(): Promise<HedyStatusResult> {
  const b = bridge();
  if (!b) return { ok: false, available: false, error: "houseRuntime.hedy bridge is not available" };
  return b.status();
}

export async function hedyStart(request: HedyStartRequest): Promise<HedyStartResult> {
  const b = bridge();
  if (!b) return { ok: false, error: "houseRuntime.hedy bridge is not available" };
  return b.start(request);
}

export async function hedySend(personaId: string, message: string): Promise<HedySendResult> {
  const b = bridge();
  if (!b) return { ok: false, error: "houseRuntime.hedy bridge is not available" };
  return b.send({ personaId, message });
}

export async function hedyStop(personaId: string): Promise<{ ok: boolean }> {
  const b = bridge();
  if (!b) return { ok: false };
  return b.stop({ personaId });
}

export async function hedyClearSession(personaId: string): Promise<{ ok: boolean }> {
  const b = bridge();
  if (!b) return { ok: false };
  return b.clearSession({ personaId });
}

export async function hedyLoadHistory(personaId: string): Promise<HedyHistoryResult> {
  const b = bridge();
  if (!b) return { ok: false, error: "houseRuntime.hedy bridge is not available" };
  return b.loadHistory({ personaId });
}

export function hedyOnEvent(personaId: string, listener: (event: HedyEvent) => void): () => void {
  const b = bridge();
  if (!b) return () => {};
  return b.onEvent(personaId, listener);
}
