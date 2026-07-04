const { contextBridge, ipcRenderer } = require("electron");

const mobileWalkieHandlers = new Set();
ipcRenderer.on("mobile-walkie:request", (_event, request) => {
  for (const listener of mobileWalkieHandlers) {
    listener(request);
  }
});

contextBridge.exposeInMainWorld("houseRuntime", {
  getRuntimeInfo: () => ipcRenderer.invoke("house:getRuntimeInfo"),
  sendAnthropicMessage: (request) => ipcRenderer.invoke("house:sendAnthropicMessage", request),
  sendPersonaQuery: (request) => ipcRenderer.invoke("house:sendPersonaQuery", request),
  fetchWeatherSignal: (payload) => ipcRenderer.invoke("house:fetchWeatherSignal", payload),
  exportState: (payload) => ipcRenderer.invoke("house:exportState", payload),
  loadState: () => ipcRenderer.invoke("house:loadState"),
  writeRoomConfig: (room) => ipcRenderer.invoke("house:writeRoomConfig", room),
  writePersonaConfig: (persona) => ipcRenderer.invoke("house:writePersonaConfig", persona),
  deletePersonaConfig: (payload) => ipcRenderer.invoke("house:deletePersonaConfig", payload),
  importExternalMemoryExport: (payload) => ipcRenderer.invoke("house:importExternalMemoryExport", payload),
  writePersonaMemory: (memory) => ipcRenderer.invoke("house:writePersonaMemory", memory),
  writePersonaMemories: (payload) => ipcRenderer.invoke("house:writePersonaMemories", payload),
  listPersonaMemoryFiles: () => ipcRenderer.invoke("house:listPersonaMemoryFiles"),
  loadPersonaMemoryArchive: () => ipcRenderer.invoke("house:loadPersonaMemoryArchive"),
  appendHouseEvents: (payload) => ipcRenderer.invoke("house:appendHouseEvents", payload),
  loadHouseEventArchive: () => ipcRenderer.invoke("house:loadHouseEventArchive"),
  appendRelationshipUpdates: (payload) => ipcRenderer.invoke("house:appendRelationshipUpdates", payload),
  appendRelationshipUpdateRevisions: (payload) => ipcRenderer.invoke("house:appendRelationshipUpdateRevisions", payload),
  loadRelationshipUpdateArchive: () => ipcRenderer.invoke("house:loadRelationshipUpdateArchive"),
  writeDirectRoom: (room) => ipcRenderer.invoke("house:writeDirectRoom", room),
  writeDirectRooms: (payload) => ipcRenderer.invoke("house:writeDirectRooms", payload),
  loadDirectRoomArchive: () => ipcRenderer.invoke("house:loadDirectRoomArchive"),
  writeRoomConversation: (conversation) => ipcRenderer.invoke("house:writeRoomConversation", conversation),
  loadRoomConversationArchive: () => ipcRenderer.invoke("house:loadRoomConversationArchive"),
  createBackup: (payload) => ipcRenderer.invoke("house:createBackup", payload),
  listBackups: () => ipcRenderer.invoke("house:listBackups"),
  restoreLatestBackup: () => ipcRenderer.invoke("house:restoreLatestBackup"),
  restoreBackup: (payload) => ipcRenderer.invoke("house:restoreBackup", payload),
  librarianAppend: (record) => ipcRenderer.invoke("house:librarianAppend", record),
  librarianQuery: (payload) => ipcRenderer.invoke("house:librarianQuery", payload),
  librarianTombstone: (payload) => ipcRenderer.invoke("house:librarianTombstone", payload),
  librarianCompact: () => ipcRenderer.invoke("house:librarianCompact"),
  mobileWalkie: {
    onRequest: (listener) => {
      mobileWalkieHandlers.add(listener);
      return () => mobileWalkieHandlers.delete(listener);
    },
    respond: (payload) => ipcRenderer.send("mobile-walkie:response", payload)
  },

  hedy: {
    status: () => ipcRenderer.invoke("hedy:status"),
    start: (payload) => ipcRenderer.invoke("hedy:start", payload),
    send: (payload) => ipcRenderer.invoke("hedy:send", payload),
    stop: (payload) => ipcRenderer.invoke("hedy:stop", payload),
    clearSession: (payload) => ipcRenderer.invoke("hedy:clearSession", payload),
    loadHistory: (payload) => ipcRenderer.invoke("hedy:loadHistory", payload),
    onEvent: (personaId, listener) => {
      const channel = `hedy:event:${personaId}`;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  }
});
