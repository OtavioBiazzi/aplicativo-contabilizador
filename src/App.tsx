import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronDown,
  Check,
  Copy,
  DatabaseBackup,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FolderOpen,
  History,
  Gauge,
  KeyRound,
  Laptop,
  LayoutGrid,
  LayoutPanelTop,
  ListFilter,
  MinusCircle,
  Minus,
  MonitorUp,
  Palette,
  Pin,
  PlugZap,
  Plus,
  RadioTower,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  Upload,
  Users,
  Utensils,
  Wallet,
  TriangleAlert,
  Wifi,
  X
} from "lucide-react";
import { ENTRY_TYPES, PAYMENT_METHODS, DEFAULT_COLUMNS, SIMPLE_COLUMNS, DEFAULT_FLOATING_FIELDS, DEFAULT_QUICK_TABS, createDefaultSettings } from "./shared/defaults";
import { PaymentAmountModal, PdvApp } from "./PdvApp";
import type { PdvAdvancedSection, PdvAdvancedSettingsActions } from "./PdvApp";
import type { PdvCustomer, PdvPayable, PdvPayableDraft, PdvPayablePayment, PdvPayment, PdvPaymentMethod, PdvReceivable, PdvSale, PdvSettings, PdvSnapshot } from "./shared/pdvTypes";
import { readReceiptPrintDestination, saveReceiptPrintDestination, type ReceiptPrintTarget } from "./shared/receiptPrintPreference";
import { downloadFinancialCsv } from "./shared/financialExport";
import {
  buildReportDataset,
  createReportRecords,
  filterReportRecords,
  type ReportDataset,
  type ReportProductSummary
} from "./shared/reporting";
import {
  calculateCash,
  calculateSplit,
  filterEntriesByLocalDate,
  formatCurrency,
  formatDateTime,
  getEntryAmount,
  getLocalDateKey,
  parseMoney,
  ROUNDING_STEPS,
  roundMoney,
  summarizeEntries
} from "./shared/calculations";
import type {
  AppSettings,
  DaySummary,
  DiagnosticsSnapshot,
  EntryDraft,
  EntryType,
  ExportStatus,
  LedgerEntry,
  LedgerImportPreview,
  PaymentMethod,
  QuickTabSettings,
  RemoteClientPolicy,
  RoundDirection,
  ServerDevice,
  ServerPermissions,
  ServerState,
  UpdateInfo
} from "./shared/types";

type TabKey = "sale" | "tables" | "history" | "dashboard" | "clients" | "receivables" | "payables" | "reports" | "server" | "settings";
type SettingsCategory =
  | "appearance"
  | "operation"
  | "defaults"
  | "profiles"
  | "floating"
  | "quick"
  | "files"
  | "pdv"
  | "pdvTables"
  | "pdvOperation"
  | "printing"
  | "privacy"
  | "server"
  | "shortcuts"
  | "updates"
  | "advanced";
type ServerPanelMode = "create" | "connect" | "permissions";

interface RemoteEntriesResponse {
  entries: LedgerEntry[];
  summary: DaySummary | null;
  todayCount?: number;
  totalCount?: number;
  limited?: boolean;
  permissions: ServerPermissions;
  clientPolicy: RemoteClientPolicy;
}

interface RemoteClientSession {
  baseUrl: string;
  password: string;
  deviceName: string;
  appVersion: string;
  entries: LedgerEntry[];
  summary: DaySummary | null;
  todayCount?: number;
  totalCount?: number;
  limited?: boolean;
  permissions: ServerPermissions;
  clientPolicy: RemoteClientPolicy;
  connectedAt: string;
}

interface RemoteSessionStoragePayload {
  baseUrl: string;
  password: string;
  deviceName: string;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !sourceSignal?.aborted) {
      throw new Error("O servidor nao respondeu dentro do tempo esperado. A conexao sera restabelecida automaticamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

function addMonthsClamped(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return getLocalDateKey(target);
}

interface VersionMismatchState {
  clientVersion: string;
  serverVersion: string;
  serverIsNewer: boolean;
}

class RemoteVersionMismatchError extends Error {
  constructor(public readonly mismatch: VersionMismatchState) {
    super(`Versao diferente: este computador usa ${mismatch.clientVersion} e o servidor usa ${mismatch.serverVersion}.`);
    this.name = "RemoteVersionMismatchError";
  }
}

interface ReportFocusPeriod {
  from: string;
  to: string;
  nonce: number;
}

interface HistoryFocusDate {
  date: string;
  nonce: number;
}

interface ToastState {
  tone: "success" | "error" | "info";
  message: string;
}

interface ModeCommand {
  type: EntryType;
  nonce: number;
}

interface QuickEntryModeState {
  type: EntryType;
  cashLinkedType: EntryType;
  activeQuickTabId: string;
}

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: typeof Send }> = [
  { key: "sale", label: "Venda", icon: Send },
  { key: "tables", label: "Mesas", icon: LayoutPanelTop },
  { key: "history", label: "Historico", icon: History },
  { key: "dashboard", label: "Visao geral", icon: Gauge },
  { key: "clients", label: "Clientes", icon: Users },
  { key: "receivables", label: "Contas a receber", icon: ReceiptText },
  { key: "payables", label: "Contas a pagar", icon: Wallet },
  { key: "reports", label: "Relatorios", icon: BarChart3 },
  { key: "server", label: "Rede", icon: Server },
  { key: "settings", label: "Ajustes", icon: Settings }
];

const DEFAULT_HEADER_PINNED_MODULES: TabKey[] = ["sale", "tables", "history"];
const HEADER_PINNABLE_MODULES: TabKey[] = ["sale", "tables", "history", "dashboard", "clients", "receivables", "payables", "reports", "server", "settings"];

function normalizeHeaderPinnedModules(value?: string[]): TabKey[] {
  if (!Array.isArray(value)) {
    return DEFAULT_HEADER_PINNED_MODULES;
  }
  const valid = new Set<TabKey>(HEADER_PINNABLE_MODULES);
  return [...new Set((value || []).filter((key): key is TabKey => valid.has(key as TabKey)))];
}
const MODULE_GROUPS: Array<{
  label: string;
  items: Array<{
    key: TabKey;
    label: string;
    description: string;
    icon: typeof Send;
    comingSoon?: boolean;
  }>;
}> = [
  {
    label: "Operacao",
    items: [
      { key: "sale", label: "Venda", description: "Venda direta e lancamento rapido de produtos", icon: Send },
      { key: "tables", label: "Mesas", description: "Mapa de mesas, submesas e comandas", icon: LayoutPanelTop },
      { key: "history", label: "Historico", description: "Vendas, pagamentos e recibos anteriores", icon: History }
    ]
  },
  {
    label: "Financeiro",
    items: [
      { key: "clients", label: "Clientes", description: "Cadastro, historico e contas vinculadas aos clientes", icon: Users },
      { key: "receivables", label: "Contas a receber", description: "Pendencias, recebimentos, vencimentos e historico", icon: ReceiptText },
      { key: "payables", label: "Contas a pagar", description: "Fornecedores, despesas, pagamentos e historico", icon: Wallet }
    ]
  },
  {
    label: "Analise",
    items: [
      { key: "dashboard", label: "Visao geral", description: "Vendas, mesas, estoque e alertas do dia", icon: Gauge },
      { key: "reports", label: "Relatorios", description: "Resultados, produtos e formas de pagamento", icon: BarChart3 }
    ]
  },
  {
    label: "Sistema",
    items: [
      { key: "server", label: "Rede", description: "Servidor, clientes e sincronizacao", icon: Server },
      { key: "settings", label: "Ajustes", description: "Preferencias gerais e operacao do PDV", icon: Settings }
    ]
  }
];

const IS_FLOATING_WINDOW = new URLSearchParams(window.location.search).get("floating") === "1";
const CDA_ICON_SRC = "/cda-icon.png";
const REMOTE_SESSION_STORAGE_KEY = "caixaRemoteSession";
const DAILY_UPDATE_CHECK_KEY = "caixa.update.last-check-date.v1";
const QUICK_ENTRY_MODE_STORAGE_PREFIX = "caixaQuickEntryMode";
const HISTORY_FILTERS_STORAGE_KEY = "caixaHistoryFiltersV2";
const REMOTE_ENTRY_LIMIT = 0;
const HISTORY_PAGE_SIZE = 160;

interface StoredHistoryFilters {
  query: string;
  type: string;
  statusFilter: string;
  paymentFilter: string;
  dateFrom: string;
  dateTo: string;
  minimumValue: string;
  maximumValue: string;
  originFilter: string;
  movementFilter: string;
}

interface RemoteSocketMessage {
  type?: string;
  jobId?: string;
  sale?: PdvSale;
  customer?: PdvCustomer;
  receivable?: PdvReceivable;
  customerName?: string;
  customerDocument?: string;
  receiptSettings?: PdvSettings;
}

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function loadHistoryFilters(rememberPeriod = false): StoredHistoryFilters {
  const defaults: StoredHistoryFilters = {
    query: "",
    type: "Todos",
    statusFilter: "todos",
    paymentFilter: "Todos",
    dateFrom: "",
    dateTo: "",
    minimumValue: "",
    maximumValue: "",
    originFilter: "Todos",
    movementFilter: "Todos"
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem(HISTORY_FILTERS_STORAGE_KEY) || "{}") as Partial<StoredHistoryFilters>;
    const merged = { ...defaults, ...stored };
    if (merged.statusFilter === "visiveis") merged.statusFilter = "todos";
    return rememberPeriod ? merged : { ...merged, dateFrom: "", dateTo: "" };
  } catch {
    return defaults;
  }
}

function parseOptionalHistoryValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = parseMoney(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHistorySearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function displayOriginDevice(value?: string): string {
  return !value || value === "Este computador" || value === "PDV local" ? "Servidor" : value;
}

const CASH_LINKED_TYPES: Array<{ value: EntryType; label: string }> = [
  { value: "Mesa", label: "Mesa" },
  { value: "Venda", label: "Balcao/Venda" },
  { value: "Onibus", label: "Onibus" },
  { value: "Extra", label: "Extra" },
  { value: "Personalizado", label: "Personalizado" }
];

const FLOATING_FIELD_OPTIONS = [
  { id: "tabs", label: "Abas rapidas", helper: "Conta, Dinheiro, Mesa, Onibus..." },
  { id: "mode", label: "Trocar Conta/Dinheiro", helper: "Botao lateral de alternancia." },
  { id: "type", label: "Tipo ou vinculo", helper: "Seletor de tipo e vincular dinheiro." },
  { id: "people", label: "Pessoas", helper: "Divisao rapida da conta." },
  { id: "tableNumber", label: "Mesa", helper: "Campo curto para numero da mesa." },
  { id: "busNumber", label: "Onibus", helper: "Campo curto para numero do onibus." },
  { id: "paymentMethod", label: "Pagamento", helper: "Pix, debito, credito ou voucher." },
  { id: "description", label: "Descricao", helper: "Campo opcional para observacao." },
  { id: "paidWith", label: "Pago com", helper: "Valor recebido no modo dinheiro." },
  { id: "result", label: "Troco/por pessoa", helper: "Resultado calculado na barra." },
  { id: "submit", label: "Botao enviar", helper: "Tambem da para enviar com Enter." }
];

const FLOATING_FIELD_IDS = new Set(["value", ...FLOATING_FIELD_OPTIONS.map((field) => field.id)]);

const SHORTCUT_ORDER = [
  "submit",
  "submitAndClear",
  "money",
  "table",
  "bus",
  "history",
  "settings",
  "repeatLast",
  "escape"
] as const;

type ShortcutAction = (typeof SHORTCUT_ORDER)[number];

const GLOBAL_SHORTCUT_ACTIONS: ShortcutAction[] = ["money", "table", "bus", "history", "settings", "repeatLast"];

const SHORTCUT_HELPERS: Record<ShortcutAction, string> = {
  submit: "Envia o formulario atual quando estiver no caixa.",
  submitAndClear: "Envia e limpa os campos do caixa rapido.",
  money: "Troca para Dinheiro/Troco sem sair do fluxo.",
  table: "Troca para modo Mesa.",
  bus: "Troca para modo Onibus.",
  history: "Abre o historico do dia.",
  settings: "Abre a tela de ajustes.",
  repeatLast: "Duplica o ultimo lancamento ativo.",
  escape: "Limpa o formulario atual."
};

type FloatingPresetId = "cashier" | "table" | "bus" | "money" | "minimal";

interface FloatingPreset {
  id: FloatingPresetId;
  label: string;
  title: string;
  description: string;
  defaultType: EntryType;
  fields: string[];
  quickTabs: QuickTabSettings[];
  borderless?: boolean;
  layoutMode?: AppSettings["floating"]["layoutMode"];
}

const FLOATING_PRESETS: FloatingPreset[] = [
  {
    id: "cashier",
    label: "Caixa",
    title: "Caixa completo",
    description: "Conta, dinheiro, mesa, onibus e divisao sempre ao alcance.",
    defaultType: "Venda",
    fields: DEFAULT_FLOATING_FIELDS,
    quickTabs: DEFAULT_QUICK_TABS,
    borderless: true
  },
  {
    id: "table",
    label: "Mesa",
    title: "Mesa rapida",
    description: "Valor, mesa, pessoas e dinheiro vinculado a mesa.",
    defaultType: "Mesa",
    fields: ["tabs", "mode", "value", "people", "tableNumber", "description", "paidWith", "result", "submit"],
    quickTabs: [
      { id: "table", label: "Mesa", enabled: true, type: "Mesa" },
      { id: "money", label: "Dinheiro", enabled: true, type: "Dinheiro/Troco", cashLinkedType: "Mesa" },
      { id: "account", label: "Venda", enabled: true, type: "Venda" },
      { id: "bus", label: "Onibus", enabled: false, type: "Onibus" },
      { id: "minimal", label: "Minimo", enabled: false, type: "Venda", compact: true },
      { id: "custom", label: "Extra", enabled: false, type: "Personalizado" }
    ],
    borderless: true,
    layoutMode: "compact"
  },
  {
    id: "bus",
    label: "Onibus",
    title: "Onibus enxuto",
    description: "So o necessario: modo, valor, numero do onibus, pago com e enviar.",
    defaultType: "Onibus",
    fields: ["tabs", "mode", "value", "busNumber", "paidWith", "result", "submit"],
    quickTabs: [
      { id: "bus", label: "Onibus", enabled: true, type: "Onibus" },
      { id: "money", label: "Dinheiro", enabled: true, type: "Dinheiro/Troco", cashLinkedType: "Onibus" },
      { id: "account", label: "Venda", enabled: true, type: "Venda" },
      { id: "table", label: "Mesa", enabled: false, type: "Mesa" },
      { id: "minimal", label: "Minimo", enabled: false, type: "Venda", compact: true },
      { id: "custom", label: "Extra", enabled: false, type: "Personalizado" }
    ],
    borderless: true,
    layoutMode: "compact"
  },
  {
    id: "money",
    label: "Dinheiro",
    title: "Dinheiro e troco",
    description: "Conta, pago com, troco grande e vinculo Mesa ou Onibus.",
    defaultType: "Dinheiro/Troco",
    fields: ["tabs", "mode", "type", "value", "tableNumber", "busNumber", "paidWith", "description", "result", "submit"],
    quickTabs: [
      { id: "money", label: "Dinheiro", enabled: true, type: "Dinheiro/Troco", cashLinkedType: "Mesa" },
      { id: "table", label: "Mesa", enabled: true, type: "Mesa" },
      { id: "bus", label: "Onibus", enabled: true, type: "Onibus" },
      { id: "account", label: "Venda", enabled: true, type: "Venda" },
      { id: "minimal", label: "Minimo", enabled: false, type: "Venda", compact: true },
      { id: "custom", label: "Extra", enabled: false, type: "Personalizado" }
    ],
    borderless: true,
    layoutMode: "compact"
  },
  {
    id: "minimal",
    label: "Minimo",
    title: "Minimalista",
    description: "Barra bem pequena para registrar venda sem distracao.",
    defaultType: "Venda",
    fields: ["mode", "value", "submit"],
    quickTabs: [
      { id: "account", label: "Venda", enabled: true, type: "Venda", compact: true },
      { id: "money", label: "Dinheiro", enabled: true, type: "Dinheiro/Troco", cashLinkedType: "Venda", compact: true },
      { id: "table", label: "Mesa", enabled: false, type: "Mesa" },
      { id: "bus", label: "Onibus", enabled: false, type: "Onibus" },
      { id: "minimal", label: "Minimo", enabled: false, type: "Venda", compact: true },
      { id: "custom", label: "Extra", enabled: false, type: "Personalizado" }
    ],
    borderless: true,
    layoutMode: "mini"
  }
];

const CASH_LINKABLE_TYPES = CASH_LINKED_TYPES.map((item) => item.value);

function cashLinkFromEntryType(type: EntryType, fallback: EntryType = "Mesa"): EntryType {
  return CASH_LINKABLE_TYPES.includes(type) ? type : fallback;
}

function entryTypeFromCashLink(type: EntryType): EntryType {
  return CASH_LINKABLE_TYPES.includes(type) ? type : "Venda";
}

function enabledQuickTabs(settings: Pick<AppSettings, "quickTabs">): QuickTabSettings[] {
  return (settings.quickTabs.length ? settings.quickTabs : DEFAULT_QUICK_TABS).filter((tab) => tab.enabled);
}

function quickTabForType(tabs: QuickTabSettings[], type: EntryType): QuickTabSettings | undefined {
  return tabs.find((tab) => tab.type === type && !tab.compact) || tabs.find((tab) => tab.type === type) || tabs[0];
}

function defaultCashLinkForAllowedTypes(allowedTypes: EntryType[], fallback: EntryType = "Mesa"): EntryType {
  if (CASH_LINKABLE_TYPES.includes(fallback) && allowedTypes.includes(fallback)) {
    return fallback;
  }
  return CASH_LINKABLE_TYPES.find((item) => allowedTypes.includes(item)) || "Venda";
}

function quickEntryModeStorageKey(scope: string): string {
  return `${QUICK_ENTRY_MODE_STORAGE_PREFIX}:${scope}`;
}

function readQuickEntryModeState(scope?: string): Partial<QuickEntryModeState> | null {
  if (!scope) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(quickEntryModeStorageKey(scope));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<QuickEntryModeState>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeQuickEntryModeState(scope: string | undefined, state: QuickEntryModeState): void {
  if (!scope) {
    return;
  }
  try {
    window.localStorage.setItem(quickEntryModeStorageKey(scope), JSON.stringify(state));
  } catch {
    // LocalStorage pode falhar em modo restrito; o app continua usando o estado em memoria.
  }
}

function sanitizeQuickEntryModeState(
  state: Partial<QuickEntryModeState> | null | undefined,
  settings: AppSettings,
  clientPolicy: RemoteClientPolicy | undefined,
  allowedTypes: EntryType[],
  quickTabs: QuickTabSettings[]
): QuickEntryModeState {
  const fallbackType = allowedTypes.includes(clientPolicy?.defaultType || settings.defaultType)
    ? clientPolicy?.defaultType || settings.defaultType
    : allowedTypes[0] || "Venda";
  const type = state?.type && allowedTypes.includes(state.type) ? state.type : fallbackType;
  const matchingTab = quickTabForType(quickTabs, type);
  const activeQuickTabId =
    state?.activeQuickTabId && quickTabs.some((tab) => tab.id === state.activeQuickTabId)
      ? state.activeQuickTabId
      : matchingTab?.id || "manual";
  const cashFallback = matchingTab?.cashLinkedType || quickTabForType(enabledQuickTabs(settings), settings.defaultType)?.cashLinkedType || "Mesa";
  const cashLinkedType =
    state?.cashLinkedType && CASH_LINKABLE_TYPES.includes(state.cashLinkedType) && allowedTypes.includes(state.cashLinkedType)
      ? state.cashLinkedType
      : defaultCashLinkForAllowedTypes(allowedTypes, cashFallback);

  return { type, cashLinkedType, activeQuickTabId };
}

function quickEntryStorageScopeForSession(session: RemoteClientSession | null): string {
  return session ? `remote:${session.baseUrl}:${session.deviceName}` : "local";
}

function readStoredRemoteSession(): RemoteSessionStoragePayload | null {
  try {
    const raw = window.localStorage.getItem(REMOTE_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RemoteSessionStoragePayload>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.password !== "string" ||
      typeof parsed.deviceName !== "string"
    ) {
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      password: parsed.password,
      deviceName: parsed.deviceName
    };
  } catch {
    return null;
  }
}

function writeStoredRemoteSession(session: RemoteSessionStoragePayload | null) {
  try {
    if (!session) {
      window.localStorage.removeItem(REMOTE_SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(REMOTE_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // O modo fixado precisa funcionar mesmo se o storage estiver indisponivel.
  }
}

function privateSummaryForCount(count: number): DaySummary {
  return {
    ...summarizeEntries([]),
    count
  };
}

function resolveTheme(theme: AppSettings["theme"], _prefersDark: boolean): Exclude<AppSettings["theme"], "auto"> {
  return theme === "dark" || theme === "datacaixa-dark" ? "dark" : "datacaixa";
}

function resolveFloatingTheme(settings: AppSettings, prefersDark: boolean): Exclude<AppSettings["theme"], "auto"> {
  const floatingTheme = settings.floating.theme || "follow";
  return floatingTheme === "follow" ? resolveTheme(settings.theme, prefersDark) : resolveTheme(floatingTheme, prefersDark);
}

function themeDefaultAccent(theme: AppSettings["theme"]) {
  const map: Record<AppSettings["theme"], string> = {
    light: "#0565b7",
    dark: "#2f8cff",
    auto: "#0565b7",
    contrast: "#00ff66",
    datacaixa: "#0565b7",
    "datacaixa-dark": "#2f8cff",
    italia: "#168a56"
  };
  return map[theme];
}

function normalizeShortcutKey(key: string): string {
  const map: Record<string, string> = {
    " ": "Space",
    Spacebar: "Space",
    Escape: "Esc",
    Esc: "Esc",
    Del: "Delete",
    Plus: "+",
    Add: "+"
  };
  if (map[key]) {
    return map[key];
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  const key = normalizeShortcutKey(event.key);
  if (["Control", "Ctrl", "Alt", "Shift", "Meta"].includes(key)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
}

function normalizeShortcutValue(value?: string): string {
  if (!value?.trim()) {
    return "";
  }
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  const keys: string[] = [];
  for (const part of parts) {
    const normalized = normalizeShortcutKey(part);
    const lower = normalized.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "command" || lower === "meta") {
      modifiers.add("Ctrl");
    } else if (lower === "alt" || lower === "option") {
      modifiers.add("Alt");
    } else if (lower === "shift") {
      modifiers.add("Shift");
    } else {
      keys.push(normalized);
    }
  }
  const key = keys.at(-1);
  if (!key) {
    return "";
  }
  return ["Ctrl", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+").toLowerCase();
}

function shortcutMatchesEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  shortcut?: string
): boolean {
  const normalizedShortcut = normalizeShortcutValue(shortcut);
  if (!normalizedShortcut) {
    return false;
  }
  const eventShortcut = shortcutFromKeyboardEvent(event);
  return Boolean(eventShortcut && normalizeShortcutValue(eventShortcut) === normalizedShortcut);
}

function shortcutActionForEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  shortcuts: Record<string, string>,
  actions: ShortcutAction[]
): ShortcutAction | null {
  return actions.find((action) => shortcutMatchesEvent(event, shortcuts[action])) || null;
}

function createSettingsFallback(settings: AppSettings): AppSettings {
  return createDefaultSettings(settings.outputDirectory);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createProfileSnapshot(settings: AppSettings): Partial<AppSettings> {
  return {
    theme: settings.theme,
    accentColor: settings.accentColor,
    fieldSize: settings.fieldSize,
    density: settings.density,
    layout: settings.layout,
    headerPinnedModules: cloneValue(settings.headerPinnedModules),
    defaultType: settings.defaultType,
    defaultPeople: settings.defaultPeople,
    defaultRoundingStep: settings.defaultRoundingStep,
    defaultRoundingDirection: settings.defaultRoundingDirection,
    tableNumberEnabled: settings.tableNumberEnabled,
    busNumberEnabled: settings.busNumberEnabled,
    privacy: cloneValue(settings.privacy),
    floating: cloneValue(settings.floating),
    quickTabs: cloneValue(settings.quickTabs),
    shortcuts: cloneValue(settings.shortcuts)
  };
}

function profilePatch(profile?: Partial<AppSettings>): Partial<AppSettings> {
  if (!profile) {
    return {};
  }
  const patch: Partial<AppSettings> = {};
  const keys: Array<keyof AppSettings> = [
    "theme",
    "accentColor",
    "fieldSize",
    "density",
    "layout",
    "headerPinnedModules",
    "defaultType",
    "defaultPeople",
    "defaultRoundingStep",
    "defaultRoundingDirection",
    "tableNumberEnabled",
    "busNumberEnabled",
    "privacy",
    "floating",
    "quickTabs",
    "shortcuts"
  ];
  keys.forEach((key) => {
    if (profile[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = cloneValue(profile[key]);
    }
  });
  return patch;
}

function mergeProfileSettings(
  defaults: Record<string, Partial<AppSettings>>,
  current?: Record<string, Partial<AppSettings>>,
  patch?: Record<string, Partial<AppSettings>>
): Record<string, Partial<AppSettings>> {
  const names = new Set([...Object.keys(defaults), ...Object.keys(current || {}), ...Object.keys(patch || {})]);
  const merged: Record<string, Partial<AppSettings>> = {};
  const fallbackSettings = createDefaultSettings("");
  names.forEach((name) => {
    const base = defaults[name] || {};
    const saved = current?.[name] || {};
    const next = patch?.[name] || {};
    const profile: Partial<AppSettings> = {
      ...base,
      ...saved,
      ...next,
      privacy: {
        ...fallbackSettings.privacy,
        ...base.privacy,
        ...saved.privacy,
        ...next.privacy
      },
      shortcuts: {
        ...fallbackSettings.shortcuts,
        ...base.shortcuts,
        ...saved.shortcuts,
        ...next.shortcuts
      },
      quickTabs: next.quickTabs?.length
        ? cloneValue(next.quickTabs)
        : saved.quickTabs?.length
          ? cloneValue(saved.quickTabs)
          : base.quickTabs?.length
            ? cloneValue(base.quickTabs)
            : undefined
    };
    if (base.floating || saved.floating || next.floating) {
      profile.floating = {
        ...fallbackSettings.floating,
        ...base.floating,
        ...saved.floating,
        ...next.floating,
        visibleFields: normalizeFloatingFields(next.floating?.visibleFields || saved.floating?.visibleFields || base.floating?.visibleFields)
      };
    }
    if (name === "Perfil tela pequena" && profile.theme === "datacaixa-dark" && profile.layout === "sidePanel") {
      profile.theme = "datacaixa";
      profile.layout = "compact";
      profile.floating = {
        ...fallbackSettings.floating,
        ...profile.floating,
        visibleFields: normalizeFloatingFields(["mode", "value", "tableNumber", "busNumber", "paidWith", "submit"]),
        layoutMode: "mini",
        dragWholeBar: true
      };
    }
    merged[name] = profile;
  });
  return merged;
}

function normalizeSettingsDraft(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const defaults = createSettingsFallback(current);
  const merged: AppSettings = {
    ...defaults,
    ...current,
    ...patch,
    floating: {
      ...defaults.floating,
      ...current.floating,
      ...patch.floating
    },
    server: {
      ...defaults.server,
      ...current.server,
      ...patch.server,
      autoConnection: {
        ...defaults.server.autoConnection,
        ...current.server.autoConnection,
        ...patch.server?.autoConnection
      },
      permissions: {
        ...defaults.server.permissions,
        ...current.server.permissions,
        ...patch.server?.permissions
      }
    },
    privacy: {
      ...defaults.privacy,
      ...current.privacy,
      ...patch.privacy
    },
    shortcuts: {
      ...defaults.shortcuts,
      ...current.shortcuts,
      ...patch.shortcuts
    },
    profiles: {
      ...mergeProfileSettings(defaults.profiles, current.profiles, patch.profiles)
    },
    quickTabs: patch.quickTabs?.length
      ? cloneValue(patch.quickTabs)
      : current.quickTabs?.length
        ? cloneValue(current.quickTabs)
        : cloneValue(defaults.quickTabs)
  };
  merged.headerPinnedModules = normalizeHeaderPinnedModules(merged.headerPinnedModules);
  return {
    ...merged,
    visibleColumns: merged.spreadsheetMode === "simple" ? SIMPLE_COLUMNS : merged.visibleColumns,
    floating: {
      ...merged.floating,
      visibleFields: normalizeFloatingFields(merged.floating.visibleFields)
    }
  };
}

function normalizeFloatingFields(fields?: string[]): string[] {
  if (!Array.isArray(fields) || !fields.length) {
    return [...DEFAULT_FLOATING_FIELDS];
  }

  const legacyFields = ["type", "value", "people", "description", "submit"];
  const isLegacyDefault = fields.length === legacyFields.length && legacyFields.every((field) => fields.includes(field));
  if (isLegacyDefault) {
    return [...DEFAULT_FLOATING_FIELDS];
  }

  const normalizedFields = fields
    .filter((field) => typeof field === "string")
    .flatMap((field) => (field === "detail" ? ["tableNumber", "busNumber"] : [field]))
    .filter((field) => FLOATING_FIELD_IDS.has(field));
  const next = [...new Set(normalizedFields)];
  return next.includes("value") ? next : ["value", ...next];
}

function clientPolicyFromSettings(settings: AppSettings): RemoteClientPolicy {
  const quickTabs = enabledQuickTabs(settings);
  const allowed = new Set<EntryType>();
  allowed.add(settings.defaultType);
  quickTabs.forEach((tab) => {
    allowed.add(tab.type);
    if (tab.cashLinkedType) {
      allowed.add(tab.cashLinkedType);
    }
  });
  if (settings.tableNumberEnabled === false) {
    allowed.delete("Mesa");
  }
  if (settings.busNumberEnabled === false) {
    allowed.delete("Onibus");
  }
  if (!allowed.size) {
    allowed.add("Venda");
  }
  const allowedTypes = [...allowed];
  const defaultType = allowedTypes.includes(settings.defaultType) ? settings.defaultType : allowedTypes[0] || "Venda";
  const filteredFields = normalizeFloatingFields(settings.floating.visibleFields).filter((field) => {
    if (field === "tableNumber") {
      return settings.tableNumberEnabled !== false;
    }
    if (field === "busNumber") {
      return settings.busNumberEnabled !== false;
    }
    return true;
  });
  const visibleFields = filteredFields.includes("submit") ? filteredFields : [...filteredFields, "submit"];

  return {
    operationMode: settings.operationMode,
    defaultType,
    defaultPeople: Math.max(1, Math.floor(settings.defaultPeople || 1)),
    defaultRoundingStep: settings.defaultRoundingStep,
    defaultRoundingDirection: settings.defaultRoundingDirection,
    tableNumberEnabled: settings.tableNumberEnabled !== false,
    busNumberEnabled: settings.busNumberEnabled !== false,
    allowedTypes,
    visibleFields,
    quickTabs: quickTabs.filter((tab) => allowedTypes.includes(tab.type)),
    paymentMethods: PAYMENT_METHODS,
    spreadsheetMode: settings.spreadsheetMode,
    visibleColumns: settings.visibleColumns
  };
}

function normalizeRemotePolicy(policy: RemoteClientPolicy | undefined, settings: AppSettings): RemoteClientPolicy {
  const fallback = clientPolicyFromSettings(settings);
  if (!policy) {
    return fallback;
  }
  const allowedTypes = (policy.allowedTypes?.length ? policy.allowedTypes : fallback.allowedTypes).filter((type): type is EntryType => ENTRY_TYPES.includes(type));
  const safeAllowedTypes: EntryType[] = allowedTypes.length ? allowedTypes : ["Venda"];
  return {
    ...fallback,
    ...policy,
    operationMode: policy.operationMode === "legacy" ? "legacy" : "pdv",
    defaultType: safeAllowedTypes.includes(policy.defaultType) ? policy.defaultType : safeAllowedTypes[0],
    defaultPeople: Math.max(1, Math.floor(policy.defaultPeople || fallback.defaultPeople)),
    allowedTypes: safeAllowedTypes,
    visibleFields: normalizeFloatingFields(policy.visibleFields).includes("submit")
      ? normalizeFloatingFields(policy.visibleFields)
      : [...normalizeFloatingFields(policy.visibleFields), "submit"],
    quickTabs: (policy.quickTabs?.length ? policy.quickTabs : fallback.quickTabs)
      .filter((tab) => tab.enabled !== false && safeAllowedTypes.includes(tab.type))
      .map((tab) => ({ ...tab, enabled: true })),
    paymentMethods: policy.paymentMethods?.length ? policy.paymentMethods : fallback.paymentMethods,
    visibleColumns: policy.visibleColumns?.length ? policy.visibleColumns : fallback.visibleColumns
  };
}

function clientPolicyForEntry(settings: AppSettings, policy: RemoteClientPolicy, allowClientCustomization = false): RemoteClientPolicy {
  if (!allowClientCustomization) {
    return policy;
  }
  const defaultType = policy.allowedTypes.includes(settings.defaultType) ? settings.defaultType : policy.defaultType;
  const serverFields = new Set(normalizeFloatingFields(policy.visibleFields));
  const customFields = normalizeFloatingFields(settings.floating.visibleFields).filter((field) => serverFields.has(field));
  const visibleFields = customFields.length ? normalizeFloatingFields(customFields) : normalizeFloatingFields(policy.visibleFields);
  const customTabs = enabledQuickTabs(settings)
    .filter((tab) => policy.allowedTypes.includes(tab.type))
    .map((tab) => ({
      ...tab,
      enabled: true,
      cashLinkedType:
        tab.cashLinkedType && policy.allowedTypes.includes(tab.cashLinkedType)
          ? tab.cashLinkedType
          : tab.cashLinkedType
            ? defaultCashLinkForAllowedTypes(policy.allowedTypes, tab.cashLinkedType)
            : undefined
    }));

  return {
    ...policy,
    defaultType,
    defaultPeople: Math.max(1, Math.floor(settings.defaultPeople || policy.defaultPeople || 1)),
    defaultRoundingStep: settings.defaultRoundingStep,
    defaultRoundingDirection: settings.defaultRoundingDirection,
    tableNumberEnabled: policy.tableNumberEnabled && settings.tableNumberEnabled !== false,
    busNumberEnabled: policy.busNumberEnabled && settings.busNumberEnabled !== false,
    visibleFields,
    quickTabs: customTabs.length ? customTabs : policy.quickTabs
  };
}

function settingsForRemoteClient(settings: AppSettings, policy: RemoteClientPolicy, allowClientCustomization = false): AppSettings {
  const entryPolicy = clientPolicyForEntry(settings, policy, allowClientCustomization);
  return normalizeSettingsDraft(settings, {
    defaultType: entryPolicy.defaultType,
    defaultPeople: entryPolicy.defaultPeople,
    defaultRoundingStep: entryPolicy.defaultRoundingStep,
    defaultRoundingDirection: entryPolicy.defaultRoundingDirection,
    tableNumberEnabled: entryPolicy.tableNumberEnabled,
    busNumberEnabled: entryPolicy.busNumberEnabled,
    quickTabs: entryPolicy.quickTabs.length
      ? entryPolicy.quickTabs.map((tab) => ({ ...tab, enabled: true }))
      : [{ id: "remote-default", label: entryPolicy.defaultType, enabled: true, type: entryPolicy.defaultType }],
    floating: {
      ...settings.floating,
      visibleFields: normalizeFloatingFields(entryPolicy.visibleFields)
    }
  });
}

function applyFloatingPresetToSettings(settings: AppSettings, preset: FloatingPreset): AppSettings {
  return normalizeSettingsDraft(settings, {
    defaultType: preset.defaultType,
    quickTabs: cloneValue(preset.quickTabs),
    floating: {
      ...settings.floating,
      visibleFields: normalizeFloatingFields(preset.fields),
      borderless: preset.borderless ?? settings.floating.borderless,
      layoutMode: preset.layoutMode || settings.floating.layoutMode || "adaptive",
      syncMoneyWithEntryType: true
    }
  });
}

function dateTokenForFormat(date: Date, format: AppSettings["dateFormat"]): string {
  const [year, month, day] = getLocalDateKey(date).split("-");
  if (format === "dd-MM-yyyy") {
    return `${day}-${month}-${year}`;
  }
  if (format === "yyyyMMdd") {
    return `${year}${month}${day}`;
  }
  return `${year}-${month}-${day}`;
}

function filePreviewForSettings(settings: AppSettings): string {
  const now = new Date();
  const extension = settings.fileFormat;
  const date = dateTokenForFormat(now, settings.dateFormat);
  if (settings.fileStrategy === "monthlyTabs" && settings.fileFormat === "xlsx") {
    return `Fechamentos mensais / caixa-${getLocalDateKey(now).slice(0, 7)}.${extension}`;
  }
  if (settings.fileStrategy === "fixedAll") {
    return `Exportacoes / caixa-geral.${extension}`;
  }
  if (settings.fileStrategy === "byType") {
    return `Por tipo / venda-${date}.${extension}`;
  }
  return `Vendas diarias / vendas-${date}.${extension}`;
}

function profileSummary(profile: Partial<AppSettings>): string {
  const details = [
    profile.theme ? `Tema ${profile.theme}` : "",
    profile.layout ? `Layout ${profile.layout}` : "",
    profile.density ? `Densidade ${profile.density}` : "",
    profile.defaultType ? `Padrao ${profile.defaultType}` : "",
    profile.floating?.visibleFields?.length ? `${profile.floating.visibleFields.length} itens na barra` : ""
  ].filter(Boolean);
  return details.join(" | ") || "Perfil pronto para personalizar";
}

function settingsChangeWarnings(previous: AppSettings, next: AppSettings): string[] {
  const warnings: string[] = [];
  if (previous.outputDirectory !== next.outputDirectory) {
    warnings.push("pasta padrao das planilhas");
  }
  if (previous.fileFormat !== next.fileFormat || previous.fileStrategy !== next.fileStrategy || previous.spreadsheetMode !== next.spreadsheetMode) {
    warnings.push("formato ou organizacao da planilha");
  }
  if (previous.server.port !== next.server.port || previous.server.password !== next.server.password) {
    warnings.push("porta ou senha do servidor");
  }
  if (JSON.stringify(previous.server.autoConnection) !== JSON.stringify(next.server.autoConnection)) {
    warnings.push("autoconexao ao abrir o app");
  }
  if (JSON.stringify(previous.server.permissions) !== JSON.stringify(next.server.permissions)) {
    warnings.push("permissoes dos dispositivos remotos");
  }
  if (JSON.stringify(previous.shortcuts) !== JSON.stringify(next.shortcuts)) {
    warnings.push("atalhos de teclado");
  }
  return warnings;
}

function remoteLockedSettingsSnapshot(settings: AppSettings, allowClientCustomization = false) {
  const snapshot: Record<string, unknown> = {
    outputDirectory: settings.outputDirectory,
    fileFormat: settings.fileFormat,
    fileStrategy: settings.fileStrategy,
    spreadsheetMode: settings.spreadsheetMode,
    dateFormat: settings.dateFormat,
    csvSeparator: settings.csvSeparator,
    visibleColumns: settings.visibleColumns,
    backupEnabled: settings.backupEnabled,
    automaticSpreadsheetEnabled: settings.automaticSpreadsheetEnabled,
    automaticClosingReportEnabled: settings.automaticClosingReportEnabled,
    reportExportSections: settings.reportExportSections,
    server: settings.server
  };
  if (!allowClientCustomization) {
    snapshot.defaultType = settings.defaultType;
    snapshot.defaultPeople = settings.defaultPeople;
    snapshot.defaultRoundingStep = settings.defaultRoundingStep;
    snapshot.defaultRoundingDirection = settings.defaultRoundingDirection;
    snapshot.tableNumberEnabled = settings.tableNumberEnabled;
    snapshot.busNumberEnabled = settings.busNumberEnabled;
    snapshot.profiles = settings.profiles;
    snapshot.activeProfile = settings.activeProfile;
    snapshot.quickTabs = settings.quickTabs;
  }
  return snapshot;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [pdvSnapshot, setPdvSnapshot] = useState<PdvSnapshot | null>(null);
  const [remotePdvSales, setRemotePdvSales] = useState<PdvSale[]>([]);
  const [remotePdvCustomers, setRemotePdvCustomers] = useState<PdvCustomer[]>([]);
  const [remotePdvReceivables, setRemotePdvReceivables] = useState<PdvReceivable[]>([]);
  const [remotePdvSnapshot, setRemotePdvSnapshot] = useState<PdvSnapshot | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("sale");
  const [payableCreateRequest, setPayableCreateRequest] = useState<{ supplier: string; nonce: number } | null>(null);
  const [pdvViewNonce, setPdvViewNonce] = useState(0);
  const [pdvDirectCartActive, setPdvDirectCartActive] = useState(false);
  const [pdvNavigationRequest, setPdvNavigationRequest] = useState<TabKey | null>(null);
  const [pinned, setPinnedState] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modeCommand, setModeCommand] = useState<ModeCommand | null>(null);
  const [importPreview, setImportPreview] = useState<LedgerImportPreview | null>(null);
  const [importingPreview, setImportingPreview] = useState(false);
  const [currentDateKey, setCurrentDateKey] = useState(() => getLocalDateKey());
  const [totalMenuOpen, setTotalMenuOpen] = useState(false);
  const totalMenuRef = useRef<HTMLDivElement | null>(null);
  const [modulesMenuOpen, setModulesMenuOpen] = useState(false);
  const modulesMenuRef = useRef<HTMLDivElement | null>(null);
  const [reportFocus, setReportFocus] = useState<ReportFocusPeriod | null>(null);
  const [historyFocus, setHistoryFocus] = useState<HistoryFocusDate | null>(null);
  const [settingsFocus, setSettingsFocus] = useState<{ category: SettingsCategory; nonce: number } | null>(null);
  const [remoteSession, setRemoteSession] = useState<RemoteClientSession | null>(null);
  const [remoteMessage, setRemoteMessage] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [versionMismatch, setVersionMismatch] = useState<VersionMismatchState | null>(null);
  const [startupUpdateInfo, setStartupUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installingPromptUpdate, setInstallingPromptUpdate] = useState(false);
  const remoteSocket = useRef<WebSocket | null>(null);
  const remoteSessionRef = useRef<RemoteClientSession | null>(null);
  const remoteManualDisconnect = useRef(false);
  const remoteReconnectTimer = useRef<number | null>(null);
  const remoteReconnectAttempt = useRef(0);
  const remoteHeartbeatFailures = useRef(0);
  const remotePdvRefreshTimer = useRef<number | null>(null);
  const appReloadInFlight = useRef<Promise<void> | null>(null);
  const appReloadQueued = useRef(false);
  const appReloadTimer = useRef<number | null>(null);
  const pdvReloadInFlight = useRef<Promise<void> | null>(null);
  const pdvReloadQueued = useRef(false);
  const pdvReloadTimer = useRef<number | null>(null);
  const remoteRefreshInFlight = useRef<Promise<void> | null>(null);
  const remoteRefreshQueued = useRef(false);
  const autoConnectionAttemptKey = useRef<string | null>(null);
  const dailyUpdateCheckStarted = useRef(false);

  useEffect(() => {
    if (!totalMenuOpen && !modulesMenuOpen) {
      return;
    }
    const closeHeaderMenus = (event: PointerEvent) => {
      if (!totalMenuRef.current?.contains(event.target as Node)) {
        setTotalMenuOpen(false);
      }
      if (!modulesMenuRef.current?.contains(event.target as Node)) {
        setModulesMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTotalMenuOpen(false);
        setModulesMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeHeaderMenus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeHeaderMenus);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modulesMenuOpen, totalMenuOpen]);
  const combinedEntries = useMemo(() => [...entries].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), [entries]);
  const todayEntries = useMemo(() => filterEntriesByLocalDate(combinedEntries, currentDateKey), [combinedEntries, currentDateKey]);
  const summary = useMemo(() => summarizeEntries(todayEntries), [todayEntries]);

  const reload = async () => {
    if (appReloadInFlight.current) {
      appReloadQueued.current = true;
      return appReloadInFlight.current;
    }
    const request = Promise.all([
      window.caixa.getSnapshot(),
      window.caixa.getPdvSnapshot(),
      window.caixa.getPinned()
    ]).then(([snapshot, pdv, nextPinned]) => {
      setEntries(snapshot.entries);
      setPdvSnapshot(pdv);
      setSettings((current) =>
        current && JSON.stringify(current) === JSON.stringify(snapshot.settings) ? current : snapshot.settings
      );
      setServer(snapshot.server);
      setExportStatus(snapshot.exportStatus);
      setPinnedState(nextPinned);
    });
    appReloadInFlight.current = request;
    try {
      await request;
    } finally {
      appReloadInFlight.current = null;
      if (appReloadQueued.current) {
        appReloadQueued.current = false;
        void reload();
      }
    }
  };
  const scheduleReload = () => {
    if (appReloadTimer.current !== null) {
      window.clearTimeout(appReloadTimer.current);
    }
    appReloadTimer.current = window.setTimeout(() => {
      appReloadTimer.current = null;
      void reload();
    }, 50);
  };

  const reloadPdv = async () => {
    if (pdvReloadInFlight.current) {
      pdvReloadQueued.current = true;
      return pdvReloadInFlight.current;
    }
    const request = window.caixa.getPdvSnapshot(300).then((next) => {
      setPdvSnapshot((current) => {
        if (!current) return next;
        const recentSales = [...new Map([...current.recentSales, ...next.recentSales].map((sale) => [sale.id, sale])).values()]
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        return { ...next, recentSales };
      });
    });
    pdvReloadInFlight.current = request;
    try {
      await request;
    } finally {
      pdvReloadInFlight.current = null;
      if (pdvReloadQueued.current) {
        pdvReloadQueued.current = false;
        void reloadPdv();
      }
    }
  };

  const schedulePdvReload = () => {
    if (pdvReloadTimer.current !== null) {
      window.clearTimeout(pdvReloadTimer.current);
    }
    pdvReloadTimer.current = window.setTimeout(() => {
      pdvReloadTimer.current = null;
      void reloadPdv();
    }, 50);
  };

  useEffect(() => {
    reload();
    const offEntries = window.caixa.onEntriesChanged(scheduleReload);
    const offServer = window.caixa.onServerChanged((state) => setServer(state));
    const offPinned = window.caixa.onPinnedChanged((nextPinned) => setPinnedState(nextPinned));
    const offSettings = window.caixa.onSettingsChanged((nextSettings) => setSettings(nextSettings));
    const offPdv = window.caixa.onPdvChanged(schedulePdvReload);
    return () => {
      if (appReloadTimer.current !== null) {
        window.clearTimeout(appReloadTimer.current);
        appReloadTimer.current = null;
      }
      if (pdvReloadTimer.current !== null) {
        window.clearTimeout(pdvReloadTimer.current);
        pdvReloadTimer.current = null;
      }
      offEntries();
      offServer();
      offPinned();
      offSettings();
      offPdv();
    };
  }, []);

  useEffect(() => {
    remoteSessionRef.current = remoteSession;
  }, [remoteSession]);

  useEffect(() => window.caixa.onRemoteReceiptPrintResult((result) => {
    showToast(result.ok ? "success" : "error", `${result.deviceName}: ${result.message}`);
  }), []);

  useEffect(() => window.caixa.onSecondInstance(() => {
    showToast("info", "O Caixa PDV ja estava aberto. A janela existente foi trazida para frente.");
  }), []);

  useEffect(() => {
    if (!settings || IS_FLOATING_WINDOW || dailyUpdateCheckStarted.current) {
      return;
    }
    const today = getLocalDateKey();
    if (window.localStorage.getItem(DAILY_UPDATE_CHECK_KEY) === today) {
      dailyUpdateCheckStarted.current = true;
      return;
    }
    dailyUpdateCheckStarted.current = true;
    void window.caixa.checkForUpdates().then((info) => {
      if (info.hasUpdate || !info.message) {
        window.localStorage.setItem(DAILY_UPDATE_CHECK_KEY, today);
      }
      if (info.hasUpdate) {
        setStartupUpdateInfo(info);
      }
    }).catch(() => {
      dailyUpdateCheckStarted.current = false;
    });
  }, [settings]);

  useEffect(() => {
    setTotalMenuOpen(false);
    setModulesMenuOpen(false);
  }, [activeTab, remoteSession?.baseUrl, remoteSession?.permissions.viewTotals]);

  useEffect(() => {
    return () => {
      if (remoteReconnectTimer.current !== null) {
        window.clearTimeout(remoteReconnectTimer.current);
        remoteReconnectTimer.current = null;
      }
      if (remotePdvRefreshTimer.current !== null) {
        window.clearTimeout(remotePdvRefreshTimer.current);
        remotePdvRefreshTimer.current = null;
      }
      remoteSocket.current?.close();
      remoteSocket.current = null;
    };
  }, []);

  useEffect(() => {
    const syncStoredRemoteSession = () => {
      const stored = readStoredRemoteSession();
      const current = remoteSessionRef.current;
      if (!stored) {
        if (current) {
          disconnectRemoteClient();
        }
        return;
      }

      if (current && current.baseUrl === stored.baseUrl && current.password === stored.password && current.deviceName === stored.deviceName) {
        return;
      }

      void connectRemoteClient(stored.baseUrl, stored.password, stored.deviceName, { quiet: true, auto: true });
    };

    syncStoredRemoteSession();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === REMOTE_SESSION_STORAGE_KEY) {
        syncStoredRemoteSession();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [settings, server]);

  useEffect(() => {
    if (!settings || !server || IS_FLOATING_WINDOW) {
      return;
    }

    const auto = settings.server.autoConnection;
    if (!auto || auto.mode === "none") {
      autoConnectionAttemptKey.current = null;
      return;
    }

    if (auto.mode === "server") {
      if (server.running || remoteSession) {
        return;
      }
      const key = `server:${settings.server.port}:${settings.server.password}`;
      if (autoConnectionAttemptKey.current === key) {
        return;
      }
      autoConnectionAttemptKey.current = key;
      void window.caixa
        .startServer(settings.server.port, settings.server.password)
        .then((nextServer) => {
          setServer(nextServer);
          showToast("success", "Servidor automatico aberto neste PC.");
        })
        .catch((error) => {
          setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel abrir o servidor automatico.");
          showToast("error", error instanceof Error ? error.message : "Nao foi possivel abrir o servidor automatico.");
        });
      return;
    }

    if (auto.mode === "client") {
      if (server.running || remoteSession || !auto.host || !auto.password) {
        return;
      }
      const key = `client:${auto.host}:${auto.password}:${auto.deviceName}:${settings.server.port}`;
      if (autoConnectionAttemptKey.current === key) {
        return;
      }
      autoConnectionAttemptKey.current = key;
      void connectRemoteClient(auto.host, auto.password, auto.deviceName || "App cliente", { quiet: true, auto: true });
    }
  }, [settings, server, remoteSession]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentDateKey(getLocalDateKey()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedAppTheme = resolveTheme(settings.theme, media.matches);
      const resolvedFloatingTheme = resolveFloatingTheme(settings, media.matches);
      document.documentElement.dataset.theme = IS_FLOATING_WINDOW ? resolvedFloatingTheme : resolvedAppTheme;
      document.documentElement.dataset.themePreference = settings.theme;
      document.documentElement.dataset.floatingTheme = resolvedFloatingTheme;
      document.documentElement.dataset.density = settings.density;
      document.documentElement.dataset.simpleMode = settings.simpleMode ? "true" : "false";
      document.documentElement.dataset.fieldSize = settings.fieldSize;
      document.documentElement.dataset.floatingBorderless = settings.floating.borderless ? "true" : "false";
      document.documentElement.dataset.floatingCornerStyle = settings.floating.cornerStyle || "rounded";
      document.documentElement.style.setProperty("--accent", settings.accentColor);
      document.documentElement.classList.toggle("is-floating-root", IS_FLOATING_WINDOW);
      document.body.classList.toggle("is-pinned", pinned || IS_FLOATING_WINDOW);
      document.body.classList.toggle("is-floating-window", IS_FLOATING_WINDOW);
      document.body.classList.toggle("floating-borderless", IS_FLOATING_WINDOW && settings.floating.borderless);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings, pinned]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const notificationDuration = Math.max(1200, settings?.notificationDurationMs || 3200);
    const timeout = window.setTimeout(() => setToast(null), notificationDuration);
    return () => window.clearTimeout(timeout);
  }, [toast, settings?.notificationDurationMs]);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (!settings || event.defaultPrevented) {
        return;
      }
      const action = shortcutActionForEvent(event, settings.shortcuts, GLOBAL_SHORTCUT_ACTIONS);
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "money") {
        commandMode("Dinheiro/Troco");
      } else if (action === "table") {
        commandMode("Mesa");
      } else if (action === "bus") {
        commandMode("Onibus");
      } else if (action === "history") {
        requestNavigation("history");
      } else if (action === "settings") {
        requestNavigation("settings");
      } else if (action === "repeatLast") {
        await repeatLastEntry();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, settings, pinned]);

  const showToast = (tone: ToastState["tone"], message: string) => {
    if (settings && settings.notificationsEnabled === false && tone !== "error") {
      return;
    }
    setToast({ tone, message });
  };

  const installPromptedUpdate = async (source: "daily" | "version") => {
    if (installingPromptUpdate) return;
    setInstallingPromptUpdate(true);
    try {
      const info = await window.caixa.checkForUpdates();
      if (!info.hasUpdate) {
        setStartupUpdateInfo(null);
        if (source === "version" && versionMismatch && !versionMismatch.serverIsNewer) {
          showToast("error", `Este computador ja esta atualizado. Atualize o servidor ${versionMismatch.serverVersion} antes de conectar.`);
        } else {
          showToast("info", info.message || "Nenhuma atualizacao nova foi encontrada para este computador.");
        }
        return;
      }
      const result = await window.caixa.installUpdate();
      showToast(result.ok ? "success" : "error", result.message);
      if (!result.ok) {
        setStartupUpdateInfo(info);
      }
    } finally {
      setInstallingPromptUpdate(false);
    }
  };

  const commandMode = (type: EntryType) => {
    setActiveTab("sale");
    setModeCommand({ type, nonce: Date.now() });
  };

  const saveSettings = async (next: AppSettings) => {
    const currentRemote = remoteSessionRef.current;
    if (currentRemote?.permissions.allowClientCustomization && settings) {
      const serverPatch = remoteServerSettingsPatch(settings, next);
      if (Object.keys(serverPatch).length) {
        await remoteRequest<{ settings: AppSettings }>(currentRemote, "/api/settings", {
          method: "PATCH",
          body: JSON.stringify(serverPatch)
        });
      }
    }
    const saved = await window.caixa.saveSettings(next);
    setSettings(saved);
    showToast("success", currentRemote?.permissions.allowClientCustomization ? "Configuracoes salvas neste cliente e no servidor." : "Configuracoes salvas.");
  };

  const toggleHeaderPrivacy = async () => {
    if (!settings) {
      return;
    }
    await saveSettings({
      ...settings,
      privacy: {
        ...settings.privacy,
        hideHeaderTotal: !settings.privacy.hideHeaderTotal
      }
    });
    setTotalMenuOpen(false);
  };

  const openTodayReport = () => {
    setReportFocus({ from: currentDateKey, to: currentDateKey, nonce: Date.now() });
    requestNavigation("reports");
    setTotalMenuOpen(false);
  };

  const remoteRequest = async <T,>(session: RemoteClientSession, path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetchWithTimeout(`${session.baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-caixa-password": session.password,
        "x-device-name": session.deviceName,
        "x-caixa-version": session.appVersion,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      let errorMessage = text || response.statusText;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        errorMessage = parsed.error || errorMessage;
      } catch {
        // A resposta remota pode ser texto puro.
      }
      throw new Error(errorMessage);
    }
    return (text ? JSON.parse(text) : {}) as T;
  };

  const scheduleRemoteReconnect = () => {
    if (remoteReconnectTimer.current !== null || remoteManualDisconnect.current) {
      return;
    }
    const stored = readStoredRemoteSession();
    if (!stored) {
      return;
    }
    remoteReconnectAttempt.current += 1;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(4, remoteReconnectAttempt.current - 1));
    setRemoteMessage(`Servidor desconectado. Tentando reconectar em ${Math.ceil(delay / 1000)}s...`);
    remoteReconnectTimer.current = window.setTimeout(() => {
      remoteReconnectTimer.current = null;
      void connectRemoteClient(stored.baseUrl, stored.password, stored.deviceName, { quiet: true, auto: true })
        .then((connected) => {
          if (!connected) {
            scheduleRemoteReconnect();
          }
        });
    }, delay);
  };

  const openRemoteSocket = (session: RemoteClientSession) => {
    if (remoteReconnectTimer.current !== null) {
      window.clearTimeout(remoteReconnectTimer.current);
      remoteReconnectTimer.current = null;
    }
    if (remoteSocket.current) {
      remoteSocket.current.onclose = null;
      remoteSocket.current.close();
    }
    const wsUrl = `${session.baseUrl.replace(/^http/i, "ws")}/sync?password=${encodeURIComponent(session.password)}&device=${encodeURIComponent(session.deviceName)}&version=${encodeURIComponent(session.appVersion)}`;
    remoteSocket.current = new WebSocket(wsUrl);
    remoteSocket.current.onopen = () => {
      remoteReconnectAttempt.current = 0;
      remoteHeartbeatFailures.current = 0;
      setRemoteMessage("Tempo real ativo. Sincronizando dados...");
      void refreshRemote(session)
        .then(() => setRemoteMessage("Tempo real ativo. Dados sincronizados."))
        .catch((error) => {
          setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel concluir a sincronizacao apos reconectar.");
        });
    };
    remoteSocket.current.onerror = () => {
      if (remoteSocket.current?.readyState !== WebSocket.CLOSED) {
        remoteSocket.current?.close();
      }
    };
    remoteSocket.current.onmessage = (event) => {
      let isPdvChange = false;
      let receiptJob: RemoteSocketMessage | null = null;
      try {
        const message = JSON.parse(String(event.data || "{}")) as RemoteSocketMessage;
        if (message.type === "pdv-changed") {
          isPdvChange = true;
        } else if (message.type === "receipt-print-request") {
          receiptJob = message;
        }
      } catch {
        // Mensagens antigas podem nao ser JSON valido.
      }
      const current = remoteSessionRef.current;
      if (current) {
        if (receiptJob?.jobId && receiptJob.sale) {
          const socket = remoteSocket.current;
          const job = receiptJob;
          void (async () => {
            let ok = false;
            let resultMessage = "Nao foi possivel imprimir o recibo.";
            try {
              if (!current.permissions.printReceipts) {
                throw new Error("O servidor nao permitiu impressao neste cliente.");
              }
              const [printers, localPdv] = await Promise.all([
                window.caixa.listPdvPrinters(),
                window.caixa.getPdvSnapshot()
              ]);
              const configured = localPdv.settings.receiptPrinterName;
              const printer = printers.find((item) => item.name === configured)
                || printers.find((item) => item.isDefault)
                || printers[0];
              if (!printer) {
                throw new Error("Nenhuma impressora foi encontrada neste computador.");
              }
              const result = await window.caixa.printPdvReceipt(job.sale!, job.customer, job.receivable, {
                customerName: job.customerName,
                customerDocument: job.customerDocument,
                action: "print",
                printerName: printer.name,
                receiptSettings: job.receiptSettings
              });
              ok = result.ok;
              resultMessage = result.message;
              showToast(result.ok ? "success" : "error", result.message);
            } catch (error) {
              resultMessage = error instanceof Error ? error.message : resultMessage;
              showToast("error", resultMessage);
            }
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "receipt-print-result",
                jobId: job.jobId,
                ok,
                message: resultMessage,
                deviceName: current.deviceName
              }));
            }
          })();
          return;
        }
        if (isPdvChange) {
          if (remotePdvRefreshTimer.current !== null) {
            window.clearTimeout(remotePdvRefreshTimer.current);
          }
          // Agrupa eventos consecutivos de mesa sem mudar o protocolo da conexao.
          remotePdvRefreshTimer.current = window.setTimeout(() => {
            remotePdvRefreshTimer.current = null;
            // Vendas PDV tambem geram lancamentos no Historico integrado.
            // Atualize o estado inteiro para mesas e Historico nunca divergirem.
            void refreshRemote(current).catch((error) => {
              setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel atualizar o cliente remoto.");
            });
          }, 80);
          return;
        }
        void refreshRemote(current).catch((error) => {
          setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel atualizar o cliente remoto.");
        });
      }
    };
    remoteSocket.current.onclose = () => {
      if (remoteManualDisconnect.current) {
        remoteManualDisconnect.current = false;
        return;
      }
      remoteSocket.current = null;
      setRemoteMessage("Servidor desconectado. As mesas permanecem vinculadas ao servidor enquanto reconecta.");
      scheduleRemoteReconnect();
    };
  };

  const applyRemotePdvSnapshot = (pdv: PdvSnapshot) => {
    // O endpoint retorna o estado completo. Substituir o cache tambem remove
    // vendas excluidas e evita manter versoes antigas no Historico do cliente.
    setRemotePdvSnapshot(pdv);
    setRemotePdvSales(pdv.recentSales);
    setRemotePdvCustomers(pdv.customers);
    setRemotePdvReceivables(pdv.receivables);
  };

  const refreshRemote = async (session = remoteSessionRef.current) => {
    if (!session || !settings) {
      return;
    }
    if (remoteRefreshInFlight.current) {
      remoteRefreshQueued.current = true;
      return remoteRefreshInFlight.current;
    }
    const request = Promise.all([
      remoteRequest<RemoteEntriesResponse>(session, REMOTE_ENTRY_LIMIT ? `/api/entries?limit=${REMOTE_ENTRY_LIMIT}` : "/api/entries"),
      remoteRequest<PdvSnapshot>(session, "/api/pdv/snapshot")
    ]).then(([data, pdv]) => {
      const current = remoteSessionRef.current;
      if (!current || current.baseUrl !== session.baseUrl || current.password !== session.password) {
        return;
      }
      applyRemotePdvSnapshot(pdv);
      const nextSession = {
        ...session,
        entries: data.entries,
        summary: data.summary,
        todayCount: data.todayCount,
        totalCount: data.totalCount,
        limited: data.limited,
        permissions: data.permissions,
        clientPolicy: normalizeRemotePolicy(data.clientPolicy, settings)
      };
      setRemoteSession(nextSession);
      remoteSessionRef.current = nextSession;
      remoteHeartbeatFailures.current = 0;
    });
    remoteRefreshInFlight.current = request;
    try {
      await request;
    } finally {
      remoteRefreshInFlight.current = null;
      if (remoteRefreshQueued.current) {
        remoteRefreshQueued.current = false;
        void refreshRemote(remoteSessionRef.current).catch((error) => {
          setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel concluir a sincronizacao remota.");
        });
      }
    }
  };

  useEffect(() => {
    if (!remoteSession) return;
    const interval = window.setInterval(() => {
      const current = remoteSessionRef.current;
      if (!current) return;
      void refreshRemote(current).catch((error) => {
        remoteHeartbeatFailures.current += 1;
        setRemoteMessage(error instanceof Error ? error.message : "Sincronizacao em tempo real temporariamente indisponivel.");
        if (remoteHeartbeatFailures.current >= 2) {
          remoteSocket.current?.close();
          scheduleRemoteReconnect();
        }
      });
    }, 10000);
    return () => window.clearInterval(interval);
  }, [remoteSession?.baseUrl, remoteSession?.password]);

  useEffect(() => {
    if (!remoteSession) return;
    const onOnline = () => {
      remoteHeartbeatFailures.current = 0;
      const current = remoteSessionRef.current;
      if (!current) return;
      if (!remoteSocket.current || remoteSocket.current.readyState !== WebSocket.OPEN) {
        openRemoteSocket(current);
        return;
      }
      void refreshRemote(current).catch(() => {
        remoteSocket.current?.close();
        scheduleRemoteReconnect();
      });
    };
    const onOffline = () => setRemoteMessage("Sem conexao de rede. Os dados serao atualizados ao reconectar.");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [remoteSession?.baseUrl, remoteSession?.password]);

  const connectRemoteClient = async (
    host: string,
    password: string,
    deviceName: string,
    options: { quiet?: boolean; auto?: boolean } = {}
  ): Promise<boolean> => {
    if (!settings) {
      return false;
    }
    if (server?.running) {
      const message = "Desligue o servidor deste app antes de conectar como cliente de outro caixa.";
      setRemoteMessage(message);
      if (!options.quiet) {
        showToast("error", message);
      }
      return false;
    }
    setRemoteLoading(true);
    setRemoteMessage("");
    try {
      const baseUrl = normalizeRemoteBaseUrl(host, settings.server.port, server?.ips || []);
      const clientVersion = await window.caixa.getAppVersion();
      const versionResponse = await fetchWithTimeout(`${baseUrl}/api/version`);
      if (!versionResponse.ok) {
        if (versionResponse.status === 404) {
          throw new RemoteVersionMismatchError({
            clientVersion,
            serverVersion: "anterior/sem identificacao",
            serverIsNewer: false
          });
        }
        throw new Error(`Nao foi possivel confirmar a versao do servidor (${versionResponse.status}).`);
      }
      const versionData = await versionResponse.json() as { appVersion?: string };
      const serverVersion = String(versionData.appVersion || "").trim();
      if (!serverVersion || normalizeAppVersion(serverVersion) !== normalizeAppVersion(clientVersion)) {
        throw new RemoteVersionMismatchError({
          clientVersion,
          serverVersion: serverVersion || "anterior/sem identificacao",
          serverIsNewer: compareAppVersions(serverVersion, clientVersion) > 0
        });
      }
      const pendingSession: RemoteClientSession = {
        baseUrl,
        password,
        deviceName: deviceName.trim() || "App cliente",
        appVersion: clientVersion,
        entries: [],
        summary: null,
        todayCount: 0,
        totalCount: 0,
        limited: false,
        permissions: {
          view: false,
          create: false,
          manageTables: false,
          manageProducts: false,
          edit: false,
          delete: false,
          viewEntryValues: false,
          viewTotals: false,
          printReceipts: false,
          allowClientCustomization: false
        },
        clientPolicy: clientPolicyFromSettings(settings),
        connectedAt: new Date().toISOString()
      };
      const data = await remoteRequest<RemoteEntriesResponse>(pendingSession, `/api/entries?limit=${REMOTE_ENTRY_LIMIT}`);
      const remotePdv = await remoteRequest<PdvSnapshot>(pendingSession, "/api/pdv/snapshot");
      applyRemotePdvSnapshot(remotePdv);
      const connectedSession: RemoteClientSession = {
        ...pendingSession,
        entries: data.entries,
        summary: data.summary,
        todayCount: data.todayCount,
        totalCount: data.totalCount,
        limited: data.limited,
        permissions: data.permissions,
        clientPolicy: normalizeRemotePolicy(data.clientPolicy, settings)
      };
      setRemoteSession(connectedSession);
      remoteSessionRef.current = connectedSession;
      setVersionMismatch(null);
      if (connectedSession.clientPolicy.operationMode === "pdv") {
        setActiveTab("sale");
      }
      remoteReconnectAttempt.current = 0;
      writeStoredRemoteSession({ baseUrl, password, deviceName: connectedSession.deviceName });
      openRemoteSocket(connectedSession);
      if (!options.quiet) {
        showToast("success", "Cliente conectado ao caixa principal.");
      } else if (options.auto) {
        setRemoteMessage("Cliente conectado automaticamente ao caixa principal.");
      }
      return true;
    } catch (error) {
      if (error instanceof RemoteVersionMismatchError) {
        setVersionMismatch(error.mismatch);
        writeStoredRemoteSession(null);
      } else if (!options.auto) {
        writeStoredRemoteSession(null);
      }
      setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel conectar.");
      if (!options.quiet) {
        showToast("error", error instanceof Error ? error.message : "Nao foi possivel conectar.");
      }
      return false;
    } finally {
      setRemoteLoading(false);
    }
  };

  const disconnectRemoteClient = () => {
    const socket = remoteSocket.current;
    remoteManualDisconnect.current = Boolean(socket);
    if (remoteReconnectTimer.current !== null) {
      window.clearTimeout(remoteReconnectTimer.current);
      remoteReconnectTimer.current = null;
    }
    if (remotePdvRefreshTimer.current !== null) {
      window.clearTimeout(remotePdvRefreshTimer.current);
      remotePdvRefreshTimer.current = null;
    }
    remoteRefreshQueued.current = false;
    socket?.close();
    remoteSocket.current = null;
    remoteSessionRef.current = null;
    setRemotePdvSales([]);
    setRemotePdvCustomers([]);
    setRemotePdvReceivables([]);
    setRemotePdvSnapshot(null);
    setRemoteSession(null);
    remoteReconnectAttempt.current = 0;
    setRemoteMessage("");
    writeStoredRemoteSession(null);
    showToast("info", "Cliente remoto desconectado.");
  };

  const ensureRemoteSession = async () => {
    const current = remoteSessionRef.current;
    if (current) {
      return current;
    }
    const stored = readStoredRemoteSession();
    if (!stored) {
      return null;
    }
    const connected = await connectRemoteClient(stored.baseUrl, stored.password, stored.deviceName, { quiet: true, auto: true });
    return connected ? remoteSessionRef.current : null;
  };

  const addEntry = async (draft: EntryDraft) => {
    const result = await window.caixa.addEntry(draft);
    await reload();
    setExportStatus(result.exportStatus);
    showToast(result.exportStatus.ok ? "success" : "error", result.exportStatus.ok ? "Lancamento registrado." : result.exportStatus.message || "Lancamento salvo localmente.");
  };

  const submitRemoteEntry = async (draft: EntryDraft, session = remoteSessionRef.current) => {
    if (!session?.permissions.create) {
      showToast("error", "Este cliente nao tem permissao para registrar.");
      return;
    }
    await remoteRequest<{ entry: LedgerEntry }>(session, "/api/entries", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    await refreshRemote(session);
    showToast("success", "Lancamento enviado ao caixa principal.");
  };

  const submitEntry = async (draft: EntryDraft) => {
    const remoteIntent = Boolean(remoteSessionRef.current || readStoredRemoteSession());
    const activeRemoteSession = remoteSessionRef.current || (await ensureRemoteSession());
    if (activeRemoteSession) {
      await submitRemoteEntry(draft, activeRemoteSession);
      return;
    }
    if (remoteIntent) {
      const message = IS_FLOATING_WINDOW
        ? "O modo legado perdeu a conexao com o servidor. Reconecte o cliente antes de enviar."
        : "Este app esta em modo cliente, mas nao conseguiu reconectar ao servidor.";
      setRemoteMessage(message);
      showToast("error", message);
      return;
    }
    await addEntry(draft);
  };

  const editRemoteEntry = async (entry: LedgerEntry) => {
    if (!remoteSession?.permissions.edit) {
      return;
    }
    const description = window.prompt("Nova descricao", entry.description || "");
    if (description === null) {
      return;
    }
    const payload: Record<string, unknown> = {};
    if (remoteSession.clientPolicy.visibleFields.includes("description")) {
      payload.description = description;
    }
    if (remoteSession.permissions.viewEntryValues && remoteSession.clientPolicy.visibleFields.includes("value")) {
      const value = window.prompt("Novo valor", String(entry.finalValue || 0).replace(".", ","));
      if (value !== null) {
        payload.value = parseMoney(value);
      }
    }
    if (!Object.keys(payload).length) {
      showToast("info", "O servidor nao permite editar esses campos neste cliente.");
      return;
    }
    await remoteRequest<{ entry: LedgerEntry }>(remoteSession, `/api/entries/${entry.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await refreshRemote(remoteSession);
    showToast("success", "Lancamento remoto editado.");
  };

  const cancelRemoteEntry = async (entry: LedgerEntry) => {
    if (!remoteSession?.permissions.edit) {
      return;
    }
    await remoteRequest<{ entry: LedgerEntry }>(remoteSession, `/api/entries/${entry.id}/cancel`, { method: "POST" });
    await refreshRemote(remoteSession);
    showToast("info", "Lancamento remoto cancelado.");
  };

  const deleteRemoteEntry = async (entry: LedgerEntry, permanent = false) => {
    if (!remoteSession?.permissions.delete) {
      return;
    }
    await remoteRequest<{ ok: boolean }>(remoteSession, `/api/entries/${entry.id}${permanent ? "?permanent=1" : ""}`, {
      method: "DELETE"
    });
    await refreshRemote(remoteSession);
    showToast(permanent ? "info" : "success", permanent ? "Lancamento remoto apagado." : "Lancamento remoto enviado para a lixeira.");
  };

  const importLedgerFile = async () => {
    try {
      const preview = await window.caixa.previewLedgerImport();
      if (!preview) {
        showToast("info", "Importacao cancelada.");
        return;
      }
      setImportPreview(preview);
      showToast(preview.newRows ? "info" : "error", preview.newRows ? "Previa da importacao pronta." : "Nenhum lancamento novo encontrado.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Nao foi possivel ler a planilha.");
    }
  };

  const importLedgerFolder = async () => {
    try {
      const result = await window.caixa.importLedgerFolder();
      if (!result) {
        showToast("info", "Importacao de pasta cancelada.");
        return;
      }
      await reload();
      setExportStatus(result.exportStatus);
      const warningText = result.warnings.length ? ` ${result.warnings.length} aviso(s).` : "";
      showToast(
        result.imported ? "success" : "info",
        result.imported
          ? `${result.imported} lancamento(s) importado(s) de ${result.filesImported}/${result.filesScanned} arquivo(s).${warningText}`
          : `Nenhum lancamento novo na pasta. ${result.filesScanned} arquivo(s) conferido(s).${warningText}`
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Nao foi possivel importar a pasta.");
    }
  };

  const confirmLedgerImport = async () => {
    if (!importPreview) {
      return;
    }
    setImportingPreview(true);
    try {
      const result = await window.caixa.importLedgerFile(importPreview.filePath);
      if (!result) {
        showToast("info", "Importacao cancelada.");
        return;
      }
      await reload();
      setExportStatus(result.exportStatus);
      setImportPreview(null);
      const skippedText = result.skipped ? ` ${result.skipped} linha(s) pulada(s).` : "";
      const warningText = result.warnings.length ? ` ${result.warnings.length} aviso(s).` : "";
      showToast(
        result.imported ? "success" : "info",
        result.imported
          ? `${result.imported} lancamento(s) importado(s).${skippedText}${warningText}`
          : `Nenhum lancamento novo importado.${skippedText}${warningText}`
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Nao foi possivel importar a planilha.");
    } finally {
      setImportingPreview(false);
    }
  };

  const repeatLastEntry = async () => {
    const last = entries.find((entry) => entry.status === "active");
    if (!last) {
      showToast("info", "Nenhum lancamento para repetir.");
      return;
    }
    const result = await window.caixa.duplicateEntry(last.id);
    await reload();
    setExportStatus(result.exportStatus);
    showToast("success", "Ultimo lancamento repetido.");
  };

  const togglePinned = async () => {
    if (!settings) {
      return;
    }
    const mode = remoteSession?.clientPolicy.operationMode || settings.operationMode;
    if (mode !== "legacy") {
      showToast("info", "A barra fixa pertence ao Modo Classico. Ative esse modo em Ajuste para usa-la.");
      return;
    }
    const next = !pinned;
    const result = await window.caixa.setPinned(next, {
      opacity: settings.floating.opacity,
      borderless: settings.floating.borderless,
      lockPosition: settings.floating.lockPosition
    });
    setPinnedState(result);
  };

  const requestNavigation = (nextTab: TabKey) => {
    const targetTab = nextTab;
    const mode = remoteSession?.clientPolicy.operationMode || settings?.operationMode;
    if (mode === "pdv" && activeTab === "sale" && targetTab !== "sale" && pdvDirectCartActive) {
      setPdvNavigationRequest(targetTab);
      return;
    }
    if (activeTab === targetTab && (targetTab === "tables" || targetTab === "sale")) {
      setPdvViewNonce((nonce) => nonce + 1);
    }
    setActiveTab(targetTab);
  };

  useEffect(() => {
    const mode = remoteSession?.clientPolicy.operationMode || settings?.operationMode;
    if (mode === "legacy" && activeTab === "tables") {
      setActiveTab("sale");
    }
  }, [remoteSession?.clientPolicy.operationMode, settings?.operationMode, activeTab]);

  useEffect(() => {
    if (IS_FLOATING_WINDOW || !settings) {
      return;
    }
    const mode = remoteSession?.clientPolicy.operationMode || settings.operationMode;
    if (mode === "pdv" && pinned) {
      void window.caixa.setPinned(false).then(setPinnedState);
    }
  }, [settings?.operationMode, remoteSession?.clientPolicy.operationMode, pinned]);

  if (!settings || !server) {
    return (
      <div className="boot-screen">
        <div className="pulse-mark" />
        <strong>Carregando Caixa PDV...</strong>
      </div>
    );
  }

  const effectiveRemotePolicy = remoteSession
    ? clientPolicyForEntry(settings, remoteSession.clientPolicy, remoteSession.permissions.allowClientCustomization)
    : undefined;
  const entrySettings = remoteSession && effectiveRemotePolicy
    ? settingsForRemoteClient(settings, remoteSession.clientPolicy, remoteSession.permissions.allowClientCustomization)
    : settings;
  const displayEntries = remoteSession ? remoteSession.entries : entries;
  // Privacidade oculta valores de destaque, mas nunca remove a auditoria.
  const historyEntries = remoteSession ? displayEntries : combinedEntries;
  const historyPdvSales = remoteSession ? remotePdvSales : pdvSnapshot?.recentSales || [];
  const displayTodayEntries = remoteSession ? filterEntriesByLocalDate(remoteSession.entries, currentDateKey) : todayEntries;
  const canViewRemoteTotals = !remoteSession || remoteSession.permissions.viewTotals;
  const canViewRemoteEntryValues = !remoteSession || remoteSession.permissions.viewEntryValues;
  const displaySummary = remoteSession
    ? remoteSession.summary || privateSummaryForCount(remoteSession.todayCount ?? displayTodayEntries.filter((entry) => entry.status === "active").length)
    : summary;
  const quickEntryStorageScope = quickEntryStorageScopeForSession(remoteSession);
  const canUseTotalMenu = canViewRemoteTotals;

  if (IS_FLOATING_WINDOW) {
    return (
      <div className="pinned-app">
        <QuickEntry
          entries={displayEntries}
          settings={entrySettings}
          clientPolicy={effectiveRemotePolicy}
          pinned
          modeCommand={modeCommand}
          storageScope={quickEntryStorageScope}
          onSubmit={submitEntry}
          onUnpin={togglePinned}
        />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  const header = headerForTab(activeTab, displaySummary.count);
  const effectiveOperationMode = remoteSession?.clientPolicy.operationMode || settings.operationMode;
  const legacyMode = effectiveOperationMode === "legacy";
  const visibleTabItems = TAB_ITEMS.filter((item) => {
    if (legacyMode && (["tables", "clients", "receivables", "payables"] as TabKey[]).includes(item.key)) {
      return false;
    }
    return true;
  });
  const headerPinnedModules = normalizeHeaderPinnedModules(settings.headerPinnedModules);
  const primaryTabItems = visibleTabItems.filter((item) => item.key !== "settings" && headerPinnedModules.includes(item.key));
  const settingsPinnedItem = visibleTabItems.find((item) => item.key === "settings" && headerPinnedModules.includes(item.key));
  const availableModuleGroups = MODULE_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (
        visibleTabItems.some((visibleItem) => visibleItem.key === item.key)
        && !headerPinnedModules.includes(item.key)
      ))
    }))
    .filter((group) => group.items.length > 0);
  const availableModuleKeys = new Set(availableModuleGroups.flatMap((group) => group.items.map((item) => item.key)));
  const hasAvailableModules = availableModuleGroups.length > 0;
  const secondaryTabActive = availableModuleKeys.has(activeTab);
  const headerControlCount = primaryTabItems.length + (hasAvailableModules ? 1 : 0) + (settingsPinnedItem ? 1 : 0);
  const pdvMainTab = activeTab === "tables"
    ? (legacyMode ? null : "tables")
    : activeTab === "sale" && !legacyMode
      ? "sale"
      : null;
  const financialMainTab = (["clients", "receivables", "payables"] as TabKey[]).includes(activeTab);

  return (
    <div className={`app-shell ${pdvMainTab ? "pdv-main-mode" : ""} ${settings.hideHeaderBrand ? "header-brand-hidden" : ""}`}>
      <div className="window-titlebar" onDoubleClick={() => void window.caixa.toggleMaximizeWindow()}>
        <div className="window-titlebar-label">
          <img src={CDA_ICON_SRC} alt="" draggable={false} />
          <span>Caixa PDV</span>
        </div>
        <div className="window-titlebar-actions">
          <button type="button" title="Minimizar" aria-label="Minimizar" onClick={(event) => { event.stopPropagation(); void window.caixa.minimizeWindow(); }}><Minus size={14} /></button>
          <button type="button" title="Maximizar ou restaurar" aria-label="Maximizar ou restaurar" onClick={(event) => { event.stopPropagation(); void window.caixa.toggleMaximizeWindow(); }}><Square size={11} /></button>
          <button className="close" type="button" title="Fechar" aria-label="Fechar" onClick={(event) => { event.stopPropagation(); void window.caixa.closeWindow(); }}><X size={15} /></button>
        </div>
      </div>
      <aside className="sidebar app-topbar">
        {!settings.hideHeaderBrand && (
          <div className="brand-block">
            <div className="brand-mark">
              <img src={CDA_ICON_SRC} alt="Caixa PDV" draggable={false} />
            </div>
            <div>
              <strong>Caixa PDV</strong>
              <span>{legacyMode ? "Caixa classico" : remoteSession ? "Cliente do caixa principal" : "PDV local rapido"}</span>
            </div>
          </div>
        )}

        <nav className={`tabs primary-tabs ${headerControlCount > 6 ? "header-tabs-dense" : ""}`} aria-label="Navegacao principal">
          {primaryTabItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`${activeTab === item.key ? "active" : ""} ${item.key === "dashboard" ? "header-dashboard-tab" : ""}`.trim()}
                onClick={() => requestNavigation(item.key)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
          {hasAvailableModules && (
            <div className="modules-menu-wrap" ref={modulesMenuRef}>
              <button
                type="button"
                className={`modules-trigger ${secondaryTabActive ? "active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={modulesMenuOpen}
                onClick={() => {
                  setModulesMenuOpen((open) => !open);
                  setTotalMenuOpen(false);
                }}
              >
                <LayoutGrid size={18} />
                Modulos
                <ChevronDown className={modulesMenuOpen ? "open" : ""} size={15} />
              </button>
              {modulesMenuOpen && (
                <div className="modules-popover" role="menu" aria-label="Modulos do sistema">
                  <div className="modules-popover-head">
                    <div>
                      <strong>Modulos do sistema</strong>
                      <span>Somente os atalhos que nao estao fixados no cabecalho.</span>
                    </div>
                    <button type="button" className="modules-close" aria-label="Fechar modulos" onClick={() => setModulesMenuOpen(false)}>
                      <X size={17} />
                    </button>
                  </div>
                  <div className="modules-groups">
                    {availableModuleGroups.map((group) => (
                      <section key={group.label} className="modules-group">
                        <span className="modules-group-label">{group.label}</span>
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = activeTab === item.key;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              role="menuitem"
                              className={isActive ? "active" : ""}
                              disabled={item.comingSoon}
                              onClick={() => {
                                requestNavigation(item.key);
                                setModulesMenuOpen(false);
                              }}
                            >
                              <Icon size={19} />
                              <span>
                                <strong>{item.label}</strong>
                                <small>{item.description}</small>
                              </span>
                              {item.comingSoon && <b>Em breve</b>}
                            </button>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {settingsPinnedItem && (
            <button
              type="button"
              className={`header-settings-shortcut ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => requestNavigation("settings")}
            >
              <Settings size={18} />
              Ajustes
            </button>
          )}
        </nav>

        <div className="total-menu-wrap" ref={totalMenuRef}>
          <button
            type="button"
            className="sidebar-card topbar-card topbar-card-button"
            disabled={!canUseTotalMenu}
            title={canUseTotalMenu ? "Abrir acoes do total de hoje" : "O servidor bloqueou o menu de totais neste cliente."}
            onClick={() => {
              setTotalMenuOpen((open) => !open);
              setModulesMenuOpen(false);
            }}
          >
            <span>{settings.privacy.hideHeaderTotal || !canViewRemoteTotals ? "Total oculto" : "Total hoje"}</span>
            <strong className={settings.privacy.hideHeaderTotal || !canViewRemoteTotals ? "private-value" : ""}>
              {settings.privacy.hideHeaderTotal || !canViewRemoteTotals ? "Privado" : formatCurrency(displaySummary.total)}
            </strong>
            <small>{displaySummary.count} lancamentos{remoteSession ? " no servidor" : ""}</small>
          </button>
          {totalMenuOpen && canUseTotalMenu && (
            <div className="total-popover" role="menu">
              <div>
                <strong>Hoje</strong>
                <span>{displaySummary.count} lancamento(s)</span>
              </div>
              <button type="button" onClick={toggleHeaderPrivacy}>
                <Eye size={16} />
                {settings.privacy.hideHeaderTotal ? "Mostrar total no topo" : "Ativar privacidade"}
              </button>
              <button type="button" onClick={openTodayReport}>
                <BarChart3 size={16} />
                Relatorio deste dia
              </button>
              <button type="button" onClick={() => {
                setHistoryFocus({ date: currentDateKey, nonce: Date.now() });
                requestNavigation("history");
                setTotalMenuOpen(false);
              }}>
                <History size={16} />
                Historico de hoje
              </button>
              <button type="button" onClick={() => {
                setSettingsFocus({ category: "privacy", nonce: Date.now() });
                requestNavigation("settings");
                setTotalMenuOpen(false);
              }}>
                <Settings size={16} />
                Ajustes de privacidade
              </button>
            </div>
          )}
        </div>
        {legacyMode && (
          <button className="pin-button" type="button" onClick={togglePinned}>
            <Pin size={18} />
            {pinned ? "Fechar barra fixa" : "Abrir barra fixa"}
          </button>
        )}

      </aside>

      <main className={`workspace ${pdvMainTab ? "pdv-direct-workspace" : financialMainTab ? "admin-workspace financial-direct-workspace" : activeTab !== "sale" ? "admin-workspace" : ""}`}>
        {!pdvMainTab && !financialMainTab && (
          <header className="workspace-header">
            <div>
              <span className="eyebrow">{header.eyebrow}</span>
              <h1>{header.title}</h1>
            </div>
            <div className="module-status">
              <span>{header.status}</span>
            </div>
          </header>
        )}

        {pdvMainTab && (
          <div className="pdv-module-panel pdv-direct-panel">
            <PdvApp
              key={`pdv-main-${pdvViewNonce}`}
              embedded
              initialTab={pdvMainTab}
              hideTopbar
              remoteSession={remoteSession ? {
                ...remoteSession,
                roundingStep: effectiveRemotePolicy?.defaultRoundingStep,
                roundingDirection: effectiveRemotePolicy?.defaultRoundingDirection,
                allowPrint: remoteSession.permissions.printReceipts,
                allowEdit: remoteSession.permissions.edit,
                snapshot: remotePdvSnapshot
              } : null}
              roundingStep={settings.defaultRoundingStep}
              roundingDirection={settings.defaultRoundingDirection}
              toastDuration={settings.notificationDurationMs}
              onDirectCartChange={setPdvDirectCartActive}
              snapshotOverride={remoteSession ? remotePdvSnapshot : pdvSnapshot}
              receiptPrintTargets={remoteSession
                ? (remoteSession.permissions.printReceipts ? [{ id: "server", label: "Computador servidor" }] : [])
                : server.devices.filter((device) => device.permissions.printReceipts).map((device) => ({ id: device.id, label: device.name }))}
              onRemoteReceiptPrint={remoteSession
                ? async (_targetId, payload) => remoteRequest(remoteSession, "/api/pdv/print-receipt", { method: "POST", body: JSON.stringify(payload) })
                : async (targetId, payload) => window.caixa.requestRemotePdvReceiptPrint(targetId, payload)}
              onNavigateMain={(tab) => requestNavigation(tab)}
              onOperationalTabChange={(tab) => setActiveTab(tab)}
            />
          </div>
        )}

        {activeTab === "sale" && legacyMode && (
          <div className="legacy-workspace">
            <QuickEntry
              entries={displayEntries}
              settings={entrySettings}
              clientPolicy={effectiveRemotePolicy}
              pinned={false}
              modeCommand={modeCommand}
              storageScope={quickEntryStorageScope}
              onSubmit={submitEntry}
            />
            <TodayPanel
              summary={displaySummary}
              entries={displayEntries}
              settings={settings}
              canViewTotals={canViewRemoteTotals}
              canViewEntryValues={canViewRemoteEntryValues}
              onMode={(type) => setModeCommand({ type, nonce: Date.now() })}
            />
          </div>
        )}

        {activeTab === "history" && !pdvMainTab && (
          <HistoryPanel
            entries={historyEntries}
            settings={settings}
            focusDate={historyFocus}
            onChange={async () => {
              await reload();
            }}
            onToast={showToast}
            pdvSales={historyPdvSales}
            pdvCustomers={remoteSession ? remotePdvCustomers : pdvSnapshot?.customers || []}
            pdvReceivables={remoteSession ? remotePdvReceivables : pdvSnapshot?.receivables || []}
            pdvSettings={remoteSession ? remotePdvSnapshot?.settings : pdvSnapshot?.settings}
            printDevices={remoteSession ? [] : server.devices.filter((device) => device.permissions.printReceipts)}
            onPrintServer={remoteSession?.permissions.printReceipts ? (payload) => remoteRequest(remoteSession, "/api/pdv/print-receipt", {
              method: "POST",
              body: JSON.stringify(payload)
            }) : undefined}
            onEditRemote={remoteSession ? editRemoteEntry : undefined}
            onCancelRemote={remoteSession ? cancelRemoteEntry : undefined}
            onDeleteRemote={remoteSession ? deleteRemoteEntry : undefined}
            onRestoreRemote={remoteSession ? async (entry) => {
              if (!remoteSession.permissions.edit) return;
              await remoteRequest<{ entry: LedgerEntry }>(remoteSession, `/api/entries/${entry.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
              await refreshRemote(remoteSession);
              showToast("success", "Lancamento remoto restaurado.");
            } : undefined}
          />
        )}

        {activeTab === "dashboard" && (
          <DashboardPanel
            snapshot={remoteSession ? remotePdvSnapshot : pdvSnapshot}
            sales={remoteSession ? remotePdvSales : pdvSnapshot?.recentSales || []}
            remoteConnected={Boolean(remoteSession)}
            connectedDevices={remoteSession ? 1 : server.devices.length}
            canViewTotals={canViewRemoteTotals}
            onOpenReports={() => requestNavigation("reports")}
            onOpenClients={() => {
              requestNavigation("receivables");
            }}
            onOpenPayables={() => requestNavigation("payables")}
            onOpenTables={() => requestNavigation("tables")}
            onOpenProducts={() => {
              setSettingsFocus({ category: "pdv", nonce: Date.now() });
              requestNavigation("settings");
            }}
          />
        )}

        {(["clients", "receivables", "payables"] as TabKey[]).includes(activeTab) && (
          <section className="financial-workspace">
            <div className="financial-content">
              {activeTab !== "payables" ? (
                <div className="pdv-module-panel clients-main-panel">
                  <PdvApp
                    key={`finance-${activeTab}`}
                    embedded
                    initialTab="history"
                    initialHistoryView={activeTab === "receivables" ? "receivables" : "customers"}
                    hideHistoryNavigation
                    hideTopbar
                    snapshotOverride={remoteSession ? remotePdvSnapshot : pdvSnapshot}
                    remoteSession={remoteSession ? {
                      ...remoteSession,
                      roundingStep: effectiveRemotePolicy?.defaultRoundingStep,
                      roundingDirection: effectiveRemotePolicy?.defaultRoundingDirection,
                      allowPrint: remoteSession.permissions.printReceipts,
                      allowEdit: remoteSession.permissions.edit,
                      snapshot: remotePdvSnapshot
                    } : null}
                    toastDuration={settings.notificationDurationMs}
                    receiptPrintTargets={remoteSession
                      ? (remoteSession.permissions.printReceipts ? [{ id: "server", label: "Computador servidor" }] : [])
                      : server.devices.filter((device) => device.permissions.printReceipts).map((device) => ({ id: device.id, label: device.name }))}
                    onRemoteReceiptPrint={remoteSession
                      ? async (_targetId, payload) => remoteRequest(remoteSession, "/api/pdv/print-receipt", { method: "POST", body: JSON.stringify(payload) })
                      : async (targetId, payload) => window.caixa.requestRemotePdvReceiptPrint(targetId, payload)}
                    onNavigateMain={(tab) => requestNavigation(tab)}
                    onCreatePayableForCustomer={(customer) => {
                      setPayableCreateRequest({ supplier: customer.name, nonce: Date.now() });
                      requestNavigation("payables");
                    }}
                  />
                </div>
              ) : (
                <div className="pdv-module-panel payables-main-panel">
                  <PayablesPanel
                  payables={(remoteSession ? remotePdvSnapshot : pdvSnapshot)?.payables || []}
                  readOnly={Boolean(remoteSession && !remoteSession.permissions.manageTables)}
                  onSave={async (draft) => {
                    const payable = remoteSession
                      ? await remoteRequest<{ payable: PdvPayable }>(remoteSession, "/api/pdv/payables", { method: "POST", body: JSON.stringify(draft) }).then((result) => result.payable)
                      : await window.caixa.savePdvPayable(draft);
                    if (remoteSession) await refreshRemote(remoteSession);
                    else await reloadPdv();
                    return payable;
                  }}
                  onPay={async (id, payment) => {
                    const operationId = crypto.randomUUID();
                    const payable = remoteSession
                      ? await remoteRequest<{ payable: PdvPayable }>(remoteSession, `/api/pdv/payables/${id}/payments`, {
                          method: "POST",
                          headers: { "x-idempotency-key": operationId },
                          body: JSON.stringify({ payment })
                        }).then((result) => result.payable)
                      : await window.caixa.payPdvPayable(id, payment, operationId);
                    if (remoteSession) await refreshRemote(remoteSession);
                    else await reloadPdv();
                    return payable;
                  }}
                  onCancel={async (id) => {
                    if (remoteSession) {
                      await remoteRequest(remoteSession, `/api/pdv/payables/${id}/cancel`, { method: "POST" });
                      await refreshRemote(remoteSession);
                    } else {
                      await window.caixa.cancelPdvPayable(id);
                      await reloadPdv();
                    }
                  }}
                  onDelete={async (id) => {
                    if (remoteSession) {
                      await remoteRequest(remoteSession, `/api/pdv/payables/${id}`, { method: "DELETE" });
                      await refreshRemote(remoteSession);
                    } else {
                      await window.caixa.deletePdvPayable(id);
                      await reloadPdv();
                    }
                  }}
                  createRequest={payableCreateRequest}
                  onCreateRequestConsumed={() => setPayableCreateRequest(null)}
                  onToast={showToast}
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "reports" && (
            <ProfessionalReportsPanel entries={historyEntries} pdvSales={historyPdvSales} receivables={remoteSession ? remotePdvReceivables : pdvSnapshot?.receivables || []} settings={settings} summary={displaySummary} exportStatus={exportStatus} remoteClientActive={Boolean(remoteSession)} canViewTotals={canViewRemoteTotals} canViewEntryValues={canViewRemoteEntryValues} focusPeriod={reportFocus} onFocusConsumed={() => setReportFocus(null)} onOpenOutputDirectory={async () => {
              if (remoteSession) {
                showToast("info", "A pasta de Excel deve ser aberta no computador servidor.");
                return;
              }
              await window.caixa.openOutputDirectory();
            }} onExport={async () => {
            if (remoteSession) {
              showToast("info", "Exportacao de relatorio remoto fica no computador servidor.");
              return;
            }
            const status = await window.caixa.exportNow();
            setExportStatus(status);
            showToast(status.ok ? "success" : "error", status.message || "Exportacao executada.");
          }} onExportFiltered={async (ids, label) => {
            if (remoteSession) {
              showToast("info", "Exportacao de relatorio remoto fica no computador servidor.");
              return;
            }
            const status = await window.caixa.exportFilteredReport(ids, label);
            setExportStatus(status);
            showToast(status.ok ? "success" : "error", status.message || "Exportacao executada.");
          }} />
        )}

        {activeTab === "server" && (
          <ServerPanel
            settings={settings}
            server={server}
            remoteSession={remoteSession}
            remoteMessage={remoteMessage}
            remoteLoading={remoteLoading}
            onSaveSettings={saveSettings}
            onServerChange={setServer}
            onToast={showToast}
            onConnectRemote={connectRemoteClient}
            onDisconnectRemote={disconnectRemoteClient}
            onRefreshRemote={() => refreshRemote()}
            onSubmitRemote={submitRemoteEntry}
            onEditRemote={editRemoteEntry}
            onCancelRemote={cancelRemoteEntry}
            onDeleteRemote={deleteRemoteEntry}
          />
        )}

        {activeTab === "settings" && (
            <SettingsPanel
              settings={settings}
              remoteSession={remoteSession}
              remoteClientActive={Boolean(remoteSession)}
              remoteClientPermissions={remoteSession?.permissions}
              focusCategory={settingsFocus}
              onFocusCategoryConsumed={() => setSettingsFocus(null)}
              onSave={saveSettings}
              onToast={showToast}
              onImportLedger={importLedgerFile}
              onImportLedgerFolder={importLedgerFolder}
            />
        )}
      </main>

      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          busy={importingPreview}
          onClose={() => setImportPreview(null)}
          onConfirm={confirmLedgerImport}
        />
      )}
      {toast && <Toast toast={toast} />}
      {pdvNavigationRequest && (
        <SettingsConfirmModal
          title="Cancelar venda em andamento?"
          message="Existem produtos ainda nao finalizados na Venda. Ao sair, o carrinho atual sera cancelado."
          confirmLabel="Sair e cancelar venda"
          danger
          operational
          onCancel={() => setPdvNavigationRequest(null)}
          onConfirm={async () => {
            const nextTab = pdvNavigationRequest;
            setPdvNavigationRequest(null);
            setPdvDirectCartActive(false);
            setPdvViewNonce((nonce) => nonce + 1);
            setActiveTab(nextTab);
          }}
        />
      )}
      {versionMismatch && (
        <SettingsConfirmModal
          title="Versoes diferentes nao podem conectar"
          message={`Este computador usa ${versionMismatch.clientVersion} e o servidor usa ${versionMismatch.serverVersion}. Atualize ${versionMismatch.serverIsNewer ? "este computador" : "o computador servidor"} para a mesma versao antes de tentar novamente.`}
          confirmLabel={installingPromptUpdate ? "Verificando..." : "Verificar e atualizar"}
          onCancel={() => setVersionMismatch(null)}
          onConfirm={() => installPromptedUpdate("version")}
        />
      )}
      {!versionMismatch && startupUpdateInfo?.hasUpdate && (
        <SettingsConfirmModal
          title={`Nova versao ${startupUpdateInfo.latestVersion} disponivel`}
          message={`O Caixa PDV verificou a atualizacao diaria. Este computador esta na versao ${startupUpdateInfo.currentVersion}.`}
          confirmLabel={installingPromptUpdate ? "Baixando..." : "Baixar e instalar"}
          onCancel={() => setStartupUpdateInfo(null)}
          onConfirm={() => installPromptedUpdate("daily")}
        />
      )}
    </div>
  );
}

function PayablesPanel({
  payables,
  readOnly,
  onSave,
  onPay,
  onCancel,
  onDelete,
  createRequest,
  onCreateRequestConsumed,
  onToast
}: {
  payables: PdvPayable[];
  readOnly: boolean;
  onSave: (draft: PdvPayableDraft) => Promise<PdvPayable>;
  onPay: (id: string, payment: PdvPayablePayment) => Promise<PdvPayable>;
  onCancel: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  createRequest?: { supplier: string; nonce: number } | null;
  onCreateRequestConsumed?: () => void;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const today = getLocalDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEndDate = new Date(`${monthStart}T12:00:00`);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0);
  const monthEnd = getLocalDateKey(monthEndDate);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"Todos" | "Em aberto" | "Vencidas" | "Historico" | "Pagas" | "Canceladas" | "Excluidas">("Em aberto");
  const [editing, setEditing] = useState<PdvPayable | "new" | null>(null);
  const [paying, setPaying] = useState<PdvPayable | null>(null);
  const [selected, setSelected] = useState<PdvPayable | null>(null);
  const [cancelRequest, setCancelRequest] = useState<PdvPayable | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<PdvPayable | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSupplier, setNewSupplier] = useState("");

  useEffect(() => {
    if (!createRequest) return;
    setNewSupplier(createRequest.supplier);
    setEditing("new");
    onCreateRequestConsumed?.();
  }, [createRequest?.nonce]);

  const visible = payables.filter((payable) => {
    const inPeriod = (!from || payable.dueDate >= from) && (!to || payable.dueDate <= to);
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const queryMatch = !normalizedQuery || [
      payable.description,
      payable.supplier,
      payable.category,
      payable.costCenter,
      payable.documentNumber,
      payable.paymentAccount,
      ...(payable.tags || []),
      payable.note
    ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    const statusMatch = status === "Todos"
      || (status === "Em aberto" && ["Em aberto", "Parcialmente paga"].includes(payable.status))
      || (status === "Vencidas" && payable.status === "Vencida")
      || (status === "Pagas" && payable.status === "Paga")
      || (status === "Canceladas" && payable.status === "Cancelada")
      || (status === "Excluidas" && payable.status === "Excluida")
      || (status === "Historico" && ["Paga", "Cancelada", "Excluida"].includes(payable.status));
    return inPeriod && queryMatch && statusMatch;
  });
  const active = visible.filter((payable) => !["Cancelada", "Excluida"].includes(payable.status));
  const openBalance = roundMoney(active.reduce((sum, payable) => sum + payable.balance, 0));
  const overdue = active.filter((payable) => payable.status === "Vencida");
  const paidInPeriod = roundMoney(active.reduce((sum, payable) => sum + payable.paidAmount, 0));
  const dueToday = active.filter((payable) => payable.dueDate === today && !["Paga", "Cancelada", "Excluida"].includes(payable.status));
  const dueNextSevenDays = active.filter((payable) => {
    if (["Paga", "Cancelada", "Excluida"].includes(payable.status)) return false;
    const days = Math.ceil((new Date(`${payable.dueDate}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
    return days >= 0 && days <= 7;
  });
  const categories = [...new Set(payables.map((payable) => payable.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  const suppliers = [...new Set(payables.map((payable) => payable.supplier).filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  const syncSelection = (next: PdvPayable) => {
    setSelected(next);
    setPaying((current) => current?.id === next.id ? next : current);
  };

  return (
    <section className="payables-panel pdv-panel financial-module-shell pdv-payable-professional">
      <div className="pdv-section-head financial-module-head">
        <div>
          <span className="pdv-eyebrow">Financeiro</span>
          <h1>Contas a pagar</h1>
          <p>Vencimentos, fornecedores e pagamentos do negocio.</p>
        </div>
        <div className="financial-head-actions"><button className="pdv-ghost-button" onClick={() => downloadFinancialCsv(`contas-a-pagar-${today}.csv`, ["Descricao", "Fornecedor", "Categoria", "Centro de custo", "Documento", "Emissao", "Vencimento", "Valor", "Pago", "Saldo", "Situacao", "Conta prevista", "Tags", "Observacao"], visible.map((item) => [item.description, item.supplier, item.category, item.costCenter, item.documentNumber, item.issueDate, item.dueDate, item.amount, item.paidAmount, item.balance, item.status, item.paymentAccount, (item.tags || []).join(", "), item.note]))}><Download size={16} /> Exportar</button>{!readOnly && <button className="pdv-primary-button" onClick={() => setEditing("new")}><Plus size={17} /> Nova conta</button>}</div>
      </div>

      <div className="financial-metrics">
        <button onClick={() => setStatus("Em aberto")}><span>Saldo em aberto</span><strong>{formatCurrency(openBalance)}</strong><small>{active.filter((item) => !["Paga", "Cancelada", "Excluida"].includes(item.status)).length} conta(s)</small></button>
        <button className={overdue.length ? "warning" : ""} onClick={() => setStatus("Vencidas")}><span>Vencidas</span><strong>{formatCurrency(overdue.reduce((sum, item) => sum + item.balance, 0))}</strong><small>{overdue.length} pendencia(s)</small></button>
        <button onClick={() => { setFrom(today); setTo(today); setStatus("Todos"); }}><span>Vence hoje</span><strong>{formatCurrency(dueToday.reduce((sum, item) => sum + item.balance, 0))}</strong><small>{dueToday.length} conta(s)</small></button>
        <button onClick={() => setStatus("Todos")}><span>Proximos 7 dias</span><strong>{formatCurrency(dueNextSevenDays.reduce((sum, item) => sum + item.balance, 0))}</strong><small>{dueNextSevenDays.length} vencimento(s)</small></button>
        <button onClick={() => setStatus("Pagas")}><span>Pago no recorte</span><strong>{formatCurrency(paidInPeriod)}</strong><small>{active.filter((item) => item.paidAmount > 0).length} conta(s) com pagamento</small></button>
      </div>

      <div className="financial-filters">
        <label className="financial-search"><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Descricao, fornecedor, categoria, documento ou tag" /></label>
        <label><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>Ate</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label><span>Situacao</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{["Em aberto", "Vencidas", "Historico", "Pagas", "Canceladas", "Excluidas", "Todos"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <button onClick={() => { setFrom(""); setTo(""); setStatus("Todos"); setQuery(""); }}><RotateCcw size={15} /> Exibir tudo</button>
      </div>

      <div className="financial-master-detail">
        <div className="financial-account-list">
          <div className="financial-account-list-head"><span>Conta</span><span>Vencimento</span><span>Valor</span><span>Saldo</span><span>Situacao</span><span>Acoes</span></div>
          {visible.map((payable) => (
            <article key={payable.id} className={`${payable.status === "Vencida" ? "overdue" : ""} ${selected?.id === payable.id ? "selected" : ""}`} onClick={() => setSelected(payable)}>
              <div><strong>{payable.description}</strong><small>{payable.supplier || "Fornecedor nao informado"}{payable.category ? ` · ${payable.category}` : ""}</small></div>
              <time>{new Date(`${payable.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</time>
              <b>{formatCurrency(payable.amount)}</b>
              <b>{formatCurrency(payable.balance)}</b>
              <span className={`financial-status status-${payable.status.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-")}`}>{payable.status}</span>
              <div className="payable-row-actions">
                {!readOnly && !["Paga", "Cancelada", "Excluida"].includes(payable.status) && <button title="Registrar pagamento" onClick={(event) => { event.stopPropagation(); setPaying(payable); }}><Wallet size={15} /></button>}
                {!readOnly && !["Cancelada", "Excluida"].includes(payable.status) && <button title="Editar conta" onClick={(event) => { event.stopPropagation(); setEditing(payable); }}><Edit3 size={15} /></button>}
                {!readOnly && payable.paidAmount <= 0.009 && !["Cancelada", "Excluida"].includes(payable.status) && <button className="danger" title="Cancelar conta" onClick={(event) => { event.stopPropagation(); setCancelRequest(payable); }}><X size={15} /></button>}
                {!readOnly && payable.status !== "Excluida" && <button className="danger" title="Mover para excluidas" onClick={(event) => { event.stopPropagation(); setDeleteRequest(payable); }}><Trash2 size={15} /></button>}
              </div>
            </article>
          ))}
          {!visible.length && (
            <div className="financial-detail-empty">
              <CalendarDays size={30} />
              <strong>Nenhuma conta neste recorte</strong>
              <span>Ajuste os filtros ou cadastre o primeiro vencimento.</span>
            </div>
          )}
        </div>
        <aside className="financial-account-detail">
          {selected ? (
            <>
              <div className="financial-detail-title"><span className="pdv-eyebrow">Detalhes da conta</span><h3>{selected.description}</h3><p>{selected.note || "Sem observacoes."}</p></div>
              <dl>
                <div><dt>Fornecedor</dt><dd>{selected.supplier || "Nao informado"}</dd></div>
                <div><dt>Categoria</dt><dd>{selected.category || "Nao informada"}</dd></div>
                <div><dt>Centro de custo</dt><dd>{selected.costCenter || "Nao informado"}</dd></div>
                <div><dt>Documento</dt><dd>{selected.documentNumber || "Nao informado"}</dd></div>
                <div><dt>Conta prevista</dt><dd>{selected.paymentAccount || "Nao informada"}</dd></div>
                <div><dt>Emissao</dt><dd>{selected.issueDate ? new Date(`${selected.issueDate}T12:00:00`).toLocaleDateString("pt-BR") : "Nao informada"}</dd></div>
                {selected.installmentCount && selected.installmentCount > 1 && <div><dt>Parcela</dt><dd>{selected.installmentNumber}/{selected.installmentCount}</dd></div>}
                <div><dt>Valor original</dt><dd>{formatCurrency(selected.amount)}</dd></div>
              </dl>
              {(selected.tags || []).length > 0 && <div className="financial-tag-list">{(selected.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div>}
              {!readOnly && !["Paga", "Cancelada", "Excluida"].includes(selected.status) && (
                <div className="financial-detail-actions payable-detail-actions">
                  <button className="pdv-primary-button" onClick={() => setPaying(selected)}>
                    <Wallet size={16} /> Registrar pagamento
                  </button>
                </div>
              )}
              <div className="financial-payment-history">
                <strong>Pagamentos</strong>
                {selected.payments.map((payment) => (
                  <div key={payment.id}><span>{new Date(payment.createdAt).toLocaleDateString("pt-BR")} · {payment.method}</span><b>{formatCurrency(payment.amount)}</b><small>{payment.description || payment.originDevice || ""}</small></div>
                ))}
                {!selected.payments.length && <span>Nenhum pagamento registrado.</span>}
              </div>
              <div className="financial-audit-timeline">
                <strong>Linha do tempo</strong>
                {(selected.events || []).map((event) => (
                  <div key={event.id}><i /><span><b>{event.action}</b>{event.description}</span><time>{new Date(event.createdAt).toLocaleString("pt-BR")} · {event.originDevice}</time>{event.amount !== undefined && <em>{formatCurrency(event.amount)}</em>}</div>
                ))}
                {!selected.events?.length && <div className="financial-audit-created"><i /><span><b>Criacao</b>Conta cadastrada no sistema.</span><time>{new Date(selected.createdAt).toLocaleString("pt-BR")}</time></div>}
              </div>
            </>
          ) : (
            <div className="financial-detail-empty"><Wallet size={28} /><strong>Selecione uma conta</strong><span>Os dados e pagamentos aparecerao aqui.</span></div>
          )}
        </aside>
      </div>

      {editing && (
        <PayableEditorModal
          payable={editing === "new" ? null : editing}
          initialSupplier={editing === "new" ? newSupplier : undefined}
          categories={categories}
          suppliers={suppliers}
          busy={busy}
          onCancel={() => { setEditing(null); setNewSupplier(""); }}
          onSave={async (draft) => {
            setBusy(true);
            try {
              const installmentCount = editing === "new" ? Math.max(1, Math.min(60, Math.floor(draft.installmentCount || 1))) : 1;
              const recurrenceInterval = editing === "new" && installmentCount === 1 ? Math.max(0, Math.floor(draft.recurrenceIntervalMonths || 0)) : 0;
              const recurrenceCount = recurrenceInterval > 0 ? Math.max(2, Math.min(60, Math.floor(draft.recurrenceCount || 2))) : 1;
              const seriesCount = installmentCount > 1 ? installmentCount : recurrenceCount;
              let next: PdvPayable;
              if (seriesCount > 1) {
                const totalCents = Math.round(draft.amount * 100);
                const baseCents = Math.floor(totalCents / installmentCount);
                const seriesId = draft.seriesId || draft.id || crypto.randomUUID();
                const created: PdvPayable[] = [];
                for (let index = 0; index < seriesCount; index += 1) {
                  const amountCents = installmentCount > 1
                    ? (index === installmentCount - 1 ? totalCents - baseCents * (installmentCount - 1) : baseCents)
                    : totalCents;
                  created.push(await onSave({
                    ...draft,
                    id: `${seriesId}-${index + 1}`,
                    seriesId,
                    seriesKind: installmentCount > 1 ? "Parcelamento" : "Recorrencia",
                    installmentNumber: index + 1,
                    installmentCount: seriesCount,
                    description: `${draft.description} (${index + 1}/${seriesCount})`,
                    dueDate: addMonthsClamped(draft.dueDate, index * (installmentCount > 1 ? 1 : recurrenceInterval)),
                    amount: amountCents / 100,
                    payments: []
                  }));
                }
                next = created[0];
              } else {
                next = await onSave({ ...draft, installmentCount: draft.installmentCount || 1 });
              }
              syncSelection(next);
              setEditing(null);
              setNewSupplier("");
              onToast("success", editing === "new" ? (installmentCount > 1 ? `${installmentCount} parcelas cadastradas.` : recurrenceCount > 1 ? `${recurrenceCount} contas recorrentes cadastradas.` : "Conta a pagar cadastrada.") : "Conta atualizada.");
            } catch (error) {
              onToast("error", error instanceof Error ? error.message : "Nao foi possivel salvar a conta.");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {paying && (
        <PayablePaymentModal
          payable={paying}
          busy={busy}
          onCancel={() => setPaying(null)}
          onConfirm={async (payment) => {
            setBusy(true);
            try {
              const next = await onPay(paying.id, payment);
              syncSelection(next);
              setPaying(null);
              onToast("success", next.status === "Paga" ? "Conta paga por completo." : "Pagamento parcial registrado.");
            } catch (error) {
              onToast("error", error instanceof Error ? error.message : "Nao foi possivel registrar o pagamento.");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {cancelRequest && (
        <SettingsConfirmModal
          title="Cancelar conta a pagar?"
          message={`${cancelRequest.description} sera mantida no historico com a situacao Cancelada.`}
          confirmLabel="Cancelar conta"
          danger
          onCancel={() => setCancelRequest(null)}
          onConfirm={async () => {
            await onCancel(cancelRequest.id);
            setSelected((current) => current?.id === cancelRequest.id ? null : current);
            setCancelRequest(null);
            onToast("success", "Conta cancelada.");
          }}
        />
      )}
      {deleteRequest && (
        <SettingsConfirmModal
          title="Excluir conta a pagar?"
          message={`${deleteRequest.description} saira da lista principal e ficara disponivel no filtro Excluidas.`}
          confirmLabel="Excluir conta"
          danger
          onCancel={() => setDeleteRequest(null)}
          onConfirm={async () => {
            await onDelete(deleteRequest.id);
            setSelected((current) => current?.id === deleteRequest.id ? null : current);
            setDeleteRequest(null);
            onToast("success", "Conta movida para o historico de excluidas.");
          }}
        />
      )}
    </section>
  );
}

function PayableEditorModal({
  payable,
  initialSupplier,
  categories,
  suppliers,
  busy,
  onCancel,
  onSave
}: {
  payable: PdvPayable | null;
  initialSupplier?: string;
  categories: string[];
  suppliers: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: PdvPayableDraft) => void;
}) {
  const [draft, setDraft] = useState<PdvPayableDraft>({
    id: payable?.id || crypto.randomUUID(),
    description: payable?.description || "",
    supplier: payable?.supplier || initialSupplier || "",
    category: payable?.category || "",
    costCenter: payable?.costCenter || "",
    documentNumber: payable?.documentNumber || "",
    paymentAccount: payable?.paymentAccount || "",
    tags: payable?.tags || [],
    issueDate: payable?.issueDate || getLocalDateKey(),
    seriesId: payable?.seriesId,
    installmentNumber: payable?.installmentNumber,
    installmentCount: payable?.installmentCount || 1,
    recurrenceIntervalMonths: 0,
    recurrenceCount: 2,
    dueDate: payable?.dueDate || getLocalDateKey(),
    amount: payable?.amount || 0,
    note: payable?.note || ""
  });
  const [amountText, setAmountText] = useState(payable ? String(payable.amount).replace(".", ",") : "");
  const [payments, setPayments] = useState<PdvPayablePayment[]>(() => payable?.payments.map((payment) => ({ ...payment })) || []);
  const amount = roundMoney(parseMoney(amountText));
  const paidAmount = roundMoney(payments.reduce((sum, payment) => sum + roundMoney(Number(payment.amount) || 0), 0));
  const balance = roundMoney(Math.max(0, amount - paidAmount));
  const paymentsValid = payments.every((payment) => Number.isFinite(Number(payment.amount)) && Number(payment.amount) > 0)
    && paidAmount - amount <= 0.009;
  const updatePayment = (id: string, patch: Partial<PdvPayablePayment>) => {
    setPayments((current) => current.map((payment) => payment.id === id ? { ...payment, ...patch } : payment));
  };
  const addPayment = () => {
    const nextAmount = balance > 0.009 ? balance : 0;
    setPayments((current) => [...current, {
      id: crypto.randomUUID(),
      payableId: payable?.id || draft.id || "",
      createdAt: new Date().toISOString(),
      method: "Pix",
      amount: nextAmount,
      description: "",
      originDevice: "Edicao da conta"
    }]);
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal payable-editor-modal">
        <div className="modal-head"><div><span className="settings-overline">Contas a pagar</span><strong>{payable ? "Editar conta" : "Nova conta"}</strong></div><button className="icon-button" onClick={onCancel}><X size={18} /></button></div>
        <div className="payable-editor-body">
          <div className="payable-form-grid">
            <label className="wide"><span>Descricao *</span><input autoFocus value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ex.: Energia eletrica da loja" /></label>
            <label><span>{!payable && (draft.installmentCount || 1) > 1 ? "Valor total *" : "Valor *"}</span><input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="0,00" /></label>
            {!payable && <label><span>Parcelas</span><input type="number" min="1" max="60" value={draft.installmentCount || 1} onChange={(event) => setDraft({ ...draft, installmentCount: Math.max(1, Math.min(60, Math.floor(Number(event.target.value) || 1))) })} /></label>}
            {!payable && (draft.installmentCount || 1) === 1 && <label><span>Recorrencia</span><select value={draft.recurrenceIntervalMonths || 0} onChange={(event) => setDraft({ ...draft, recurrenceIntervalMonths: Number(event.target.value) })}><option value="0">Nao repetir</option><option value="1">Mensal</option><option value="2">Bimestral</option><option value="3">Trimestral</option><option value="6">Semestral</option><option value="12">Anual</option></select></label>}
            {!payable && (draft.recurrenceIntervalMonths || 0) > 0 && <label><span>Quantidade de ocorrencias</span><input type="number" min="2" max="60" value={draft.recurrenceCount || 2} onChange={(event) => setDraft({ ...draft, recurrenceCount: Math.max(2, Math.min(60, Math.floor(Number(event.target.value) || 2))) })} /></label>}
            <label><span>Data de emissao</span><input type="date" value={draft.issueDate || ""} onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })} /></label>
            <label><span>Vencimento *</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label><span>Fornecedor</span><input list="payable-suppliers" value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} placeholder="Opcional" /><datalist id="payable-suppliers">{suppliers.map((value) => <option key={value} value={value} />)}</datalist></label>
            <label><span>Categoria</span><input list="payable-categories" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Ex.: Energia, aluguel..." /><datalist id="payable-categories">{categories.map((value) => <option key={value} value={value} />)}</datalist></label>
            <label><span>Centro de custo</span><input value={draft.costCenter || ""} onChange={(event) => setDraft({ ...draft, costCenter: event.target.value })} placeholder="Ex.: Loja, cozinha, administrativo" /></label>
            <label><span>Conta/caixa previsto</span><input value={draft.paymentAccount || ""} onChange={(event) => setDraft({ ...draft, paymentAccount: event.target.value })} placeholder="Ex.: Caixa principal, Banco" /></label>
            <label className="wide"><span>Numero do documento</span><input value={draft.documentNumber} onChange={(event) => setDraft({ ...draft, documentNumber: event.target.value })} placeholder="Nota fiscal, boleto ou referencia opcional" /></label>
            <label className="wide"><span>Tags</span><input value={(draft.tags || []).join(", ")} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Ex.: fixa, urgente, fornecedor local" /></label>
            <label className="wide"><span>Observacoes</span><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Informacoes internas sobre esta despesa." /></label>
          </div>
          {!payable && (draft.installmentCount || 1) > 1 && <div className="financial-installment-preview"><CalendarDays size={17} /><span>O total sera dividido em <b>{draft.installmentCount} parcelas mensais</b>, a partir do vencimento informado. Cada parcela tera seu proprio pagamento e historico.</span></div>}
          {!payable && (draft.installmentCount || 1) === 1 && (draft.recurrenceIntervalMonths || 0) > 0 && <div className="financial-installment-preview"><RotateCcw size={17} /><span>Serão criadas <b>{draft.recurrenceCount || 2} contas recorrentes</b>. O valor informado será repetido em cada ocorrência, com vencimentos calculados automaticamente.</span></div>}
          <section className="payable-editor-payments">
            <div className="payable-editor-section-head">
              <div><strong>Pagamentos da conta</strong><span>Edite ou remova pagamentos incorretos antes de salvar.</span></div>
              <button type="button" className="ghost-button" onClick={addPayment} disabled={balance <= 0.009 || (!payable && (draft.installmentCount || 1) > 1)}><Plus size={16} /> Adicionar pagamento</button>
            </div>
            <div className="payable-editor-summary">
              <span>Valor <b>{formatCurrency(amount)}</b></span>
              <span>Pago <b>{formatCurrency(paidAmount)}</b></span>
              <span>Saldo <b>{formatCurrency(balance)}</b></span>
            </div>
            <div className="payable-editor-payment-list">
              {payments.map((payment) => (
                <div key={payment.id} className="payable-editor-payment-row">
                  <label><span>Data</span><input type="date" value={String(payment.createdAt).slice(0, 10)} onChange={(event) => updatePayment(payment.id, { createdAt: `${event.target.value}T12:00:00.000Z` })} /></label>
                  <label><span>Forma</span><select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PdvPayablePayment["method"] })}>{["Dinheiro", "Debito", "Credito", "Pix", "Outros", "Nao definido"].map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label><span>Valor</span><input type="number" min="0.01" step="0.01" value={Number.isFinite(Number(payment.amount)) ? payment.amount : ""} onChange={(event) => updatePayment(payment.id, { amount: Number(event.target.value) })} /></label>
                  <label className="payment-description"><span>Observacao</span><input value={payment.description || ""} onChange={(event) => updatePayment(payment.id, { description: event.target.value })} placeholder="Opcional" /></label>
                  <button type="button" className="icon-button danger" title="Remover pagamento" onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}><Trash2 size={17} /></button>
                </div>
              ))}
              {!payments.length && <div className="payable-editor-payment-empty">Nenhum pagamento registrado. A conta permanecera em aberto.</div>}
            </div>
            {!paymentsValid && <div className="payable-editor-warning"><TriangleAlert size={16} /> O total pago nao pode ultrapassar o valor da conta e todos os pagamentos precisam ser maiores que zero.</div>}
          </section>
        </div>
        <div className="modal-actions"><button className="ghost-button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="primary-button" disabled={busy || !draft.description.trim() || !draft.dueDate || amount <= 0 || !paymentsValid} onClick={() => onSave({ ...draft, amount, payments })}>{busy ? "Salvando..." : "Salvar conta"}</button></div>
      </section>
    </div>
  );
}

function PayablePaymentModal({ payable, busy, onCancel, onConfirm }: { payable: PdvPayable; busy: boolean; onCancel: () => void; onConfirm: (payment: PdvPayablePayment) => void }) {
  const methods: Array<Exclude<PdvPaymentMethod, "Conta a receber" | "Nao definido">> = ["Dinheiro", "Debito", "Credito", "Pix", "Outros"];
  const [method, setMethod] = useState<typeof methods[number] | null>(null);
  const [description, setDescription] = useState("");
  const confirmPayment = (payment: PdvPayment) => {
    onConfirm({
      id: crypto.randomUUID(),
      payableId: payable.id,
      createdAt: new Date().toISOString(),
      method: payment.method as Exclude<PdvPaymentMethod, "Conta a receber">,
      amount: payment.amount,
      description: description.trim() || undefined
    });
  };
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop" role="dialog" aria-modal="true">
      <section className="pdv-payment-modal pdv-collection-modal pdv-admin-modal payable-payment-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Pagamento de conta</span>
            <h1>{payable.description}</h1>
            <p>Saldo atual: {formatCurrency(payable.balance)}</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel} disabled={busy}><X size={18} /></button>
        </div>
        <div className="pdv-payment-methods" aria-label="Forma de pagamento">
          {methods.map((value) => (
            <button key={value} type="button" className={method === value ? "active" : ""} disabled={busy} onClick={() => setMethod(value)}>
              {value}
            </button>
          ))}
        </div>
        <label className="pdv-payment-description">
          <span>Observacao do pagamento</span>
          <input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Comprovante, conta utilizada ou observacao opcional" />
          <small>A observacao ficara salva no historico desta conta.</small>
        </label>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" onClick={onCancel} disabled={busy}>Voltar</button>
        </div>
        {method && (
          <PaymentAmountModal
            key={`${method}-${payable.balance}`}
            method={method}
            remaining={payable.balance}
            context="payable"
            onCancel={() => setMethod(null)}
            onConfirm={confirmPayment}
          />
        )}
      </section>
    </div>
  );
}

function DashboardPanel({
  snapshot,
  sales,
  remoteConnected,
  connectedDevices,
  canViewTotals,
  onOpenReports,
  onOpenClients,
  onOpenPayables,
  onOpenTables,
  onOpenProducts
}: {
  snapshot: PdvSnapshot | null;
  sales: PdvSale[];
  remoteConnected: boolean;
  connectedDevices: number;
  canViewTotals: boolean;
  onOpenReports: () => void;
  onOpenClients: () => void;
  onOpenPayables: () => void;
  onOpenTables: () => void;
  onOpenProducts: () => void;
}) {
  if (!snapshot) {
    return (
      <section className="dashboard-panel dashboard-loading" aria-label="Carregando Visao geral">
        <div /><div /><div /><div />
      </section>
    );
  }
  const today = getLocalDateKey();
  const todaySales = sales.filter((sale) => getLocalDateKey(sale.createdAt) === today && sale.status !== "Cancelada" && sale.status !== "deleted");
  const totalToday = roundMoney(todaySales.reduce((sum, sale) => sum + sale.total, 0));
  const ticketAverage = todaySales.length ? roundMoney(totalToday / todaySales.length) : 0;
  const openTables = snapshot.tables.filter((table) => table.items.length > 0 || table.status === "Ocupada" || table.status === "Fechamento");
  const activeReceivables = snapshot.receivables.filter((receivable) => !["Recebida", "Cancelada", "Excluida"].includes(receivable.status));
  const overdueReceivables = activeReceivables.filter((receivable) => Boolean(receivable.dueDate && receivable.dueDate < today));
  const receivableBalance = roundMoney(activeReceivables.reduce((sum, receivable) => sum + receivable.balance, 0));
  const activePayables = (snapshot.payables || []).filter((payable) => !["Paga", "Cancelada", "Excluida"].includes(payable.status));
  const overduePayables = activePayables.filter((payable) => payable.status === "Vencida");
  const payableBalance = roundMoney(activePayables.reduce((sum, payable) => sum + payable.balance, 0));
  const projectionLimit = addMonthsClamped(today, 1);
  const receivableNext30 = roundMoney(activeReceivables.filter((item) => !item.dueDate || item.dueDate <= projectionLimit).reduce((sum, item) => sum + item.balance, 0));
  const payableNext30 = roundMoney(activePayables.filter((item) => item.dueDate <= projectionLimit).reduce((sum, item) => sum + item.balance, 0));
  const projectedFinancialResult = roundMoney(receivableNext30 - payableNext30);
  const lowStock = snapshot.products
    .filter((product) => product.active && product.trackStock && (product.stockQuantity || 0) <= (product.minimumStock || 0))
    .sort((left, right) => (left.stockQuantity || 0) - (right.stockQuantity || 0));
  const costByProduct = new Map(snapshot.products.map((product) => [product.id, product.costPrice || 0]));
  const estimatedCost = roundMoney(todaySales.reduce((saleSum, sale) => saleSum + sale.items.reduce(
    (itemSum, item) => itemSum + (costByProduct.get(item.productId) || 0) * item.quantity,
    0
  ), 0));
  const estimatedGrossProfit = roundMoney(totalToday - estimatedCost);
  const productsToday = new Map<string, { quantity: number; total: number }>();
  todaySales.forEach((sale) => sale.items.forEach((item) => {
    const current = productsToday.get(item.productName) || { quantity: 0, total: 0 };
    current.quantity += item.quantity;
    current.total += item.total;
    productsToday.set(item.productName, current);
  }));
  const topProducts = [...productsToday.entries()].sort((left, right) => right[1].quantity - left[1].quantity).slice(0, 6);
  const privacyValue = (value: number) => canViewTotals ? formatCurrency(value) : "Privado";

  return (
    <section className="dashboard-panel">
      <div className="dashboard-intro">
        <div>
          <span className="settings-overline">Resumo operacional de hoje</span>
          <h2>O que precisa da sua atencao agora</h2>
          <p>Vendas, mesas, recebimentos, estoque e rede reunidos sem interromper o fluxo do caixa.</p>
        </div>
        <div className={`dashboard-network ${remoteConnected || connectedDevices > 0 ? "online" : ""}`}>
          <Wifi size={18} />
          <span>{remoteConnected ? "Cliente sincronizado" : connectedDevices > 0 ? `${connectedDevices} cliente(s) conectado(s)` : "Servidor local sem clientes"}</span>
        </div>
      </div>

      <div className="dashboard-metrics">
        <button onClick={onOpenReports}>
          <span>Vendas de hoje</span>
          <strong>{privacyValue(totalToday)}</strong>
          <small>{todaySales.length} fechamento(s) · ticket {privacyValue(ticketAverage)}</small>
        </button>
        <button onClick={onOpenTables}>
          <span>Mesas em atendimento</span>
          <strong>{openTables.length}</strong>
          <small>{openTables.reduce((sum, table) => sum + table.items.length, 0)} item(ns) ainda em aberto</small>
        </button>
        <button onClick={onOpenClients} className={overdueReceivables.length ? "warning" : ""}>
          <span>Contas a receber</span>
          <strong>{privacyValue(receivableBalance)}</strong>
          <small>{overdueReceivables.length} vencida(s) de {activeReceivables.length} em aberto</small>
        </button>
        <button onClick={onOpenPayables} className={overduePayables.length ? "warning" : ""}>
          <span>Contas a pagar</span>
          <strong>{privacyValue(payableBalance)}</strong>
          <small>{overduePayables.length} vencida(s) de {activePayables.length} em aberto</small>
        </button>
        <button onClick={onOpenProducts} className={lowStock.length ? "warning" : ""}>
          <span>Estoque baixo</span>
          <strong>{lowStock.length}</strong>
          <small>{snapshot.products.filter((product) => product.trackStock).length} produto(s) monitorado(s)</small>
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-performance">
          <div className="dashboard-section-head">
            <div><BarChart3 size={18} /><span><strong>Desempenho do dia</strong><small>Estimativa baseada no custo atual dos produtos.</small></span></div>
            <button onClick={onOpenReports}>Abrir relatorios</button>
          </div>
          <div className="dashboard-profit-line">
            <div><span>Faturamento</span><strong>{privacyValue(totalToday)}</strong></div>
            <div><span>Custo estimado</span><strong>{privacyValue(estimatedCost)}</strong></div>
            <div><span>Lucro bruto estimado</span><strong>{privacyValue(estimatedGrossProfit)}</strong></div>
            <div className={projectedFinancialResult < 0 ? "warning" : ""}><span>Projecao financeira 30 dias</span><strong>{privacyValue(projectedFinancialResult)}</strong><small>{privacyValue(receivableNext30)} a receber · {privacyValue(payableNext30)} a pagar</small></div>
          </div>
          <div className="dashboard-top-products">
            <strong>Produtos mais vendidos hoje</strong>
            {topProducts.map(([name, result], index) => (
              <div key={name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{name}</b>
                <small>{formatReportQuantity(result.quantity)} · {privacyValue(result.total)}</small>
              </div>
            ))}
            {!topProducts.length && <p className="dashboard-empty">As primeiras vendas do dia aparecerao aqui.</p>}
          </div>
        </section>

        <aside className="dashboard-attention">
          <div className="dashboard-section-head">
            <div><TriangleAlert size={18} /><span><strong>Atencao</strong><small>Pontos que podem exigir uma acao.</small></span></div>
          </div>
          <button onClick={onOpenProducts} className={lowStock.length ? "alert" : ""}>
            <Boxes size={18} />
            <span><strong>{lowStock.length ? `${lowStock.length} estoque(s) no limite` : "Estoque em ordem"}</strong><small>{lowStock.slice(0, 3).map((product) => `${product.name} (${formatReportQuantity(product.stockQuantity || 0)})`).join(" · ") || "Nenhum produto abaixo do minimo."}</small></span>
          </button>
          <button onClick={onOpenClients} className={overdueReceivables.length ? "alert" : ""}>
            <Wallet size={18} />
            <span><strong>{overdueReceivables.length ? `${overdueReceivables.length} conta(s) vencida(s)` : "Recebimentos em dia"}</strong><small>{overdueReceivables.length ? `${privacyValue(overdueReceivables.reduce((sum, item) => sum + item.balance, 0))} aguardando recebimento` : "Nenhum vencimento atrasado."}</small></span>
          </button>
          <button onClick={onOpenPayables} className={overduePayables.length ? "alert" : ""}>
            <CalendarDays size={18} />
            <span><strong>{overduePayables.length ? `${overduePayables.length} despesa(s) vencida(s)` : "Despesas em dia"}</strong><small>{overduePayables.length ? `${privacyValue(overduePayables.reduce((sum, item) => sum + item.balance, 0))} aguardando pagamento` : "Nenhuma conta a pagar atrasada."}</small></span>
          </button>
          <button onClick={onOpenTables}>
            <Utensils size={18} />
            <span><strong>{openTables.length} mesa(s) aberta(s)</strong><small>{openTables.slice(0, 5).map((table) => String(table.number).padStart(3, "0")).join(", ") || "Nenhuma mesa em atendimento."}</small></span>
          </button>
        </aside>
      </div>
    </section>
  );
}

function QuickEntry({
  entries,
  settings,
  clientPolicy,
  pinned,
  modeCommand,
  storageScope,
  onSubmit,
  onUnpin
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  clientPolicy?: RemoteClientPolicy;
  pinned: boolean;
  modeCommand: ModeCommand | null;
  storageScope?: string;
  onSubmit: (draft: EntryDraft) => Promise<void>;
  onUnpin?: () => Promise<void> | void;
}) {
  const remoteFieldLimited = Boolean(clientPolicy);
  const allowedTypes = clientPolicy?.allowedTypes?.length ? clientPolicy.allowedTypes : ENTRY_TYPES;
  const policyVisibleFields = normalizeFloatingFields(clientPolicy?.visibleFields || settings.floating.visibleFields);
  const quickTabsForEntry = clientPolicy?.quickTabs?.length ? clientPolicy.quickTabs.filter((tab) => allowedTypes.includes(tab.type)) : enabledQuickTabs(settings);
  const paymentMethodsForEntry = clientPolicy?.paymentMethods?.length ? clientPolicy.paymentMethods : PAYMENT_METHODS;
  const initialModeRef = useRef<QuickEntryModeState | null>(null);
  if (!initialModeRef.current) {
    initialModeRef.current = sanitizeQuickEntryModeState(
      readQuickEntryModeState(storageScope),
      settings,
      clientPolicy,
      allowedTypes,
      quickTabsForEntry
    );
  }
  const initialMode = initialModeRef.current;
  const [type, setType] = useState<EntryType>(() => initialMode.type);
  const [valueText, setValueText] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState(settings.defaultPeople);
  const [tableNumber, setTableNumber] = useState("");
  const [busNumber, setBusNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Nao informado");
  const [cashLinkedType, setCashLinkedType] = useState<EntryType>(() => initialMode.cashLinkedType);
  const [paidWithText, setPaidWithText] = useState("");
  const [observations, setObservations] = useState("");
  const [roundingStep, setRoundingStep] = useState(settings.defaultRoundingStep);
  const [roundingDirection, setRoundingDirection] = useState<RoundDirection>(settings.defaultRoundingDirection);
  const [registerDifference, setRegisterDifference] = useState(true);
  const [showSplitAdjustment, setShowSplitAdjustment] = useState(false);
  const [activeQuickTabId, setActiveQuickTabId] = useState(() => initialMode.activeQuickTabId);
  const [submitting, setSubmitting] = useState(false);
  const storageScopeRef = useRef(storageScope);

  const value = parseMoney(valueText);
  const paidWith = parseMoney(paidWithText);
  const split = calculateSplit(value, people, roundingStep, roundingDirection, registerDifference);
  const effectivePaidWith = paidWith > 0 ? paidWith : value;
  const cash = calculateCash(value, effectivePaidWith);
  const lastActive = entries.find((entry) => entry.status === "active");
  const tableFieldEnabled = settings.tableNumberEnabled !== false && clientPolicy?.tableNumberEnabled !== false;
  const busFieldEnabled = settings.busNumberEnabled !== false && clientPolicy?.busNumberEnabled !== false;

  useEffect(() => {
    if (modeCommand) {
      if (settings.floating.syncMoneyWithEntryType && modeCommand.type === "Dinheiro/Troco") {
        setCashLinkedType(cashLinkFromEntryType(type, cashLinkedType));
      }
      const nextType = allowedTypes.includes(modeCommand.type) ? modeCommand.type : clientPolicy?.defaultType || settings.defaultType;
      setType(nextType);
      const matchingTab = quickTabForType(quickTabsForEntry, nextType);
      setActiveQuickTabId(matchingTab?.id || "manual");
    }
  }, [modeCommand?.nonce, settings.floating.syncMoneyWithEntryType, settings.quickTabs, clientPolicy?.allowedTypes, clientPolicy?.quickTabs]);

  useEffect(() => {
    if (storageScopeRef.current === storageScope) {
      return;
    }
    storageScopeRef.current = storageScope;
    const nextState = sanitizeQuickEntryModeState(
      readQuickEntryModeState(storageScope),
      settings,
      clientPolicy,
      allowedTypes,
      quickTabsForEntry
    );
    setType(nextState.type);
    setCashLinkedType(nextState.cashLinkedType);
    setActiveQuickTabId(nextState.activeQuickTabId);
  }, [storageScope, settings.quickTabs, settings.defaultType, clientPolicy?.quickTabs, clientPolicy?.allowedTypes]);

  useEffect(() => {
    if (!allowedTypes.includes(type)) {
      setType(clientPolicy?.defaultType || allowedTypes[0] || "Venda");
      return;
    }
    if (!allowedTypes.includes(cashLinkedType)) {
      setCashLinkedType(defaultCashLinkForAllowedTypes(allowedTypes, cashLinkedType));
    }
    const currentTab = quickTabsForEntry.find((tab) => tab.id === activeQuickTabId);
    if (currentTab?.type === type) {
      return;
    }
    const matchingTab = quickTabForType(quickTabsForEntry, type);
    setActiveQuickTabId(matchingTab?.id || currentTab?.id || "manual");
  }, [settings.quickTabs, clientPolicy?.quickTabs, clientPolicy?.allowedTypes, type, cashLinkedType, activeQuickTabId]);

  useEffect(() => {
    const state = sanitizeQuickEntryModeState(
      { type, cashLinkedType, activeQuickTabId },
      settings,
      clientPolicy,
      allowedTypes,
      quickTabsForEntry
    );
    writeQuickEntryModeState(storageScope, state);
  }, [storageScope, settings.quickTabs, settings.defaultType, clientPolicy?.quickTabs, clientPolicy?.allowedTypes, type, cashLinkedType, activeQuickTabId]);

  useEffect(() => {
    if (tableFieldEnabled && type === "Mesa" && tableNumber && !description) {
      setDescription(`Mesa ${tableNumber}`);
    }
    if (busFieldEnabled && type === "Onibus" && busNumber && !description) {
      setDescription(`Onibus ${busNumber}`);
    }
    if (tableFieldEnabled && type === "Dinheiro/Troco" && cashLinkedType === "Mesa" && tableNumber && !description) {
      setDescription(`Mesa ${tableNumber}`);
    }
    if (busFieldEnabled && type === "Dinheiro/Troco" && cashLinkedType === "Onibus" && busNumber && !description) {
      setDescription(`Onibus ${busNumber}`);
    }
  }, [type, cashLinkedType, tableNumber, busNumber, tableFieldEnabled, busFieldEnabled]);

  const visible = (field: string) => (!pinned && !remoteFieldLimited) || policyVisibleFields.includes(field);

  const clearForm = () => {
    setValueText("");
    setDescription("");
    setPeople(clientPolicy?.defaultPeople || settings.defaultPeople);
    setTableNumber("");
    setBusNumber("");
    setPaidWithText("");
    setObservations("");
  };

  const submit = async () => {
    if (value <= 0 && type !== "Cancelado/Estorno") {
      return;
    }
    setSubmitting(true);
    const visibleFields = new Set(policyVisibleFields);
    const isMoney = type === "Dinheiro/Troco";
    const effectiveType: EntryType =
      pinned && type !== "Dinheiro/Troco" && people > 1 && allowedTypes.includes("Divisao de conta") ? "Divisao de conta" : type;
    const effectiveSplit = effectiveType === "Divisao de conta" ? split : undefined;
    const effectiveCash = effectiveType === "Dinheiro/Troco" ? cash : undefined;
    const effectiveDescription =
      visibleFields.has("description")
        ? description ||
          (isMoney && cashLinkedType === "Mesa" && tableNumber ? `Mesa ${tableNumber}` : "") ||
          (isMoney && cashLinkedType === "Onibus" && busNumber ? `Onibus ${busNumber}` : "")
        : "";
    const draft: EntryDraft = {
      type: effectiveType,
      value,
      description: effectiveDescription,
      people: visibleFields.has("people") ? effectiveSplit?.people ?? people : clientPolicy?.defaultPeople || settings.defaultPeople,
      tableNumber: tableFieldEnabled && visibleFields.has("tableNumber") && !(isMoney && cashLinkedType !== "Mesa") ? tableNumber : "",
      busNumber: busFieldEnabled && visibleFields.has("busNumber") && !(isMoney && cashLinkedType !== "Onibus") ? busNumber : "",
      paymentMethod: effectiveType === "Dinheiro/Troco" ? "Dinheiro" : visibleFields.has("paymentMethod") ? paymentMethod : "Nao informado",
      paidWith: visibleFields.has("paidWith") ? effectiveType === "Dinheiro/Troco" ? effectivePaidWith : paidWith : 0,
      observations: visibleFields.has("observations") ? observations : "",
      customType: effectiveType === "Dinheiro/Troco" ? `Dinheiro/${cashLinkedType}` : undefined,
      splitDetails: effectiveSplit,
      cashDetails: effectiveCash
    };
    try {
      await onSubmit(draft);
      clearForm();
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    await submit();
  };

  const onEntryKeyDown = async (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.defaultPrevented) {
      return;
    }
    const action = shortcutActionForEvent(event, settings.shortcuts, ["submitAndClear", "submit", "escape"]);
    if (action === "escape") {
      event.preventDefault();
      clearForm();
      return;
    }
    if (action === "submit" || action === "submitAndClear") {
      event.preventDefault();
      await submit();
      return;
    }
    const target = event.target as HTMLElement | null;
    const isButton = target?.tagName === "BUTTON";
    if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !isButton) {
      event.preventDefault();
    }
  };

  if (pinned) {
    const quickTabs = quickTabsForEntry;
    const isMoney = type === "Dinheiro/Troco";
    const nextModeLabel = isMoney ? "Conta" : "Dinheiro";
    const moneyDisabled = false;
    const disabled = submitting || value <= 0 || moneyDisabled;
    const floatingTypeOptions: EntryType[] = ["Venda", "Mesa", "Onibus", "Extra", "Taxa", "Personalizado"];
    const floatingTypes = floatingTypeOptions.filter((item) => allowedTypes.includes(item));
    const activeQuickTab = quickTabs.find((tab) => tab.id === activeQuickTabId);
    const floatingLayout = settings.floating.layoutMode || "adaptive";
    const miniFloating = floatingLayout === "mini";
    const compactFloating = Boolean(activeQuickTab?.compact) || floatingLayout === "compact" || miniFloating;
    const detailKind = isMoney
      ? tableFieldEnabled && cashLinkedType === "Mesa"
        ? "mesa"
        : busFieldEnabled && cashLinkedType === "Onibus"
          ? "onibus"
          : ""
      : tableFieldEnabled && type === "Mesa"
        ? "mesa"
        : busFieldEnabled && type === "Onibus"
          ? "onibus"
          : "";
    const showTabs = visible("tabs") && quickTabs.length > 0 && !miniFloating;
    const showMode = visible("mode");
    const showType = visible("type") && !miniFloating;
    const showPeople = visible("people") && !miniFloating;
    const detailFieldId = detailKind === "mesa" ? "tableNumber" : detailKind === "onibus" ? "busNumber" : "";
    const showDetail = Boolean(detailFieldId && visible(detailFieldId));
    const showDescription = visible("description") && !miniFloating;
    const showPaidWith = visible("paidWith");
    const showPaymentMethod = visible("paymentMethod") && !isMoney && !compactFloating;
    const showResult = visible("result");
    const showSubmit = visible("submit");
    const applyQuickTab = (tab: QuickTabSettings) => {
      setActiveQuickTabId(tab.id);
      setType(allowedTypes.includes(tab.type) ? tab.type : clientPolicy?.defaultType || "Venda");
      if (tab.type === "Dinheiro/Troco") {
        setCashLinkedType(
          settings.floating.syncMoneyWithEntryType
            ? cashLinkFromEntryType(type, tab.cashLinkedType || "Mesa")
            : tab.cashLinkedType || "Mesa"
        );
      }
      if (settings.floating.syncMoneyWithEntryType && tab.type !== "Dinheiro/Troco") {
        setCashLinkedType(cashLinkFromEntryType(tab.type, cashLinkedType));
      }
      if (tab.compact) {
        setPeople(1);
      }
    };
    const switchMoneyMode = () => {
      const syncModes = settings.floating.syncMoneyWithEntryType;
      const moneyTab = quickTabs.find((tab) => tab.type === "Dinheiro/Troco");
      if (!isMoney) {
        if (!allowedTypes.includes("Dinheiro/Troco")) {
          return;
        }
        setType("Dinheiro/Troco");
        setCashLinkedType(syncModes ? cashLinkFromEntryType(type, cashLinkedType) : moneyTab?.cashLinkedType || "Mesa");
        setActiveQuickTabId(moneyTab?.id || "manual");
        return;
      }
      const preferredType: EntryType = syncModes ? entryTypeFromCashLink(cashLinkedType) : "Venda";
      const nextType: EntryType = allowedTypes.includes(preferredType) ? preferredType : clientPolicy?.defaultType || allowedTypes[0] || "Venda";
      const matchingTab = quickTabs.find((tab) => tab.type === nextType && !tab.compact);
      if (matchingTab) {
        setActiveQuickTabId(matchingTab.id);
        setType(matchingTab.type);
        return;
      }
      setType(nextType);
      setActiveQuickTabId("manual");
    };
    const chooseType = (nextType: EntryType) => {
      if (!allowedTypes.includes(nextType)) {
        return;
      }
      setType(nextType);
      if (settings.floating.syncMoneyWithEntryType) {
        setCashLinkedType(cashLinkFromEntryType(nextType, cashLinkedType));
      }
      const matchingTab = quickTabs.find((tab) => tab.type === nextType && !tab.compact);
      setActiveQuickTabId(matchingTab?.id || "manual");
    };

    return (
      <form
        className={`floating-bar ${isMoney ? "money" : "account"} ${showDetail ? "has-detail" : ""} ${compactFloating ? "compact-ui" : ""} ${miniFloating ? "mini-bar" : ""} ${showTabs ? "with-tabs" : ""} ${settings.floating.dragWholeBar ? "drag-anywhere" : ""}`}
        onSubmit={onSubmitForm}
        onKeyDown={onEntryKeyDown}
      >
        <div className="floating-grip" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        {showTabs && (
          <div className="floating-tab-strip" aria-label="Modos rapidos">
            {quickTabs.map((tab) => (
              <button
                key={tab.id}
                className={tab.id === activeQuickTabId ? "active" : ""}
                type="button"
                onClick={() => applyQuickTab(tab)}
                title={`Usar modo ${tab.label}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="floating-main-row">
        {showMode && (
          <button
            className="floating-mode"
            type="button"
            onClick={switchMoneyMode}
          >
            <span>&lt;-&gt;</span>
            {nextModeLabel}
          </button>
        )}

        {showType && !compactFloating && (isMoney ? (
          <label className="floating-field floating-kind floating-cash-kind">
            <span>VINCULAR A</span>
            <select value={cashLinkedType} onChange={(event) => setCashLinkedType(event.target.value as EntryType)}>
              {CASH_LINKED_TYPES.filter((item) => allowedTypes.includes(item.value)).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="floating-field floating-kind">
            <span>TIPO</span>
            <select value={type} onChange={(event) => chooseType(event.target.value as EntryType)}>
              {floatingTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        ))}

        <label className="floating-field amount-field">
          <span>VALOR DA CONTA</span>
          <div className="money-input">
            <b>R$</b>
            <input
              autoFocus
              inputMode="decimal"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              placeholder="0,00"
            />
          </div>
        </label>

        {isMoney ? showPaidWith && (
          <label className="floating-field paid-field">
            <span>PAGO COM</span>
            <div className="money-input warm">
              <b>R$</b>
              <input
                inputMode="decimal"
                value={paidWithText}
                onChange={(event) => setPaidWithText(event.target.value)}
                placeholder="0,00"
              />
            </div>
          </label>
        ) : showPeople && !compactFloating && (
          <div className="floating-field people-field">
            <span>PESSOAS</span>
            <div className="people-stepper">
              <button type="button" onClick={() => setPeople(Math.max(1, people - 1))}>
                -
              </button>
              <input
                type="number"
                min={1}
                value={people}
                onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))}
              />
              <button type="button" onClick={() => setPeople(people + 1)}>
                +
              </button>
            </div>
          </div>
        )}

        {showDetail && (
          <label className="floating-field floating-detail">
            <span>{detailKind === "mesa" ? "MESA" : "ONIBUS"}</span>
            <input
              value={detailKind === "mesa" ? tableNumber : busNumber}
              onChange={(event) => {
                if (detailKind === "mesa") {
                  setTableNumber(event.target.value);
                } else {
                  setBusNumber(event.target.value);
                }
              }}
              placeholder={detailKind === "mesa" ? "8" : "2"}
            />
          </label>
        )}

        {showPaymentMethod && (
          <label className="floating-field payment-field">
            <span>PAGAMENTO</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {paymentMethodsForEntry.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}

        {showDescription && (
          <label className="floating-field floating-description">
            <span>DESCRICAO</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descricao opcional"
            />
          </label>
        )}

        {showResult && (isMoney ? (
          <div className="floating-result">
            <span>TROCO</span>
            <strong>{formatCurrency(cash.change)}</strong>
          </div>
        ) : (
          people > 1 && (
            <div className="floating-result">
              <span>POR PESSOA</span>
              <strong>{formatCurrency(split.perPersonRounded)}</strong>
            </div>
          )
        ))}

        {showSubmit && (
          <button className="floating-send" type="submit" disabled={disabled}>
            {submitting ? <RefreshCw size={17} className="spin" /> : <Send size={18} />}
            Enviar
          </button>
        )}
        </div>

        <button className="floating-close" type="button" onClick={onUnpin} title="Voltar ao app completo">
          <Undo2 size={16} />
        </button>
      </form>
    );
  }

  return (
    <form className={`quick-entry ${pinned ? "pinned" : ""}`} onSubmit={onSubmitForm} onKeyDown={onEntryKeyDown}>
      <div className="quick-head">
        <div>
          <span className="eyebrow">Registro rapido</span>
          <h2>Lancar valor</h2>
        </div>
        {!pinned && (
          <div className="mode-chips">
            {(["Venda", "Mesa", "Onibus", "Dinheiro/Troco", "Divisao de conta"] as EntryType[]).map((item) => (
              allowedTypes.includes(item) && (
              <button type="button" key={item} className={type === item ? "selected" : ""} onClick={() => setType(item)}>
                {item}
              </button>
              )
            ))}
          </div>
        )}
      </div>

      <div className="entry-grid">
        {visible("type") && (
          <label className="field">
            <span>Tipo</span>
            <select value={type} onChange={(event) => setType(event.target.value as EntryType)}>
              {ENTRY_TYPES.filter((item) => allowedTypes.includes(item)).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}

        {visible("value") && (
          <label className="field value-field">
            <span>Valor</span>
            <input
              autoFocus
              inputMode="decimal"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              placeholder="0,00"
            />
          </label>
        )}

        {visible("people") && (
          <label className="field small-field">
            <span>Pessoas</span>
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))}
            />
          </label>
        )}

        {visible("description") && (
          <label className="field description-field">
            <span>Descricao</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mesa 8, Cliente Joao..." />
          </label>
        )}

        {visible("tableNumber") && tableFieldEnabled && (type === "Mesa" || (type === "Dinheiro/Troco" && cashLinkedType === "Mesa")) && !pinned && (
          <label className="field small-field">
            <span>Mesa</span>
            <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} placeholder="8" />
          </label>
        )}

        {visible("busNumber") && busFieldEnabled && (type === "Onibus" || (type === "Dinheiro/Troco" && cashLinkedType === "Onibus")) && !pinned && (
          <label className="field small-field">
            <span>Onibus</span>
            <input value={busNumber} onChange={(event) => setBusNumber(event.target.value)} placeholder="2" />
          </label>
        )}

        {visible("paymentMethod") && !pinned && (
          <label className="field">
            <span>Pagamento</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {paymentMethodsForEntry.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}

        {type === "Dinheiro/Troco" && !pinned && (
          <label className="field">
            <span>Vincular a</span>
            <select value={cashLinkedType} onChange={(event) => setCashLinkedType(event.target.value as EntryType)}>
              {CASH_LINKED_TYPES.filter((item) => allowedTypes.includes(item.value)).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {visible("people") && type === "Divisao de conta" && !pinned && (
        <SplitBox
          split={split}
          roundingStep={roundingStep}
          roundingDirection={roundingDirection}
          registerDifference={registerDifference}
          showAdjustment={showSplitAdjustment}
          onRoundingStep={setRoundingStep}
          onRoundingDirection={setRoundingDirection}
          onRegisterDifference={setRegisterDifference}
          onShowAdjustment={setShowSplitAdjustment}
        />
      )}

      {visible("paidWith") && type === "Dinheiro/Troco" && !pinned && (
        <CashBox
          cash={cash}
          paidWithText={paidWithText}
          lastValue={lastActive?.finalValue || 0}
          onPaidWithText={setPaidWithText}
          onUseLast={() => {
            if (lastActive) {
              setValueText(String(lastActive.finalValue).replace(".", ","));
            }
          }}
        />
      )}

      {visible("observations") && !pinned && (
        <label className="field observations-field">
          <span>Observacoes</span>
          <input value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="Ajuste, identificador, detalhe do pagamento..." />
        </label>
      )}

      <div className="submit-row">
        <button className="primary-button" type="submit" disabled={submitting || (value <= 0 && type !== "Cancelado/Estorno")}>
          {submitting ? <RefreshCw size={18} className="spin" /> : <Send size={18} />}
          Registrar
        </button>
        {!pinned && (
          <button className="ghost-button" type="button" onClick={clearForm}>
            <X size={18} />
            Limpar
          </button>
        )}
      </div>
    </form>
  );
}

function SplitBox({
  split,
  roundingStep,
  roundingDirection,
  registerDifference,
  showAdjustment,
  onRoundingStep,
  onRoundingDirection,
  onRegisterDifference,
  onShowAdjustment
}: {
  split: ReturnType<typeof calculateSplit>;
  roundingStep: number;
  roundingDirection: RoundDirection;
  registerDifference: boolean;
  showAdjustment: boolean;
  onRoundingStep: (value: number) => void;
  onRoundingDirection: (value: RoundDirection) => void;
  onRegisterDifference: (value: boolean) => void;
  onShowAdjustment: (value: boolean) => void;
}) {
  const adjustmentPerPerson = split.people ? split.difference / split.people : 0;
  const adjustmentTone = split.difference > 0 ? "up" : split.difference < 0 ? "down" : "neutral";
  return (
    <section className="calculation-panel">
      <div className="calc-controls">
        <label className="field">
          <span>Multiplo</span>
          <select value={roundingStep} onChange={(event) => onRoundingStep(Number(event.target.value))}>
            {ROUNDING_STEPS.map((step) => (
              <option key={step} value={step}>{step === 0.01 ? "Sem aproximacao" : formatCurrency(step)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Direcao</span>
          <select value={roundingDirection} onChange={(event) => onRoundingDirection(event.target.value as RoundDirection)}>
            <option value="up">Para cima</option>
            <option value="down">Para baixo</option>
            <option value="nearest">Mais proximo</option>
          </select>
        </label>
        <label className="switch-line">
          <input type="checkbox" checked={registerDifference} onChange={(event) => onRegisterDifference(event.target.checked)} />
          Registrar sobra como ajuste
        </label>
        <label className="switch-line">
          <input type="checkbox" checked={showAdjustment} onChange={(event) => onShowAdjustment(event.target.checked)} />
          Mostrar cobranca extra
        </label>
      </div>
      <div className="calc-results">
        <Metric label="Original" value={formatCurrency(split.originalValue)} />
        <Metric label="Sem arredondar" value={formatCurrency(split.perPersonRaw)} />
        <Metric label="Por pessoa" value={formatCurrency(split.perPersonRounded)} />
        <Metric label="Total final" value={formatCurrency(split.finalTotal)} />
        <Metric label="Sobra/diferenca" value={formatCurrency(split.difference)} />
      </div>
      {showAdjustment && (
        <div className={`split-adjustment ${adjustmentTone}`}>
          <strong>
            {split.difference > 0
              ? `Vai cobrar ${formatCurrency(split.difference)} a mais no total`
              : split.difference < 0
                ? `Vai cobrar ${formatCurrency(Math.abs(split.difference))} a menos no total`
                : "Arredondamento sem diferenca"}
          </strong>
          <span>
            {split.difference === 0
              ? "O total final ficou igual ao valor original."
              : `${formatCurrency(Math.abs(adjustmentPerPerson))} ${split.difference > 0 ? "a mais" : "a menos"} por pessoa.`}
          </span>
        </div>
      )}
    </section>
  );
}

function CashBox({
  cash,
  paidWithText,
  lastValue,
  onPaidWithText,
  onUseLast
}: {
  cash: ReturnType<typeof calculateCash>;
  paidWithText: string;
  lastValue: number;
  onPaidWithText: (value: string) => void;
  onUseLast: () => void;
}) {
  return (
    <section className="calculation-panel money-panel">
      <div className="calc-controls">
        <label className="field">
          <span>Pago com</span>
          <input inputMode="decimal" value={paidWithText} onChange={(event) => onPaidWithText(event.target.value)} placeholder="100,00" />
        </label>
        <button type="button" className="ghost-button" onClick={onUseLast} disabled={!lastValue}>
          <Wallet size={16} />
          Usar ultima conta ({formatCurrency(lastValue)})
        </button>
      </div>
      <div className="cash-result">
        <Metric label="Troco" value={formatCurrency(cash.change)} />
        <div className="breakdown">
          {cash.breakdown.length ? (
            cash.breakdown.map((item) => (
              <span key={item.label}>{formatReportQuantity(item.quantity)}x {item.label}</span>
            ))
          ) : (
            <span>Sem troco calculado.</span>
          )}
          {cash.unrepresentedCents > 0 && <span>Ajuste nao representavel: {formatCurrency(cash.unrepresentedCents)}</span>}
        </div>
      </div>
    </section>
  );
}

function TodayPanel({
  summary,
  entries,
  settings,
  canViewTotals = true,
  canViewEntryValues = true,
  onMode
}: {
  summary: DaySummary;
  entries: LedgerEntry[];
  settings: AppSettings;
  canViewTotals?: boolean;
  canViewEntryValues?: boolean;
  onMode: (type: EntryType) => void;
}) {
  const latest = entries.filter((entry) => entry.status !== "deleted").slice(0, 5);
  const showTotals = canViewTotals && !settings.privacy.hideHeaderTotal;
  return (
    <aside className="today-panel">
      <div className={`total-plate ${showTotals ? "" : "privacy-hidden"}`}>
        <span>{showTotals ? "Total do dia" : "Total privado"}</span>
        <strong>{showTotals ? formatCurrency(summary.total) : "Privado"}</strong>
        <small>{showTotals ? `${summary.count} registros, media ${formatCurrency(summary.average)}` : `${summary.count} registros hoje`}</small>
      </div>

      <div className="quick-actions">
        <button onClick={() => onMode("Mesa")}><LayoutPanelTop size={18} /> Mesa</button>
        <button onClick={() => onMode("Onibus")}><MonitorUp size={18} /> Onibus</button>
        <button onClick={() => onMode("Dinheiro/Troco")}><Wallet size={18} /> Troco</button>
        <button onClick={() => onMode("Divisao de conta")}><Plus size={18} /> Dividir</button>
      </div>

      <section className="flat-section">
        <div className="section-title">
          <strong>Ultimos lancamentos</strong>
        </div>
        <div className="mini-list">
          {latest.map((entry) => (
            <div key={entry.id}>
              <span>{entry.description}</span>
              <strong>{canViewEntryValues ? formatCurrency(entry.finalValue) : "Restrito"}</strong>
            </div>
          ))}
          {!latest.length && <p className="empty-text">Nenhum registro ainda.</p>}
        </div>
      </section>

      <section className="flat-section">
        <div className="section-title">
          <strong>Totais rapidos</strong>
        </div>
        <Metric label="Onibus" value={showTotals ? formatCurrency(summary.busTotal) : "Privado"} />
        <Metric label="Dinheiro" value={showTotals ? formatCurrency(summary.cashTotal) : "Privado"} />
        <Metric label="Sobras" value={showTotals ? formatCurrency(summary.differenceTotal) : "Privado"} />
      </section>
    </aside>
  );
}

function HistoryPanel({
  entries,
  settings,
  focusDate,
  onChange,
  onToast,
  onEditRemote,
  onCancelRemote,
  onDeleteRemote,
  onRestoreRemote,
  pdvSales,
  pdvCustomers,
  pdvReceivables,
  pdvSettings,
  printDevices = [],
  onPrintServer
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  focusDate?: HistoryFocusDate | null;
  onChange: () => Promise<void>;
  onToast: (tone: ToastState["tone"], message: string) => void;
  onEditRemote?: (entry: LedgerEntry) => Promise<void>;
  onCancelRemote?: (entry: LedgerEntry) => Promise<void>;
  onDeleteRemote?: (entry: LedgerEntry, permanent?: boolean) => Promise<void>;
  onRestoreRemote?: (entry: LedgerEntry) => Promise<void>;
  pdvSales: PdvSale[];
  pdvCustomers: PdvCustomer[];
  pdvReceivables: PdvReceivable[];
  pdvSettings?: PdvSettings;
  printDevices?: ServerDevice[];
  onPrintServer?: (payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
}) {
  const savedFilters = useMemo(() => loadHistoryFilters(settings.rememberHistoryPeriod), []);
  const todayFilter = useMemo(() => getLocalDateKey(), []);
  const [query, setQuery] = useState(savedFilters.query);
  const [type, setType] = useState(savedFilters.type);
  const [statusFilter, setStatusFilter] = useState(savedFilters.statusFilter);
  const [paymentFilter, setPaymentFilter] = useState(savedFilters.paymentFilter);
  const [dateFrom, setDateFrom] = useState(todayFilter);
  const [dateTo, setDateTo] = useState(todayFilter);
  const [minimumValue, setMinimumValue] = useState(savedFilters.minimumValue);
  const [maximumValue, setMaximumValue] = useState(savedFilters.maximumValue);
  const [originFilter, setOriginFilter] = useState(savedFilters.originFilter);
  const [movementFilter, setMovementFilter] = useState(savedFilters.movementFilter);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [details, setDetails] = useState<PdvSale | null>(null);
  const [receiptSale, setReceiptSale] = useState<PdvSale | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ entry: LedgerEntry; permanent: boolean } | null>(null);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const originOptions = useMemo(() => ["Todos", ...new Set(entries.map((entry) => displayOriginDevice(entry.originDevice)).filter(Boolean))], [entries]);
  const pdvSaleById = useMemo(() => new Map(pdvSales.map((sale) => [sale.id, sale])), [pdvSales]);
  const customerSaleIds = useMemo(() => new Set([
    ...pdvReceivables.map((item) => item.saleId).filter(Boolean),
    ...pdvSales.filter((sale) => sale.payments.some((payment) => Boolean(payment.customerId || payment.customerName))).map((sale) => sale.id)
  ]), [pdvReceivables, pdvSales]);
  const historyTypeOptions = useMemo(() => [
    "Todos",
    ...new Set([...ENTRY_TYPES, ...entries.map((entry) => entry.customType).filter(Boolean) as string[]])
  ], [entries]);

  useEffect(() => {
    if (!focusDate) {
      return;
    }
    setDateFrom(focusDate.date);
    setDateTo(focusDate.date);
    setStatusFilter("todos");
    setPaymentFilter("Todos");
    setType("Todos");
    setMovementFilter("Todos");
    setQuery("");
    setVisibleCount(HISTORY_PAGE_SIZE);
  }, [focusDate?.nonce]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_FILTERS_STORAGE_KEY, JSON.stringify({
      query,
      type,
      statusFilter,
      paymentFilter,
      // O periodo e sempre temporario: ao reabrir o Historico ele volta para hoje.
      dateFrom: "",
      dateTo: "",
      minimumValue,
      maximumValue,
      originFilter,
      movementFilter
    }));
  }, [query, type, statusFilter, paymentFilter, dateFrom, dateTo, minimumValue, maximumValue, originFilter, movementFilter, settings.rememberHistoryPeriod]);

  const filtered = useMemo(() => {
    const searchTerms = deferredQuery.split(",").map(normalizeHistorySearch).filter(Boolean);
    const minimum = parseOptionalHistoryValue(minimumValue);
    const maximum = parseOptionalHistoryValue(maximumValue);
    return entries.filter((entry) => {
      const sale = entry.sourceSaleId ? pdvSaleById.get(entry.sourceSaleId) : undefined;
      const sameType = type === "Todos" || entry.type === type || entry.customType === type;
      const sameStatus =
        statusFilter === "todos" ||
        (statusFilter === "visiveis" && entry.status !== "deleted") ||
        (statusFilter === "active" && entry.status === "active") ||
        (statusFilter === "cancelled" && entry.status === "cancelled") ||
        (statusFilter === "deleted" && entry.status === "deleted");
      const dateKey = getLocalDateKey(entry.createdAt);
      const sameDate = (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
      const normalizedOrigin = displayOriginDevice(entry.originDevice);
      const sameOrigin = originFilter === "Todos" || normalizedOrigin === originFilter;
      const samePayment = paymentFilter === "Todos" || entry.paymentMethod === paymentFilter || Boolean(entry.paymentBreakdown?.some((item) => item.method === paymentFilter));
      const sameValue = (minimum === null || entry.finalValue >= minimum) && (maximum === null || entry.finalValue <= maximum);
      const movementMatches = movementFilter === "Todos"
        || (movementFilter === "Mesas canceladas" && entry.customType === "Mesa cancelada")
        || (movementFilter === "Submesas canceladas" && entry.customType === "Submesa cancelada")
        || (movementFilter === "Com cliente" && Boolean(entry.sourceSaleId && customerSaleIds.has(entry.sourceSaleId)))
        || (movementFilter === "Servidor" && normalizedOrigin === "Servidor")
        || (movementFilter === "Clientes remotos" && normalizedOrigin !== "Servidor")
        || (movementFilter === "Fechamentos parciais" && entry.customType === "Mesa parcial")
        || (movementFilter === "Vendas diretas" && entry.type === "Venda" && !entry.tableNumber);
      if (!sameType || !sameStatus || !sameDate || !sameOrigin || !samePayment || !sameValue || !movementMatches) {
        return false;
      }
      if (!searchTerms.length) {
        return true;
      }
      const haystack = [
        entry.description,
        entry.tableNumber ? `Mesa ${entry.tableNumber}` : "",
        entry.busNumber ? `Onibus ${entry.busNumber}` : "",
        entry.observations,
        entry.originDevice,
        paymentLabelForEntry(entry),
        ...(sale?.items.flatMap((item) => [item.productName, item.categoryName, item.note, item.subtableName, ...(item.complements || []).map((part) => part.name)]) || []),
        ...(sale?.payments.flatMap((item) => [item.method, item.description]) || [])
      ].join(" ");
      const normalizedHaystack = normalizeHistorySearch(haystack);
      return searchTerms.every((term) => normalizedHaystack.includes(term));
    });
  }, [entries, deferredQuery, type, statusFilter, dateFrom, dateTo, minimumValue, maximumValue, originFilter, paymentFilter, movementFilter, pdvSaleById, customerSaleIds]);
  const visibleRows = filtered.slice(0, visibleCount);
  const filteredSummary = useMemo(() => filtered.reduce((summary, entry) => {
    if (entry.status === "active") {
      summary.active += 1;
      summary.activeTotal += entry.finalValue;
    } else if (entry.status === "cancelled") {
      summary.cancelled += 1;
    } else if (entry.status === "deleted") {
      summary.deleted += 1;
    }
    return summary;
  }, { active: 0, activeTotal: 0, cancelled: 0, deleted: 0 }), [filtered]);
  const filteredTotal = roundMoney(filteredSummary.activeTotal);
  const historyTotalHidden = settings.privacy.hideHeaderTotal || settings.privacy.hideReportTotals;

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE);
  }, [deferredQuery, type, statusFilter, dateFrom, dateTo, minimumValue, maximumValue, paymentFilter, originFilter, movementFilter]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await onChange();
      onToast("success", success);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel concluir.");
    }
  };

  const openSaleDetails = (entry: LedgerEntry) => {
    const sale = entry.sourceSaleId ? pdvSaleById.get(entry.sourceSaleId) : undefined;
    if (!sale) {
      onToast("info", "Os detalhes dessa venda ainda nao foram carregados. Atualize o Historico e tente novamente.");
      return;
    }
    setDetails(sale);
  };

  const openReceipt = (entry: LedgerEntry) => {
    const sale = entry.sourceSaleId ? pdvSaleById.get(entry.sourceSaleId) : undefined;
    setReceiptSale(sale || ledgerEntryToReceiptSale(entry));
  };

  return (
    <section className="panel professional-history-panel">
      <div className="filter-bar professional-history-filters">
        <label className="field history-search-field">
          <span>Buscar</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produto, descricao, mesa, pagamento..." />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {historyTypeOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Todos</option>
            <option value="active">Ativos</option>
            <option value="cancelled">Cancelados</option>
            <option value="deleted">Lixeira</option>
          </select>
        </label>
        <label className="field">
          <span>De</span>
          <input type="date" title="Clique para abrir o calendario" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="field">
          <span>Ate</span>
          <input type="date" title="Clique para abrir o calendario" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="field">
          <span>Origem</span>
          <select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}>
            {originOptions.map((origin) => <option key={origin}>{origin}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Movimento</span>
          <select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value)}>
            {["Todos", "Mesas canceladas", "Submesas canceladas", "Com cliente", "Servidor", "Clientes remotos", "Fechamentos parciais", "Vendas diretas"].map((movement) => <option key={movement}>{movement}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Pagamento</span>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
            {['Todos', 'Dinheiro', 'Debito', 'Credito', 'Pix', 'Outros', 'Nao informado'].map((method) => <option key={method}>{method}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Valor minimo</span>
          <input inputMode="decimal" value={minimumValue} onChange={(event) => setMinimumValue(event.target.value)} placeholder="R$ 0,00" />
        </label>
        <label className="field">
          <span>Valor maximo</span>
          <input inputMode="decimal" value={maximumValue} onChange={(event) => setMaximumValue(event.target.value)} placeholder="Sem limite" />
        </label>
        <button className="ghost-button history-clear-filters" type="button" onClick={() => {
          setQuery("");
          setType("Todos");
          setStatusFilter("todos");
          setPaymentFilter("Todos");
          setDateFrom(todayFilter);
          setDateTo(todayFilter);
          setMinimumValue("");
          setMaximumValue("");
          setOriginFilter("Todos");
          setMovementFilter("Todos");
        }}><RotateCcw size={15} /> Limpar</button>
      </div>

      <div className="history-summary-strip">
        <div><span>Resultados</span><strong>{filtered.length}</strong></div>
        <div><span>Ativos</span><strong>{filteredSummary.active}</strong></div>
        <div><span>Total filtrado</span><strong className={historyTotalHidden ? "private-value" : ""}>{historyTotalHidden ? "Privado" : formatCurrency(filteredTotal)}</strong></div>
        <div><span>Cancelados</span><strong>{filteredSummary.cancelled}</strong></div>
        <div><span>Lixeira</span><strong>{filteredSummary.deleted}</strong></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Descricao</th>
              <th>Mesa</th>
              <th>Onibus</th>
              <th>Pagamento</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((entry) => {
              const { time } = formatDateTime(entry.createdAt);
              const description = entry.description.trim();
              const defaultTablePattern = entry.tableNumber ? new RegExp(`^mesa\\s*0*${entry.tableNumber}$`, "i") : null;
              const customTableName = entry.tableNumber && description && !defaultTablePattern?.test(description) ? description : "";
              const isSubtableRecord = entry.customType?.startsWith("Submesa") || (entry.customType === "Mesa parcial" && Boolean(customTableName));
              return (
                <tr key={entry.id} className={entry.status !== "active" ? "muted-row" : ""}>
                  <td>{formatDateTime(entry.createdAt).date}</td>
                  <td>{time}</td>
                  <td>{entry.customType || entry.type}</td>
                  <td>{entry.tableNumber ? isSubtableRecord ? description : "-" : description || "-"}</td>
                  <td>{entry.tableNumber ? entry.tableNumber : "-"}</td>
                  <td>{entry.busNumber || "-"}</td>
                  <td>{paymentLabelForEntry(entry)}</td>
                  <td>{formatCurrency(entry.finalValue)}</td>
                  <td><span className={`status-dot ${entry.status}`}>{statusLabel(entry.status)}</span></td>
                  <td>
                    <div className="row-actions">
                      <button title="Editar" onClick={() => onEditRemote ? void onEditRemote(entry) : setEditing(entry)}><Edit3 size={15} /></button>
                      {entry.sourceSaleId && <button className="history-sale-details-button" title="Ver produtos e pagamentos" aria-label="Ver produtos e pagamentos" onClick={() => openSaleDetails(entry)}><Eye size={15} /></button>}
                      <button className="history-receipt-button" title="Gerar recibo ou cupom" aria-label="Gerar recibo ou cupom" onClick={() => openReceipt(entry)}><ReceiptText size={15} /></button>
                      <button title="Duplicar" onClick={() => run(() => window.caixa.duplicateEntry(entry.id), "Lancamento duplicado.")}><Copy size={15} /></button>
                      {entry.status === "deleted" || entry.status === "cancelled" ? (
                         <button title="Restaurar" onClick={() => run(() => onRestoreRemote ? onRestoreRemote(entry) : window.caixa.updateEntry(entry.id, { status: "active" }), "Lancamento restaurado.")}><Undo2 size={15} /></button>
                      ) : (
                        <>
                           <button title="Cancelar" onClick={() => run(() => onCancelRemote ? onCancelRemote(entry) : window.caixa.cancelEntry(entry.id), "Lancamento cancelado.")}><MinusCircle size={15} /></button>
                           <button title="Enviar para lixeira" onClick={() => setConfirmDelete({ entry, permanent: false })}><Trash2 size={15} /></button>
                        </>
                      )}
                       <button title="Apagar definitivo" className="danger-icon" onClick={() => setConfirmDelete({ entry, permanent: true })}><X size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="list-footnote">
        {filtered.length ? (
          <>
            <span>Mostrando {Math.min(visibleRows.length, filtered.length)} de {filtered.length} lancamento(s) filtrado(s).</span>
            {visibleRows.length < filtered.length && (
              <button className="ghost-button" type="button" onClick={() => setVisibleCount((current) => current + HISTORY_PAGE_SIZE)}>
                Mostrar mais {Math.min(HISTORY_PAGE_SIZE, filtered.length - visibleRows.length)}
              </button>
            )}
          </>
        ) : (
          <p className="empty-text">Nada encontrado com esses filtros.</p>
        )}
      </div>

      {editing && (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await run(() => window.caixa.updateEntry(editing.id, patch), "Lancamento atualizado.");
            setEditing(null);
          }}
        />
      )}
      {details && <HistorySaleDetailModal sale={details} onClose={() => setDetails(null)} onReceipt={() => setReceiptSale(details)} />}
      {receiptSale && (
        <HistoryReceiptModal
          sale={receiptSale}
          customers={pdvCustomers}
          receivable={pdvReceivables.find((item) => item.saleId === receiptSale.id)}
          receiptSettings={pdvSettings}
          printDevices={printDevices}
          onPrintServer={onPrintServer}
          onClose={() => setReceiptSale(null)}
          onToast={onToast}
        />
      )}
      {confirmDelete && (
        <HistoryDeleteConfirmModal
          permanent={confirmDelete.permanent}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const { entry, permanent } = confirmDelete;
            setConfirmDelete(null);
            if (onDeleteRemote) {
              await onDeleteRemote(entry, permanent);
              return;
            }
            await run(() => permanent ? window.caixa.deleteEntry(entry.id) : window.caixa.removeEntry(entry.id), permanent ? "Lancamento apagado definitivamente." : "Lancamento enviado para a lixeira.");
          }}
        />
      )}
    </section>
  );
}

function HistoryDeleteConfirmModal({ permanent, onCancel, onConfirm }: { permanent: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <div className="modal confirmation-modal">
        <div className="modal-head">
          <div>
            <span className="settings-overline">Historico</span>
            <strong>{permanent ? "Apagar lancamento definitivamente?" : "Enviar lancamento para a lixeira?"}</strong>
          </div>
          <button className="icon-button" onClick={onCancel} disabled={busy}><X size={18} /></button>
        </div>
        <p>{permanent ? "Essa acao remove o registro do historico e nao pode ser desfeita." : "O registro sai das visoes ativas e pode ser restaurado depois."}</p>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className={permanent ? "danger-button" : "primary-button"} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy ? "Processando..." : permanent ? "Apagar definitivamente" : "Enviar para lixeira"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistorySaleDetailModal({ sale, onClose, onReceipt }: { sale: PdvSale; onClose: () => void; onReceipt: () => void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: event.key === "ArrowDown" ? 80 : -80, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className="modal history-sale-detail-modal" tabIndex={-1} autoFocus>
        <div className="modal-head">
          <div>
            <span className="settings-overline">Detalhes do PDV</span>
            <strong>{sale.description || (sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta")}</strong>
            <p>{new Date(sale.createdAt).toLocaleString("pt-BR")} | {sale.status}</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div ref={scrollRef} className="history-detail-scroll" tabIndex={0}>
          <div className="history-detail-summary">
            <Metric label="Subtotal" value={formatCurrency(sale.subtotal)} />
            <Metric label={sale.discount < 0 ? "Acrescimo" : "Desconto"} value={formatCurrency(Math.abs(sale.discount))} />
            <Metric label="Total" value={formatCurrency(sale.total)} />
          </div>
          <div className="history-detail-list">
            <strong>Itens</strong>
            {sale.items.map((item) => (
              <div key={item.id}>
                <span>
                  {formatReportQuantity(item.quantity)}x {item.productName}{item.complements?.length ? ` + ${item.complements.map((part) => part.name).join(" + ")}` : ""}
                  {(item.discount > 0 || Math.abs(item.unitPrice * item.quantity - item.total) > 0.009 || (item.baseUnitPrice && Math.abs(item.baseUnitPrice - item.unitPrice) > 0.009)) && (
                    <small>Original {formatCurrency((item.baseUnitPrice || item.unitPrice) * item.quantity)} | {item.total > (item.baseUnitPrice || item.unitPrice) * item.quantity ? "Acrescimo" : "Desconto"} {formatCurrency(Math.abs((item.baseUnitPrice || item.unitPrice) * item.quantity - item.total))}</small>
                  )}
                </span>
                <b>{formatCurrency(item.total)}</b>
              </div>
            ))}
            <strong>Pagamentos</strong>
            {sale.payments.map((payment) => (
              <div key={payment.id}>
                <span>{payment.method}{payment.change ? ` | Troco ${formatCurrency(payment.change)}` : ""}</span>
                <b>{formatCurrency(payment.amount)}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="submit-row">
          <button className="ghost-button" onClick={onReceipt}><ReceiptText size={16} /> Recibo</button>
          <button className="primary-button" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function remoteServerSettingsPatch(previous: AppSettings, next: AppSettings): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  const editableFields: Array<keyof AppSettings> = [
    "operationMode",
    "defaultType",
    "defaultPeople",
    "defaultRoundingStep",
    "defaultRoundingDirection",
    "tableNumberEnabled",
    "busNumberEnabled",
    "quickTabs"
  ];
  for (const field of editableFields) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) {
      (patch as Record<string, unknown>)[field] = next[field];
    }
  }
  if (JSON.stringify(previous.floating.visibleFields) !== JSON.stringify(next.floating.visibleFields)) {
    patch.floating = { ...previous.floating, visibleFields: next.floating.visibleFields };
  }
  return patch;
}

function HistoryReceiptModal({
  sale,
  customers,
  receivable,
  receiptSettings,
  printDevices = [],
  onPrintServer,
  onClose,
  onToast
}: {
  sale: PdvSale;
  customers: PdvCustomer[];
  receivable?: PdvReceivable;
  receiptSettings?: PdvSettings;
  printDevices?: ServerDevice[];
  onPrintServer?: (payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onClose: () => void;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const linkedCustomer = receivable ? customers.find((item) => item.id === receivable.customerId) : undefined;
  const [customerId, setCustomerId] = useState(linkedCustomer?.id || "");
  const [customerName, setCustomerName] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [printerName, setPrinterName] = useState("");
  const availablePrintTargets: ReceiptPrintTarget[] = [
    { id: "local", label: "Servidor" },
    ...(onPrintServer ? [{ id: "server", label: "Computador servidor" }] : []),
    ...printDevices.map((device) => ({ id: device.id, label: device.name }))
  ];
  const [printDestination, setPrintDestination] = useState(() => readReceiptPrintDestination(availablePrintTargets));
  const selectedCustomer = customers.find((item) => item.id === customerId);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.caixa.getPdvReceiptPreview(sale, selectedCustomer, receivable, customerName.trim(), customerDocument.trim(), receiptSettings),
      window.caixa.listPdvPrinters(),
      window.caixa.getPdvSnapshot()
    ]).then(([html, availablePrinters, snapshot]) => {
      if (!active) return;
      setPreviewHtml(html);
      setPrinters(availablePrinters);
      setPrinterName((current) => current || snapshot.settings.receiptPrinterName || availablePrinters.find((item) => item.isDefault)?.name || "");
    });
    return () => {
      active = false;
    };
  }, [sale, selectedCustomer, receivable, customerName, customerDocument, receiptSettings]);

  const generate = async (action: "open" | "save" | "print") => {
    setBusy(true);
    try {
      if (action === "print" && printDestination !== "local") {
        const payload = {
          sale,
          customer: selectedCustomer,
          receivable,
          customerName: customerName.trim(),
          customerDocument: customerDocument.trim()
        };
        const result = printDestination === "server" && onPrintServer
          ? await onPrintServer(payload)
          : await window.caixa.requestRemotePdvReceiptPrint(printDestination, payload);
        onToast(result.ok ? "success" : "error", result.message);
        if (result.ok) onClose();
        return;
      }
      const result = await window.caixa.printPdvReceipt(
        sale,
        selectedCustomer,
        receivable,
        { customerName: customerName.trim(), customerDocument: customerDocument.trim(), action, printerName, receiptSettings }
      );
      onToast(result.ok ? "success" : "error", result.message);
      if (result.ok) onClose();
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel gerar o recibo.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && !busy && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        void generate("open");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return (
    <div className="modal-backdrop receipt-modal-backdrop">
      <div className="modal history-receipt-modal receipt-viewer-modal" role="dialog" aria-modal="true" aria-label="Gerar recibo">
        <div className="modal-head">
          <div>
            <span className="settings-overline">Recibo nao fiscal</span>
            <strong>{sale.tableNumber ? `Mesa ${String(sale.tableNumber).padStart(3, "0")}` : "Venda"}</strong>
            <p>{new Date(sale.createdAt).toLocaleString("pt-BR")} | {formatCurrency(sale.total)}</p>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div className="history-receipt-body receipt-viewer-body">
          <div className="receipt-preview-shell">
            {previewHtml
              ? <iframe title="Pre-visualizacao do recibo" srcDoc={previewHtml} className="receipt-preview-frame" />
              : <div className="receipt-preview-loading">Gerando visualizacao...</div>}
          </div>
          <div className="receipt-viewer-options">
            <label className="field">
              <span>Cliente cadastrado (opcional)</span>
              <select value={customerId} onChange={(event) => {
                setCustomerId(event.target.value);
                if (event.target.value) {
                  setCustomerName("");
                  setCustomerDocument("");
                }
              }}>
                <option value="">Consumidor nao identificado</option>
                {customers.filter((item) => item.active || item.id === linkedCustomer?.id).map((customer) => (
                  <option value={customer.id} key={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            {!customerId && <label className="field">
              <span>CPF/CNPJ somente neste recibo</span>
              <input
                value={customerDocument}
                onChange={(event) => setCustomerDocument(formatCpfCnpj(event.target.value))}
                inputMode="numeric"
                placeholder="Opcional"
              />
            </label>}
            <label className="field">
              <span>Ou informe somente um nome</span>
              <input
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  if (event.target.value) setCustomerId("");
                }}
                placeholder="Ex.: Joao, Familia Silva..."
                autoFocus={!linkedCustomer}
              />
            </label>
            <label className="field">
              <span>Imprimir em</span>
              <select value={printDestination} onChange={(event) => { setPrintDestination(event.target.value); saveReceiptPrintDestination(event.target.value, availablePrintTargets); }}>
                <option value="local">Servidor</option>
                {onPrintServer && <option value="server">Computador servidor</option>}
                {printDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
            </label>
            {printDestination === "local" && <label className="field">
              <span>Impressora</span>
              <select value={printerName} onChange={(event) => setPrinterName(event.target.value)}>
                <option value="">Nenhuma impressora configurada</option>
                {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? " (Padrao)" : ""}</option>)}
              </select>
            </label>}
            {printDestination === "local" && !printers.length && <p className="receipt-printer-warning">O Windows nao informou impressoras disponíveis. O PDF continua funcionando normalmente.</p>}
            <p className="settings-note">O recibo inclui itens, pagamentos, troco e dados da conta a receber quando existirem.</p>
          </div>
        </div>
        <div className="modal-actions receipt-modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="ghost-button" onClick={() => void generate("save")} disabled={busy}><Download size={16} /> Salvar PDF</button>
          <button className="ghost-button" onClick={() => void generate("open")} disabled={busy}><Eye size={16} /> Abrir PDF</button>
          <button className="primary-button" onClick={() => void generate("print")} disabled={busy || (printDestination === "local" && !printerName)}><ReceiptText size={16} /> {busy ? "Enviando..." : "Imprimir agora"}</button>
        </div>
      </div>
    </div>
  );
}

function ledgerEntryToReceiptSale(entry: LedgerEntry): PdvSale {
  const paymentMethod = (value: PaymentMethod): PdvPaymentMethod => {
    if (value === "Nao informado") return "Nao definido";
    if (value === "Voucher" || value === "Misto") return "Outros";
    return value;
  };
  const payments = entry.paymentBreakdown?.length
    ? entry.paymentBreakdown.map((part, index) => ({
        id: `${entry.id}-payment-${index}`,
        method: paymentMethod(part.method),
        amount: part.amount
      }))
    : [{
        id: `${entry.id}-payment`,
        method: paymentMethod(entry.paymentMethod),
        amount: entry.finalValue,
        received: entry.paymentMethod === "Dinheiro" ? entry.paidWith || entry.finalValue : undefined,
        change: entry.paymentMethod === "Dinheiro" ? entry.change || undefined : undefined
      }];
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    type: entry.type === "Mesa" ? "Mesa" : entry.type === "Onibus" ? "Onibus" : "Venda direta",
    tableNumber: Number(entry.tableNumber) || undefined,
    status: entry.status === "cancelled" ? "Cancelada" : entry.status === "deleted" ? "deleted" : "Finalizada",
    subtotal: entry.originalValue,
    discount: Math.max(0, entry.originalValue - entry.finalValue),
    total: entry.finalValue,
    description: entry.description,
    observations: entry.observations,
    originDevice: entry.originDevice,
    payments,
    items: [{
      id: `${entry.id}-item`,
      productId: "legacy-entry",
      productName: entry.description || entry.customType || entry.type,
      categoryName: "Lancamento anterior",
      quantity: 1,
      unitPrice: entry.finalValue,
      discount: 0,
      total: entry.finalValue
    }]
  };
}

function ImportPreviewModal({
  preview,
  busy,
  onClose,
  onConfirm
}: {
  preview: LedgerImportPreview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const canImport = preview.newRows > 0 && !busy;
  return (
    <div className="modal-backdrop">
      <div className="modal import-modal">
        <div className="modal-head">
          <div>
            <span className="settings-overline">Importacao de planilha</span>
            <strong>Conferir antes de importar</strong>
            <p>{preview.fileName}</p>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>

        <div className="import-summary-grid">
          <div>
            <span>Novos</span>
            <strong>{preview.newRows}</strong>
          </div>
          <div>
            <span>Duplicados</span>
            <strong>{preview.duplicateRows}</strong>
          </div>
          <div>
            <span>Ignorados</span>
            <strong>{preview.ignoredRows}</strong>
          </div>
          <div>
            <span>Lidos</span>
            <strong>{preview.parsedRows}/{preview.totalRows}</strong>
          </div>
        </div>

        {preview.warnings.length > 0 && (
          <div className="import-warning-box">
            <strong>Avisos encontrados</strong>
            {preview.warnings.slice(0, 4).map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
            {preview.warnings.length > 4 && <span>Mais {preview.warnings.length - 4} aviso(s).</span>}
          </div>
        )}

        <div className="import-table-wrap">
          <table className="import-preview-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descricao</th>
                <th>Valor</th>
                <th>Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((item) => {
                const { date, time } = formatDateTime(item.createdAt);
                return (
                  <tr key={`${item.id}-${item.duplicate ? "dup" : "new"}`} className={item.duplicate ? "duplicate" : "new"}>
                    <td><span>{item.duplicate ? "Duplicado" : "Novo"}</span></td>
                    <td>{date} {time}</td>
                    <td>{item.type}</td>
                    <td>{item.description || "Venda"}</td>
                    <td>{formatCurrency(item.finalValue)}</td>
                    <td>{item.paymentMethod}</td>
                  </tr>
                );
              })}
              {!preview.sample.length && (
                <tr>
                  <td colSpan={6}>Nenhuma linha compativel encontrada nesta planilha.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="submit-row">
          <button className="primary-button" onClick={onConfirm} disabled={!canImport}>
            {busy ? <RefreshCw size={18} className="spin" /> : <Upload size={18} />}
            Confirmar importacao
          </button>
          <button className="ghost-button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function EditEntryModal({
  entry,
  onClose,
  onSave
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onSave: (patch: Partial<LedgerEntry>) => Promise<void>;
}) {
  const [type, setType] = useState<EntryType>(entry.type);
  const [description, setDescription] = useState(entry.description);
  const [finalValue, setFinalValue] = useState(String(entry.finalValue).replace(".", ","));
  const [tableNumber, setTableNumber] = useState(entry.tableNumber);
  const [busNumber, setBusNumber] = useState(entry.busNumber);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(entry.paymentMethod);
  const [observations, setObservations] = useState(entry.observations);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ type, description, finalValue: parseMoney(finalValue), tableNumber, busNumber, paymentMethod, observations });
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && !event.repeat) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, type, description, finalValue, tableNumber, busNumber, paymentMethod, observations, saving]);

  return (
    <div className="modal-backdrop">
      <div className="modal entry-editor-modal">
        <div className="modal-head">
          <div>
            <span className="settings-overline">Historico</span>
            <strong>Editar lancamento</strong>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="entry-editor-intro">
          <strong>Dados da operacao</strong>
          <span>Corrija descricao, valor e identificacao sem perder o registro original.</span>
        </div>
        <div className="entry-grid entry-editor-grid">
          <label className="field">
            <span>Tipo / categoria</span>
            <select value={type} onChange={(event) => setType(event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Valor final</span>
            <input value={finalValue} onChange={(event) => setFinalValue(event.target.value)} />
          </label>
          <label className="field description-field">
            <span>Descricao</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">
            <span>Mesa</span>
            <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} />
          </label>
          <label className="field">
            <span>Onibus</span>
            <input value={busNumber} onChange={(event) => setBusNumber(event.target.value)} />
          </label>
          <label className="field">
            <span>Pagamento</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field observations-field">
            <span>Observacoes</span>
            <input value={observations} onChange={(event) => setObservations(event.target.value)} />
          </label>
        </div>
        <div className="submit-row">
          <button
            className="primary-button"
            onClick={() => void submit()}
            disabled={saving}
          >
            <Save size={18} />
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

type ProfessionalReportTab = "overview" | "products" | "payments" | "accounts" | "tables" | "times" | "audit";

function ProfessionalReportsPanel({
  entries,
  pdvSales,
  receivables,
  settings,
  exportStatus,
  remoteClientActive = false,
  canViewTotals = true,
  canViewEntryValues = true,
  focusPeriod,
  onFocusConsumed,
  onOpenOutputDirectory,
  onExport,
  onExportFiltered
}: {
  entries: LedgerEntry[];
  pdvSales: PdvSale[];
  receivables: PdvReceivable[];
  settings: AppSettings;
  summary: DaySummary;
  exportStatus: ExportStatus | null;
  remoteClientActive?: boolean;
  canViewTotals?: boolean;
  canViewEntryValues?: boolean;
  focusPeriod?: ReportFocusPeriod | null;
  onFocusConsumed?: () => void;
  onOpenOutputDirectory: () => Promise<void>;
  onExport: () => Promise<void>;
  onExportFiltered: (ids: string[], label: string) => Promise<void>;
}) {
  const initialPeriod = useMemo(() => currentMonthPeriod(), []);
  const [tab, setTab] = useState<ProfessionalReportTab>("overview");
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [type, setType] = useState("Todos");
  const [payment, setPayment] = useState("Todos");
  const [table, setTable] = useState("");
  const [origin, setOrigin] = useState("Todos");
  const [query, setQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [showSensitive, setShowSensitive] = useState(canViewTotals && !settings.privacy.hideReportTotals);
  const deferredQuery = useDeferredValue(query);
  const deferredProductQuery = useDeferredValue(productQuery);
  const records = useMemo(() => createReportRecords(entries, pdvSales), [entries, pdvSales]);
  const filteredRecords = useMemo(() => filterReportRecords(records, {
    from,
    to,
    type,
    payment,
    table,
    origin,
    query: deferredQuery
  }), [records, from, to, type, payment, table, origin, deferredQuery]);
  const dataset = useMemo(() => buildReportDataset(filteredRecords), [filteredRecords]);
  const previousRange = useMemo(() => previousReportPeriod(from, to), [from, to]);
  const previousDataset = useMemo(() => buildReportDataset(filterReportRecords(records, {
    from: previousRange.from,
    to: previousRange.to,
    type,
    payment,
    table,
    origin,
    query: deferredQuery
  })), [records, previousRange.from, previousRange.to, type, payment, table, origin, deferredQuery]);
  const showTotals = canViewTotals && showSensitive;
  const productRevenue = roundMoney(dataset.products.reduce((sum, product) => sum + product.revenue, 0));
  const productTotalDifference = roundMoney(productRevenue - dataset.total);
  const types = useMemo(() => ["Todos", ...new Set(records.map((record) => record.type).filter(Boolean))], [records]);
  const payments = useMemo(() => ["Todos", ...new Set(records.flatMap((record) => record.payments.map((item) => item.method)).filter(Boolean))], [records]);
  const origins = useMemo(() => ["Todos", ...new Set(records.map((record) => record.originDevice).filter(Boolean))], [records]);
  const catalogProducts = useMemo(() => dataset.products.filter((product) => product.productId !== "legacy"), [dataset.products]);
  const categories = useMemo(() => ["Todos", ...new Set(catalogProducts
    .map((product) => product.category)
    .filter(Boolean))], [catalogProducts]);
  const visibleProducts = useMemo(() => {
    const search = deferredProductQuery.trim().toLocaleLowerCase("pt-BR");
    return catalogProducts.filter((product) =>
      (category === "Todos" || product.category === category)
      && (!search || `${product.name} ${product.category}`.toLocaleLowerCase("pt-BR").includes(search))
    );
  }, [catalogProducts, category, deferredProductQuery]);
  const exportIds = filteredRecords.map((record) => record.source === "pdv" ? `pdv-${record.id}` : record.id);
  const exportLabel = [from || "inicio", to || "hoje", type, payment, tab].join("-").replace(/\s+/g, "-").toLowerCase();
  const dateIsInRange = (value: string) => {
    const key = getLocalDateKey(new Date(value));
    return (!from || key >= from) && (!to || key <= to);
  };
  const periodReceivables = receivables.filter((item) => dateIsInRange(item.createdAt));
  const periodReceipts = receivables.flatMap((item) => item.payments.map((receipt) => ({ ...receipt, receivable: item }))).filter((item) => dateIsInRange(item.createdAt));
  const receivableIssued = roundMoney(periodReceivables.reduce((sum, item) => sum + item.originalAmount, 0));
  const receivableBalance = roundMoney(receivables.filter((item) => item.status !== "Cancelada").reduce((sum, item) => sum + item.balance, 0));
  const receivableReceived = roundMoney(periodReceipts.reduce((sum, item) => sum + item.amount, 0));
  const overdueBalance = roundMoney(receivables.filter((item) => item.status === "Vencida").reduce((sum, item) => sum + item.balance, 0));

  useEffect(() => {
    setShowSensitive(canViewTotals && !settings.privacy.hideReportTotals);
  }, [canViewTotals, settings.privacy.hideReportTotals]);

  useEffect(() => {
    if (!focusPeriod) return;
    setFrom(focusPeriod.from);
    setTo(focusPeriod.to);
    setType("Todos");
    setPayment("Todos");
    setTable("");
    setOrigin("Todos");
    setQuery("");
    onFocusConsumed?.();
  }, [focusPeriod?.nonce]);

  const setPeriod = (period: "today" | "yesterday" | "week" | "month") => {
    const today = new Date();
    const end = getLocalDateKey(today);
    if (period === "today") {
      setFrom(end);
      setTo(end);
      return;
    }
    if (period === "yesterday") {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const key = getLocalDateKey(date);
      setFrom(key);
      setTo(key);
      return;
    }
    if (period === "week") {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      setFrom(getLocalDateKey(start));
      setTo(end);
      return;
    }
    const current = currentMonthPeriod();
    setFrom(current.from);
    setTo(current.to);
  };

  return (
    <section className="panel professional-report-panel">
      <header className="professional-report-head">
        <div>
          <span className="eyebrow">Inteligencia do caixa</span>
          <h2>Painel do periodo</h2>
          <p className="muted-copy">Venda, Mesas e Onibus analisados na mesma base. Os totais abaixo usam o mesmo recorte da exportacao.</p>
        </div>
        <div className="report-actions">
          <label className="switch-line">
            <input type="checkbox" checked={showTotals} disabled={!canViewTotals} onChange={(event) => setShowSensitive(event.target.checked)} />
            {canViewTotals ? "Mostrar valores" : "Valores bloqueados"}
          </label>
          <button className="ghost-button" onClick={onOpenOutputDirectory} disabled={remoteClientActive}><FolderOpen size={17} /> Pasta</button>
          <button className="ghost-button" onClick={onExport} disabled={remoteClientActive}><FileSpreadsheet size={17} /> Planilha operacional</button>
          <button className="primary-button" onClick={() => onExportFiltered(exportIds, exportLabel)} disabled={remoteClientActive || !filteredRecords.length}><Download size={17} /> Exportar recorte</button>
        </div>
      </header>

      {!canViewTotals && (
        <section className="remote-report-lock">
          <ShieldCheck size={18} />
          <div><strong>Totais protegidos pelo servidor</strong><span>Filtros e quantidades continuam disponiveis sem revelar valores.</span></div>
        </section>
      )}

      <div className="professional-report-filters">
        <div className="report-period-buttons">
          <button onClick={() => setPeriod("today")}>Hoje</button>
          <button onClick={() => setPeriod("yesterday")}>Ontem</button>
          <button onClick={() => setPeriod("week")}>7 dias</button>
          <button onClick={() => setPeriod("month")}>Mes</button>
        </div>
        <label className="field"><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>Ate</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="field"><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value)}>{types.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Pagamento</span><select value={payment} onChange={(event) => setPayment(event.target.value)}>{payments.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Mesa</span><input value={table} onChange={(event) => setTable(event.target.value)} placeholder="Todas" /></label>
        <label className="field"><span>Origem</span><select value={origin} onChange={(event) => setOrigin(event.target.value)}>{origins.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field report-wide-search"><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produto, descricao, mesa..." /></label>
        <button className="ghost-button report-clear-button" onClick={() => {
          const current = currentMonthPeriod();
          setFrom(current.from);
          setTo(current.to);
          setType("Todos");
          setPayment("Todos");
          setTable("");
          setOrigin("Todos");
          setQuery("");
        }}><RotateCcw size={15} /> Limpar</button>
      </div>

      <nav className="professional-report-tabs" aria-label="Tipos de relatorio">
        {([
          ["overview", "Visao geral"],
          ["products", "Produtos"],
          ["payments", "Pagamentos"],
          ["accounts", "Contas a receber"],
          ["tables", "Mesas e vendas"],
          ["times", "Horarios"],
          ["audit", "Auditoria"]
        ] as Array<[ProfessionalReportTab, string]>).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Total vendido liquido" value={showTotals ? formatCurrency(dataset.total) : "Restrito"} detail={comparisonLabel(dataset.total, previousDataset.total, showTotals)} />
            <ProfessionalMetric label="Vendas" value={String(dataset.count)} detail={comparisonLabel(dataset.count, previousDataset.count, true)} />
            <ProfessionalMetric label="Ticket medio" value={showTotals ? formatCurrency(dataset.average) : "Restrito"} detail={`${dataset.activeRecords.filter((record) => record.type === "Mesa").length} fechamento(s) de mesa`} />
            <ProfessionalMetric label="Maior venda" value={showTotals ? formatCurrency(dataset.biggestSale) : "Restrito"} detail={`${dataset.partialCount} fechamento(s) parcial(is)`} />
            <ProfessionalMetric label="Descontos" value={showTotals ? formatCurrency(dataset.discounts) : "Restrito"} detail={`${dataset.cancelledCount} cancelamento(s)`} tone={dataset.discounts ? "warning" : "normal"} />
          </div>
          <div className="professional-report-chart-grid">
            <ReportTrendChart rows={dataset.daily} showValues={showTotals} />
            <ReportBars title="Faturamento por tipo" rows={dataset.byType} showValues={showTotals} />
            <ReportBars title="Formas de pagamento" rows={dataset.byPayment} showValues={showTotals} />
          </div>
          <section className="professional-report-section">
            <div className="section-title"><strong>Ultimas vendas do recorte</strong><span>{dataset.activeRecords.length} valida(s)</span></div>
            <div className="professional-report-records">
              {dataset.activeRecords.slice(0, 10).map((record) => (
                <article key={record.id}>
                  <div><strong>{record.description}</strong><span>{new Date(record.createdAt).toLocaleString("pt-BR")} | {record.type} | {record.payments.map((item) => item.method).join(" + ")}</span></div>
                  <b>{canViewEntryValues ? formatCurrency(record.total) : "Restrito"}</b>
                </article>
              ))}
              {!dataset.activeRecords.length && <p className="empty-text">Sem vendas neste recorte.</p>}
            </div>
          </section>
        </div>
      )}

      {tab === "products" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Itens vendidos" value={formatReportQuantity(catalogProducts.reduce((sum, product) => sum + product.quantity, 0))} detail={`${catalogProducts.length} produto(s) diferente(s)`} />
            <ProfessionalMetric label="Produto lider" value={catalogProducts[0]?.name || "-"} detail={catalogProducts[0] ? `${formatReportQuantity(catalogProducts[0].quantity)} vendido(s)` : "Sem movimento"} />
            <ProfessionalMetric label="Categorias" value={String(dataset.categories.length)} detail={`${dataset.complements.length} adicional(is) utilizado(s)`} />
            <ProfessionalMetric
              label="Total dos itens"
              value={showTotals ? formatCurrency(productRevenue) : "Restrito"}
              detail={productTotalDifference > 0
                ? `${formatCurrency(productTotalDifference)} em desconto geral aplicado no fechamento`
                : "Ja considera descontos dos itens e do fechamento"}
            />
          </div>
          <div className="professional-product-filters">
            <label className="field"><span>Pesquisar produto</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Nome do produto" /></label>
            <label className="field"><span>Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <span>{visibleProducts.length} produto(s)</span>
          </div>
          <div className="professional-report-chart-grid">
            <ReportBars title="Mais vendidos" rows={visibleProducts.slice(0, 10).map((product) => [product.name, product.quantity])} showValues valueFormatter={formatReportQuantity} />
            <ReportBars title="Maior faturamento" rows={[...visibleProducts].sort((left, right) => right.revenue - left.revenue).slice(0, 10).map((product) => [product.name, product.revenue])} showValues={showTotals} />
            <ReportBars title="Adicionais mais usados" rows={dataset.complements.slice(0, 10)} showValues valueFormatter={formatReportQuantity} />
          </div>
          <ProductReportTable products={visibleProducts} showValues={showTotals} />
          <section className="professional-report-section">
            <div className="section-title"><strong>Desempenho por categoria</strong><span>{dataset.categories.length} categoria(s)</span></div>
            <div className="category-performance-grid">
              {dataset.categories.map((item) => (
                <article key={item.name}>
                  <div><strong>{item.name}</strong><span>{formatReportQuantity(item.quantity)} item(ns) | {item.products} produto(s)</span></div>
                  <b>{showTotals ? formatCurrency(item.revenue) : "Restrito"}</b>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "payments" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Pagamentos" value={String(dataset.activeRecords.reduce((sum, record) => sum + record.payments.length, 0))} detail={`${dataset.byPayment.length} forma(s) utilizada(s)`} />
            <ProfessionalMetric label="Dinheiro recebido" value={showTotals ? formatCurrency(dataset.receivedInCash) : "Restrito"} detail="Valor entregue pelo cliente" />
            <ProfessionalMetric label="Troco devolvido" value={showTotals ? formatCurrency(dataset.change) : "Restrito"} detail="Nao entra no faturamento" />
            <ProfessionalMetric label="Pagamentos mistos" value={String(dataset.activeRecords.filter((record) => record.payments.length > 1).length)} detail="Vendas com mais de uma forma" />
          </div>
          <div className="professional-report-chart-grid">
            <ReportBars title="Total por forma" rows={dataset.byPayment} showValues={showTotals} />
            <ReportBars title="Quantidade de usos" rows={paymentUsageRows(dataset)} showValues valueFormatter={(value) => `${value} uso(s)`} />
          </div>
          <section className="professional-report-section">
            <div className="section-title"><strong>Composicao dos pagamentos</strong><span>Partes registradas individualmente</span></div>
            <div className="payment-report-table-wrap">
              <table className="professional-data-table">
                <thead><tr><th>Data</th><th>Venda</th><th>Forma</th><th>Descricao</th><th>Recebido</th><th>Troco</th><th>Valor</th></tr></thead>
                <tbody>
                  {dataset.activeRecords.flatMap((record) => record.payments.map((item, index) => (
                    <tr key={`${record.id}-${index}`}>
                      <td>{new Date(record.createdAt).toLocaleString("pt-BR")}</td>
                      <td>{record.description}</td>
                      <td>{item.method}</td>
                      <td>{item.description || "-"}</td>
                      <td>{showTotals ? formatCurrency(item.received) : "Restrito"}</td>
                      <td>{showTotals ? formatCurrency(item.change) : "Restrito"}</td>
                      <td><strong>{showTotals ? formatCurrency(item.amount) : "Restrito"}</strong></td>
                    </tr>
                  )))}
                  {!dataset.activeRecords.length && <tr><td colSpan={7}>Sem pagamentos neste recorte.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "tables" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Mesas fechadas" value={String(dataset.activeRecords.filter((record) => record.type === "Mesa").length)} detail={`${dataset.partialCount} parcial(is)`} />
            <ProfessionalMetric label="Vendas diretas" value={String(dataset.activeRecords.filter((record) => record.type === "Venda" || record.type === "Venda direta").length)} detail="Atendimentos fora de mesa" />
            <ProfessionalMetric label="Onibus" value={String(dataset.activeRecords.filter((record) => record.type === "Onibus").length)} detail="Lancamentos identificados como onibus" />
            <ProfessionalMetric label="Canceladas" value={String(dataset.cancelledCount)} detail={showTotals ? formatCurrency(dataset.cancelledTotal) : "Valor restrito"} tone={dataset.cancelledCount ? "warning" : "normal"} />
          </div>
          <div className="professional-report-chart-grid">
            <ReportBars title="Faturamento por mesa" rows={dataset.byTable.slice(0, 15)} showValues={showTotals} />
            <ReportBars title="Venda por origem/caixa" rows={dataset.byOrigin} showValues={showTotals} />
            <ReportBars title="Tipos de atendimento" rows={dataset.byType} showValues={showTotals} />
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Contas geradas" value={showTotals ? formatCurrency(receivableIssued) : "Restrito"} detail={`${periodReceivables.length} conta(s) no periodo`} />
            <ProfessionalMetric label="Recebido no periodo" value={showTotals ? formatCurrency(receivableReceived) : "Restrito"} detail={`${periodReceipts.length} recebimento(s)`} />
            <ProfessionalMetric label="Saldo em aberto" value={showTotals ? formatCurrency(receivableBalance) : "Restrito"} detail="Posicao atual da carteira" />
            <ProfessionalMetric label="Saldo vencido" value={showTotals ? formatCurrency(overdueBalance) : "Restrito"} detail={`${receivables.filter((item) => item.status === "Vencida").length} conta(s) vencida(s)`} tone={overdueBalance ? "warning" : "normal"} />
          </div>
          <section className="professional-report-section">
            <div className="section-title"><strong>Contas geradas no recorte</strong><span>Cliente, vencimento, recebido e saldo</span></div>
            <div className="table-scroll">
              <table className="professional-report-table">
                <thead><tr><th>Data</th><th>Cliente</th><th>Origem</th><th>Vencimento</th><th>Status</th><th>Original</th><th>Recebido</th><th>Saldo</th></tr></thead>
                <tbody>
                  {periodReceivables.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleDateString("pt-BR")}</td>
                      <td>{item.customerName}</td>
                      <td>{item.tableNumber ? `Mesa ${item.tableNumber}${item.subtableName ? ` / ${item.subtableName}` : ""}` : "Venda"}</td>
                      <td>{item.dueDate ? new Date(`${item.dueDate}T12:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                      <td>{item.status}</td>
                      <td>{showTotals ? formatCurrency(item.originalAmount) : "Restrito"}</td>
                      <td>{showTotals ? formatCurrency(item.receivedAmount) : "Restrito"}</td>
                      <td><strong>{showTotals ? formatCurrency(item.balance) : "Restrito"}</strong></td>
                    </tr>
                  ))}
                  {!periodReceivables.length && <tr><td colSpan={8}>Nenhuma conta criada neste periodo.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section className="professional-report-section">
            <div className="section-title"><strong>Recebimentos do recorte</strong><span>Entradas efetivas por forma de pagamento</span></div>
            <div className="professional-report-records">
              {periodReceipts.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.receivable.customerName}</strong><span>{new Date(item.createdAt).toLocaleString("pt-BR")} | {item.method}{item.description ? ` | ${item.description}` : ""}</span></div>
                  <b>{showTotals ? formatCurrency(item.amount) : "Restrito"}</b>
                </article>
              ))}
              {!periodReceipts.length && <p className="empty-text">Nenhum recebimento neste periodo.</p>}
            </div>
          </section>
        </div>
      )}

      {tab === "times" && (
        <div className="professional-report-content">
          <div className="professional-report-chart-grid wide">
            <ReportBars title="Faturamento por hora" rows={dataset.byHour} showValues={showTotals} />
            <ReportBars title="Dias da semana" rows={dataset.byWeekday} showValues={showTotals} />
          </div>
          <ReportTrendChart rows={dataset.daily} showValues={showTotals} expanded />
        </div>
      )}

      {tab === "audit" && (
        <div className="professional-report-content">
          <div className="report-kpi-grid">
            <ProfessionalMetric label="Cancelamentos" value={String(dataset.cancelledCount)} detail={showTotals ? formatCurrency(dataset.cancelledTotal) : "Valor restrito"} tone={dataset.cancelledCount ? "warning" : "normal"} />
            <ProfessionalMetric label="Na lixeira" value={String(dataset.deletedCount)} detail="Registros fora dos totais" tone={dataset.deletedCount ? "warning" : "normal"} />
            <ProfessionalMetric label="Descontos" value={showTotals ? formatCurrency(dataset.discounts) : "Restrito"} detail="Venda e itens somados" tone={dataset.discounts ? "warning" : "normal"} />
            <ProfessionalMetric label="Planilha" value={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente(s)` : "Sincronizada"} detail={exportStatus?.message || "Sem erro registrado"} tone={exportStatus?.pendingCount ? "warning" : "normal"} />
          </div>
          <section className="professional-report-section">
            <div className="section-title"><strong>Ocorrencias do recorte</strong><span>Cancelados, removidos e parciais</span></div>
            <div className="professional-report-records">
              {dataset.records.filter((record) => record.status !== "active" || record.type === "Mesa parcial").map((record) => (
                <article key={record.id} className={record.status !== "active" ? "warning" : ""}>
                  <div><strong>{record.description}</strong><span>{new Date(record.createdAt).toLocaleString("pt-BR")} | {record.type} | {record.status}</span></div>
                  <b>{showTotals ? formatCurrency(record.total) : "Restrito"}</b>
                </article>
              ))}
              {!dataset.records.some((record) => record.status !== "active" || record.type === "Mesa parcial") && <p className="empty-text">Nenhuma ocorrencia neste recorte.</p>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function ProfessionalMetric({ label, value, detail, tone = "normal" }: { label: string; value: string; detail: string; tone?: "normal" | "warning" }) {
  return (
    <article className={`professional-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ReportBars({ title, rows, showValues, valueFormatter }: { title: string; rows: Array<[string, number]>; showValues: boolean; valueFormatter?: (value: number) => string }) {
  const max = Math.max(0, ...rows.map((row) => Math.abs(row[1])));
  return (
    <section className="professional-chart-card">
      <div className="section-title"><strong>{title}</strong><span>{rows.length} linha(s)</span></div>
      <div className="professional-bar-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span title={label}>{label}</span>
            <div><i style={{ width: `${Math.max(value ? 3 : 0, max ? (Math.abs(value) / max) * 100 : 0)}%` }} /></div>
            <strong>{showValues ? (valueFormatter ? valueFormatter(value) : formatCurrency(value)) : "Restrito"}</strong>
          </div>
        ))}
        {!rows.length && <p className="empty-text">Sem dados.</p>}
      </div>
    </section>
  );
}

function ReportTrendChart({ rows, showValues, expanded = false }: { rows: ReportDataset["daily"]; showValues: boolean; expanded?: boolean }) {
  const visible = expanded ? rows.slice(-31) : rows.slice(-14);
  const max = Math.max(0, ...visible.map((row) => row.total));
  return (
    <section className={`professional-chart-card trend ${expanded ? "expanded" : ""}`}>
      <div className="section-title"><strong>Movimento por dia</strong><span>{visible.length} dia(s)</span></div>
      <div className="professional-column-chart">
        {visible.map((row) => (
          <div key={row.dateKey} title={`${formatReportDate(row.dateKey)} | ${row.count} venda(s) | ${formatCurrency(row.total)}`}>
            <strong>{showValues ? formatCompactMoney(row.total) : `${row.count}`}</strong>
            <i style={{ height: `${Math.max(row.total ? 5 : 0, max ? (row.total / max) * 100 : 0)}%` }} />
            <span>{row.dateKey.slice(8, 10)}</span>
          </div>
        ))}
        {!visible.length && <p className="empty-text">Sem movimento no periodo.</p>}
      </div>
    </section>
  );
}

function ProductReportTable({ products, showValues }: { products: ReportProductSummary[]; showValues: boolean }) {
  return (
    <section className="professional-report-section">
      <div className="section-title"><strong>Todos os produtos do recorte</strong><span>{products.length} produto(s)</span></div>
      <div className="product-report-table-wrap">
        <table className="professional-data-table">
          <thead><tr><th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Lancamentos</th><th>Preco medio</th><th>Descontos</th><th>Total dos itens</th></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.key}>
                <td><strong>{product.name}</strong></td>
                <td>{product.category}</td>
                <td>{formatReportQuantity(product.quantity)}</td>
                <td>{product.launches}</td>
                <td>{showValues ? formatCurrency(product.averagePrice) : "Restrito"}</td>
                <td>{showValues ? formatCurrency(product.discounts) : "Restrito"}</td>
                <td><strong>{showValues ? formatCurrency(product.revenue) : "Restrito"}</strong></td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan={7}>Nenhum produto encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function previousReportPeriod(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from || getLocalDateKey()}T12:00:00`);
  const end = new Date(`${to || from || getLocalDateKey()}T12:00:00`);
  const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  const previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() - duration + 1);
  return { from: getLocalDateKey(previousStart), to: getLocalDateKey(previousEnd) };
}

function comparisonLabel(current: number, previous: number, visible: boolean): string {
  if (!visible) return "Comparacao restrita";
  if (!previous) return current ? "Sem movimento no periodo anterior" : "Sem movimento";
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}% vs. periodo anterior`;
}

function formatReportQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function formatCompactMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatCurrency(value);
}

function paymentUsageRows(dataset: ReportDataset): Array<[string, number]> {
  const counts = new Map<string, number>();
  dataset.activeRecords.forEach((record) => record.payments.forEach((payment) => counts.set(payment.method, (counts.get(payment.method) || 0) + 1)));
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function ReportsPanel({
  entries,
  settings,
  summary,
  exportStatus,
  remoteClientActive = false,
  canViewTotals = true,
  canViewEntryValues = true,
  focusPeriod,
  onFocusConsumed,
  onOpenOutputDirectory,
  onExport,
  onExportFiltered
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  summary: DaySummary;
  exportStatus: ExportStatus | null;
  remoteClientActive?: boolean;
  canViewTotals?: boolean;
  canViewEntryValues?: boolean;
  focusPeriod?: ReportFocusPeriod | null;
  onFocusConsumed?: () => void;
  onOpenOutputDirectory: () => Promise<void>;
  onExport: () => Promise<void>;
  onExportFiltered: (ids: string[], label: string) => Promise<void>;
}) {
  const [from, setFrom] = useState(() => currentMonthPeriod().from);
  const [to, setTo] = useState(() => currentMonthPeriod().to);
  const [type, setType] = useState("Todos");
  const [payment, setPayment] = useState("Todos");
  const [table, setTable] = useState("");
  const [bus, setBus] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [showSensitive, setShowSensitive] = useState(canViewTotals && !settings.privacy.hideReportTotals);
  const showReportTotals = canViewTotals && showSensitive;

  useEffect(() => {
    setShowSensitive(canViewTotals && !settings.privacy.hideReportTotals);
  }, [settings.privacy.hideReportTotals, canViewTotals]);

  useEffect(() => {
    if (!focusPeriod) {
      return;
    }
    setFrom(focusPeriod.from);
    setTo(focusPeriod.to);
    setType("Todos");
    setPayment("Todos");
    setTable("");
    setBus("");
    setQuery("");
    onFocusConsumed?.();
  }, [focusPeriod?.nonce]);

  const periodEntries = useMemo(() => {
    const search = deferredQuery.toLowerCase();
    return entries.filter((entry) => {
      const date = getLocalDateKey(entry.createdAt);
      const haystack = `${entry.description} ${entry.tableNumber} ${entry.busNumber} ${entry.originDevice}`.toLowerCase();
      return (
        (!from || date >= from) &&
        (!to || date <= to) &&
        (type === "Todos" || entry.type === type) &&
        (payment === "Todos" || entryMatchesPayment(entry, payment)) &&
        (!table || entry.tableNumber === table) &&
        (!bus || entry.busNumber === bus) &&
        haystack.includes(search)
      );
    });
  }, [entries, from, to, type, payment, table, bus, deferredQuery]);
  const reportStats = useMemo(() => {
    const periodSummary = summarizeEntries(periodEntries);
    const activeRows = periodEntries.filter((entry) => entry.status === "active");
    const cancelledCount = periodEntries.filter((entry) => entry.status === "cancelled").length;
    const deletedCount = periodEntries.filter((entry) => entry.status === "deleted").length;
    const dailyTotals = summarizeByDay(activeRows);
    const originTotals = summarizeByOrigin(activeRows);
    const peakDay = [...dailyTotals].sort((left, right) =>
      showReportTotals ? right.total - left.total : right.count - left.count
    )[0];
    const topEntries = showReportTotals
      ? [...activeRows].sort((left, right) => getEntryAmount(right) - getEntryAmount(left)).slice(0, 5)
      : activeRows.slice(0, 5);
    const dailyAverage = dailyTotals.length ? roundMoney(periodSummary.total / dailyTotals.length) : 0;
    const cashShare = periodSummary.total ? Math.round((periodSummary.cashTotal / periodSummary.total) * 100) : 0;
    const busShare = periodSummary.total ? Math.round((periodSummary.busTotal / periodSummary.total) * 100) : 0;

    return {
      periodSummary,
      activeRows,
      cancelledCount,
      deletedCount,
      dailyTotals,
      originTotals,
      peakDay,
      topEntries,
      dailyAverage,
      cashShare,
      busShare
    };
  }, [periodEntries, showReportTotals]);
  const {
    periodSummary,
    activeRows,
    cancelledCount,
    deletedCount,
    dailyTotals,
    originTotals,
    peakDay,
    topEntries,
    dailyAverage,
    cashShare,
    busShare
  } = reportStats;
  const tables = useMemo(() => uniqueFilled(entries.map((entry) => entry.tableNumber)), [entries]);
  const buses = useMemo(() => uniqueFilled(entries.map((entry) => entry.busNumber)), [entries]);
  const exportLabel = [from || "inicio", to || "hoje", type, payment]
    .join("-")
    .replace(/\s+/g, "-")
    .toLowerCase();

  return (
    <section className="panel report-panel">
      <div className="report-command">
        <div>
          <span className="eyebrow">Analise do caixa</span>
          <h2>Relatorios com filtros</h2>
          <p className="muted-copy">
            {remoteClientActive
              ? "Relatorio remoto em modo cliente. Valores e totais seguem as permissoes do computador servidor."
              : "Filtre por periodo, tipo, mesa, onibus, pagamento ou origem e exporte apenas o recorte que esta na tela."}
          </p>
        </div>
        <div className="report-actions">
          <label className="switch-line">
            <input type="checkbox" checked={showReportTotals} disabled={!canViewTotals} onChange={(event) => setShowSensitive(event.target.checked)} />
            {canViewTotals ? "Mostrar totais sensiveis" : "Totais bloqueados pelo servidor"}
          </label>
          <button className="ghost-button" onClick={onOpenOutputDirectory} disabled={remoteClientActive}><FolderOpen size={18} /> Pasta do Excel</button>
          <button className="ghost-button" onClick={onExport} disabled={remoteClientActive}><FileSpreadsheet size={18} /> Planilha geral</button>
          <button className="primary-button" onClick={() => onExportFiltered(periodEntries.map((entry) => entry.id), exportLabel)} disabled={remoteClientActive}><Download size={18} /> Exportar filtrado</button>
        </div>
      </div>

      {!canViewTotals && (
        <section className="remote-report-lock">
          <ShieldCheck size={18} />
          <div>
            <strong>Totais ocultos pelo servidor</strong>
            <span>Filtros, datas e lista continuam disponiveis, mas nenhum total e recalculado neste cliente.</span>
          </div>
        </section>
      )}

      <div className="filter-bar report-filter-bar">
        <label className="field"><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>Ate</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="field"><span>Tipo</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option>Todos</option>
            {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Pagamento</span>
          <select value={payment} onChange={(event) => setPayment(event.target.value)}>
            <option>Todos</option>
            {PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Mesa</span>
          <select value={table} onChange={(event) => setTable(event.target.value)}>
            <option value="">Todas</option>
            {tables.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Onibus</span>
          <select value={bus} onChange={(event) => setBus(event.target.value)}>
            <option value="">Todos</option>
            {buses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field report-search"><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Descricao, origem..." /></label>
        <button className="ghost-button" type="button" onClick={() => {
          const month = currentMonthPeriod();
          setFrom(month.from);
          setTo(month.to);
          setType("Todos");
          setPayment("Todos");
          setTable("");
          setBus("");
          setQuery("");
        }}><RotateCcw size={16} /> Limpar filtros</button>
      </div>

      <div className="report-close-grid">
        <ReportCloseCard
          label="Fechamento"
          value={showReportTotals ? formatCurrency(periodSummary.total) : "Restrito"}
          detail={`${activeRows.length} ativos em ${periodEntries.length} encontrados`}
        />
        <ReportCloseCard
          label={showReportTotals ? "Dia mais forte" : "Dia com mais registros"}
          value={showReportTotals ? (peakDay ? formatCurrency(peakDay.total) : formatCurrency(0)) : peakDay ? `${peakDay.count} reg.` : "0 reg."}
          detail={peakDay ? `${formatReportDate(peakDay.dateKey, true)} com ${peakDay.count} registro(s)` : "Sem lancamentos no recorte"}
        />
        <ReportCloseCard
          label="Media diaria"
          value={showReportTotals ? formatCurrency(dailyAverage) : "Restrito"}
          detail={`${dailyTotals.length || 0} dia(s) com movimento`}
        />
        <ReportCloseCard
          label="Mix rapido"
          value={showReportTotals ? `${cashShare}% dinheiro` : "Restrito"}
          detail={showReportTotals ? `${busShare}% onibus | ${cancelledCount} cancelado(s)` : `${cancelledCount} cancelado(s)`}
        />
      </div>

      <div className="metric-grid">
        <Metric label="Total do periodo" value={showReportTotals ? formatCurrency(periodSummary.total) : "Restrito"} />
        <Metric label="Quantidade" value={String(periodSummary.count)} />
        <Metric label="Media" value={showReportTotals ? formatCurrency(periodSummary.average) : "Restrito"} />
        <Metric label="Maior venda" value={showReportTotals ? formatCurrency(periodSummary.biggestSale) : "Restrito"} />
        <Metric label="Onibus" value={showReportTotals ? formatCurrency(periodSummary.busTotal) : "Restrito"} />
        <Metric label="Dinheiro" value={showReportTotals ? formatCurrency(periodSummary.cashTotal) : "Restrito"} />
        <Metric label="Sobras" value={showReportTotals ? formatCurrency(periodSummary.differenceTotal) : "Restrito"} />
        <Metric label="Cancelados" value={String(cancelledCount)} />
        <Metric label="Lixeira" value={String(deletedCount)} />
        <Metric label="Arquivo" value={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente` : "OK"} />
      </div>

      {showReportTotals ? (
        <div className="report-columns">
          <BarList title="Total por tipo" data={periodSummary.byType} total={periodSummary.total} />
          <BarList title="Total por mesa" data={periodSummary.byTable} total={periodSummary.total} />
          <BarList title="Total por onibus" data={periodSummary.byBus} total={periodSummary.total} />
          <BarList title="Forma de pagamento" data={periodSummary.byPayment} total={periodSummary.total} />
          <BarList title="Total por origem/caixa" data={originTotals} total={periodSummary.total} />
        </div>
      ) : (
        <section className="flat-section restricted-panel">
          <ShieldCheck size={20} />
          <strong>Totais ocultos</strong>
          <p className="muted-copy">Este modo permite conferir quantidade e filtros sem expor valores de venda.</p>
        </section>
      )}

      <div className="report-deep-grid">
        <DailyTrendCard rows={dailyTotals} showSensitive={showReportTotals} />
        <TopEntriesCard entries={topEntries} showSensitive={showReportTotals && canViewEntryValues} />
        <ReportAlertsCard
          cancelledCount={cancelledCount}
          deletedCount={deletedCount}
          pendingCount={exportStatus?.pendingCount || 0}
          differenceTotal={periodSummary.differenceTotal}
          showSensitive={showReportTotals}
        />
      </div>

      <section className="flat-section">
        <div className="section-title">
          <strong>Registros do recorte</strong>
          <span>{activeRows.length} ativos em {periodEntries.length} encontrados</span>
        </div>
        <div className="report-row-list">
          {periodEntries.slice(0, 12).map((entry) => {
            const { date, time } = formatDateTime(entry.createdAt);
            return (
              <div key={entry.id}>
                <span>{date} {time}</span>
                <strong>{entry.description}</strong>
                <small>{entry.customType || entry.type} | {paymentLabelForEntry(entry)}</small>
                <b>{canViewEntryValues ? formatCurrency(entry.finalValue) : "Restrito"}</b>
              </div>
            );
          })}
          {!periodEntries.length && <p className="empty-text">Nenhum registro encontrado com esses filtros.</p>}
        </div>
      </section>
    </section>
  );
}

function summarizeByDay(entries: LedgerEntry[]): Array<{ dateKey: string; total: number; count: number }> {
  const grouped = entries.reduce<Record<string, { total: number; count: number }>>((acc, entry) => {
    const dateKey = getLocalDateKey(entry.createdAt);
    acc[dateKey] = acc[dateKey] || { total: 0, count: 0 };
    acc[dateKey].total += getEntryAmount(entry);
    acc[dateKey].count += 1;
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([dateKey, value]) => ({ dateKey, total: roundMoney(value.total), count: value.count }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function summarizeByOrigin(entries: LedgerEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    const origin = entry.originDevice?.trim() || "Sem origem";
    acc[origin] = roundMoney((acc[origin] || 0) + getEntryAmount(entry));
    return acc;
  }, {});
}

function currentMonthPeriod(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: getLocalDateKey(from), to: getLocalDateKey(to) };
}

function formatReportDate(dateKey: string, withWeekday = false): string {
  const [year, month, day] = dateKey.split("-");
  const basic = `${day}/${month}/${year}`;
  if (!withWeekday) {
    return basic;
  }
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const weekdays = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
  return `${weekdays[date.getDay()]}, ${basic}`;
}

function ReportCloseCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="report-close-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DailyTrendCard({ rows, showSensitive }: { rows: Array<{ dateKey: string; total: number; count: number }>; showSensitive: boolean }) {
  const max = Math.max(...rows.map((row) => (showSensitive ? Math.abs(row.total) : row.count)), 0);
  return (
    <section className="report-insight-card">
      <div className="section-title">
        <strong>Movimento por dia</strong>
        <span>{rows.length} dia(s)</span>
      </div>
      <div className="daily-trend-list">
        {rows.slice(-7).map((row) => (
          <div key={row.dateKey}>
            <span>{formatReportDate(row.dateKey, true)}</span>
            <div className="bar-track">
              <span style={{ width: `${Math.max(3, Math.min(100, max ? ((showSensitive ? Math.abs(row.total) : row.count) / max) * 100 : 0))}%` }} />
            </div>
            <strong>{showSensitive ? formatCurrency(row.total) : `${row.count} reg.`}</strong>
          </div>
        ))}
        {!rows.length && <p className="empty-text">Sem movimento no recorte.</p>}
      </div>
    </section>
  );
}

function TopEntriesCard({ entries, showSensitive }: { entries: LedgerEntry[]; showSensitive: boolean }) {
  return (
    <section className="report-insight-card">
      <div className="section-title">
        <strong>Maiores lancamentos</strong>
        <span>Top {entries.length}</span>
      </div>
      <div className="top-entry-list">
        {entries.map((entry, index) => {
          const { date, time } = formatDateTime(entry.createdAt);
          return (
            <article key={entry.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{entry.description || "Venda"}</strong>
                <small>{date} {time} | {entry.customType || entry.type} | {paymentLabelForEntry(entry)}</small>
              </div>
              <b>{showSensitive ? formatCurrency(getEntryAmount(entry)) : "Restrito"}</b>
            </article>
          );
        })}
        {!entries.length && <p className="empty-text">Sem lancamentos ativos no recorte.</p>}
      </div>
    </section>
  );
}

function ReportAlertsCard({
  cancelledCount,
  deletedCount,
  pendingCount,
  differenceTotal,
  showSensitive
}: {
  cancelledCount: number;
  deletedCount: number;
  pendingCount: number;
  differenceTotal: number;
  showSensitive: boolean;
}) {
  const alerts = [
    {
      label: pendingCount ? "Exportacao pendente" : "Exportacao sincronizada",
      detail: pendingCount ? `${pendingCount} tentativa(s) pendente(s)` : "Planilha pronta para conferir",
      tone: pendingCount ? "warn" : "ok"
    },
    {
      label: cancelledCount ? "Cancelamentos no recorte" : "Sem cancelamentos",
      detail: `${cancelledCount} lancamento(s) cancelado(s)`,
      tone: cancelledCount ? "warn" : "ok"
    },
    {
      label: deletedCount ? "Itens na lixeira" : "Lixeira limpa no recorte",
      detail: `${deletedCount} lancamento(s) removido(s)`,
      tone: deletedCount ? "warn" : "ok"
    },
    {
      label: "Sobras e ajustes",
      detail: showSensitive ? formatCurrency(differenceTotal) : "Restrito",
      tone: differenceTotal ? "warn" : "ok"
    }
  ];

  return (
    <section className="report-insight-card report-alert-card">
      <div className="section-title">
        <strong>Alertas do recorte</strong>
        <span>Fechamento</span>
      </div>
      {alerts.map((alert) => (
        <article key={alert.label} className={alert.tone}>
          <i />
          <div>
            <strong>{alert.label}</strong>
            <span>{alert.detail}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

function ServerPanel({
  settings,
  server,
  remoteSession,
  remoteMessage,
  remoteLoading,
  onSaveSettings,
  onServerChange,
  onToast,
  onConnectRemote,
  onDisconnectRemote,
  onRefreshRemote,
  onSubmitRemote,
  onEditRemote,
  onCancelRemote,
  onDeleteRemote
}: {
  settings: AppSettings;
  server: ServerState;
  remoteSession: RemoteClientSession | null;
  remoteMessage: string;
  remoteLoading: boolean;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onServerChange: (server: ServerState) => void;
  onToast: (tone: ToastState["tone"], message: string) => void;
  onConnectRemote: (host: string, password: string, deviceName: string) => Promise<boolean>;
  onDisconnectRemote: () => void;
  onRefreshRemote: () => Promise<void> | void;
  onSubmitRemote: (draft: EntryDraft) => Promise<void>;
  onEditRemote: (entry: LedgerEntry) => Promise<void>;
  onCancelRemote: (entry: LedgerEntry) => Promise<void>;
  onDeleteRemote: (entry: LedgerEntry, permanent?: boolean) => Promise<void>;
}) {
  const [port, setPort] = useState(settings.server.port);
  const [password, setPassword] = useState(settings.server.password);
  const [permissions, setPermissions] = useState(settings.server.permissions);
  const [mode, setMode] = useState<ServerPanelMode>("create");
  const [connectHost, setConnectHost] = useState(settings.server.autoConnection.mode === "client" ? settings.server.autoConnection.host : server.url || "");
  const [connectPassword, setConnectPassword] = useState(settings.server.autoConnection.mode === "client" ? settings.server.autoConnection.password : "");
  const [connectDeviceName, setConnectDeviceName] = useState(settings.server.autoConnection.deviceName || "App cliente");
  const [autoStartServer, setAutoStartServer] = useState(settings.server.autoConnection.mode === "server");
  const [autoConnectClient, setAutoConnectClient] = useState(settings.server.autoConnection.mode === "client");

  useEffect(() => {
    setPort(settings.server.port);
    setPassword(settings.server.password);
    setPermissions(settings.server.permissions);
    setAutoStartServer(settings.server.autoConnection.mode === "server");
    setAutoConnectClient(settings.server.autoConnection.mode === "client");
    if (settings.server.autoConnection.mode === "client") {
      setConnectHost(settings.server.autoConnection.host);
      setConnectPassword(settings.server.autoConnection.password);
      setConnectDeviceName(settings.server.autoConnection.deviceName || "App cliente");
    }
  }, [settings.server.port, settings.server.password, settings.server.permissions, settings.server.autoConnection]);

  const start = async () => {
    try {
      const nextSettings = {
        ...settings,
        server: {
          ...settings.server,
          port,
          password,
          permissions,
          autoConnection: autoStartServer
            ? { mode: "server" as const, host: "", password: "", deviceName: settings.server.autoConnection.deviceName || "App cliente" }
            : settings.server.autoConnection.mode === "server"
              ? { ...settings.server.autoConnection, mode: "none" as const }
              : settings.server.autoConnection
        }
      };
      const next = await window.caixa.startServer(port, password);
      onServerChange(next);
      await onSaveSettings(nextSettings);
      onToast("success", "Servidor local aberto.");
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel abrir o servidor.");
    }
  };

  const stop = async () => {
    const next = await window.caixa.stopServer();
    onServerChange(next);
    onToast("info", "Servidor desligado.");
  };

  const connectRemote = async () => {
    const nextAutoConnection = autoConnectClient
      ? {
          mode: "client" as const,
          host: connectHost.trim(),
          password: connectPassword,
          deviceName: connectDeviceName.trim() || "App cliente"
        }
      : settings.server.autoConnection.mode === "client"
        ? { ...settings.server.autoConnection, mode: "none" as const }
        : settings.server.autoConnection;
    const connected = await onConnectRemote(connectHost, connectPassword, connectDeviceName);
    if (!connected) {
      return;
    }
    await onSaveSettings({
      ...settings,
      server: {
        ...settings.server,
        port,
        password,
        permissions,
        autoConnection: nextAutoConnection
      }
    });
  };
  const connectDisabledByServer = server.running && !remoteSession;

  return (
    <section className="panel server-panel">
      <div className="server-hero">
        <div>
          <span className="eyebrow">Rede local</span>
          <h2>{server.running ? "Servidor ativo" : "Servidor desligado"}</h2>
          <p>Use esta area para abrir o caixa principal na rede ou orientar outro computador a conectar com senha.</p>
        </div>
        <div className="server-url">
          <Laptop size={24} />
          <strong>{server.running ? server.url : "Aguardando abertura"}</strong>
          <span>{server.ips.join(" | ") || "Nenhum IP local encontrado"}</span>
        </div>
      </div>

      <div className="subtab-row">
        <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}><RadioTower size={16} /> Criar servidor</button>
        <button
          className={mode === "connect" ? "active" : ""}
          disabled={connectDisabledByServer}
          title={connectDisabledByServer ? "Desligue o servidor deste app antes de conectar a outro caixa." : "Conectar este app a outro caixa"}
          onClick={() => setMode("connect")}
        >
          <PlugZap size={16} /> Conectar
        </button>
        <button className={mode === "permissions" ? "active" : ""} onClick={() => setMode("permissions")}><ShieldCheck size={16} /> Permissoes</button>
      </div>

      {mode === "create" && (
        <>
          <div className="help-grid">
            <section>
              <strong>O que acontece ao abrir?</strong>
              <p>Este computador vira o caixa principal. Outros dispositivos da mesma rede acessam o endereco mostrado, digitam a senha e seguem as permissoes definidas.</p>
            </section>
            <section>
              <strong>Se der erro</strong>
              <p>Confira se os computadores estao no mesmo Wi-Fi/cabo, se a porta nao esta bloqueada e se a senha foi digitada igual.</p>
            </section>
          </div>
          <div className="entry-grid">
            <label className="field">
              <span>Porta</span>
              <input type="number" value={port} onChange={(event) => setPort(Number(event.target.value || 4317))} />
            </label>
            <label className="field">
              <span>Senha</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Defina uma senha" />
            </label>
          </div>
          <label className={`privacy-toggle-card ${autoStartServer ? "enabled" : ""}`}>
            <input type="checkbox" checked={autoStartServer} onChange={(event) => setAutoStartServer(event.target.checked)} />
            <span>
              <strong>Abrir este PC como servidor ao iniciar</strong>
              <small>Quando este computador for o caixa principal, o app abre o servidor sozinho usando esta porta e senha.</small>
            </span>
          </label>
          <div className="submit-row">
            {server.running ? (
              <button className="danger-button" onClick={stop}>Desligar servidor</button>
            ) : (
              <button className="primary-button" onClick={start}><Server size={18} /> Abrir servidor</button>
            )}
          </div>
        </>
      )}

      {mode === "connect" && (
        <section className="flat-section connect-panel">
          <div className="section-title">
            <strong>Conectar este computador a outro caixa</strong>
            <span>{remoteSession ? "Operando como cliente remoto" : "Para quando outro PC esta com o servidor aberto"}</span>
          </div>
          {!remoteSession ? (
            <>
              <div className="entry-grid">
                <label className="field description-field">
                  <span>Endereco do servidor</span>
                  <input value={connectHost} onChange={(event) => setConnectHost(event.target.value)} placeholder="192.168.0.10, 192.168.0.10:4317 ou so 10" />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input type="password" value={connectPassword} onChange={(event) => setConnectPassword(event.target.value)} placeholder="Senha do caixa principal" />
                </label>
                <label className="field">
                  <span>Nome deste caixa</span>
                  <input value={connectDeviceName} onChange={(event) => setConnectDeviceName(event.target.value)} placeholder="Notebook, caixa 2..." />
                </label>
              </div>
              <label className={`privacy-toggle-card ${autoConnectClient ? "enabled" : ""}`}>
                <input type="checkbox" checked={autoConnectClient} onChange={(event) => setAutoConnectClient(event.target.checked)} />
                <span>
                  <strong>Conectar automaticamente ao abrir este app</strong>
                  <small>Use no computador cliente. Ele tenta entrar no caixa principal com estes dados quando o aplicativo iniciar.</small>
                </span>
              </label>
              <div className="connection-steps">
                <span><Wifi size={16} /> 1. Abra o servidor no PC principal.</span>
                <span><KeyRound size={16} /> 2. Digite endereco, senha e o nome deste caixa.</span>
                <span><PlugZap size={16} /> 3. Pode digitar IP completo, IP:porta ou so o ultimo numero se estiver na mesma rede.</span>
              </div>
              {remoteMessage && <p className="settings-note">{remoteMessage}</p>}
              <div className="submit-row">
                <button
                  className="primary-button"
                  disabled={!connectHost || !connectPassword || remoteLoading}
                  onClick={connectRemote}
                >
                  {remoteLoading ? <RefreshCw size={18} className="spin" /> : <PlugZap size={18} />}
                  Conectar no app
                </button>
                <button
                  className="ghost-button"
                  disabled={!connectHost}
                  onClick={() => {
                    try {
                      const baseUrl = normalizeRemoteBaseUrl(connectHost, port, server.ips);
                      window.open(connectPassword ? `${baseUrl}?password=${encodeURIComponent(connectPassword)}&device=${encodeURIComponent(connectDeviceName || "App cliente")}` : baseUrl);
                    } catch (error) {
                      onToast("error", error instanceof Error ? error.message : "Endereco invalido.");
                    }
                  }}
                >
                  <ExternalLink size={18} /> Abrir no navegador
                </button>
              </div>
            </>
          ) : (
            <RemoteClientWorkspace
              session={remoteSession}
              settings={settings}
              message={remoteMessage}
              loading={remoteLoading}
              onRefresh={onRefreshRemote}
              onDisconnect={onDisconnectRemote}
              onSubmit={onSubmitRemote}
              onEdit={onEditRemote}
              onCancel={onCancelRemote}
              onDelete={onDeleteRemote}
            />
          )}
        </section>
      )}

      {mode === "permissions" && (
        <section className="flat-section">
          <div className="section-title">
            <strong>Permissoes dos dispositivos</strong>
            <span>Controla o que a pagina remota pode fazer</span>
          </div>
          <div className="permission-box permission-grid">
            {(["view", "create", "manageTables", "manageProducts", "edit", "delete", "viewEntryValues", "viewTotals", "printReceipts", "allowClientCustomization"] as const).map((key) => (
              <label className="switch-line" key={key}>
                <input
                  type="checkbox"
                  checked={permissions[key]}
                  onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}
                />
                {permissionLabel(key)}
              </label>
            ))}
          </div>
          <button
            className="primary-button"
            onClick={async () => {
              await onSaveSettings({ ...settings, server: { ...settings.server, port, password, permissions } });
              onToast("success", "Permissoes salvas.");
            }}
          >
            <Save size={18} /> Salvar permissoes
          </button>
        </section>
      )}

      {mode !== "connect" && (
        <section className="flat-section">
          <div className="section-title"><strong>Dispositivos conectados</strong></div>
          <div className="mini-list">
            {server.devices.map((device) => (
              <div key={device.id}>
                <span>{device.name}<small>{device.ip}</small></span>
                <button onClick={async () => onServerChange(await window.caixa.disconnectDevice(device.id))}>Desconectar</button>
              </div>
            ))}
            {!server.devices.length && <p className="empty-text">Nenhum dispositivo conectado agora.</p>}
          </div>
        </section>
      )}
    </section>
  );
}

function RemoteClientWorkspace({
  session,
  settings,
  message,
  loading,
  onRefresh,
  onDisconnect,
  onSubmit,
  onEdit,
  onCancel,
  onDelete
}: {
  session: RemoteClientSession;
  settings: AppSettings;
  message: string;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onDisconnect: () => void;
  onSubmit: (draft: EntryDraft) => Promise<void>;
  onEdit: (entry: LedgerEntry) => Promise<void>;
  onCancel: (entry: LedgerEntry) => Promise<void>;
  onDelete: (entry: LedgerEntry, permanent?: boolean) => Promise<void>;
}) {
  const visibleEntries = session.entries.filter((entry) => entry.status !== "deleted");
  const deletedEntries = session.entries.filter((entry) => entry.status === "deleted");
  const entryPolicy = clientPolicyForEntry(settings, session.clientPolicy, session.permissions.allowClientCustomization);
  const entrySettings = settingsForRemoteClient(settings, session.clientPolicy, session.permissions.allowClientCustomization);
  const permissionBadges = [
    session.permissions.view ? "Visualizar" : "",
    session.permissions.create ? "Registrar" : "",
    session.permissions.manageTables ? "Gerenciar mesas" : "Mesas bloqueadas",
    session.permissions.manageProducts ? "Gerenciar produtos" : "Produtos bloqueados",
    session.permissions.edit ? "Editar" : "",
    session.permissions.delete ? "Apagar" : "",
    session.permissions.viewEntryValues ? "Ver valores" : "Valores ocultos",
    session.permissions.viewTotals ? "Ver totais" : "Totais ocultos",
    session.permissions.allowClientCustomization ? "Acesso local liberado" : "",
    `${session.clientPolicy.allowedTypes.length} modo(s) do servidor`
  ].filter(Boolean);

  return (
    <div className="remote-client-workspace">
      <div className="remote-client-hero">
        <div>
          <span className="eyebrow">Cliente conectado no app</span>
          <h3>{session.deviceName}</h3>
          <p>{session.baseUrl} | conectado em {formatDateTime(session.connectedAt).time}</p>
        </div>
        <div className="remote-client-actions">
          <button className="ghost-button" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
            Atualizar
          </button>
          <button className="danger-button" type="button" onClick={onDisconnect}>
            <X size={16} /> Desconectar
          </button>
        </div>
      </div>

      <div className="remote-permission-row">
        {permissionBadges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
        {message && <small>{message}</small>}
      </div>

      <div className="metric-grid remote-metrics">
        <Metric label="Total hoje remoto" value={session.summary && session.permissions.viewTotals ? formatCurrency(session.summary.total) : "Restrito"} />
        <Metric label="Lancamentos" value={String(session.summary?.count ?? visibleEntries.length)} />
        <Metric label="Dinheiro" value={session.summary && session.permissions.viewTotals ? formatCurrency(session.summary.cashTotal) : "Restrito"} />
        <Metric label="Onibus" value={session.summary && session.permissions.viewTotals ? formatCurrency(session.summary.busTotal) : "Restrito"} />
        <Metric label="Lixeira remota" value={String(deletedEntries.length)} />
      </div>

      {session.limited && (
        <section className="remote-lite-note">
          <ShieldCheck size={17} />
          <span>Modo leve ativo: este cliente carregou os {session.entries.length} lancamentos mais recentes de {session.totalCount || "varios"} no servidor.</span>
        </section>
      )}

      {session.permissions.create ? (
        <QuickEntry
          entries={session.entries}
          settings={entrySettings}
          clientPolicy={entryPolicy}
          pinned={false}
          modeCommand={null}
          storageScope={quickEntryStorageScopeForSession(session)}
          onSubmit={onSubmit}
        />
      ) : (
        <section className="flat-section restricted-panel">
          <ShieldCheck size={20} />
          <strong>Somente visualizacao</strong>
          <p className="muted-copy">Este cliente consegue acompanhar o caixa principal, mas nao tem permissao para registrar.</p>
        </section>
      )}

      <section className="flat-section remote-history-card">
        <div className="section-title">
          <strong>Historico vindo do caixa principal</strong>
          <span>{visibleEntries.length} visiveis | {deletedEntries.length} na lixeira{session.limited ? ` | ultimos ${session.entries.length}` : ""}</span>
        </div>
        <div className="remote-entry-list">
          {session.entries.slice(0, 16).map((entry) => {
            const { date, time } = formatDateTime(entry.createdAt);
            return (
              <article key={entry.id} className={entry.status}>
                <div>
                  <strong>{entry.description || "Venda"}</strong>
                  <span>{date} {time} | {entry.customType || entry.type} | {statusLabel(entry.status)}</span>
                  <small>{entry.originDevice || "Origem nao informada"}</small>
                </div>
                <b>{session.permissions.viewEntryValues ? formatCurrency(getEntryAmount(entry)) : "Restrito"}</b>
                <div className="remote-entry-actions">
                  {session.permissions.edit && entry.status !== "deleted" && (
                    <>
                      <button type="button" onClick={() => onEdit(entry)}>Editar</button>
                      <button type="button" onClick={() => onCancel(entry)}>Cancelar</button>
                    </>
                  )}
                  {session.permissions.delete && (
                    entry.status === "deleted" ? (
                      <button type="button" onClick={() => onDelete(entry, true)}>Apagar definitivo</button>
                    ) : (
                      <button type="button" onClick={() => onDelete(entry)}>Lixeira</button>
                    )
                  )}
                </div>
              </article>
            );
          })}
          {!session.entries.length && <p className="empty-text">Nenhum lancamento remoto encontrado.</p>}
        </div>
      </section>
    </div>
  );
}

function normalizeAppVersion(value: string): string {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareAppVersions(left: string, right: string): number {
  const leftParts = normalizeAppVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeAppVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function normalizeRemoteBaseUrl(value: string, defaultPort = 4317, localIps: string[] = []): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Informe o endereco do servidor.");
  }
  let hostInput = trimmed;
  const shortIpMatch = hostInput.match(/^(\d{1,3})(?::(\d{1,5}))?$/);
  if (shortIpMatch) {
    const lastOctet = Number(shortIpMatch[1]);
    const localIp = localIps.find((ip) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip));
    if (!localIp || lastOctet < 0 || lastOctet > 255) {
      throw new Error("Digite o IP completo do servidor ou use um ultimo numero valido da rede.");
    }
    hostInput = `${localIp.split(".").slice(0, 3).join(".")}.${lastOctet}${shortIpMatch[2] ? `:${shortIpMatch[2]}` : ""}`;
  }
  const withProtocol = /^https?:\/\//i.test(hostInput) ? hostInput : `http://${hostInput}`;
  const url = new URL(withProtocol);
  if (!url.port) {
    url.port = String(defaultPort || 4317);
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function SettingsPanel({
  settings,
  remoteSession,
  remoteClientActive,
  remoteClientPermissions,
  focusCategory,
  onFocusCategoryConsumed,
  onSave,
  onToast,
  onImportLedger,
  onImportLedgerFolder
}: {
  settings: AppSettings;
  remoteSession: RemoteClientSession | null;
  remoteClientActive: boolean;
  remoteClientPermissions?: ServerPermissions | null;
  focusCategory?: { category: SettingsCategory; nonce: number } | null;
  onFocusCategoryConsumed?: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onToast: (tone: ToastState["tone"], message: string) => void;
  onImportLedger: () => Promise<void>;
  onImportLedgerFolder: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState<ShortcutAction | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [settingsConfirm, setSettingsConfirm] = useState<{ title: string; message: string; action: () => void | Promise<void>; confirmLabel?: string; danger?: boolean } | null>(null);
  const pdvSettingsActionsRef = useRef<PdvAdvancedSettingsActions | null>(null);
  const [pdvSettingsDirty, setPdvSettingsDirty] = useState(false);
  const remoteCustomizationAllowed = Boolean(remoteClientPermissions?.allowClientCustomization);
  const effectiveSettingsOperationMode = remoteSession?.clientPolicy.operationMode || draft.operationMode;
  const remoteLockedCategoryList: SettingsCategory[] = ["operation", "defaults", "profiles", "files", "pdv", "pdvTables", "pdvOperation", "printing", "server", "advanced"];
  const remoteLockedCategories = new Set<SettingsCategory>(remoteLockedCategoryList);
  const remoteServerEditableCategories = new Set<SettingsCategory>(["operation", "defaults", "pdvTables", "pdvOperation", "printing"]);
  const remoteLockMessage = "Esta parte continua restrita ao computador servidor. Ative a permissao de personalizacao para os ajustes operacionais e de impressao.";

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (focusCategory) {
      setCategory(focusCategory.category);
      onFocusCategoryConsumed?.();
    }
  }, [focusCategory, onFocusCategoryConsumed]);

  useEffect(() => {
    if (category === "advanced") {
      loadDiagnostics();
    }
  }, [category]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const isRemoteLockedCategory = (target: SettingsCategory) => remoteClientActive
    && remoteLockedCategories.has(target)
    && !(remoteCustomizationAllowed && remoteServerEditableCategories.has(target));

  const notifyRemoteLock = () => {
    onToast("info", remoteLockMessage);
  };

  const guardRemoteSection = (event: React.SyntheticEvent<HTMLElement>, target: SettingsCategory) => {
    if (!isRemoteLockedCategory(target)) {
      return;
    }
    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element?.closest("button,input,select,textarea,label,[role='button']")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    notifyRemoteLock();
  };

  const lockedClick = (target: SettingsCategory, action: () => void) => {
    if (isRemoteLockedCategory(target)) {
      notifyRemoteLock();
      return;
    }
    action();
  };

  const chooseFolder = async () => {
    const folder = await window.caixa.chooseOutputDirectory();
    if (folder) {
      update("outputDirectory", folder);
    }
  };

  const useSafeOutputFolder = async () => {
    const snapshot = await window.caixa.getDiagnostics();
    const base = snapshot.dataDirectory.replace(/[\\/]data$/i, "");
    const separator = snapshot.dataDirectory.includes("\\") ? "\\" : "/";
    update("outputDirectory", `${base}${separator}planilhas`);
    onToast("info", "Pasta segura do app aplicada ao rascunho. Salve para usar.");
  };

  const applyFloatingPreset = (preset: FloatingPreset) => {
    setDraft((current) => applyFloatingPresetToSettings(current, preset));
    onToast("success", `Preset ${preset.title} aplicado ao rascunho.`);
  };

  const moveColumn = (column: string, direction: -1 | 1) => {
    const next = [...draft.visibleColumns];
    const index = next.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    update("visibleColumns", next);
  };

  const toggleColumn = (column: string) => {
    const exists = draft.visibleColumns.includes(column);
    update("visibleColumns", exists ? draft.visibleColumns.filter((item) => item !== column) : [...draft.visibleColumns, column]);
  };

  const updateQuickTab = (id: string, patch: Partial<QuickTabSettings>) => {
    setDraft((current) => ({
      ...current,
      quickTabs: current.quickTabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    }));
  };

  const moveQuickTab = (id: string, direction: -1 | 1) => {
    setDraft((current) => {
      const next = [...current.quickTabs];
      const index = next.findIndex((tab) => tab.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) {
        return current;
      }
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, quickTabs: next };
    });
  };

  const toggleFloatingField = (field: string) => {
    setDraft((current) => {
      const currentFields = normalizeFloatingFields(current.floating.visibleFields);
      const nextFields = currentFields.includes(field)
        ? currentFields.filter((item) => item !== field)
        : [...currentFields, field];
      return {
        ...current,
        floating: {
          ...current.floating,
          visibleFields: normalizeFloatingFields(nextFields)
        }
      };
    });
  };

  const updateShortcut = (key: ShortcutAction, value: string) => {
    setDraft((current) => ({
      ...current,
      shortcuts: {
        ...current.shortcuts,
        [key]: normalizeShortcutValue(value) ? value : ""
      }
    }));
  };

  const captureShortcut = (event: React.KeyboardEvent<HTMLButtonElement>, key: ShortcutAction) => {
    if (capturingShortcut !== key) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete") {
      updateShortcut(key, "");
      setCapturingShortcut(null);
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      return;
    }
    updateShortcut(key, shortcut);
    setCapturingShortcut(null);
  };

  const profileNames = Object.keys(draft.profiles);
  const activeProfileName = draft.activeProfile && draft.profiles[draft.activeProfile]
    ? draft.activeProfile
    : profileNames[0] || "Perfil PC";

  const applyProfile = (name: string) => {
    setDraft((current) => normalizeSettingsDraft(current, { ...profilePatch(current.profiles[name]), activeProfile: name }));
    onToast("success", `Perfil ${name} aplicado ao rascunho.`);
  };

  const saveCurrentProfile = (name = activeProfileName) => {
    setDraft((current) => ({
      ...current,
      activeProfile: name,
      profiles: {
        ...current.profiles,
        [name]: createProfileSnapshot({ ...current, activeProfile: name })
      }
    }));
    onToast("success", `Perfil ${name} atualizado. Salve as configuracoes para gravar.`);
  };

  const commitProfile = (name: string) => {
    setDraft((current) => ({
      ...current,
      activeProfile: name,
      profiles: {
        ...current.profiles,
        [name]: createProfileSnapshot({ ...current, activeProfile: name })
      }
    }));
    setNewProfileName("");
    onToast("success", `Perfil ${name} criado. Salve as configuracoes para gravar.`);
  };

  const createProfile = () => {
    const name = newProfileName.trim();
    if (!name) {
      onToast("error", "Digite um nome para o novo perfil.");
      return;
    }
    if (draft.profiles[name]) {
      setSettingsConfirm({
        title: `Atualizar perfil ${name}?`,
        message: "Ja existe um perfil com esse nome. Ele sera substituido pelos ajustes atuais do rascunho.",
        confirmLabel: "Atualizar perfil",
        action: () => commitProfile(name)
      });
      return;
    }
    commitProfile(name);
  };

  const deleteProfile = (name: string) => {
    if (Object.keys(draft.profiles).length <= 1) {
      onToast("error", "Mantenha pelo menos um perfil.");
      return;
    }
    setSettingsConfirm({
      title: `Apagar perfil ${name}?`,
      message: "Esse perfil sera removido do rascunho. As vendas e arquivos nao serao alterados.",
      confirmLabel: "Apagar perfil",
      danger: true,
      action: () => {
        setDraft((current) => {
          const nextProfiles = { ...current.profiles };
          delete nextProfiles[name];
          const nextActive = current.activeProfile === name ? Object.keys(nextProfiles)[0] : current.activeProfile;
          return { ...current, profiles: nextProfiles, activeProfile: nextActive };
        });
        onToast("info", `Perfil ${name} removido do rascunho.`);
      }
    });
  };

  const exportSettings = async () => {
    const filePath = await window.caixa.exportSettings(draft);
    onToast(filePath ? "success" : "info", filePath ? "Configuracoes exportadas." : "Exportacao cancelada.");
  };

  const importSettings = async () => {
    try {
      const result = await window.caixa.importSettings();
      if (!result) {
        onToast("info", "Importacao cancelada.");
        return;
      }
      setDraft((current) => normalizeSettingsDraft(current, result.settings));
      setCategory("advanced");
      onToast("info", "Configuracoes importadas para revisao. Clique em Salvar para aplicar.");
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel importar configuracoes.");
    }
  };

  const loadDiagnostics = async () => {
    setDiagnosticsLoading(true);
    try {
      setDiagnostics(await window.caixa.getDiagnostics());
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel carregar diagnostico.");
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const createDataBackup = async () => {
    try {
      const backup = await window.caixa.createDataBackup("manual");
      onToast("success", `Backup criado: ${backup.fileName}`);
      await loadDiagnostics();
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel criar backup.");
    }
  };

  const restoreDataBackup = async (filePath?: string) => {
    setSettingsConfirm({
      title: "Restaurar backup?",
      message: "O estado atual sera salvo antes da restauracao. Depois disso o app volta para os dados do backup escolhido.",
      confirmLabel: "Restaurar backup",
      danger: true,
      action: async () => {
    try {
      const result = await window.caixa.restoreDataBackup(filePath);
      if (!result) {
        onToast("info", "Restauracao cancelada.");
        return;
      }
      onToast("success", `Backup restaurado: ${result.backup.fileName}`);
      await loadDiagnostics();
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel restaurar backup.");
    }
      }
    });
  };

  const openDirectory = async (target: "data" | "output") => {
    const message = target === "data" ? await window.caixa.openDataDirectory() : await window.caixa.openOutputDirectory();
    if (message) {
      onToast("error", message);
    }
  };

  const openCurrentExport = async () => {
    const status = await window.caixa.exportNow();
    onToast(status.ok ? "success" : "error", status.ok ? "Arquivo atual gerado e aberto na pasta." : status.message || "Nao foi possivel abrir a planilha.");
  };

  const openTodayRecoveryFile = async () => {
    const status = await window.caixa.exportTodayRecovery();
    onToast(status.ok ? "success" : "error", status.message || "Nao foi possivel gerar o arquivo de hoje.");
  };

  const resetCategory = (target: SettingsCategory) => {
    setDraft((current) => {
      const defaults = createSettingsFallback(current);
      if (target === "appearance") {
        return {
          ...current,
          theme: defaults.theme,
          accentColor: defaults.accentColor,
          fieldSize: defaults.fieldSize,
          density: defaults.density,
          layout: defaults.layout,
          hideHeaderBrand: defaults.hideHeaderBrand,
          headerPinnedModules: defaults.headerPinnedModules,
          rememberHistoryPeriod: defaults.rememberHistoryPeriod,
          rememberReportPeriod: defaults.rememberReportPeriod
        };
      }
      if (target === "operation") {
        return { ...current, operationMode: defaults.operationMode };
      }
      if (target === "defaults") {
        return {
          ...current,
          defaultType: defaults.defaultType,
          defaultPeople: defaults.defaultPeople,
          defaultRoundingStep: defaults.defaultRoundingStep,
          defaultRoundingDirection: defaults.defaultRoundingDirection,
          tableNumberEnabled: defaults.tableNumberEnabled,
          busNumberEnabled: defaults.busNumberEnabled
        };
      }
      if (target === "profiles") {
        return {
          ...current,
          profiles: defaults.profiles,
          activeProfile: defaults.activeProfile
        };
      }
      if (target === "floating") {
        return { ...current, floating: defaults.floating };
      }
      if (target === "quick") {
        return { ...current, quickTabs: defaults.quickTabs };
      }
      if (target === "files") {
        return {
          ...current,
          fileFormat: defaults.fileFormat,
          fileStrategy: defaults.fileStrategy,
          spreadsheetMode: defaults.spreadsheetMode,
          dateFormat: defaults.dateFormat,
          csvSeparator: defaults.csvSeparator,
          visibleColumns: defaults.visibleColumns,
          backupEnabled: defaults.backupEnabled,
          automaticSpreadsheetEnabled: defaults.automaticSpreadsheetEnabled,
          automaticClosingReportEnabled: defaults.automaticClosingReportEnabled,
          reportExportSections: defaults.reportExportSections
        };
      }
      if (target === "server") {
        return { ...current, server: defaults.server };
      }
      if (target === "privacy") {
        return { ...current, privacy: defaults.privacy };
      }
      if (target === "shortcuts") {
        return { ...current, shortcuts: defaults.shortcuts };
      }
      return current;
    });
    onToast("info", "Categoria restaurada para o padrao.");
  };

  const checkUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await window.caixa.checkForUpdates();
      setUpdateInfo(info);
      onToast(
        info.hasUpdate ? "info" : "success",
        info.hasUpdate ? "Atualizacao encontrada. Use Baixar e instalar." : "Voce esta na versao mais recente."
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    setInstallingUpdate(true);
    try {
      const info = updateInfo?.hasUpdate ? updateInfo : await window.caixa.checkForUpdates();
      setUpdateInfo(info);
      if (!info.hasUpdate) {
        onToast("success", "Voce esta na versao mais recente.");
        return;
      }
      const result = await window.caixa.installUpdate();
      onToast(result.ok ? "success" : "error", result.message);
    } finally {
      setInstallingUpdate(false);
    }
  };

  const persistSettingsDraft = async () => {
    await onSave(draft);
    if (pdvSettingsDirty) {
      await pdvSettingsActionsRef.current?.save();
    }
  };

  const saveDraft = async () => {
    if (
      remoteClientActive &&
      JSON.stringify(remoteLockedSettingsSnapshot(settings, remoteCustomizationAllowed)) !==
        JSON.stringify(remoteLockedSettingsSnapshot(draft, remoteCustomizationAllowed))
    ) {
      onToast("error", "Nao salvei: esse rascunho altera configuracoes controladas pelo servidor. Desconecte do caixa principal para editar essas partes.");
      return;
    }
    const warnings = settingsChangeWarnings(settings, draft);
    if (warnings.length) {
      setSettingsConfirm({
        title: "Salvar configuracoes sensiveis?",
        message: `Essas configuracoes alteram ${warnings.join(", ")}. Confira antes de aplicar.`,
        confirmLabel: "Salvar mesmo assim",
        action: persistSettingsDraft
      });
      return;
    }
    await persistSettingsDraft();
  };

  const settingsCategories: Array<{ key: SettingsCategory; label: string; description: string; icon: typeof Settings }> = [
    { key: "appearance", label: "Aparencia", description: "Tema, cor, densidade e formato geral da interface.", icon: Palette },
    { key: "operation", label: "Modo de operacao", description: "Alterna entre o PDV novo e o caixa classico preservado.", icon: MonitorUp },
    { key: "defaults", label: "Vendas", description: "Tipo, pessoas e arredondamento usados por padrao.", icon: Send },
    { key: "profiles", label: "Perfis", description: "Perfis para alternar entre PC, notebook e tela pequena.", icon: MonitorUp },
    { key: "floating", label: "Barra fixa", description: "Janela flutuante, tamanho, posicao, campos e tema do Caixa Classico.", icon: Pin },
    { key: "quick", label: "Barra rapida", description: "Abas e atalhos visuais usados dentro da barra fixa classica.", icon: LayoutPanelTop },
    { key: "pdv", label: "Produtos", description: "Produtos, categorias, importacao, favoritos, unidade, kg, grama e adicionais.", icon: LayoutPanelTop },
    { key: "pdvTables", label: "Mesas", description: "Quantidade de mesas, submesas e contas separadas.", icon: Utensils },
    { key: "pdvOperation", label: "Operacoes", description: "Lancamentos, agrupamento, complementos, divisao e fechamento.", icon: Wallet },
    { key: "printing", label: "Impressao", description: "Recibo, impressora, papel, logotipo e PDF.", icon: ReceiptText },
    { key: "files", label: "Planilha e backup", description: "Exportacao Excel/CSV, pasta, colunas e backups gerados a partir do banco local.", icon: FileSpreadsheet },
    { key: "privacy", label: "Privacidade", description: "Controle o que aparece na tela quando ha cliente por perto.", icon: ShieldCheck },
    { key: "server", label: "Servidor", description: "Porta, senha e permissoes para outro dispositivo.", icon: RadioTower },
    { key: "shortcuts", label: "Atalhos", description: "Comandos de teclado para operar mais rapido.", icon: KeyRound },
    { key: "updates", label: "Atualizacoes", description: "Checagem de versoes publicadas no GitHub.", icon: Download },
    { key: "advanced", label: "Avancado", description: "Restauracao, backup e acoes administrativas.", icon: DatabaseBackup }
  ];
  const visibleSettingsCategories = settingsCategories.filter((item) => {
    if (effectiveSettingsOperationMode === "legacy") {
      if (["pdv", "pdvTables", "pdvOperation", "printing"].includes(item.key)) {
        return false;
      }
      // Em cliente remoto restrito, a ordem das abas vem do servidor. A
      // posicao, tamanho e tema da barra continuam locais em Barra fixa.
      return !(remoteClientActive && !remoteCustomizationAllowed && item.key === "quick");
    }
    return !["defaults", "profiles", "floating", "quick", "shortcuts"].includes(item.key);
  });
  const activeCategory = visibleSettingsCategories.find((item) => item.key === category) || visibleSettingsCategories[0];
  const filePreview = filePreviewForSettings(draft);
  const pdvAdvancedSectionByCategory: Partial<Record<SettingsCategory, PdvAdvancedSection>> = {
    appearance: "appearance",
    pdvTables: "tables",
    pdvOperation: "operation",
    printing: "printing",
    files: "data"
  };
  const activePdvAdvancedSection = pdvAdvancedSectionByCategory[category];

  useEffect(() => {
    if (!visibleSettingsCategories.some((item) => item.key === category)) {
      setCategory("operation");
    }
  }, [category, effectiveSettingsOperationMode]);

  const categoryClass = (target: SettingsCategory, extra = "") =>
    `${extra || "settings-group"} ${category === target ? "active-category" : "hidden-category"} ${isRemoteLockedCategory(target) ? "remote-locked-section" : ""}`;

  const remoteSectionProps = (target: SettingsCategory) => ({
    "data-remote-locked": isRemoteLockedCategory(target) ? "true" : undefined,
    "aria-disabled": isRemoteLockedCategory(target) ? true : undefined,
    onMouseDownCapture: (event: React.MouseEvent<HTMLElement>) => guardRemoteSection(event, target),
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => guardRemoteSection(event, target),
    onInputCapture: (event: React.FormEvent<HTMLElement>) => guardRemoteSection(event, target),
    onChangeCapture: (event: React.FormEvent<HTMLElement>) => guardRemoteSection(event, target),
    onKeyDownCapture: (event: React.KeyboardEvent<HTMLElement>) => {
      if ((event.key === "Enter" || event.key === " ") && isRemoteLockedCategory(target)) {
        guardRemoteSection(event, target);
      }
    }
  });

  return (
    <section className="panel settings-panel">
      <div className="settings-layout">
        <aside className="settings-nav">
          {visibleSettingsCategories.map((item) => {
            const Icon = item.icon;
            const locked = isRemoteLockedCategory(item.key);
            return (
              <button
                key={item.key}
                className={`${category === item.key ? "active" : ""} ${locked ? "server-locked-nav" : ""}`}
                onClick={() => setCategory(item.key)}
                title={locked ? "Controlado pelo computador servidor enquanto conectado como cliente" : item.description}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </aside>

        <div className="settings-content">
          <div className={`settings-hero ${isRemoteLockedCategory(category) ? "remote-locked-hero" : ""}`}>
            <div>
              <span className="settings-overline">Categoria</span>
              <h2>{activeCategory.label}</h2>
              <p>{activeCategory.description}</p>
              {remoteClientActive && (
                <p className="remote-lock-banner">
                  {isRemoteLockedCategory(category)
                    ? "Esta area esta travada no cliente. O servidor controla campos, modos, planilha e permissoes em tempo real."
                    : remoteCustomizationAllowed
                      ? "Modo cliente remoto ativo: o servidor define o modo, e este PC pode personalizar a aparencia e a barra classica local."
                      : "Modo cliente remoto ativo: voce pode ajustar aparencia, privacidade local, barra classica e atualizacoes deste PC."}
                </p>
              )}
            </div>
            <div className="preset-row settings-presets" aria-label="Acoes da categoria">
              <button className="ghost-button" type="button" onClick={() => lockedClick(category, () => {
                resetCategory(category);
                if (activePdvAdvancedSection) {
                  pdvSettingsActionsRef.current?.discard();
                }
              })}><RotateCcw size={16} /> Restaurar categoria</button>
            </div>
          </div>

      <div className="settings-grid">
        <section className={categoryClass("appearance")}>
          <label className="field"><span>Tema</span>
            <select
              value={draft.theme === "dark" || draft.theme === "datacaixa-dark" ? "dark" : "datacaixa"}
              onChange={(event) => {
                const theme = event.target.value as AppSettings["theme"];
                setDraft((current) => ({ ...current, theme, accentColor: themeDefaultAccent(theme) }));
              }}
            >
              <option value="datacaixa">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </label>
          <label className="field"><span>Cor principal</span><input type="color" value={draft.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></label>
          <label className="field"><span>Tamanho dos campos</span>
            <select value={draft.fieldSize} onChange={(event) => update("fieldSize", event.target.value as AppSettings["fieldSize"])}>
              <option value="small">Pequeno</option>
              <option value="medium">Medio</option>
              <option value="large">Grande</option>
            </select>
          </label>
          <label className="field"><span>Densidade geral dos menus</span>
            <select value={draft.density} onChange={(event) => update("density", event.target.value as AppSettings["density"])}>
              <option value="compact">Compacta</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Confortavel</option>
            </select>
          </label>
          <label className="field"><span>Layout</span>
            <select value={draft.layout === "pinnedBar" ? "complete" : draft.layout} onChange={(event) => update("layout", event.target.value as AppSettings["layout"])}>
              <option value="complete">Completo</option>
              <option value="compact">Compacto</option>
              <option value="grid">Grade</option>
              <option value="sidePanel">Painel lateral</option>
            </select>
          </label>
          <label className="field"><span>Tempo dos avisos</span>
            <select value={draft.notificationDurationMs || 3200} onChange={(event) => update("notificationDurationMs", Number(event.target.value))}>
              <option value={1800}>Rapido (1,8 s)</option>
              <option value={3200}>Padrao (3,2 s)</option>
              <option value={5000}>Demorado (5 s)</option>
              <option value={8000}>Lento (8 s)</option>
            </select>
          </label>
          <label className="switch-line">
            <input type="checkbox" checked={draft.notificationsEnabled !== false} onChange={(event) => update("notificationsEnabled", event.target.checked)} />
            Ativar notificacoes e avisos informativos
          </label>
          <label className="switch-line simple-mode-toggle">
            <input type="checkbox" checked={Boolean(draft.simpleMode)} onChange={(event) => update("simpleMode", event.target.checked)} />
            Modo Simples: interface mais quadrada, compacta e sem animacoes de rolagem
          </label>
          <label className="switch-line">
            <input type="checkbox" checked={draft.hideHeaderBrand} onChange={(event) => update("hideHeaderBrand", event.target.checked)} />
            Ocultar marca Caixa PDV no cabecalho
          </label>
          <div className="header-module-settings">
            <div>
              <strong>Modulos fixados no cabecalho</strong>
              <span>Sem limite de atalhos. O que for fixado sai do menu Modulos; Ajustes fica separado no canto direito.</span>
            </div>
            <div className="header-module-options">
              {TAB_ITEMS.map((item) => {
                const selectedModules = normalizeHeaderPinnedModules(draft.headerPinnedModules);
                const checked = selectedModules.includes(item.key);
                return (
                  <label key={item.key} className={checked ? "selected" : ""}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update(
                        "headerPinnedModules",
                        checked
                          ? selectedModules.filter((key) => key !== item.key)
                          : [...selectedModules, item.key]
                      )}
                    />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <section className={categoryClass("floating", "settings-group wide")} {...remoteSectionProps("floating")}>
          <h3>Barra fixa classica</h3>
          <p className="settings-note">Esta janela so fica disponivel no Modo Classico. Abra-a pelo botao ao lado do Total hoje e personalize-a aqui.</p>
          <div className="floating-preset-grid">
            {FLOATING_PRESETS.map((preset) => {
              const active = draft.defaultType === preset.defaultType
                && normalizeFloatingFields(draft.floating.visibleFields).join("|") === normalizeFloatingFields(preset.fields).join("|")
                && (draft.floating.layoutMode || "adaptive") === (preset.layoutMode || "adaptive");
              return (
                <button key={preset.id} className={`floating-preset-card ${active ? "active" : ""}`} type="button" onClick={() => applyFloatingPreset(preset)}>
                  <strong>{preset.title}</strong>
                  <span>{preset.description}</span>
                  <small>{normalizeFloatingFields(preset.fields).length} elementos na barra</small>
                </button>
              );
            })}
          </div>
          <label className="field"><span>Tema da barra</span>
            <select
              value={draft.floating.theme === "dark" || draft.floating.theme === "datacaixa-dark"
                ? "dark"
                : draft.floating.theme === "follow" ? "follow" : "datacaixa"}
              onChange={(event) => update("floating", { ...draft.floating, theme: event.target.value as AppSettings["floating"]["theme"] })}
            >
              <option value="follow">Seguir tema do app</option>
              <option value="datacaixa">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </label>
          <label className="field"><span>Modo visual</span>
            <select value={draft.floating.layoutMode || "adaptive"} onChange={(event) => update("floating", { ...draft.floating, layoutMode: event.target.value as AppSettings["floating"]["layoutMode"] })}>
              <option value="adaptive">Adaptavel</option>
              <option value="compact">Compacto</option>
              <option value="mini">Mini</option>
            </select>
          </label>
          <label className="field"><span>Opacidade ({Math.round(draft.floating.opacity * 100)}%)</span>
            <input aria-label={`Opacidade (${Math.round(draft.floating.opacity * 100)}%)`} type="range" min={0.35} max={1} step={0.01} value={draft.floating.opacity} onChange={(event) => update("floating", { ...draft.floating, opacity: Number(event.target.value) })} />
          </label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.rememberBounds} onChange={(event) => update("floating", { ...draft.floating, rememberBounds: event.target.checked })} /> Salvar tamanho e posicao</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.lockPosition} onChange={(event) => update("floating", { ...draft.floating, lockPosition: event.target.checked })} /> Travar a barra no lugar</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.borderless} onChange={(event) => update("floating", { ...draft.floating, borderless: event.target.checked })} /> Visual sem borda de janela</label>
          <label className="field"><span>Cantos da barra fixa</span>
            <select value={draft.floating.cornerStyle || "rounded"} onChange={(event) => update("floating", { ...draft.floating, cornerStyle: event.target.value as AppSettings["floating"]["cornerStyle"] })}>
              <option value="rounded">Bordas arredondadas</option>
              <option value="square">Bordas quadradas</option>
            </select>
          </label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.dragWholeBar} onChange={(event) => update("floating", { ...draft.floating, dragWholeBar: event.target.checked })} /> Arrastar pela barra inteira</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.syncMoneyWithEntryType} onChange={(event) => update("floating", { ...draft.floating, syncMoneyWithEntryType: event.target.checked })} /> Manter Mesa ou Onibus ao trocar Conta/Dinheiro</label>
          <div className="floating-field-picker">
            <div className="section-title"><strong>Elementos da barra</strong><span>Desmarque o que nao precisa aparecer.</span></div>
            {FLOATING_FIELD_OPTIONS.filter((field) => field.id !== "value").map((field) => (
              <label key={field.id} className="toggle-card">
                <input type="checkbox" checked={normalizeFloatingFields(draft.floating.visibleFields).includes(field.id)} onChange={() => toggleFloatingField(field.id)} />
                <span><strong>{field.label}</strong><small>{field.helper}</small></span>
              </label>
            ))}
          </div>
        </section>

        <section className={categoryClass("quick", "settings-group wide")} {...remoteSectionProps("quick")}>
          <h3>Barra rapida classica</h3>
          <p className="settings-note">Defina as abas que aparecem na barra fixa e a ordem em que elas ficam disponiveis.</p>
          <div className="quick-tab-editor">
            {draft.quickTabs.map((tab, index) => (
              <article key={tab.id} className={`quick-tab-row ${tab.enabled ? "enabled" : ""} ${tab.type === "Dinheiro/Troco" ? "has-money-link" : ""}`}>
                <label className="switch-line quick-switch"><input type="checkbox" checked={tab.enabled} onChange={(event) => updateQuickTab(tab.id, { enabled: event.target.checked })} /> Ativa</label>
                <label className="field"><span>Nome da aba</span><input value={tab.label} onChange={(event) => updateQuickTab(tab.id, { label: event.target.value })} /></label>
                <label className="field"><span>Modo ao clicar</span><select value={tab.type} onChange={(event) => updateQuickTab(tab.id, { type: event.target.value as EntryType })}>{ENTRY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
                {tab.type === "Dinheiro/Troco" && <label className="field"><span>Dinheiro vinculado a</span><select value={tab.cashLinkedType || "Mesa"} onChange={(event) => updateQuickTab(tab.id, { cashLinkedType: event.target.value as EntryType })}>{CASH_LINKED_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
                <label className="switch-line quick-switch"><input type="checkbox" checked={Boolean(tab.compact)} onChange={(event) => updateQuickTab(tab.id, { compact: event.target.checked })} /> Compacta</label>
                <div className="quick-order"><button type="button" disabled={index === 0} onClick={() => moveQuickTab(tab.id, -1)} title="Subir"><ArrowUp size={15} /></button><button type="button" disabled={index === draft.quickTabs.length - 1} onClick={() => moveQuickTab(tab.id, 1)} title="Descer"><ArrowDown size={15} /></button></div>
              </article>
            ))}
          </div>
        </section>

        <section className={categoryClass("operation")}>
          <label className="field"><span>Interface principal</span>
            <select value={effectiveSettingsOperationMode} disabled={remoteClientActive} onChange={(event) => update("operationMode", event.target.value as AppSettings["operationMode"])}>
              <option value="pdv">PDV novo integrado</option>
              <option value="legacy">Caixa classico preservado</option>
            </select>
          </label>
          <p className="settings-note">
            Cada modo mostra apenas as configuracoes e telas do seu proprio fluxo. O modo Classico preserva lancamento rapido e barra fixa; o PDV concentra venda, mesas, produtos e fechamento.
          </p>
          {effectiveSettingsOperationMode === "legacy" && (
            <div className="settings-warning">
              <strong>Modo de compatibilidade ativo</strong>
              <span>Venda volta para o fluxo antigo. Abra a barra fixa pelo topo; Mesas e Produtos ficam ocultos para nao misturar os fluxos.</span>
            </div>
          )}
        </section>

        <section className={categoryClass("defaults")} {...remoteSectionProps("defaults")}>
          <h3>Padroes</h3>
          <label className="field"><span>Tipo padrao</span>
            <select value={draft.defaultType} onChange={(event) => update("defaultType", event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field"><span>Pessoas padrao</span><input type="number" min={1} value={draft.defaultPeople} onChange={(event) => update("defaultPeople", Number(event.target.value || 1))} /></label>
          <label className="field"><span>Arredondamento</span>
            <select value={draft.defaultRoundingStep} onChange={(event) => update("defaultRoundingStep", Number(event.target.value))}>
              {ROUNDING_STEPS.map((step) => <option value={step} key={step}>{step === 0.01 ? "Sem aproximacao" : formatCurrency(step)}</option>)}
            </select>
          </label>
          <label className="field"><span>Direcao</span>
            <select value={draft.defaultRoundingDirection} onChange={(event) => update("defaultRoundingDirection", event.target.value as RoundDirection)}>
              <option value="up">Para cima</option>
              <option value="down">Para baixo</option>
              <option value="nearest">Mais proximo</option>
            </select>
          </label>
          <label className="switch-line"><input type="checkbox" checked={draft.tableNumberEnabled} onChange={(event) => update("tableNumberEnabled", event.target.checked)} /> Mostrar campo de numero da mesa</label>
          <label className="switch-line"><input type="checkbox" checked={draft.busNumberEnabled} onChange={(event) => update("busNumberEnabled", event.target.checked)} /> Mostrar campo de numero do onibus</label>
          <p className="settings-note">Essas opcoes escondem apenas o campo numerico. Os modos Mesa e Onibus continuam disponiveis quando forem uteis.</p>
        </section>

        <section className={categoryClass("profiles", "settings-group wide")} {...remoteSectionProps("profiles")}>
          <h3>Perfis de configuracao</h3>
          <p className="settings-note">
            Perfis guardam tema, densidade, layout, atalhos e padroes de venda.
            Eles nao trocam sua pasta de arquivos nem apagam vendas.
          </p>
          <div className="profile-manager">
            <div className="profile-active-card">
              <div>
                <span className="settings-overline">Perfil ativo</span>
                <strong>{activeProfileName}</strong>
                <p>{profileSummary(draft.profiles[activeProfileName] || {})}</p>
              </div>
              <label className="field">
                <span>Trocar perfil</span>
                <select value={activeProfileName} onChange={(event) => applyProfile(event.target.value)}>
                  {profileNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <div className="profile-actions">
                <button className="primary-button" type="button" onClick={() => saveCurrentProfile(activeProfileName)}>
                  <Save size={16} /> Atualizar perfil
                </button>
              </div>
            </div>
            <div className="profile-create-card">
              <label className="field">
                <span>Nome do novo perfil</span>
                <input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Perfil tela caixa, notebook..." />
              </label>
              <button className="ghost-button" type="button" onClick={createProfile}>
                <Plus size={16} /> Criar com ajustes atuais
              </button>
            </div>
            <div className="profile-grid">
              {profileNames.map((name) => (
                <article key={name} className={`profile-card ${name === activeProfileName ? "active" : ""}`}>
                  <MonitorUp size={20} />
                  <div>
                    <strong>{name}</strong>
                    <span>{profileSummary(draft.profiles[name] || {})}</span>
                  </div>
                  <div className="profile-card-actions">
                    <button type="button" onClick={() => applyProfile(name)} title="Aplicar perfil">
                      <Check size={15} />
                    </button>
                    <button type="button" onClick={() => saveCurrentProfile(name)} title="Salvar estado atual neste perfil">
                      <Save size={15} />
                    </button>
                    <button type="button" onClick={() => deleteProfile(name)} title="Apagar perfil">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={categoryClass("files", "settings-group wide files-settings")} {...remoteSectionProps("files")}>
          <h3>Arquivos</h3>
          <div className="file-preview-card">
            <FileSpreadsheet size={20} />
            <div>
              <span>Proximo arquivo</span>
              <strong>{filePreview}</strong>
              <small>
                {draft.fileStrategy === "daily"
                  ? "Lancamentos de cada dia ficam no arquivo daquele dia."
                  : draft.fileStrategy === "monthlyTabs" && draft.fileFormat === "xlsx"
                    ? "Um arquivo por mes, com uma aba para cada dia."
                    : draft.fileStrategy === "byType"
                      ? "Um arquivo por tipo e por data do lancamento."
                      : "Todos os lancamentos ativos ficam em um arquivo geral."}
              </small>
            </div>
            <div className="file-preview-actions">
              <button className="primary-button" type="button" onClick={onImportLedger}>
                <Upload size={18} /> Importar Excel/CSV
              </button>
              <button className="ghost-button" type="button" onClick={onImportLedgerFolder}>
                <Upload size={18} /> Importar pasta
              </button>
              <button className="ghost-button" type="button" onClick={() => openDirectory("output")}>
                <FolderOpen size={18} /> Abrir pasta dos arquivos
              </button>
              <button className="ghost-button" type="button" onClick={openTodayRecoveryFile}>
                <ExternalLink size={18} /> Gerar/abrir arquivo de hoje
              </button>
              <button className="ghost-button" type="button" onClick={openCurrentExport}>
                <ExternalLink size={18} /> Gerar/abrir arquivo
              </button>
            </div>
          </div>
          <label className="field path-field"><span>Pasta padrao</span><input value={draft.outputDirectory} onChange={(event) => update("outputDirectory", event.target.value)} /><button onClick={chooseFolder} type="button">Escolher</button><button onClick={useSafeOutputFolder} type="button">Usar pasta segura</button></label>
          <label className="field"><span>Formato</span>
            <select value={draft.fileFormat} onChange={(event) => update("fileFormat", event.target.value as AppSettings["fileFormat"])}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="field"><span>Organizacao</span>
            <select value={draft.fileStrategy} onChange={(event) => update("fileStrategy", event.target.value as AppSettings["fileStrategy"])}>
              <option value="daily">Um arquivo por dia</option>
              <option value="monthlyTabs">Um arquivo por mes com abas</option>
              <option value="fixedAll">Arquivo fixo geral</option>
              <option value="byType">Arquivos por tipo</option>
            </select>
          </label>
          <label className="field"><span>Modo da planilha</span>
            <select
              value={draft.spreadsheetMode}
              onChange={(event) => {
                const spreadsheetMode = event.target.value as AppSettings["spreadsheetMode"];
                setDraft((current) => ({
                  ...current,
                  spreadsheetMode,
                  visibleColumns: spreadsheetMode === "simple" ? SIMPLE_COLUMNS : DEFAULT_COLUMNS
                }));
              }}
            >
              <option value="simple">Simples: valor pago e total</option>
              <option value="advanced">Avancado: todas as colunas</option>
            </select>
          </label>
          <label className="field"><span>Formato da data</span>
            <select value={draft.dateFormat} onChange={(event) => update("dateFormat", event.target.value as AppSettings["dateFormat"])}>
              <option value="yyyy-MM-dd">{dateTokenForFormat(new Date(), "yyyy-MM-dd")}</option>
              <option value="dd-MM-yyyy">{dateTokenForFormat(new Date(), "dd-MM-yyyy")}</option>
              <option value="yyyyMMdd">{dateTokenForFormat(new Date(), "yyyyMMdd")}</option>
            </select>
          </label>
          <label className="field"><span>Separador CSV</span>
            <select value={draft.csvSeparator} onChange={(event) => update("csvSeparator", event.target.value as AppSettings["csvSeparator"])}>
              <option value=";">Ponto e virgula</option>
              <option value=",">Virgula</option>
              <option value="\t">Tab</option>
            </select>
          </label>
          <div className="settings-subsection">
            <h4>Automacao</h4>
            <label className="switch-line"><input type="checkbox" checked={draft.automaticSpreadsheetEnabled} onChange={(event) => update("automaticSpreadsheetEnabled", event.target.checked)} /> Sincronizar planilha operacional a cada alteracao</label>
            <label className="switch-line"><input type="checkbox" checked={draft.automaticClosingReportEnabled} onChange={(event) => update("automaticClosingReportEnabled", event.target.checked)} /> Gerar fechamento analitico ao encerrar o aplicativo</label>
            <label className="switch-line"><input type="checkbox" checked={draft.backupEnabled} onChange={(event) => update("backupEnabled", event.target.checked)} /> Criar um backup diario ao fechar o aplicativo</label>
            <label className="switch-line"><input type="checkbox" checked={draft.rememberHistoryPeriod} onChange={(event) => update("rememberHistoryPeriod", event.target.checked)} /> Manter periodo escolhido no Historico</label>
            <label className="switch-line"><input type="checkbox" checked={draft.rememberReportPeriod} onChange={(event) => update("rememberReportPeriod", event.target.checked)} /> Manter periodo escolhido nos Relatorios</label>
            <p className="settings-note">Relatorios da aba Relatorios sao gerados manualmente. O fechamento automatico, quando ativado, cria apenas um arquivo consolidado no encerramento.</p>
          </div>
          <div className="settings-subsection">
            <h4>Abas dos relatorios Excel</h4>
            {([
              ["products", "Produtos"],
              ["categories", "Categorias"],
              ["tables", "Mesas"],
              ["times", "Horarios"]
            ] as const).map(([section, label]) => (
              <label className="switch-line" key={section}>
                <input
                  type="checkbox"
                  checked={draft.reportExportSections.includes(section)}
                  onChange={() => update("reportExportSections", draft.reportExportSections.includes(section)
                    ? draft.reportExportSections.filter((item) => item !== section)
                    : [...draft.reportExportSections, section])}
                />
                Incluir aba {label}
              </label>
            ))}
          </div>
        </section>

        <section className={categoryClass("pdv", "settings-group wide pdv-settings-panel")}>
          <PdvApp embedded initialTab="products" hideTopbar remoteSession={remoteSession} toastDuration={settings.notificationDurationMs} />
        </section>

        <section className={categoryClass("privacy", "settings-group wide privacy-settings")}>
          <div className="privacy-overview">
            <div className="privacy-mark">
              <ShieldCheck size={22} />
            </div>
            <div>
              <span className="settings-overline">Valores sensiveis</span>
              <h3>Privacidade de caixa</h3>
              <p>
                Esconda totais grandes quando o app estiver visivel para cliente, atendente ou outro computador.
                Os lancamentos continuam salvos normalmente na planilha.
              </p>
            </div>
            <strong>{draft.privacy.hideHeaderTotal || draft.privacy.hideReportTotals ? "Protecao ativa" : "Visao aberta"}</strong>
          </div>

          <div className="privacy-mode-grid">
            <button
              type="button"
              className={`privacy-mode-card ${!draft.privacy.hideHeaderTotal && !draft.privacy.hideReportTotals ? "active" : ""}`}
              onClick={() => update("privacy", { ...draft.privacy, hideHeaderTotal: false, hideReportTotals: false })}
            >
              <Eye size={18} />
              <strong>Normal</strong>
              <span>Mostra total do dia e relatorios completos.</span>
            </button>
            <button
              type="button"
              className={`privacy-mode-card ${draft.privacy.hideHeaderTotal && !draft.privacy.hideReportTotals ? "active" : ""}`}
              onClick={() => update("privacy", { ...draft.privacy, hideHeaderTotal: true, hideReportTotals: false })}
            >
              <ShieldCheck size={18} />
              <strong>Balcao</strong>
              <span>Esconde o total no topo, mas deixa relatorio disponivel.</span>
            </button>
            <button
              type="button"
              className={`privacy-mode-card ${draft.privacy.hideHeaderTotal && draft.privacy.hideReportTotals ? "active" : ""}`}
              onClick={() => update("privacy", { ...draft.privacy, hideHeaderTotal: true, hideReportTotals: true })}
            >
              <BarChart3 size={18} />
              <strong>Reservado</strong>
              <span>Abre relatorios com totais ocultos por padrao.</span>
            </button>
          </div>

          <div className="privacy-control-grid">
            <label className={`privacy-toggle-card ${draft.privacy.hideHeaderTotal ? "enabled" : ""}`}>
              <input
                type="checkbox"
                checked={draft.privacy.hideHeaderTotal}
                onChange={(event) => update("privacy", { ...draft.privacy, hideHeaderTotal: event.target.checked })}
              />
              <span>
                <strong>Ocultar total no topo</strong>
                <small>Troca o valor do card superior por "Privado" e reduz exposicao na tela principal.</small>
              </span>
            </label>
            <label className={`privacy-toggle-card ${draft.privacy.hideReportTotals ? "enabled" : ""}`}>
              <input
                type="checkbox"
                checked={draft.privacy.hideReportTotals}
                onChange={(event) => update("privacy", { ...draft.privacy, hideReportTotals: event.target.checked })}
              />
              <span>
                <strong>Relatorios abrirem ocultos</strong>
                <small>O relatorio abre protegido, e voce decide quando revelar os totais na tela.</small>
              </span>
            </label>
          </div>

          <p className="settings-note">
            Privacidade muda somente a visualizacao local. Ela nao altera permissao do servidor, historico, importacao ou arquivo Excel.
          </p>
        </section>

        <section className={categoryClass("server", "settings-group wide")} {...remoteSectionProps("server")}>
          <h3>Servidor e sincronizacao</h3>
          <label className="field">
            <span>Autoconexao ao abrir</span>
            <select
              value={draft.server.autoConnection.mode}
              onChange={(event) =>
                update("server", {
                  ...draft.server,
                  autoConnection: {
                    ...draft.server.autoConnection,
                    mode: event.target.value as AppSettings["server"]["autoConnection"]["mode"]
                  }
                })
              }
            >
              <option value="none">Nao conectar automaticamente</option>
              <option value="server">Este PC sempre abre o servidor</option>
              <option value="client">Este PC sempre entra como cliente</option>
            </select>
          </label>
          {draft.server.autoConnection.mode === "client" && (
            <div className="entry-grid server-auto-grid">
              <label className="field description-field">
                <span>Endereco do servidor automatico</span>
                <input
                  value={draft.server.autoConnection.host}
                  onChange={(event) =>
                    update("server", {
                      ...draft.server,
                      autoConnection: { ...draft.server.autoConnection, host: event.target.value }
                    })
                  }
                  placeholder="192.168.0.10:4317"
                />
              </label>
              <label className="field">
                <span>Senha do servidor automatico</span>
                <input
                  type="password"
                  value={draft.server.autoConnection.password}
                  onChange={(event) =>
                    update("server", {
                      ...draft.server,
                      autoConnection: { ...draft.server.autoConnection, password: event.target.value }
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Nome deste cliente</span>
                <input
                  value={draft.server.autoConnection.deviceName}
                  onChange={(event) =>
                    update("server", {
                      ...draft.server,
                      autoConnection: { ...draft.server.autoConnection, deviceName: event.target.value }
                    })
                  }
                  placeholder="Notebook, caixa 2..."
                />
              </label>
            </div>
          )}
          {draft.server.autoConnection.mode === "server" && (
            <p className="settings-note">Ao abrir o aplicativo, este computador tenta iniciar o servidor com a porta e senha abaixo. Se a porta estiver ocupada, ele avisa e permanece local.</p>
          )}
          <label className="field"><span>Porta padrao</span><input type="number" value={draft.server.port} onChange={(event) => update("server", { ...draft.server, port: Number(event.target.value || 4317) })} /></label>
          <label className="field"><span>Senha salva</span><input type="password" value={draft.server.password} onChange={(event) => update("server", { ...draft.server, password: event.target.value })} placeholder="Opcional, pode definir ao abrir" /></label>
          <div className="permission-box permission-grid">
            {(["view", "create", "manageTables", "manageProducts", "edit", "delete", "viewEntryValues", "viewTotals", "printReceipts", "allowClientCustomization"] as const).map((key) => (
              <label className="switch-line" key={key}>
                <input
                  type="checkbox"
                  checked={draft.server.permissions[key]}
                  onChange={(event) => update("server", { ...draft.server, permissions: { ...draft.server.permissions, [key]: event.target.checked } })}
                />
                {permissionLabel(key)}
              </label>
            ))}
          </div>
        </section>

        <section className={categoryClass("shortcuts", "settings-group wide")}>
          <div className="shortcut-list">
            {SHORTCUT_ORDER.map((key) => (
              <article className={`shortcut-card ${draft.shortcuts[key] ? "" : "disabled"}`} key={key}>
                <div>
                  <strong>{shortcutLabel(key)}</strong>
                  <span>{SHORTCUT_HELPERS[key]}</span>
                </div>
                <button
                  className={`shortcut-capture ${capturingShortcut === key ? "capturing" : ""}`}
                  type="button"
                  data-shortcut-capture="true"
                  onClick={() => setCapturingShortcut(key)}
                  onKeyDown={(event) => captureShortcut(event, key)}
                  onBlur={() => setCapturingShortcut((current) => (current === key ? null : current))}
                >
                  {capturingShortcut === key ? "Pressione as teclas..." : draft.shortcuts[key] || "Desativado"}
                </button>
                <button className="ghost-button shortcut-disable" type="button" onClick={() => updateShortcut(key, "")}>
                  <X size={15} /> Desativar
                </button>
              </article>
            ))}
          </div>
          <p className="settings-note">Clique no atalho e pressione a combinacao desejada. Use Backspace, Delete ou Desativar para desligar um comando.</p>
        </section>

        <section className={categoryClass("updates", "settings-group wide")}>
          <p className="settings-note">A verificacao consulta a ultima release e, quando houver versao nova, baixa o instalador para atualizar sem abrir o GitHub.</p>
          <div className="update-card">
            <Download size={20} />
            <div>
              <strong>{updateInfo ? `Atual: ${updateInfo.currentVersion} | GitHub: ${updateInfo.latestVersion}` : "Nenhuma verificacao feita"}</strong>
              <span>{updateInfo?.message || (updateInfo?.hasUpdate ? "Versao nova pronta para baixar e instalar." : "Use o botao para verificar sem interromper o caixa.")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={checkUpdates} disabled={checkingUpdate || installingUpdate}>
              {checkingUpdate ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
              Verificar
            </button>
            {updateInfo?.hasUpdate && (
              <button className="primary-button" type="button" onClick={installUpdate} disabled={installingUpdate || !updateInfo.downloadUrl}>
                {installingUpdate ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                Baixar e instalar
              </button>
            )}
          </div>
        </section>

        <section className={categoryClass("advanced", "settings-group wide")} {...remoteSectionProps("advanced")}>
          <h3>Backup, restauracao e seguranca</h3>
          <div className="diagnostics-grid">
            <article>
              <span>Banco local</span>
              <strong>{diagnostics ? `${diagnostics.entryCount} lancamentos` : "Carregando"}</strong>
              <small>{diagnostics?.dataDirectory || "Diretorio de dados do app"}</small>
            </article>
            <article>
              <span>Planilha</span>
              <strong>{diagnostics?.exportStatus.pendingCount ? `${diagnostics.exportStatus.pendingCount} pendente` : "Sincronizada"}</strong>
              <small>{diagnostics?.exportStatus.message || "Exportacao local pronta"}</small>
            </article>
            <article>
              <span>Backups</span>
              <strong>{diagnostics?.backupCount ?? 0}</strong>
              <small>Historico, configuracoes e banco SQLite do PDV</small>
            </article>
          </div>
          <div className="made-by-card">
            <span>Aplicativo</span>
            <strong>Feito por Otavio Biazzi</strong>
            <small>Contabilizador Caixa para uso local, rede e planilhas diarias.</small>
          </div>
          <div className="settings-action-card">
            <DatabaseBackup size={20} />
            <div>
              <strong>Exportar e importar configuracoes</strong>
              <span>Gere um JSON para levar seus ajustes para outro PC ou importar um backup. A importacao entra como rascunho e so aplica depois de salvar.</span>
            </div>
            <button className="ghost-button" type="button" onClick={exportSettings}>
              <Download size={16} /> Exportar
            </button>
            <button className="primary-button" type="button" onClick={importSettings}>
              <FileSpreadsheet size={16} /> Importar
            </button>
          </div>
          <div className="settings-action-card">
            <DatabaseBackup size={20} />
            <div>
              <strong>Backup local do caixa</strong>
              <span>Salva historico, configuracoes e o banco SQLite do PDV em um backup unico. Antes de restaurar, o estado atual tambem recebe uma copia de seguranca.</span>
            </div>
            <button className="ghost-button" type="button" onClick={createDataBackup}>
              <Save size={16} /> Criar backup
            </button>
            <button className="primary-button" type="button" onClick={() => restoreDataBackup()}>
              <Upload size={16} /> Restaurar externo
            </button>
          </div>
          <div className="settings-action-card">
            <DatabaseBackup size={20} />
            <div>
              <strong>Pastas e diagnostico</strong>
              <span>Abra os dados internos ou a pasta das planilhas para conferir arquivos, backups e logs quando algo parecer fora do lugar.</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => openDirectory("data")}>
              <DatabaseBackup size={16} /> Dados
            </button>
            <button className="ghost-button" type="button" onClick={() => openDirectory("output")}>
              <FileSpreadsheet size={16} /> Planilhas
            </button>
          </div>
          <div className="diagnostics-panel">
            <div className="section-title">
              <strong>Backups recentes</strong>
              <button className="ghost-button" type="button" onClick={loadDiagnostics} disabled={diagnosticsLoading}>
                {diagnosticsLoading ? <RefreshCw size={15} className="spin" /> : <RefreshCw size={15} />}
                Atualizar
              </button>
            </div>
            <div className="backup-list">
              {diagnostics?.backups.slice(0, 6).map((backup) => {
                const { date, time } = formatDateTime(backup.createdAt);
                return (
                  <article key={backup.filePath}>
                    <div>
                      <strong>{backup.fileName}</strong>
                      <span>{date} {time} | {backup.entryCount} lancamentos | {formatFileSize(backup.size)} | {backup.reason}</span>
                    </div>
                    <button className="ghost-button" type="button" onClick={() => restoreDataBackup(backup.filePath)}>
                      <RotateCcw size={15} /> Restaurar
                    </button>
                  </article>
                );
              })}
              {diagnostics && !diagnostics.backups.length && <p className="settings-note">Nenhum backup local criado ainda.</p>}
            </div>
          </div>
          <div className="diagnostics-panel">
            <div className="section-title">
              <strong>Ultimos eventos</strong>
              <span>Log simples para diagnosticar exportacao, importacao e restauracao.</span>
            </div>
            <div className="log-list">
              {diagnostics?.logs.slice(0, 8).map((log) => {
                const { date, time } = formatDateTime(log.createdAt);
                return (
                  <article key={log.id} className={log.level}>
                    <span>{log.level}</span>
                    <strong>{log.message}</strong>
                    <small>{date} {time}{log.detail ? ` | ${log.detail}` : ""}</small>
                  </article>
                );
              })}
              {diagnostics && !diagnostics.logs.length && <p className="settings-note">Nenhum evento registrado ainda.</p>}
            </div>
          </div>
          <div className="danger-zone">
            <DatabaseBackup size={20} />
            <div>
              <strong>Restauracoes seguras</strong>
              <span>Restaurar categorias nao apaga vendas. Para apagar dados de venda, use o Historico com confirmacao.</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSettingsConfirm({
              title: "Restaurar configuracoes de fabrica?",
              message: "Tema, visual, atalhos, barra fixa e preferencias serao restaurados. Historico, vendas, mesas, produtos, pagamentos, relatorios e arquivos exportados serao preservados.",
              confirmLabel: "Restaurar configuracoes",
              action: () => {
                setDraft(createSettingsFallback(draft));
                onToast("info", "Configuracoes restauradas. Salve para aplicar.");
              }
            })}>
              <RotateCcw size={16} /> Restaurar tudo
            </button>
          </div>
        </section>

        <section className={categoryClass("files", "settings-group wide")} {...remoteSectionProps("files")}>
          <h3>Colunas do arquivo</h3>
          {draft.spreadsheetMode === "simple" && (
            <p className="settings-note">
              O modo simples usa Data, Hora, Valor pago, Descricao, Tipo, Pessoas, Pago com, Troco e uma linha TOTAL.
              Troque para avancado para reordenar todas as colunas.
            </p>
          )}
          <div className="column-list">
            {DEFAULT_COLUMNS.map((column) => (
              <div key={column} className={draft.visibleColumns.includes(column) ? "" : "disabled"}>
                <label><input type="checkbox" disabled={draft.spreadsheetMode === "simple"} checked={draft.visibleColumns.includes(column)} onChange={() => toggleColumn(column)} /> {column}</label>
                <span>
                  <button disabled={draft.spreadsheetMode === "simple"} onClick={() => moveColumn(column, -1)}><ArrowUp size={14} /></button>
                  <button disabled={draft.spreadsheetMode === "simple"} onClick={() => moveColumn(column, 1)}><ArrowDown size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section
          className={`settings-group wide pdv-settings-panel ${activePdvAdvancedSection ? "active-category" : "hidden-category"} ${isRemoteLockedCategory(category) ? "remote-locked-section" : ""}`}
          {...remoteSectionProps(category)}
        >
          <PdvApp
            embedded
            initialTab="advanced"
            hideTopbar
            remoteSession={remoteSession}
            toastDuration={settings.notificationDurationMs}
            advancedSection={activePdvAdvancedSection || "tables"}
            hideAdvancedNavigation
            advancedSettingsActionsRef={pdvSettingsActionsRef}
            onAdvancedSettingsDirtyChange={setPdvSettingsDirty}
          />
        </section>
      </div>
        </div>
      </div>

      <div className="submit-row sticky-save">
        <button className="primary-button" onClick={saveDraft}><Save size={18} /> Salvar configuracoes</button>
        <button className="ghost-button" onClick={() => {
          setDraft(settings);
          pdvSettingsActionsRef.current?.discard();
          onToast("info", "Alteracoes descartadas.");
        }}>Descartar</button>
      </div>
      {settingsConfirm && (
        <SettingsConfirmModal
          title={settingsConfirm.title}
          message={settingsConfirm.message}
          confirmLabel={settingsConfirm.confirmLabel}
          danger={settingsConfirm.danger}
          onCancel={() => setSettingsConfirm(null)}
          onConfirm={async () => {
            const request = settingsConfirm;
            setSettingsConfirm(null);
            await request.action();
          }}
        />
      )}
    </section>
  );
}

function SettingsConfirmModal({
  title,
  message,
  confirmLabel = "Confirmar",
  danger = false,
  operational = false,
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  operational?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [focusedAction, setFocusedAction] = useState<"cancel" | "confirm">("cancel");

  const runConfirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Tab") {
        event.preventDefault();
        setFocusedAction((current) => current === "cancel" ? "confirm" : "cancel");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (focusedAction === "cancel") {
          onCancel();
        } else {
          void runConfirm();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, focusedAction, onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal confirmation-modal ${operational ? "pdv-navigation-confirm" : ""}`}>
        <div className="modal-head">
          <div>
            <span className="settings-overline">Confirmacao</span>
            <strong>{title}</strong>
          </div>
          <button className="icon-button" onClick={onCancel} disabled={busy}><X size={18} /></button>
        </div>
        <p>{message}</p>
        <div className="modal-actions">
          <button className={`ghost-button ${focusedAction === "cancel" ? "keyboard-selected" : ""}`} onClick={onCancel} disabled={busy}>Cancelar</button>
          <button
            className={`${danger ? "danger-button" : "primary-button"} ${focusedAction === "confirm" ? "keyboard-selected" : ""}`}
            disabled={busy}
            onClick={() => void runConfirm()}
          >
            {busy ? "Processando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarList({ title, data, total }: { title: string; data: Record<string, number>; total: number }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <section className="bar-list">
      <h3>{title}</h3>
      {rows.map(([label, value]) => (
        <div key={label} className="bar-row">
          <div>
            <span>{label}</span>
            <strong>{formatCurrency(value)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.min(100, Math.abs(total ? (value / total) * 100 : 0))}%` }} />
          </div>
        </div>
      ))}
      {!rows.length && <p className="empty-text">Sem dados suficientes.</p>}
    </section>
  );
}

function StatusPill({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <span className={`status-pill ${ok ? "ok" : "warn"}`}>
      <i />
      {label}: {text}
    </span>
  );
}

function Toast({ toast }: { toast: ToastState }) {
  return (
    <div className={`toast ${toast.tone}`}>
      {toast.tone === "success" ? <Check size={18} /> : toast.tone === "error" ? <X size={18} /> : <Eye size={18} />}
      {toast.message}
    </div>
  );
}

function titleForTab(tab: TabKey): string {
  const map: Record<TabKey, string> = {
    sale: "Venda",
    tables: "Mesas",
    history: "Historico editavel",
    dashboard: "Visao geral",
    clients: "Clientes",
    receivables: "Contas a receber",
    payables: "Contas a pagar",
    reports: "Relatorios",
    server: "Servidor local",
    settings: "Ajuste"
  };
  return map[tab];
}

function headerForTab(tab: TabKey, todayCount: number): { eyebrow: string; title: string; status: string; detail: string } {
  const map: Record<TabKey, { eyebrow: string; title: string; status: string; detail: string }> = {
    sale: {
      eyebrow: "Operacao diaria",
      title: titleForTab(tab),
      status: "Venda direta integrada ao sistema",
      detail: "Produtos"
    },
    tables: {
      eyebrow: "Atendimento por mesa",
      title: titleForTab(tab),
      status: "Mapa de mesas e comandas",
      detail: "Mesas"
    },
    history: {
      eyebrow: "Consulta e auditoria",
      title: titleForTab(tab),
      status: "Edite, duplique ou restaure registros",
      detail: "Historico"
    },
    dashboard: {
      eyebrow: "Painel de gestao",
      title: titleForTab(tab),
      status: "Vendas, mesas, estoque e alertas",
      detail: "Hoje"
    },
    clients: {
      eyebrow: "Relacionamento",
      title: titleForTab(tab),
      status: "Cadastro, historico e contas vinculadas",
      detail: "Clientes"
    },
    receivables: {
      eyebrow: "Gestao financeira",
      title: titleForTab(tab),
      status: "Pendencias, recebimentos e vencimentos",
      detail: "Receber"
    },
    payables: {
      eyebrow: "Gestao financeira",
      title: titleForTab(tab),
      status: "Fornecedores, despesas e pagamentos",
      detail: "Pagar"
    },
    reports: {
      eyebrow: "Analise do caixa",
      title: titleForTab(tab),
      status: "Filtros por periodo, tipo e pagamento",
      detail: "Relatorios"
    },
    server: {
      eyebrow: "Rede local",
      title: titleForTab(tab),
      status: "Acesso com senha e permissoes",
      detail: "Sincronizacao"
    },
    settings: {
      eyebrow: "Preferencias do app",
      title: titleForTab(tab),
      status: "Tema, arquivos, barra e perfis",
      detail: "Ajustes"
    }
  };
  return map[tab];
}

function statusLabel(status: LedgerEntry["status"]): string {
  return {
    active: "Ativo",
    cancelled: "Cancelado",
    deleted: "Lixeira"
  }[status];
}

function uniqueFilled(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function shortcutLabel(key: string): string {
  const labels: Record<string, string> = {
    submit: "Enviar",
    submitAndClear: "Enviar e limpar",
    money: "Modo dinheiro",
    table: "Modo mesa",
    bus: "Modo onibus",
    history: "Abrir historico",
    settings: "Abrir ajustes",
    repeatLast: "Repetir ultimo",
    escape: "Limpar/fechar"
  };
  return labels[key] || key;
}

function permissionLabel(key: keyof ServerPermissions): string {
  return {
    view: "Somente visualizar",
    create: "Registrar vendas",
    manageTables: "Gerenciar mesas e fechamentos",
    manageProducts: "Gerenciar produtos e ajustes do PDV",
    edit: "Editar lancamentos",
    delete: "Apagar lancamentos",
    viewEntryValues: "Ver valores das vendas",
    viewTotals: "Ver totais vendidos",
    printReceipts: "Imprimir recibos neste cliente",
    allowClientCustomization: "Cliente pode editar configuracoes do servidor"
  }[key];
}

function entryMatchesPayment(entry: LedgerEntry, payment: string): boolean {
  return entry.paymentMethod === payment || Boolean(entry.paymentBreakdown?.some((item) => item.method === payment));
}

function paymentLabelForEntry(entry: LedgerEntry): string {
  const methods = entry.paymentBreakdown?.map((item) => item.method).filter(Boolean) || [];
  return methods.length ? [...new Set(methods)].join(" + ") : entry.paymentMethod;
}
