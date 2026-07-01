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
export type ThemeMode = "light" | "dark" | "auto" | "contrast" | "datacaixa" | "datacaixa-dark" | "italia";
export type FloatingThemeMode = "follow" | ThemeMode;
export type DensityMode = "compact" | "normal" | "comfortable";
export type LayoutMode = "complete" | "compact" | "pinnedBar" | "grid" | "sidePanel";

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
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  viewEntryValues: boolean;
  viewTotals: boolean;
}

export interface FloatingSettings {
  visibleFields: string[];
  opacity: number;
  borderless: boolean;
  lockPosition: boolean;
  theme: FloatingThemeMode;
  syncMoneyWithEntryType: boolean;
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
