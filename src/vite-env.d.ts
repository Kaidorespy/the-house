/// <reference types="vite/client" />

interface HouseRuntimeInfo {
  appName: string;
  instanceId?: string;
  projectRoot?: string;
  userData?: string;
  walkiePort?: number;
  anthropicConfigured: boolean;
}

interface AnthropicMessageRequest {
  model: string;
  system: string;
  maxTokens?: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

interface AnthropicMessageResponse {
  ok: boolean;
  missingKey: boolean;
  text: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
  model?: string;
}

interface WeatherSignalResponse {
  ok: boolean;
  source: string;
  latitude: number;
  longitude: number;
  fetchedAt: string;
  current: {
    temperature_2m?: number;
    rain?: number;
    showers?: number;
    precipitation?: number;
    weather_code?: number;
  } | null;
  daily: {
    time?: string[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
    weather_code?: number[];
  } | null;
}

interface HouseExportPayload {
  personas: unknown[];
  rooms: unknown[];
  runtime: unknown;
}

interface HouseExportResponse {
  ok: boolean;
  written: string[];
}

interface HouseLoadResponse {
  ok: boolean;
  personas: unknown[];
  rooms: unknown[];
  runtime: unknown;
  read: {
    personas: number;
    rooms: number;
    runtime: boolean;
  };
}

interface ExternalMemoryImportResponse {
  ok: boolean;
  canceled: boolean;
  filePath: string | null;
  data: unknown;
}

interface HouseBackupManifest {
  backupId: string;
  createdAt: string;
  reason: string;
  copied: string[];
  includes?: {
    config: boolean;
    state: boolean;
    docs: boolean;
  };
  projectRoot?: string;
}

interface HouseBackupResponse {
  ok: boolean;
  backupId: string;
  manifestPath: string;
  copied: string[];
}

interface HouseBackupListResponse {
  ok: boolean;
  backups: HouseBackupManifest[];
}

interface HouseRestoreResponse {
  ok: boolean;
  restoredBackupId: string;
  preRestoreBackupId: string;
  restored: string[];
}

interface LibrarianAppendResponse {
  ok: boolean;
  record: import("./types").LibrarianRecord;
  deduped?: boolean;
}

interface LibrarianTombstoneResponse {
  ok: boolean;
  tombstoned: number;
  recordIds: string[];
}

interface LibrarianCompactResponse {
  ok: boolean;
  before: number;
  after: number;
  removed: number;
  tombstones: number;
}

interface PersonaMemoryWriteResponse {
  ok: boolean;
  path: string;
  archive?: {
    ok: boolean;
    appended: number;
    skipped: number;
    path: string;
  };
  memoryId: string;
  personaId: string;
}

interface PersonaMemoryWriteManyResponse {
  ok: boolean;
  written: PersonaMemoryWriteResponse[];
}

interface PersonaMemoryFileListResponse {
  ok: boolean;
  files: string[];
}

interface PersonaMemoryArchiveLoadResponse {
  ok: boolean;
  memories: import("./types").PersonaMemoryEntry[];
  read: number;
  path: string;
}

interface HouseEventArchiveAppendResponse {
  ok: boolean;
  appended: number;
  skipped: number;
  path: string;
}

interface HouseEventArchiveLoadResponse {
  ok: boolean;
  events: import("./types").HouseEvent[];
  read: number;
  path: string;
}

interface RelationshipUpdateArchiveAppendResponse {
  ok: boolean;
  appended: number;
  skipped: number;
  path: string;
}

interface RelationshipUpdateArchiveLoadResponse {
  ok: boolean;
  updates: import("./types").RelationshipUpdate[];
  read: number;
  path: string;
}

interface DirectRoomWriteResponse {
  ok: boolean;
  path: string;
  roomId: string;
}

interface DirectRoomWriteManyResponse {
  ok: boolean;
  written: DirectRoomWriteResponse[];
}

interface DirectRoomArchiveLoadResponse {
  ok: boolean;
  rooms: import("./types").DirectRoom[];
  read: number;
  skipped?: Array<{ file: string; reason: string }>;
  path: string;
}

interface RoomConfigWriteResponse {
  ok: boolean;
  path: string;
  roomId: string;
}

interface Window {
  houseRuntime?: {
    getRuntimeInfo: () => Promise<HouseRuntimeInfo>;
    sendAnthropicMessage: (request: AnthropicMessageRequest) => Promise<AnthropicMessageResponse>;
    sendPersonaQuery: (request: {
      personaId: string;
      system: string;
      model: string;
      userMessage: string;
      cwd?: string;
      maxTurns?: number;
      houseDay?: number;
    }) => Promise<AnthropicMessageResponse>;
    fetchWeatherSignal: (payload?: { latitude?: number; longitude?: number }) => Promise<WeatherSignalResponse>;
    exportState: (payload: HouseExportPayload) => Promise<HouseExportResponse>;
    loadState: () => Promise<HouseLoadResponse>;
    writeRoomConfig: (room: import("./types").Room) => Promise<RoomConfigWriteResponse>;
    writePersonaConfig: (
      persona: import("./types").Persona
    ) => Promise<{ ok: boolean; path: string; personaId: string }>;
    deletePersonaConfig: (payload: {
      personaId: string;
    }) => Promise<{ ok: boolean; personaId: string }>;
    importExternalMemoryExport: (payload?: { filePath?: string }) => Promise<ExternalMemoryImportResponse>;
    writePersonaMemory: (memory: import("./types").PersonaMemoryEntry) => Promise<PersonaMemoryWriteResponse>;
    writePersonaMemories: (payload: {
      memories: import("./types").PersonaMemoryEntry[];
    }) => Promise<PersonaMemoryWriteManyResponse>;
    listPersonaMemoryFiles: () => Promise<PersonaMemoryFileListResponse>;
    loadPersonaMemoryArchive: () => Promise<PersonaMemoryArchiveLoadResponse>;
    appendHouseEvents: (payload: {
      events: import("./types").HouseEvent[];
    }) => Promise<HouseEventArchiveAppendResponse>;
    loadHouseEventArchive: () => Promise<HouseEventArchiveLoadResponse>;
    appendRelationshipUpdates: (payload: {
      updates: import("./types").RelationshipUpdate[];
    }) => Promise<RelationshipUpdateArchiveAppendResponse>;
    appendRelationshipUpdateRevisions: (payload: {
      updates: import("./types").RelationshipUpdate[];
    }) => Promise<RelationshipUpdateArchiveAppendResponse>;
    loadRelationshipUpdateArchive: () => Promise<RelationshipUpdateArchiveLoadResponse>;
    writeDirectRoom: (room: import("./types").DirectRoom) => Promise<DirectRoomWriteResponse>;
    writeDirectRooms: (payload: {
      rooms: import("./types").DirectRoom[];
    }) => Promise<DirectRoomWriteManyResponse>;
    loadDirectRoomArchive: () => Promise<DirectRoomArchiveLoadResponse>;
    writeRoomConversation: (
      conversation: import("./types").RoomConversation
    ) => Promise<{ ok: boolean; path: string; conversationId: string }>;
    loadRoomConversationArchive: () => Promise<{
      ok: boolean;
      conversations: import("./types").RoomConversation[];
      read: number;
      skipped?: Array<{ file: string; reason: string }>;
      path: string;
    }>;
    createBackup: (payload: { reason?: string }) => Promise<HouseBackupResponse>;
    listBackups: () => Promise<HouseBackupListResponse>;
    restoreLatestBackup: () => Promise<HouseRestoreResponse>;
    restoreBackup: (payload: { backupId: string }) => Promise<HouseRestoreResponse>;
    librarianAppend: (record: import("./types").LibrarianRecord) => Promise<LibrarianAppendResponse>;
    librarianQuery: (payload: {
      query: string;
      limit?: number;
    }) => Promise<{ ok: boolean; query: string; records: import("./types").LibrarianRecord[] }>;
    librarianTombstone: (payload: {
      recordIds?: string[];
      sourceIds?: string[];
      reason?: string;
    }) => Promise<LibrarianTombstoneResponse>;
    librarianCompact: () => Promise<LibrarianCompactResponse>;
    mobileWalkie?: {
      onRequest: (listener: (request: {
        id: string;
        type: "status" | "message" | "transcript";
        payload?: {
          text?: string;
          mode?: "room" | "house";
          targetPersonaId?: string;
        };
      }) => void) => () => void;
      respond: (payload: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }) => void;
    };
  };
}
