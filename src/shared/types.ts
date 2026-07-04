/*
 * Shared type declarations for the Contabilizador application.
 *
 * This file mirrors the structure of the upstream `src/shared/types.ts` file
 * but introduces a few additional fields to support new features requested
 * by the application maintainer. The key additions are:
 *
 * - A new permission `allowReports` on `ServerPermissions` which can be
 *   toggled by the server administrator to enable or disable report and
 *   export functionality for connected clients. When set to `false`, the
 *   client UI should hide or disable buttons related to exporting data.
 * - An optional `savedPosition` on `FloatingSettings`. This stores an
 *   `[x, y]` tuple representing the last saved coordinates of the pinned
 *   floating bar. When present, the floating bar should be positioned at
 *   this point on startup. A future UI control should allow users to
 *   reposition the bar and save its position for subsequent sessions.
 *
 * These additions are designed to be backwards compatible with existing
 * installations. Any code consuming these interfaces should guard against
 * missing properties and apply sensible defaults when they are absent.
 */

export type EntryType =
  | "Venda"
  | "Mesa"
  | "Onibus"
  | "Dinheiro/Troco"
  | "Divisao de conta"
  | "Taxa"
  | "Extra"
  | "Cancelado/Estorno"
  | "Personalizado";

export type PaymentMethod =
  | "Nao informado"
  | "Dinheiro"
  | "Pix"
  | "Debito"
  | "Credito"
  | "Voucher"
  | "Misto";

export type RoundDirection = "up" | "down" | "nearest";
export type FileFormat = "xlsx" | "csv";
export type FileStrategy = "daily" | "monthlyTabs" | "fixedAll" | "byType";
export type SpreadsheetMode = "simple" | "advanced";
export type ThemeMode =
  | "light"
  | "dark"
  | "auto"
  | "contrast"
  | "datacaixa"
  | "datacaixa-dark"
  | "italia";
export type FloatingThemeMode = "follow" | ThemeMode;
export type FloatingLayoutMode = "adaptive" | "compact" | "mini";
export type DensityMode = "compact" | "normal" | "comfortable";
export type LayoutMode =
  | "complete"
  | "compact"
  | "pinnedBar"
  | "grid"
  | "sidePanel";
export type ServerAutoConnectionMode = "none" | "server" | "client";

export interface QuickTabSettings {
  id: string;
  label: string;
  enabled: boolean;
  type: EntryType;
  cashLinkedType?: EntryType;
  compact?: boolean;
}

export interface SplitDetails {
  originalValue: number;
  people: number;
  perPersonRaw: number;
  roundingStep: number;
  roundingDirection: RoundDirection;
  perPersonRounded: number;
  finalTotal: number;
  difference: number;
  registerDifference: boolean;
}

export interface CashBreakdownItem {
  label: string;
  value: number;
  quantity: number;
}

export interface CashDetails {
  accountValue: number;
  paidWith: number;
  change: number;
  breakdown: CashBreakdownItem[];
  unrepresentedCents: number;
}

export interface LedgerEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: EntryType;
  originalValue: number;
  finalValue: number;
  people: number;
  perPerson: number;
  roundingStep: number;
  roundingDirection: RoundDirection;
  difference: number;
  description: string;
  tableNumber: string;
  busNumber: string;
  paymentMethod: PaymentMethod;
  paidWith: number;
  change: number;
  observations: string;
  originDevice: string;
  status: "active" | "cancelled" | "deleted";
  customType?: string;
  splitDetails?: SplitDetails;
  cashDetails?: CashDetails;
}

export interface EntryDraft {
  type: EntryType;
  value: number;
  description?: string;
  people?: number;
  tableNumber?: string;
  busNumber?: string;
  paymentMethod?: PaymentMethod;
  paidWith?: number;
  observations?: string;
  customType?: string;
  splitDetails?: SplitDetails;
  cashDetails?: CashDetails;
  originDevice?: string;
}

export interface ServerPermissions {
  /**
   * Whether the connected client can view entries and totals.
   */
  view: boolean;
  /**
   * Whether the client can create new entries.
   */
  create: boolean;
  /**
   * Whether the client can edit existing entries.
   */
  edit: boolean;
  /**
   * Whether the client can delete entries.
   */
  delete: boolean;
  /**
   * Whether the client can see entry values (otherwise only counts are shown).
   */
  viewEntryValues: boolean;
  /**
   * Whether the client can see totals across all entries.
   */
  viewTotals: boolean;
  /**
   * Whether the client may adjust its own settings (colours, columns, etc.).
   */
  allowClientCustomization: boolean;
  /**
   * Whether the client is permitted to generate and download reports (CSV/XLSX).
   * When false, the report generation UI should be hidden or disabled.
   */
  allowReports: boolean;
}

export interface ServerAutoConnectionSettings {
  mode: ServerAutoConnectionMode;
  host: string;
  password: string;
  deviceName: string;
}

export interface RemoteClientPolicy {
  defaultType: EntryType;
  defaultPeople: number;
  defaultRoundingStep: number;
  defaultRoundingDirection: RoundDirection;
  tableNumberEnabled: boolean;
  busNumberEnabled: boolean;
  allowedTypes: EntryType[];
  visibleFields: string[];
  quickTabs: QuickTabSettings[];
  paymentMethods: PaymentMethod[];
  spreadsheetMode: SpreadsheetMode;
  visibleColumns: string[];
}

export interface FloatingSettings {
  visibleFields: string[];
  layoutMode: FloatingLayoutMode;
  opacity: number;
  borderless: boolean;
  lockPosition: boolean;
  dragWholeBar: boolean;
  theme: FloatingThemeMode;
  syncMoneyWithEntryType: boolean;
  /**
   * Optional saved position for the floating bar. If provided, the bar should
   * be repositioned to these coordinates upon mounting. Coordinates are in
   * window pixels relative to the top-left corner of the screen.
   */
  savedPosition?: [number, number];
}

export interface AppSettings {
  outputDirectory: string;
  fileFormat: FileFormat;
  fileStrategy: FileStrategy;
  spreadsheetMode: SpreadsheetMode;
  dateFormat: "yyyy-MM-dd" | "dd-MM-yyyy" | "yyyyMMdd";
  csvSeparator: "," | ";" | "\t";
  currency: "BRL";
  visibleColumns: string[];
  backupEnabled: boolean;
  defaultType: EntryType;
  defaultPeople: number;
  defaultRoundingStep: number;
  defaultRoundingDirection: RoundDirection;
  tableNumberEnabled: boolean;
  busNumberEnabled: boolean;
  theme: ThemeMode;
  accentColor: string;
  fieldSize: "small" | "medium" | "large";
  density: DensityMode;
  layout: LayoutMode;
  profiles: Record<string, Partial<AppSettings>>;
  activeProfile: string;
  privacy: {
    hideHeaderTotal: boolean;
    hideReportTotals: boolean;
  };
  quickTabs: QuickTabSettings[];
  floating: FloatingSettings;
  server: {
    port: number;
    password: string;
    permissions: ServerPermissions;
    autoConnection: ServerAutoConnectionSettings;
  };
  shortcuts: Record<string, string>;
}

export interface DaySummary {
  total: number;
  count: number;
  average: number;
  biggestSale: number;
  busTotal: number;
  cashTotal: number;
  differenceTotal: number;
  byType: Record<string, number>;
  byTable: Record<string, number>;
  byBus: Record<string, number>;
  byPayment: Record<string, number>;
}

export interface ServerDevice {
  id: string;
  name: string;
  ip: string;
  connectedAt: string;
  lastSeen: string;
  permissions: ServerPermissions;
}

export interface ServerState {
  running: boolean;
  port: number;
  url: string;
  ips: string[];
  devices: ServerDevice[];
}

export interface ExportStatus {
  ok: boolean;
  filePath?: string;
  message?: string;
  pendingCount: number;
}

export interface LedgerImportResult {
  filePath: string;
  imported: number;
  skipped: number;
  totalRows: number;
  parsedRows: number;
  warnings: string[];
  exportStatus: ExportStatus;
}

export interface LedgerFolderImportResult {
  folderPath: string;
  filesScanned: number;
  filesImported: number;
  imported: number;
  skipped: number;
  totalRows: number;
  parsedRows: number;
  warnings: string[];
  exportStatus: ExportStatus;
}

export interface LedgerImportPreviewItem {
  id: string;
  createdAt: string;
  type: EntryType;
  description: string;
  finalValue: number;
  paymentMethod: PaymentMethod;
  status: LedgerEntry["status"];
  tableNumber: string;
  busNumber: string;
  duplicate: boolean;
}

export interface LedgerImportPreview {
  filePath: string;
  fileName: string;
  totalRows: number;
  parsedRows: number;
  ignoredRows: number;
  newRows: number;
  duplicateRows: number;
  warnings: string[];
  sample: LedgerImportPreviewItem[];
}

export interface DataBackupInfo {
  filePath: string;
  fileName: string;
  createdAt: string;
  reason: string;
  size: number;
  entryCount: number;
}

export interface DiagnosticLogItem {
  id: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export interface DiagnosticsSnapshot {
  dataDirectory: string;
  outputDirectory: string;
  exportStatus: ExportStatus;
  entryCount: number;
  backupCount: number;
  backups: DataBackupInfo[];
  logs: DiagnosticLogItem[];
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  checkedAt: string;
  downloadUrl?: string;
  assetName?: string;
  message?: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  message: string;
  latestVersion?: string;
  filePath?: string;
}

export interface AppSnapshot {
  entries: LedgerEntry[];
  settings: AppSettings;
  server: ServerState;
  exportStatus: ExportStatus;
}