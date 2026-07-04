const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { registerAgentSdkHandlers } = require("./agentSdk.cjs");

// Suppress Anthropic's internal operational telemetry for any Claude Code
// subprocess the SDK spawns. Subprocesses inherit process.env.
process.env.DISABLE_TELEMETRY = "1";
process.env.DISABLE_ERROR_REPORTING = "1";

const projectRoot = path.join(__dirname, "..");
const resolvedProjectRoot = path.resolve(projectRoot);
const projectHash = crypto
  .createHash("sha1")
  .update(resolvedProjectRoot.toLowerCase())
  .digest("hex")
  .slice(0, 8);
const projectSlug =
  path
    .basename(resolvedProjectRoot)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32) || "the-house";
const instanceId = process.env.HOUSE_INSTANCE_ID || `${projectSlug}-${projectHash}`;
const userDataName = process.env.HOUSE_USER_DATA_NAME || `The House Dev - ${instanceId}`;
const defaultWalkiePort = 8700 + (parseInt(projectHash.slice(4, 8), 16) % 800);
const walkiePort = Number(process.env.HOUSE_WALKIE_PORT || defaultWalkiePort);
app.setPath("userData", path.join(app.getPath("appData"), userDataName));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disk-cache-size", "0");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let mobileWalkieServer = null;
const pendingMobileRequests = new Map();

if (!hasSingleInstanceLock) {
  app.quit();
}

const extractText = (message) => {
  if (!message || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((part) => part && part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const callAnthropic = async ({ model, system, messages, maxTokens }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      missingKey: true,
      text: "ANTHROPIC_API_KEY is not configured. No model call was made.",
      usage: null
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens ?? 700,
      system,
      messages
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      missingKey: false,
      text: payload?.error?.message ?? `Anthropic request failed with ${response.status}.`,
      usage: payload?.usage ?? null
    };
  }

  return {
    ok: true,
    missingKey: false,
    text: extractText(payload),
    usage: payload.usage ?? null,
    model: payload.model
  };
};

const fetchWeatherSignal = async ({ latitude = 41.8781, longitude = -87.6298 } = {}) => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,rain,showers,precipitation,weather_code");
  url.searchParams.set("daily", "precipitation_probability_max,precipitation_sum,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "America/Chicago");

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.reason ?? `Weather request failed with ${response.status}.`);
  }

  return {
    ok: true,
    source: "open-meteo",
    latitude,
    longitude,
    fetchedAt: new Date().toISOString(),
    current: payload.current ?? null,
    daily: payload.daily ?? null
  };
};

const assertInsideProject = (targetPath) => {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(projectRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Refusing to write outside project: ${resolved}`);
  }
  return resolved;
};

const writeJson = async (relativePath, value) => {
  const target = assertInsideProject(path.join(projectRoot, relativePath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
};

const readJson = async (relativePath, fallback = null) => {
  const target = assertInsideProject(path.join(projectRoot, relativePath));
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
};

const readJsonDirectory = async (relativePath) => {
  const target = assertInsideProject(path.join(projectRoot, relativePath));
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const values = [];
    for (const file of files) {
      try {
        values.push(await readJson(path.join(relativePath, file)));
      } catch (error) {
        console.warn(`Skipping unreadable JSON file ${path.join(relativePath, file)}: ${error?.message || error}`);
      }
    }
    return values;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";

const exportHouseState = async ({ personas, rooms, runtime }) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const written = [];

  for (const persona of personas ?? []) {
    written.push(
      await writeJson(`config/personas/${slug(persona.id ?? persona.name)}.json`, persona)
    );
  }

  for (const room of rooms ?? []) {
    written.push(await writeJson(`config/rooms/${slug(room.id ?? room.name)}.json`, room));
  }

  written.push(await writeJson("state/runtime.json", runtime));
  written.push(
    await writeJson(`state/exports/runtime-${stamp}.json`, {
      exportedAt: new Date().toISOString(),
      runtime
    })
  );

  return {
    ok: true,
    written: written.map((filePath) => path.relative(projectRoot, filePath))
  };
};

const loadHouseState = async () => {
  const personas = await readJsonDirectory("config/personas");
  const rooms = await readJsonDirectory("config/rooms");
  let runtime = null;
  try {
    runtime = await readJson("state/runtime.json", null);
  } catch (error) {
    console.warn(`Skipping unreadable state/runtime.json: ${error?.message || error}`);
  }

  return {
    ok: true,
    personas,
    rooms,
    runtime,
    read: {
      personas: personas.length,
      rooms: rooms.length,
      runtime: Boolean(runtime)
    }
  };
};

const writeRoomConfig = async (room) => {
  if (!room?.id) {
    throw new Error("Cannot write room config without an id.");
  }
  const written = await writeJson(`config/rooms/${slug(room.id ?? room.name)}.json`, room);
  return {
    ok: true,
    path: path.relative(projectRoot, written),
    roomId: room.id
  };
};

const writePersonaConfig = async (persona) => {
  if (!persona?.id) {
    throw new Error("Cannot write persona config without an id.");
  }
  const written = await writeJson(`config/personas/${slug(persona.id ?? persona.name)}.json`, persona);
  return {
    ok: true,
    path: path.relative(projectRoot, written),
    personaId: persona.id
  };
};

const deletePersonaConfig = async (personaId) => {
  if (!personaId) throw new Error("Cannot delete persona config without an id.");
  const target = assertInsideProject(path.join(projectRoot, `config/personas/${slug(personaId)}.json`));
  try { await fs.unlink(target); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ok: true, personaId };
};

const importExternalMemoryExport = async ({ filePath } = {}) => {
  let selectedPath = filePath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
      title: "Import memory export",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true, filePath: null, data: null };
    }
    selectedPath = result.filePaths[0];
  }

  const content = await fs.readFile(selectedPath, "utf8");
  return {
    ok: true,
    canceled: false,
    filePath: selectedPath,
    data: JSON.parse(content)
  };
};

const memoryRelativePath = (memory) => {
  const personaId = slug(memory?.personaId ?? memory?.personaName ?? "unknown");
  const day = Number(memory?.day ?? 0);
  const dayLabel = String(Number.isFinite(day) && day > 0 ? day : 0).padStart(3, "0");
  const memoryId = slug(memory?.id ?? `memory-${dayLabel}`);
  return `state/personas/${personaId}/memories/day-${dayLabel}/${memoryId}.json`;
};

const personaMemoryArchivePath = "state/memories/persona-memories.jsonl";

const readPersonaMemoryArchive = async () => {
  const target = assertInsideProject(path.join(projectRoot, personaMemoryArchivePath));
  try {
    const content = await fs.readFile(target, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const appendPersonaMemoryArchive = async (memories = []) => {
  const target = assertInsideProject(path.join(projectRoot, personaMemoryArchivePath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await readPersonaMemoryArchive();
  const existingIds = new Set(existing.map((memory) => memory?.id).filter(Boolean));
  const next = [];
  for (const memory of memories) {
    if (!memory?.id || existingIds.has(memory.id)) continue;
    existingIds.add(memory.id);
    next.push({
      ...memory,
      archivedAt: new Date().toISOString()
    });
  }
  if (next.length > 0) {
    await fs.appendFile(target, next.map((memory) => `${JSON.stringify(memory)}\n`).join(""), "utf8");
  }
  return {
    ok: true,
    appended: next.length,
    skipped: memories.length - next.length,
    path: personaMemoryArchivePath
  };
};

const writePersonaMemory = async (memory) => {
  if (!memory || !memory.id) {
    throw new Error("Cannot write persona memory without an id.");
  }
  const archive = await appendPersonaMemoryArchive([memory]);
  const written = await writeJson(memoryRelativePath(memory), {
    ...memory,
    fileBackedAt: new Date().toISOString()
  });
  return {
    ok: true,
    path: path.relative(projectRoot, written),
    archive,
    memoryId: memory.id,
    personaId: memory.personaId
  };
};

const writePersonaMemories = async ({ memories } = {}) => {
  const written = [];
  for (const memory of memories ?? []) {
    written.push(await writePersonaMemory(memory));
  }
  return {
    ok: true,
    written
  };
};

const listPersonaMemoryFiles = async () => {
  const root = assertInsideProject(path.join(projectRoot, "state/personas"));
  const files = [];
  const walk = async (directory) => {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.relative(projectRoot, target));
      }
    }
  };
  await walk(root);
  files.sort();
  return { ok: true, files };
};

const loadPersonaMemoryArchive = async () => {
  const memories = await readPersonaMemoryArchive();
  return {
    ok: true,
    memories,
    read: memories.length,
    path: personaMemoryArchivePath
  };
};

const houseEventArchivePath = "state/house/events.jsonl";

const readHouseEventArchive = async () => {
  const target = assertInsideProject(path.join(projectRoot, houseEventArchivePath));
  try {
    const content = await fs.readFile(target, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const appendHouseEventArchive = async (events = []) => {
  const target = assertInsideProject(path.join(projectRoot, houseEventArchivePath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await readHouseEventArchive();
  const existingIds = new Set(existing.map((event) => event?.id).filter(Boolean));
  const next = [];
  for (const event of events) {
    if (!event?.id || existingIds.has(event.id)) continue;
    existingIds.add(event.id);
    next.push({
      ...event,
      archivedAt: new Date().toISOString()
    });
  }
  if (next.length > 0) {
    await fs.appendFile(target, next.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
  }
  return {
    ok: true,
    appended: next.length,
    skipped: events.length - next.length,
    path: houseEventArchivePath
  };
};

const loadHouseEventArchive = async () => {
  const events = await readHouseEventArchive();
  return {
    ok: true,
    events,
    read: events.length,
    path: houseEventArchivePath
  };
};

const relationshipUpdateArchivePath = "state/relationships/updates.jsonl";

const readRelationshipUpdateArchive = async () => {
  const target = assertInsideProject(path.join(projectRoot, relationshipUpdateArchivePath));
  try {
    const content = await fs.readFile(target, "utf8");
    const records = content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const latestById = new Map();
    for (const record of records) {
      if (!record?.id) continue;
      latestById.set(record.id, record);
    }
    return Array.from(latestById.values());
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const appendRelationshipUpdateArchive = async (updates = []) => {
  const target = assertInsideProject(path.join(projectRoot, relationshipUpdateArchivePath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await readRelationshipUpdateArchive();
  const existingIds = new Set(existing.map((update) => update?.id).filter(Boolean));
  const next = [];
  for (const update of updates) {
    if (!update?.id || existingIds.has(update.id)) continue;
    existingIds.add(update.id);
    next.push({
      ...update,
      archivedAt: new Date().toISOString()
    });
  }
  if (next.length > 0) {
    await fs.appendFile(target, next.map((update) => `${JSON.stringify(update)}\n`).join(""), "utf8");
  }
  return {
    ok: true,
    appended: next.length,
    skipped: updates.length - next.length,
    path: relationshipUpdateArchivePath
  };
};

const appendRelationshipUpdateRevisions = async (updates = []) => {
  const target = assertInsideProject(path.join(projectRoot, relationshipUpdateArchivePath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const next = (updates ?? [])
    .filter((update) => update?.id)
    .map((update) => ({
      ...update,
      revisionAt: new Date().toISOString()
    }));
  if (next.length > 0) {
    await fs.appendFile(target, next.map((update) => `${JSON.stringify(update)}\n`).join(""), "utf8");
  }
  return {
    ok: true,
    appended: next.length,
    skipped: updates.length - next.length,
    path: relationshipUpdateArchivePath
  };
};

const loadRelationshipUpdateArchive = async () => {
  const updates = await readRelationshipUpdateArchive();
  return {
    ok: true,
    updates,
    read: updates.length,
    path: relationshipUpdateArchivePath
  };
};

const directRoomRelativePath = (room) => {
  const roomId = slug(room?.id ?? "direct-room");
  return `state/direct-rooms/${roomId}.json`;
};

const roomConversationRelativePath = (conversation) => {
  const id = slug(conversation?.id ?? conversation?.roomId ?? "room-conversation");
  return `state/room-conversations/${id}.json`;
};

const writeRoomConversation = async (conversation) => {
  if (!conversation?.id) {
    throw new Error("Cannot write room conversation without an id.");
  }
  const written = await writeJson(roomConversationRelativePath(conversation), {
    ...conversation,
    fileBackedAt: new Date().toISOString()
  });
  return {
    ok: true,
    path: path.relative(projectRoot, written),
    conversationId: conversation.id
  };
};

const loadRoomConversationArchive = async () => {
  const target = assertInsideProject(path.join(projectRoot, "state/room-conversations"));
  const conversations = [];
  const skipped = [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const file of files) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(target, file), "utf8"));
        conversations.push(value);
      } catch (error) {
        skipped.push({
          file,
          reason: error instanceof Error ? error.message : "Could not parse room-conversation JSON."
        });
      }
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    ok: true,
    conversations,
    read: conversations.length,
    skipped,
    path: "state/room-conversations"
  };
};

const writeDirectRoom = async (room) => {
  if (!room?.id) {
    throw new Error("Cannot write direct room without an id.");
  }
  const written = await writeJson(directRoomRelativePath(room), {
    ...room,
    fileBackedAt: new Date().toISOString()
  });
  return {
    ok: true,
    path: path.relative(projectRoot, written),
    roomId: room.id
  };
};

const writeDirectRooms = async ({ rooms } = {}) => {
  const written = [];
  for (const room of rooms ?? []) {
    written.push(await writeDirectRoom(room));
  }
  return {
    ok: true,
    written
  };
};

const loadDirectRoomArchive = async () => {
  const target = assertInsideProject(path.join(projectRoot, "state/direct-rooms"));
  const rooms = [];
  const skipped = [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const file of files) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(target, file), "utf8"));
        rooms.push(value);
      } catch (error) {
        skipped.push({
          file,
          reason: error instanceof Error ? error.message : "Could not parse direct-room JSON."
        });
      }
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    ok: true,
    rooms,
    read: rooms.length,
    skipped,
    path: "state/direct-rooms"
  };
};

const librarianPath = "state/librarian/records.jsonl";

const writeLibrarianRecords = async (records) => {
  const target = assertInsideProject(path.join(projectRoot, librarianPath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  const content = records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, target);
};

const appendLibrarianRecord = async (record) => {
  const target = assertInsideProject(path.join(projectRoot, librarianPath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await readLibrarianRecords();
  if (record && record.id && existing.some((candidate) => candidate.id === record.id)) {
    return { ok: true, record, deduped: true };
  }
  await fs.appendFile(target, `${JSON.stringify(record)}\n`, "utf8");
  return { ok: true, record };
};

const readLibrarianRecords = async () => {
  const target = assertInsideProject(path.join(projectRoot, librarianPath));
  try {
    const content = await fs.readFile(target, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const queryLibrarianRecords = async ({ query, limit } = {}) => {
  const records = (await readLibrarianRecords()).filter((record) => {
    const state = record?.consent?.state ?? "known";
    return state !== "deleted" && state !== "soft-forgotten" && record?.published !== false;
  });
  const tokens = String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  const scored = records
    .map((record) => {
      const haystack = [
        record.type,
        record.subject,
        record.predicate,
        record.object,
        ...(record.tags ?? []),
        record.source?.label
      ]
        .join(" ")
        .toLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { record, score };
    })
    .filter((entry) => tokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.record.updatedAt).localeCompare(String(a.record.updatedAt)))
    .slice(0, limit ?? 8)
    .map((entry) => entry.record);

  return { ok: true, query: query ?? "", records: scored };
};

const createLibrarianTombstone = (record, reason) => {
  const now = new Date().toISOString();
  return {
    id: `tombstone-${record.id}`,
    type: "tombstone",
    kind: "tombstone",
    subject: "Librarian",
    predicate: "tombstoned_record",
    object: `Tombstoned ${record.id}`,
    content: "",
    confidence: 1,
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    source: {
      kind: "manual",
      id: record.id,
      label: "Librarian tombstone"
    },
    consent: {
      state: "deleted",
      reason: reason || "Tombstoned by consent lifecycle",
      updatedAt: now,
      allowedPersonaIds: [],
      allowSteward: true,
      allowLibrarian: true
    },
    published: false,
    tags: ["tombstone", "consent"],
    references: [],
    embedding: null,
    compressionLevel: record.compressionLevel || "raw",
    tombstonedRecordId: record.id,
    stale: true
  };
};

const tombstoneLibrarianRecords = async ({ recordIds = [], sourceIds = [], reason } = {}) => {
  const records = await readLibrarianRecords();
  const recordIdSet = new Set(recordIds);
  const sourceIdSet = new Set(sourceIds);
  const existingTombstones = new Set(
    records
      .filter((record) => record.type === "tombstone" || record.kind === "tombstone")
      .map((record) => record.tombstonedRecordId)
      .filter(Boolean)
  );
  const targets = records.filter((record) => {
    if (!record || record.type === "tombstone" || record.kind === "tombstone") return false;
    if (existingTombstones.has(record.id)) return false;
    return recordIdSet.has(record.id) || sourceIdSet.has(record.source?.id);
  });
  if (targets.length === 0) {
    return { ok: true, tombstoned: 0, recordIds: [] };
  }
  const tombstones = targets.map((record) => createLibrarianTombstone(record, reason));
  const target = assertInsideProject(path.join(projectRoot, librarianPath));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, tombstones.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
  return { ok: true, tombstoned: tombstones.length, recordIds: targets.map((record) => record.id) };
};

const compactLibrarianRecords = async () => {
  const records = await readLibrarianRecords();
  const tombstoneByTarget = new Map();
  for (const record of records) {
    if ((record.type === "tombstone" || record.kind === "tombstone") && record.tombstonedRecordId) {
      tombstoneByTarget.set(record.tombstonedRecordId, record);
    }
  }

  const keptById = new Map();
  for (const record of records) {
    if (!record?.id) continue;
    const state = record?.consent?.state ?? "known";
    const isTombstone = record.type === "tombstone" || record.kind === "tombstone";
    if (!isTombstone && (state === "deleted" || tombstoneByTarget.has(record.id))) {
      continue;
    }
    if (isTombstone && record.tombstonedRecordId) {
      keptById.set(record.id, {
        ...record,
        object: `Tombstoned ${record.tombstonedRecordId}`,
        content: "",
        references: [],
        embedding: null
      });
      continue;
    }
    keptById.set(record.id, record);
  }

  const kept = Array.from(keptById.values());
  await writeLibrarianRecords(kept);
  return {
    ok: true,
    before: records.length,
    after: kept.length,
    removed: records.length - kept.length,
    tombstones: Array.from(tombstoneByTarget.keys()).length
  };
};

const exists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const copyIfExists = async (relativeSource, relativeDestination) => {
  const source = assertInsideProject(path.join(projectRoot, relativeSource));
  const destination = assertInsideProject(path.join(projectRoot, relativeDestination));
  if (!(await exists(source))) {
    return false;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  return true;
};

const backupDocs = [
  "VISION.md",
  "MVP.md",
  "RHYTHM.md",
  "MEMORY.md",
  "ENTITIES.md",
  "GROWTH.md",
  "PERMISSIONS.md",
  "SELF_MODIFICATION.md",
  "MOTION.md",
  "TRIGGERS.md",
  "CONVERSATION_PRESENCE.md",
  "ROOM_STRUCTURE.md",
  "AUTOPILOT.md",
  "CODER_HANDS.md",
  "LIBRARIAN_MEMORY.md",
  "HOUSE_EVENT_LOG.md",
  "RELATIONSHIPS.md",
  "CONSENT.md",
  "UNOBSERVED.md",
  "OUTSIDE_SIGNAL.md",
  "FAILURE_MODES.md",
  "STEWARD_DIAGNOSTICS.md",
  "FILE_BACKED_STATE.md",
  "STATE_OWNERSHIP.md",
  "THINGS_TO_TEST.md",
  "KNOWN_GAPS.md",
  "POST_TESTING_ROADMAP.md",
  "BACKUPS.md",
  "README.md"
];

const createBackup = async ({ reason } = {}) => {
  const createdAt = new Date().toISOString();
  const backupId = `backup-${createdAt.replace(/[:.]/g, "-")}`;
  const backupRoot = `backups/${backupId}`;
  const copied = [];

  if (await copyIfExists("config", `${backupRoot}/config`)) copied.push("config");
  if (await copyIfExists("state", `${backupRoot}/state`)) copied.push("state");

  for (const doc of backupDocs) {
    if (await copyIfExists(doc, `${backupRoot}/docs/${doc}`)) {
      copied.push(`docs/${doc}`);
    }
  }

  const manifest = {
    backupId,
    createdAt,
    reason: reason || "Manual backup",
    copied,
    includes: {
      config: copied.includes("config"),
      state: copied.includes("state"),
      docs: copied.some((entry) => entry.startsWith("docs/"))
    },
    projectRoot
  };
  await writeJson(`${backupRoot}/manifest.json`, manifest);

  return {
    ok: true,
    backupId,
    manifestPath: `${backupRoot}/manifest.json`,
    copied
  };
};

const listBackups = async () => {
  const backupsRoot = assertInsideProject(path.join(projectRoot, "backups"));
  try {
    const entries = await fs.readdir(backupsRoot, { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readJson(`backups/${entry.name}/manifest.json`, null);
      if (manifest) backups.push(manifest);
    }
    backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { ok: true, backups };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ok: true, backups: [] };
    }
    throw error;
  }
};

const restoreBackup = async ({ backupId } = {}) => {
  const listed = await listBackups();
  const selected = backupId
    ? listed.backups.find((backup) => backup.backupId === backupId)
    : listed.backups[0];
  if (!selected) {
    throw new Error("No backups available to restore.");
  }

  const preRestore = await createBackup({
    reason: `Pre-restore safety backup before restoring ${selected.backupId}`
  });
  const restored = [];
  const backupRoot = `backups/${selected.backupId}`;

  if (await copyIfExists(`${backupRoot}/config`, "config")) restored.push("config");
  if (await copyIfExists(`${backupRoot}/state`, "state")) restored.push("state");

  return {
    ok: true,
    restoredBackupId: selected.backupId,
    preRestoreBackupId: preRestore.backupId,
    restored
  };
};

const jsonResponse = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  response.end(JSON.stringify(payload));
};

const readRequestBody = (request, limitBytes = 16 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const sendMobileRendererRequest = (type, payload = {}) =>
  new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) {
      reject(new Error("The House window is not available."));
      return;
    }
    const id = `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = setTimeout(() => {
      pendingMobileRequests.delete(id);
      reject(new Error("The House did not answer the walkie request."));
    }, 30000);
    pendingMobileRequests.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send("mobile-walkie:request", { id, type, payload });
  });

const runWhisperTranscription = async (audioBuffer, extension = "webm") => {
  const commandTemplate = process.env.HOUSE_WHISPER_COMMAND || process.env.WHISPER_COMMAND;
  if (!commandTemplate) {
    return {
      ok: false,
      error: "No local Whisper command is configured. Set HOUSE_WHISPER_COMMAND with {input} and optional {output} placeholders."
    };
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "house-walkie-"));
  const inputPath = path.join(tempDir, `dictation.${extension.replace(/[^a-z0-9]/gi, "") || "webm"}`);
  const outputPath = path.join(tempDir, "dictation.txt");
  await fs.writeFile(inputPath, audioBuffer);
  const rendered = commandTemplate.replaceAll("{input}", inputPath).replaceAll("{output}", outputPath);
  const child = spawn(rendered, {
    shell: true,
    cwd: projectRoot,
    env: { ...process.env, HOUSE_WALKIE_INPUT: inputPath, HOUSE_WALKIE_OUTPUT: outputPath }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  const outputText = fsSync.existsSync(outputPath) ? await fs.readFile(outputPath, "utf8").catch(() => "") : "";
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() || stdout.trim() || `Whisper exited with ${exitCode}.` };
  }
  return { ok: true, text: (outputText || stdout).trim() };
};

const mobileWalkieHtml = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>House Walkie</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101414;color:#eef1ea}body{margin:0;background:#101414}main{min-height:100vh;display:flex;flex-direction:column;gap:12px;padding:14px;box-sizing:border-box}header{display:flex;justify-content:space-between;align-items:center;gap:12px}h1{font-size:1.05rem;margin:0}.pill{border:1px solid rgba(149,188,177,.35);border-radius:999px;padding:5px 9px;color:#a9c9bd;font-size:.76rem}label{display:grid;gap:6px;color:#aab4ad;font-size:.78rem}select,textarea,button{font:inherit;border-radius:7px;border:1px solid rgba(238,241,234,.14);background:#151b1b;color:#eef1ea}select{padding:10px}textarea{min-height:30vh;resize:vertical;padding:12px;line-height:1.38}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}button{padding:12px 10px;font-weight:650;background:#28372f;border-color:rgba(123,196,154,.62)}button.secondary{background:#1a2224;border-color:rgba(117,167,216,.35)}button.recording{background:#442626;border-color:rgba(224,143,95,.7)}#status{min-height:1.2em;color:#aab4ad;font-size:.82rem;line-height:1.35}.transcript-head{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#aab4ad;font-size:.78rem}#log{overflow:auto;max-height:34vh;display:grid;gap:8px}article{border-top:1px solid rgba(238,241,234,.08);padding-top:8px}article strong{display:block;font-size:.78rem;color:#a9c9bd;margin-bottom:3px}article p{margin:0;white-space:pre-wrap;font-size:.9rem;line-height:1.35}
</style></head><body><main><header><h1>House Walkie</h1><span id="clock" class="pill">connecting</span></header><label>Target<select id="target"><option value="room">Current room</option><option value="house">House channel</option></select></label><textarea id="message" placeholder="Type here, or record and transcribe."></textarea><div class="actions"><button id="send">Send</button><button id="record" class="secondary">Record</button></div><div id="status"></div><div class="transcript-head"><span id="transcriptTitle">Transcript</span><span id="transcriptCount">0 turns</span></div><section id="log"></section></main>
<script>
const target=document.getElementById('target'),message=document.getElementById('message'),statusEl=document.getElementById('status'),logEl=document.getElementById('log'),clockEl=document.getElementById('clock'),recordBtn=document.getElementById('record'),transcriptTitle=document.getElementById('transcriptTitle'),transcriptCount=document.getElementById('transcriptCount');let mediaRecorder=null,chunks=[];function setStatus(t){statusEl.textContent=t||''}async function api(path,options={}){const res=await fetch(path,options);const data=await res.json().catch(()=>({}));if(!res.ok||data.ok===false)throw new Error(data.error||'Request failed.');return data}function payloadForSelection(text){const selected=target.value;if(selected.startsWith('persona:'))return{text,targetPersonaId:selected.slice(8)};return{text,mode:selected}}function renderTranscript(data){const turns=data.turns||[];transcriptTitle.textContent=data.title||'Transcript';transcriptCount.textContent=turns.length+' turn'+(turns.length===1?'':'s');logEl.innerHTML='';if(!turns.length){const item=document.createElement('article');item.innerHTML='<strong>No transcript yet</strong><p>This channel has not said anything from the walkie view yet.</p>';logEl.appendChild(item);return}for(const turn of turns.slice().reverse()){const item=document.createElement('article');item.innerHTML='<strong></strong><p></p>';const when=turn.timestamp?new Date(turn.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):turn.minuteOfDay!=null?String(Math.floor(turn.minuteOfDay/60)).padStart(2,'0')+':'+String(turn.minuteOfDay%60).padStart(2,'0'):'';item.querySelector('strong').textContent=turn.speaker+(when?' / '+when:'');item.querySelector('p').textContent=turn.text;logEl.appendChild(item)}}async function loadTranscript(){try{const selected=target.value;const payload=selected.startsWith('persona:')?{targetPersonaId:selected.slice(8)}:{mode:selected};renderTranscript(await api('/api/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}))}catch(error){setStatus(error.message)}}async function refreshStatus(){try{const data=await api('/api/status');clockEl.textContent=data.formattedTime||'online';const current=target.value;target.innerHTML='<option value="room">Current room'+(data.caseyRoomName?': '+data.caseyRoomName:'')+'</option><option value="house">House channel</option>';for(const persona of data.personas||[]){if(!persona.apiEnabled)continue;const opt=document.createElement('option');opt.value='persona:'+persona.id;opt.textContent='Walkie: '+persona.name;target.appendChild(opt)}if([...target.options].some(o=>o.value===current))target.value=current;await loadTranscript()}catch(error){clockEl.textContent='offline';setStatus(error.message)}}async function sendMessage(){const text=message.value.trim();if(!text)return;setStatus('Sending...');try{const data=await api('/api/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payloadForSelection(text))});message.value='';setStatus(data.route||'Sent.');setTimeout(loadTranscript,600)}catch(error){setStatus(error.message)}}async function toggleRecording(){if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recordBtn.classList.remove('recording');recordBtn.textContent='Record';const blob=new Blob(chunks,{type:mediaRecorder.mimeType||'audio/webm'});setStatus('Transcribing...');try{const data=await api('/api/transcribe',{method:'POST',headers:{'content-type':blob.type},body:blob});message.value=message.value?message.value+'\\n'+data.text:data.text;setStatus('Transcribed.')}catch(error){setStatus(error.message)}};mediaRecorder.start();recordBtn.classList.add('recording');recordBtn.textContent='Stop';setStatus('Recording...')}catch(error){setStatus(error.message)}}document.getElementById('send').addEventListener('click',sendMessage);recordBtn.addEventListener('click',toggleRecording);target.addEventListener('change',loadTranscript);message.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});refreshStatus();setInterval(refreshStatus,10000);
</script></body></html>`;

const startMobileWalkieServer = () => {
  if (mobileWalkieServer) return;
  const port = walkiePort;
  mobileWalkieServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(mobileWalkieHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        jsonResponse(response, 200, await sendMobileRendererRequest("status"));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/transcript") {
        const body = await readRequestBody(request, 1024 * 1024);
        jsonResponse(response, 200, await sendMobileRendererRequest("transcript", JSON.parse(body.toString("utf8") || "{}")));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/message") {
        const body = await readRequestBody(request, 1024 * 1024);
        jsonResponse(response, 200, await sendMobileRendererRequest("message", JSON.parse(body.toString("utf8") || "{}")));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/transcribe") {
        const body = await readRequestBody(request, 32 * 1024 * 1024);
        const contentType = request.headers["content-type"] || "";
        const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("wav") ? "wav" : "webm";
        jsonResponse(response, 200, await runWhisperTranscription(body, extension));
        return;
      }
      jsonResponse(response, 404, { ok: false, error: "Not found." });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: String(error?.message || error) });
    }
  });
  mobileWalkieServer.listen(port, "0.0.0.0", () => {
    console.log(`House walkie web app listening for ${instanceId} on http://0.0.0.0:${port}`);
  });
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "The House",
    backgroundColor: "#111314",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
};

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(() => {
  ipcMain.on("mobile-walkie:response", (_event, payload) => {
    const pending = pendingMobileRequests.get(payload?.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingMobileRequests.delete(payload.id);
    if (payload.ok === false) {
      pending.reject(new Error(payload.error || "Mobile walkie request failed."));
      return;
    }
    pending.resolve(payload.result ?? { ok: true });
  });

  ipcMain.handle("house:getRuntimeInfo", () => ({
    appName: "The House",
    instanceId,
    projectRoot: resolvedProjectRoot,
    userData: app.getPath("userData"),
    walkiePort,
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY)
  }));

  // Legacy raw-fetch path. All persona calls now route through the SDK via
  // house:sendPersonaQuery (cache-warm, session-resumed). Left wired as an
  // escape hatch in case we ever need the bare messages API.
  ipcMain.handle("house:sendAnthropicMessage", async (_event, request) => {
    return callAnthropic(request);
  });

  ipcMain.handle("house:fetchWeatherSignal", async (_event, payload) => {
    return fetchWeatherSignal(payload);
  });

  ipcMain.handle("house:exportState", async (_event, payload) => {
    return exportHouseState(payload);
  });

  ipcMain.handle("house:loadState", async () => {
    return loadHouseState();
  });

  ipcMain.handle("house:writeRoomConfig", async (_event, room) => {
    return writeRoomConfig(room);
  });

  ipcMain.handle("house:writePersonaConfig", async (_event, persona) => {
    return writePersonaConfig(persona);
  });

  ipcMain.handle("house:deletePersonaConfig", async (_event, payload) => {
    return deletePersonaConfig(payload?.personaId);
  });

  ipcMain.handle("house:importExternalMemoryExport", async (_event, payload) => {
    return importExternalMemoryExport(payload);
  });

  ipcMain.handle("house:writePersonaMemory", async (_event, memory) => {
    return writePersonaMemory(memory);
  });

  ipcMain.handle("house:writePersonaMemories", async (_event, payload) => {
    return writePersonaMemories(payload);
  });

  ipcMain.handle("house:listPersonaMemoryFiles", async () => {
    return listPersonaMemoryFiles();
  });

  ipcMain.handle("house:loadPersonaMemoryArchive", async () => {
    return loadPersonaMemoryArchive();
  });

  ipcMain.handle("house:appendHouseEvents", async (_event, payload) => {
    return appendHouseEventArchive(payload?.events ?? []);
  });

  ipcMain.handle("house:loadHouseEventArchive", async () => {
    return loadHouseEventArchive();
  });

  ipcMain.handle("house:appendRelationshipUpdates", async (_event, payload) => {
    return appendRelationshipUpdateArchive(payload?.updates ?? []);
  });

  ipcMain.handle("house:appendRelationshipUpdateRevisions", async (_event, payload) => {
    return appendRelationshipUpdateRevisions(payload?.updates ?? []);
  });

  ipcMain.handle("house:loadRelationshipUpdateArchive", async () => {
    return loadRelationshipUpdateArchive();
  });

  ipcMain.handle("house:writeDirectRoom", async (_event, room) => {
    return writeDirectRoom(room);
  });

  ipcMain.handle("house:writeDirectRooms", async (_event, payload) => {
    return writeDirectRooms(payload);
  });

  ipcMain.handle("house:loadDirectRoomArchive", async () => {
    return loadDirectRoomArchive();
  });

  ipcMain.handle("house:writeRoomConversation", async (_event, conversation) => {
    return writeRoomConversation(conversation);
  });

  ipcMain.handle("house:loadRoomConversationArchive", async () => {
    return loadRoomConversationArchive();
  });

  ipcMain.handle("house:createBackup", async (_event, payload) => {
    return createBackup(payload);
  });

  ipcMain.handle("house:listBackups", async () => {
    return listBackups();
  });

  ipcMain.handle("house:restoreLatestBackup", async () => {
    return restoreBackup();
  });

  ipcMain.handle("house:restoreBackup", async (_event, payload) => {
    return restoreBackup(payload);
  });

  ipcMain.handle("house:librarianAppend", async (_event, record) => {
    return appendLibrarianRecord(record);
  });

  ipcMain.handle("house:librarianQuery", async (_event, payload) => {
    return queryLibrarianRecords(payload);
  });

  ipcMain.handle("house:librarianTombstone", async (_event, payload) => {
    return tombstoneLibrarianRecords(payload);
  });

  ipcMain.handle("house:librarianCompact", async () => {
    return compactLibrarianRecords();
  });

  registerAgentSdkHandlers({ ipcMain, projectRoot });

  createWindow();
  startMobileWalkieServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
