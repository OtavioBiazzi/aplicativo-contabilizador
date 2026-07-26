import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, EntryDraft, LedgerEntry, ServerState } from "../src/shared/types.js";
import type { PdvCartItem, PdvCategoryDraft, PdvCustomer, PdvCustomerDraft, PdvExportFilters, PdvPayableDraft, PdvPayablePayment, PdvPayment, PdvProductDraft, PdvReceivable, PdvReceivablePatch, PdvReceivablePayment, PdvSale, PdvSettings, PdvTableStatus, PdvTransferSelection } from "../src/shared/pdvTypes.js";

contextBridge.exposeInMainWorld("caixa", {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  getPdvSnapshot: (salesLimit?: number) => ipcRenderer.invoke("pdv:getSnapshot", salesLimit),
  savePdvSettings: (patch: Partial<PdvSettings>) => ipcRenderer.invoke("pdv:saveSettings", patch),
  updatePdvProducts: (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) =>
    ipcRenderer.invoke("pdv:updateProducts", ids, patch),
  savePdvCategory: (draft: PdvCategoryDraft) => ipcRenderer.invoke("pdv:saveCategory", draft),
  savePdvProduct: (draft: PdvProductDraft) => ipcRenderer.invoke("pdv:saveProduct", draft),
  removePdvProduct: (id: string) => ipcRenderer.invoke("pdv:removeProduct", id),
  importCoseProducts: () => ipcRenderer.invoke("pdv:importCoseProducts"),
  previewCoseProducts: () => ipcRenderer.invoke("pdv:previewCoseProducts"),
  removeCoseProducts: () => ipcRenderer.invoke("pdv:removeCoseProducts"),
  previewPdvProductsFile: () => ipcRenderer.invoke("pdv:previewProductsFile"),
  importPdvProductsFile: (filePath?: string) => ipcRenderer.invoke("pdv:importProductsFile", filePath),
  saveDirectSale: (items: PdvCartItem[], discount: number, payments: PdvPayment[], saleType?: PdvSale["type"], operationId?: string) =>
    ipcRenderer.invoke("pdv:saveDirectSale", { items, discount, payments, saleType, operationId }),
  openPdvTable: (tableNumber: number, people?: number, note?: string) => ipcRenderer.invoke("pdv:openTable", tableNumber, people, note),
  setPdvTableStatus: (tableNumber: number, status: PdvTableStatus) => ipcRenderer.invoke("pdv:setTableStatus", tableNumber, status),
  savePdvTableItems: (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => ipcRenderer.invoke("pdv:saveTableItems", tableNumber, items, subtables),
  transferPdvTableItems: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) =>
    ipcRenderer.invoke("pdv:transferTableItems", sourceTableNumber, targetTableNumber, selections),
  closePdvTable: (tableNumber: number, payments: PdvPayment[], discount?: number, operationId?: string) => ipcRenderer.invoke("pdv:closeTable", tableNumber, payments, discount, operationId),
  cancelPdvTable: (tableNumber: number) => ipcRenderer.invoke("pdv:cancelTable", tableNumber),
  savePdvTablePartial: (tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], discount?: number, operationId?: string, observations?: string) =>
    ipcRenderer.invoke("pdv:saveTablePartial", tableNumber, items, payments, discount, operationId, observations),
  cancelPdvSale: (id: string) => ipcRenderer.invoke("pdv:cancelSale", id),
  updatePdvSalePayments: (id: string, payments: PdvPayment[]) => ipcRenderer.invoke("pdv:updateSalePayments", id, payments),
  savePdvCustomer: (draft: PdvCustomerDraft) => ipcRenderer.invoke("pdv:saveCustomer", draft),
  receivePdvReceivable: (id: string, payment: PdvReceivablePayment, operationId?: string) => ipcRenderer.invoke("pdv:receiveReceivable", id, payment, operationId),
  updatePdvReceivable: (id: string, patch: PdvReceivablePatch) => ipcRenderer.invoke("pdv:updateReceivable", id, patch),
  cancelPdvReceivable: (id: string) => ipcRenderer.invoke("pdv:cancelReceivable", id),
  savePdvPayable: (draft: PdvPayableDraft) => ipcRenderer.invoke("pdv:savePayable", draft),
  payPdvPayable: (id: string, payment: PdvPayablePayment, operationId?: string) => ipcRenderer.invoke("pdv:payPayable", id, payment, operationId),
  cancelPdvPayable: (id: string) => ipcRenderer.invoke("pdv:cancelPayable", id),
  printPdvReceipt: (
    sale: PdvSale,
    customer?: PdvCustomer,
    receivable?: PdvReceivable,
    options?: { customerName?: string; customerDocument?: string; action?: "open" | "save" | "print"; printerName?: string; receiptSettings?: PdvSettings }
  ) => ipcRenderer.invoke("pdv:printReceipt", sale, customer, receivable, options),
  getPdvReceiptPreview: (sale: PdvSale, customer?: PdvCustomer, receivable?: PdvReceivable, customerName?: string, customerDocument?: string, receiptSettings?: PdvSettings) => ipcRenderer.invoke("pdv:receiptPreview", sale, customer, receivable, customerName, customerDocument, receiptSettings),
  listPdvPrinters: () => ipcRenderer.invoke("pdv:listPrinters"),
  choosePdvReceiptLogo: () => ipcRenderer.invoke("pdv:chooseReceiptLogo"),
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
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onSecondInstance: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("app:secondInstance", handler);
    return () => ipcRenderer.removeListener("app:secondInstance", handler);
  },
  startServer: (port: number, password: string) => ipcRenderer.invoke("server:start", port, password),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  disconnectDevice: (id: string) => ipcRenderer.invoke("server:disconnectDevice", id),
  requestRemotePdvReceiptPrint: (
    deviceId: string,
    payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }
  ) => ipcRenderer.invoke("server:printPdvReceipt", deviceId, payload),
  setPinned: (pinned: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) =>
    ipcRenderer.invoke("window:setPinned", pinned, options),
  getPinned: () => ipcRenderer.invoke("window:getPinned"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
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
  onRemoteReceiptPrintResult: (callback: (result: { jobId: string; ok: boolean; message: string; deviceName: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: { jobId: string; ok: boolean; message: string; deviceName: string }) => callback(result);
    ipcRenderer.on("receipt-print:result", handler);
    return () => ipcRenderer.removeListener("receipt-print:result", handler);
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
