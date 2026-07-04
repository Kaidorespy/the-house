const path = require("node:path");
const fs = require("node:fs/promises");

// The SDK is ESM. Main process is CJS. Dynamic import bridges it.
let sdkPromise = null;
const loadSdk = () => {
  if (!sdkPromise) {
    sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkPromise;
};

const sessionFilePath = (projectRoot, personaId) =>
  path.join(projectRoot, "state", "personas", personaId, "session.json");

const loadSession = async (projectRoot, personaId) => {
  try {
    const raw = await fs.readFile(sessionFilePath(projectRoot, personaId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveSession = async (projectRoot, personaId, data) => {
  const file = sessionFilePath(projectRoot, personaId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
};

const clearSession = async (projectRoot, personaId) => {
  try { await fs.unlink(sessionFilePath(projectRoot, personaId)); } catch {}
};

const shouldClearStoredSession = (persisted, houseDay, model) => {
  if (!persisted?.sessionId || typeof houseDay !== "number") return false;
  // Sessions are same-House-day only. Missing day metadata is treated as stale
  // because older builds failed to persist houseDay for autonomous/direct calls.
  return typeof persisted.day !== "number" || persisted.day !== houseDay || (model && persisted.model && persisted.model !== model);
};

const personaMemoryArchivePath = (projectRoot) =>
  path.join(projectRoot, "state", "memories", "persona-memories.jsonl");

const loadRecentMemories = async (projectRoot, personaId, limit = 5) => {
  try {
    const raw = await fs.readFile(personaMemoryArchivePath(projectRoot), "utf8");
    const records = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((record) => record && record.personaId === personaId);
    records.sort((a, b) => (b.day || 0) - (a.day || 0) || String(b.fileBackedAt || "").localeCompare(String(a.fileBackedAt || "")));
    return records.slice(0, limit).reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    return [];
  }
};

const formatMemoriesForPrompt = (memories) => {
  if (!memories || memories.length === 0) return "";
  const blocks = memories.map((memory) => {
    const residue = (memory.emotionalResidue || "").trim();
    const facts = Array.isArray(memory.mechanicalFacts) ? memory.mechanicalFacts : [];
    const factLines = facts.length > 0 ? facts.map((f) => `- ${f}`).join("\n") : "- (no mechanical facts)";
    return `### Day ${memory.day ?? "?"}\nEmotional residue: ${residue || "(none recorded)"}\nMechanical facts:\n${factLines}`;
  });
  return `\n\n## Recent memories\n\nThese are your authored memories from prior days. Treat them as the texture of what you remember — not transcripts, but your own read of what happened.\n\n${blocks.join("\n\n")}`;
};

const augmentSystemPrompt = (baseSystemPrompt, memories) => {
  return `${baseSystemPrompt}${formatMemoriesForPrompt(memories)}`;
};

// Per-persona runtime config so the renderer only sends prompt/model once.
const personaConfig = new Map();

const safeSerialize = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === "function") return undefined;
        if (v && typeof v === "object") {
          if (seen.has(v)) return undefined;
          seen.add(v);
        }
        return v;
      })
    );
  } catch {
    return null;
  }
};

const extractEventType = (event) => {
  if (!event) return "Unknown";
  if (typeof event.type === "string") return event.type;
  const ctor = event.constructor?.name;
  if (ctor && ctor !== "Object") return ctor;
  return "Unknown";
};

const extractSessionId = (event) => {
  const candidates = [event?.data, event?.message, event];
  for (const obj of candidates) {
    if (!obj) continue;
    const sid = obj.session_id || obj.sessionId;
    if (sid) return sid;
  }
  return null;
};

const sendMessage = async ({ projectRoot, personaId, message, onEvent }) => {
  const config = personaConfig.get(personaId);
  if (!config) {
    throw new Error(`No config for ${personaId}. Call hedy:start first.`);
  }

  const sdk = await loadSdk();
  if (!sdk.query) throw new Error("SDK does not expose query()");

  const persisted = await loadSession(projectRoot, personaId);
  const resume = persisted?.sessionId || undefined;

  const options = {
    model: config.model,
    systemPrompt: config.systemPrompt,
    permissionMode: "bypassPermissions",
    cwd: config.cwd,
    ...(resume ? { resume } : {})
  };

  let responseText = "";
  const toolUses = [];
  let currentSessionId = persisted?.sessionId || null;

  for await (const event of sdk.query({ prompt: message, options })) {
    const eventType = extractEventType(event);
    // Raw event emission was a debug aid that became a leak under streaming:
    // every chunk shipped the full serialized payload across IPC and React
    // queued updaters that kept references. Killed.

    const sid = extractSessionId(event);
    if (sid && sid !== currentSessionId) {
      currentSessionId = sid;
      await saveSession(projectRoot, personaId, {
        personaId,
        sessionId: sid,
        day: config.day ?? null,
        cwd: config.cwd,
        model: config.model,
        updatedAt: new Date().toISOString()
      });
      onEvent?.({ kind: "session", sessionId: sid });
    }

    if (eventType === "AssistantMessage" || eventType === "assistant") {
      const content = event.message?.content ?? event.content ?? [];
      if (Array.isArray(content)) {
        for (const block of content) {
          const blockType = block?.type || block?.constructor?.name;
          if (blockType === "text" || typeof block?.text === "string") {
            const text = block.text || "";
            responseText += text;
            onEvent?.({ kind: "text", text });
          } else if (blockType === "tool_use" || block?.name) {
            const use = { id: block.id, name: block.name, input: block.input };
            toolUses.push(use);
            onEvent?.({ kind: "tool_use", ...use });
          }
        }
      }
    } else if (eventType === "UserMessage" || eventType === "user") {
      const content = event.message?.content ?? event.content ?? [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result") {
            onEvent?.({
              kind: "tool_result",
              toolUseId: block.tool_use_id,
              isError: Boolean(block.is_error),
              content: block.content
            });
          }
        }
      }
    } else if (eventType === "ResultMessage" || eventType === "result") {
      onEvent?.({
        kind: "done",
        result: event.result ?? null,
        usage: event.usage ?? null,
        stopReason: event.stop_reason ?? null
      });
    } else if (eventType === "SystemMessage" || eventType === "system") {
      onEvent?.({ kind: "system", subtype: event.subtype ?? null });
    }
  }

  return {
    ok: true,
    text: responseText,
    sessionId: currentSessionId,
    toolUses
  };
};

// One-shot query for non-streaming callers (bedtime ritual, direct rooms).
const runPersonaQuery = async ({
  projectRoot,
  personaId,
  systemPrompt,
  model,
  userMessage,
  cwd,
  maxTurns,
  houseDay
}) => {
  if (!personaId) throw new Error("personaId is required");
  if (!systemPrompt) throw new Error("systemPrompt is required");
  if (typeof userMessage !== "string") throw new Error("userMessage must be a string");

  const sdk = await loadSdk();
  if (!sdk.query) throw new Error("SDK does not expose query()");

  const resolvedCwd = cwd || projectRoot;
  let persisted = await loadSession(projectRoot, personaId);

  // Day boundary: sessions are same-House-day only. Memories carry continuity
  // across days, while stale SDK sessions can drag large prior context forward.
  const dayRolled = shouldClearStoredSession(persisted, houseDay, model || "claude-opus-4-7");
  if (dayRolled) {
    await clearSession(projectRoot, personaId);
    persisted = null;
  }

  // Always inject recent memories — same prefix every same-day call hits cache.
  const memories = await loadRecentMemories(projectRoot, personaId, 5);
  const augmentedSystemPrompt = augmentSystemPrompt(systemPrompt, memories);
  const resume = persisted?.sessionId || undefined;

  personaConfig.set(personaId, {
    systemPrompt: augmentedSystemPrompt,
    model: model || "claude-opus-4-7",
    cwd: resolvedCwd
  });

  const options = {
    model: model || "claude-opus-4-7",
    systemPrompt: augmentedSystemPrompt,
    permissionMode: "bypassPermissions",
    cwd: resolvedCwd,
    ...(resume ? { resume } : {}),
    ...(maxTurns ? { maxTurns } : {})
  };

  let text = "";
  let usage = null;
  let resultModel = options.model;
  let currentSessionId = persisted?.sessionId || null;
  let stopReason = null;

  for await (const event of sdk.query({ prompt: userMessage, options })) {
    const eventType = extractEventType(event);
    const sid = extractSessionId(event);
    if (sid && sid !== currentSessionId) {
      currentSessionId = sid;
      await saveSession(projectRoot, personaId, {
        personaId,
        sessionId: sid,
        day: typeof houseDay === "number" ? houseDay : persisted?.day ?? null,
        cwd: resolvedCwd,
        model: options.model,
        updatedAt: new Date().toISOString()
      });
    }
    if (eventType === "AssistantMessage" || eventType === "assistant") {
      const content = event.message?.content ?? event.content ?? [];
      const modelFromMessage = event.message?.model;
      if (modelFromMessage) resultModel = modelFromMessage;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" || typeof block?.text === "string") {
            text += block.text || "";
          }
        }
      }
    } else if (eventType === "ResultMessage" || eventType === "result") {
      usage = event.usage ?? null;
      stopReason = event.stop_reason ?? null;
    }
  }

  return {
    ok: true,
    text,
    sessionId: currentSessionId,
    usage,
    model: resultModel,
    stopReason,
    dayRolled
  };
};

const registerAgentSdkHandlers = ({ ipcMain, projectRoot }) => {
  ipcMain.handle("hedy:status", async () => {
    try {
      const sdk = await loadSdk();
      return {
        ok: true,
        available: typeof sdk?.query === "function",
        exports: Object.keys(sdk || {}),
        configured: Array.from(personaConfig.keys())
      };
    } catch (error) {
      return { ok: false, available: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle("hedy:start", async (_event, request) => {
    try {
      const { personaId, systemPrompt, model, cwd, fresh, houseDay } = request || {};
      if (!personaId) throw new Error("personaId is required");
      if (!systemPrompt) throw new Error("systemPrompt is required");

      const resolvedCwd = cwd || projectRoot;

      if (fresh) await clearSession(projectRoot, personaId);
      let persisted = await loadSession(projectRoot, personaId);

      // Auto day-boundary: if stored session is from prior day, seal it.
      const dayRolled = shouldClearStoredSession(persisted, houseDay, model || "claude-opus-4-7");
      if (dayRolled) {
        await clearSession(projectRoot, personaId);
        persisted = null;
      }

      // Load memories once per Wake — they stay in the system prompt for the
      // rest of the day's session so the prefix is cache-stable.
      const memories = await loadRecentMemories(projectRoot, personaId, 5);
      const augmentedSystemPrompt = augmentSystemPrompt(systemPrompt, memories);

      personaConfig.set(personaId, {
        systemPrompt: augmentedSystemPrompt,
        model: model || "claude-opus-4-7",
        cwd: resolvedCwd,
        day: typeof houseDay === "number" ? houseDay : null
      });

      return {
        ok: true,
        personaId,
        sessionId: persisted?.sessionId || null,
        resumed: Boolean(persisted?.sessionId),
        cwd: resolvedCwd,
        model: model || "claude-opus-4-7",
        dayRolled,
        memoriesLoaded: memories.length
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle("hedy:send", async (ipcEvent, request) => {
    const sender = ipcEvent.sender;
    const { personaId, message } = request || {};
    if (!personaId || typeof message !== "string") {
      return { ok: false, error: "personaId and message are required" };
    }
    const channel = `hedy:event:${personaId}`;
    try {
      const result = await sendMessage({
        projectRoot,
        personaId,
        message,
        onEvent: (payload) => {
          if (!sender.isDestroyed()) sender.send(channel, payload);
        }
      });
      return result;
    } catch (error) {
      const errPayload = { kind: "error", error: String(error?.message || error) };
      if (!sender.isDestroyed()) sender.send(channel, errPayload);
      return { ok: false, error: errPayload.error };
    }
  });

  ipcMain.handle("hedy:stop", async (_event, request) => {
    const { personaId } = request || {};
    if (!personaId) return { ok: false, error: "personaId is required" };
    personaConfig.delete(personaId);
    return { ok: true, personaId };
  });

  ipcMain.handle("hedy:clearSession", async (_event, request) => {
    const { personaId } = request || {};
    if (!personaId) return { ok: false, error: "personaId is required" };
    await clearSession(projectRoot, personaId);
    return { ok: true, personaId };
  });

  ipcMain.handle("house:sendPersonaQuery", async (_event, request) => {
    try {
      const result = await runPersonaQuery({
        projectRoot,
        personaId: request?.personaId,
        systemPrompt: request?.system,
        model: request?.model,
        userMessage: request?.userMessage,
        cwd: request?.cwd,
        maxTurns: request?.maxTurns ?? 1,
        houseDay: request?.houseDay
      });
      return result;
    } catch (error) {
      return {
        ok: false,
        missingKey: false,
        text: String(error?.message || error),
        usage: null
      };
    }
  });

  ipcMain.handle("hedy:loadHistory", async (_event, request) => {
    const { personaId } = request || {};
    if (!personaId) return { ok: false, error: "personaId is required" };
    const persisted = await loadSession(projectRoot, personaId);
    if (!persisted?.sessionId) return { ok: true, sessionId: null, messages: [] };
    try {
      const sdk = await loadSdk();
      if (typeof sdk.getSessionMessages !== "function") {
        return { ok: true, sessionId: persisted.sessionId, messages: [] };
      }
      const messages = await sdk.getSessionMessages(persisted.sessionId);
      return {
        ok: true,
        sessionId: persisted.sessionId,
        messages: Array.isArray(messages) ? messages.map(safeSerialize).filter(Boolean) : []
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
};

module.exports = { registerAgentSdkHandlers };
