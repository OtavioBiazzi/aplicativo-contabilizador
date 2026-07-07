import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, EntryDraft, LedgerEntry, ServerState } from "../src/shared/types.js";
import type { PdvCartItem, PdvCategoryDraft, PdvExportFilters, PdvPayment, PdvProductDraft, PdvSettings, PdvTableStatus } from "../src/shared/pdvTypes.js";

contextBridge.exposeInMainWorld("caixa", {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  getPdvSnapshot: () => ipcRenderer.invoke("pdv:getSnapshot"),
  savePdvSettings: (patch: Partial<PdvSettings>) => ipcRenderer.invoke("pdv:saveSettings", patch),
  updatePdvProducts: (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean }) =>
    ipcRenderer.invoke("pdv:updateProducts", ids, patch),
  savePdvCategory: (draft: PdvCategoryDraft) => ipcRenderer.invoke("pdv:saveCategory", draft),
  savePdvProduct: (draft: PdvProductDraft) => ipcRenderer.invoke("pdv:saveProduct", draft),
  importCoseProducts: () => ipcRenderer.invoke("pdv:importCoseProducts"),
  importPdvProductsFile: () => ipcRenderer.invoke("pdv:importProductsFile"),
  saveDirectSale: (items: PdvCartItem[], discount: number, payments: PdvPayment[]) =>
    ipcRenderer.invoke("pdv:saveDirectSale", { items, discount, payments }),
  openPdvTable: (tableNumber: number, people?: number, note?: string) => ipcRenderer.invoke("pdv:openTable", tableNumber, people, note),
  setPdvTableStatus: (tableNumber: number, status: PdvTableStatus) => ipcRenderer.invoke("pdv:setTableStatus", tableNumber, status),
  savePdvTableItems: (tableNumber: number, items: PdvCartItem[]) => ipcRenderer.invoke("pdv:saveTableItems", tableNumber, items),
  closePdvTable: (tableNumber: number, payments: PdvPayment[], discount?: number) => ipcRenderer.invoke("pdv:closeTable", tableNumber, payments, discount),
  savePdvTablePartial: (tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], discount?: number) =>
    ipcRenderer.invoke("pdv:saveTablePartial", tableNumber, items, payments, discount),
  cancelPdvSale: (id: string) => ipcRenderer.invoke("pdv:cancelSale", id),
  exportPdvSales: (filters?: PdvExportFilters) => ipcRenderer.invoke("pdv:exportSales", filters),
  addEntry: (draft: EntryDraft) => ipcRenderer.invoke("entries:add", draft),
  updateEntry: (id: string, patch: Partial<LedgerEntry>) => ipcRenderer.invoke("entries:update", id, patch),
  removeEntry: (id: string) => ipcRenderer.invoke("entries:remove", id),
  deleteEntry: (id: string) => ipcRenderer.invoke("entries:delete", id),
  duplicateEntry: (id: string) => ipcRenderer.invoke("entries:duplicate", id),
  cancelEntry: (id: string) => ipcRenderer.invoke("entries:cancel", id),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  chooseOutputDirectory: () => ipcRenderer.invoke("settings:chooseOutputDirectory"),
  exportSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:exportConfig", settings),
  importSettings: () => ipcRenderer.invoke("settings:importConfig"),
  previewLedgerImport: (filePath?: string) => ipcRenderer.invoke("entries:previewImportFile", filePath),
  importLedgerFile: (filePath?: string) => ipcRenderer.invoke("entries:importFile", filePath),
  importLedgerFolder: (folderPath?: string) => ipcRenderer.invoke("entries:importFolder", folderPath),
  exportNow: () => ipcRenderer.invoke("export:now"),
  exportTodayRecovery: () => ipcRenderer.invoke("export:today"),
  exportFilteredReport: (ids: string[], label: string) => ipcRenderer.invoke("reports:exportFiltered", ids, label),
  getDiagnostics: () => ipcRenderer.invoke("diagnostics:get"),
  createDataBackup: (reason?: string) => ipcRenderer.invoke("diagnostics:createBackup", reason),
  restoreDataBackup: (filePath?: string) => ipcRenderer.invoke("diagnostics:restoreBackup", filePath),
  openDataDirectory: () => ipcRenderer.invoke("diagnostics:openDataDirectory"),
  openOutputDirectory: () => ipcRenderer.invoke("diagnostics:openOutputDirectory"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
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
  },
  onPinnedChanged: (callback: (pinned: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, pinned: boolean) => callback(pinned);
    ipcRenderer.on("window:pinnedChanged", handler);
    return () => ipcRenderer.removeListener("window:pinnedChanged", handler);
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
  onPdvChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("pdv:changed", handler);
    return () => ipcRenderer.removeListener("pdv:changed", handler);
  }
});
