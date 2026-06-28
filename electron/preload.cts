import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, EntryDraft, LedgerEntry, ServerState } from "../src/shared/types.js";

contextBridge.exposeInMainWorld("caixa", {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  addEntry: (draft: EntryDraft) => ipcRenderer.invoke("entries:add", draft),
  updateEntry: (id: string, patch: Partial<LedgerEntry>) => ipcRenderer.invoke("entries:update", id, patch),
  removeEntry: (id: string) => ipcRenderer.invoke("entries:remove", id),
  duplicateEntry: (id: string) => ipcRenderer.invoke("entries:duplicate", id),
  cancelEntry: (id: string) => ipcRenderer.invoke("entries:cancel", id),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  chooseOutputDirectory: () => ipcRenderer.invoke("settings:chooseOutputDirectory"),
  exportNow: () => ipcRenderer.invoke("export:now"),
  startServer: (port: number, password: string) => ipcRenderer.invoke("server:start", port, password),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  disconnectDevice: (id: string) => ipcRenderer.invoke("server:disconnectDevice", id),
  setPinned: (pinned: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) =>
    ipcRenderer.invoke("window:setPinned", pinned, options),
  getPinned: () => ipcRenderer.invoke("window:getPinned"),
  onEntriesChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("entries:changed", handler);
    return () => ipcRenderer.removeListener("entries:changed", handler);
  },
  onServerChanged: (callback: (state: ServerState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ServerState) => callback(state);
    ipcRenderer.on("server:changed", handler);
    return () => ipcRenderer.removeListener("server:changed", handler);
  }
});

