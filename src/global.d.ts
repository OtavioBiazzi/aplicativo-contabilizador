import type {
  AppSettings,
  AppSnapshot,
  DataBackupInfo,
  DiagnosticsSnapshot,
  EntryDraft,
  ExportStatus,
  LedgerImportPreview,
  LedgerFolderImportResult,
  LedgerImportResult,
  LedgerEntry,
  ServerState,
  UpdateInstallResult,
  UpdateInfo
} from "./shared/types";
import type { PdvCartItem, PdvCategory, PdvCategoryDraft, PdvCustomer, PdvCustomerDraft, PdvExportFilters, PdvPayable, PdvPayableDraft, PdvPayablePayment, PdvPayment, PdvProduct, PdvProductDraft, PdvProductImportPreview, PdvProductImportResult, PdvProductRemovalResult, PdvReceivable, PdvReceivablePatch, PdvReceivablePayment, PdvSale, PdvSettings, PdvSnapshot, PdvTableStatus, PdvTransferSelection } from "./shared/pdvTypes";

export interface CaixaApi {
  getSnapshot: () => Promise<AppSnapshot>;
  getPdvSnapshot: (salesLimit?: number) => Promise<PdvSnapshot>;
  savePdvSettings: (patch: Partial<PdvSettings>) => Promise<PdvSettings>;
  updatePdvProducts: (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => Promise<void>;
  savePdvCategory: (draft: PdvCategoryDraft) => Promise<PdvCategory>;
  savePdvProduct: (draft: PdvProductDraft) => Promise<PdvProduct>;
  removePdvProduct: (id: string) => Promise<PdvProductRemovalResult>;
  importCoseProducts: () => Promise<PdvProductImportResult>;
  previewCoseProducts: () => Promise<PdvProductImportPreview>;
  removeCoseProducts: () => Promise<number>;
  previewPdvProductsFile: () => Promise<PdvProductImportPreview | null>;
  importPdvProductsFile: (filePath?: string) => Promise<PdvProductImportResult | null>;
  saveDirectSale: (items: PdvCartItem[], discount: number, payments: PdvPayment[], saleType?: PdvSale["type"], operationId?: string) => Promise<PdvSale>;
  openPdvTable: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  setPdvTableStatus: (tableNumber: number, status: PdvTableStatus) => Promise<void>;
  savePdvTableItems: (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => Promise<void>;
  transferPdvTableItems: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
  closePdvTable: (tableNumber: number, payments: PdvPayment[], discount?: number, operationId?: string) => Promise<PdvSale>;
  cancelPdvTable: (tableNumber: number) => Promise<PdvSale | null>;
  savePdvTablePartial: (tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], discount?: number, operationId?: string, observations?: string) => Promise<PdvSale>;
  cancelPdvSale: (id: string) => Promise<void>;
  updatePdvSalePayments: (id: string, payments: PdvPayment[]) => Promise<PdvSale>;
  savePdvCustomer: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  receivePdvReceivable: (id: string, payment: PdvReceivablePayment, operationId?: string) => Promise<PdvReceivable>;
  updatePdvReceivable: (id: string, patch: PdvReceivablePatch) => Promise<PdvReceivable>;
  cancelPdvReceivable: (id: string) => Promise<void>;
  savePdvPayable: (draft: PdvPayableDraft) => Promise<PdvPayable>;
  payPdvPayable: (id: string, payment: PdvPayablePayment, operationId?: string) => Promise<PdvPayable>;
  cancelPdvPayable: (id: string) => Promise<void>;
  printPdvReceipt: (
    sale: PdvSale,
    customer?: PdvCustomer,
    receivable?: PdvReceivable,
    options?: { customerName?: string; customerDocument?: string; action?: "open" | "save" | "print"; printerName?: string; receiptSettings?: PdvSettings }
  ) => Promise<{ ok: boolean; message: string; filePath?: string }>;
  getPdvReceiptPreview: (sale: PdvSale, customer?: PdvCustomer, receivable?: PdvReceivable, customerName?: string, customerDocument?: string, receiptSettings?: PdvSettings) => Promise<string>;
  listPdvPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
  choosePdvReceiptLogo: () => Promise<string>;
  exportPdvSales: (filters?: PdvExportFilters) => Promise<ExportStatus>;
  addEntry: (draft: EntryDraft) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  updateEntry: (id: string, patch: Partial<LedgerEntry>) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  removeEntry: (id: string) => Promise<{ exportStatus: ExportStatus }>;
  deleteEntry: (id: string) => Promise<{ exportStatus: ExportStatus }>;
  duplicateEntry: (id: string) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  cancelEntry: (id: string) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  chooseOutputDirectory: () => Promise<string | null>;
  exportSettings: (settings: AppSettings) => Promise<string | null>;
  importSettings: () => Promise<{ filePath: string; settings: Partial<AppSettings> } | null>;
  previewLedgerImport: (filePath?: string) => Promise<LedgerImportPreview | null>;
  importLedgerFile: (filePath?: string) => Promise<LedgerImportResult | null>;
  importLedgerFolder: (folderPath?: string) => Promise<LedgerFolderImportResult | null>;
  exportNow: () => Promise<ExportStatus>;
  exportTodayRecovery: () => Promise<ExportStatus>;
  exportFilteredReport: (ids: string[], label: string) => Promise<ExportStatus>;
  getDiagnostics: () => Promise<DiagnosticsSnapshot>;
  createDataBackup: (reason?: string) => Promise<DataBackupInfo>;
  restoreDataBackup: (filePath?: string) => Promise<{
    backup: DataBackupInfo;
    safetyBackup: DataBackupInfo;
    exportStatus: ExportStatus;
  } | null>;
  openDataDirectory: () => Promise<string>;
  openOutputDirectory: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateInfo>;
  getAppVersion: () => Promise<string>;
  installUpdate: () => Promise<UpdateInstallResult>;
  onSecondInstance: (listener: () => void) => () => void;
  startServer: (port: number, password: string) => Promise<ServerState>;
  stopServer: () => Promise<ServerState>;
  disconnectDevice: (id: string) => Promise<ServerState>;
  requestRemotePdvReceiptPrint: (
    deviceId: string,
    payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }
  ) => Promise<{ ok: boolean; message: string }>;
  setPinned: (pinned: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) => Promise<boolean>;
  getPinned: () => Promise<boolean>;
  onEntriesChanged: (callback: () => void) => () => void;
  onServerChanged: (callback: (state: ServerState) => void) => () => void;
  onRemoteReceiptPrintResult: (callback: (result: { jobId: string; ok: boolean; message: string; deviceName: string }) => void) => () => void;
  onPinnedChanged: (callback: (pinned: boolean) => void) => () => void;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
  onPdvChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    caixa: CaixaApi;
  }
}
