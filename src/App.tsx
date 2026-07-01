import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Copy,
  DatabaseBackup,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  History,
  KeyRound,
  Laptop,
  LayoutPanelTop,
  ListFilter,
  MinusCircle,
  MonitorUp,
  Palette,
  Pin,
  PlugZap,
  Plus,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  Wallet,
  Wifi,
  X
} from "lucide-react";
import { ENTRY_TYPES, PAYMENT_METHODS, DEFAULT_COLUMNS, SIMPLE_COLUMNS, DEFAULT_FLOATING_FIELDS, DEFAULT_QUICK_TABS, createDefaultSettings } from "./shared/defaults";
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
  RoundDirection,
  ServerPermissions,
  ServerState,
  UpdateInfo
} from "./shared/types";

type TabKey = "register" | "history" | "reports" | "server" | "settings";
type SettingsCategory =
  | "appearance"
  | "floating"
  | "quick"
  | "defaults"
  | "profiles"
  | "files"
  | "reports"
  | "server"
  | "shortcuts"
  | "updates"
  | "advanced";
type ServerPanelMode = "create" | "connect" | "permissions";

interface RemoteEntriesResponse {
  entries: LedgerEntry[];
  summary: DaySummary | null;
  permissions: ServerPermissions;
}

interface RemoteClientSession {
  baseUrl: string;
  password: string;
  deviceName: string;
  entries: LedgerEntry[];
  summary: DaySummary | null;
  permissions: ServerPermissions;
  connectedAt: string;
}

interface ToastState {
  tone: "success" | "error" | "info";
  message: string;
}

interface ModeCommand {
  type: EntryType;
  nonce: number;
}

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: typeof Send }> = [
  { key: "register", label: "Caixa", icon: Send },
  { key: "history", label: "Historico", icon: History },
  { key: "reports", label: "Relatorios", icon: BarChart3 },
  { key: "server", label: "Rede", icon: Server },
  { key: "settings", label: "Ajustes", icon: Settings }
];

const IS_FLOATING_WINDOW = new URLSearchParams(window.location.search).get("floating") === "1";
const CDA_ICON_SRC = "/cda-icon.png";

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
  "pin",
  "history",
  "settings",
  "repeatLast",
  "escape"
] as const;

type ShortcutAction = (typeof SHORTCUT_ORDER)[number];

const GLOBAL_SHORTCUT_ACTIONS: ShortcutAction[] = ["pin", "money", "table", "bus", "history", "settings", "repeatLast"];

const SHORTCUT_HELPERS: Record<ShortcutAction, string> = {
  submit: "Envia o formulario atual quando estiver no caixa.",
  submitAndClear: "Envia e limpa os campos do caixa rapido.",
  money: "Troca para Dinheiro/Troco sem sair do fluxo.",
  table: "Troca para modo Mesa.",
  bus: "Troca para modo Onibus.",
  pin: "Abre ou fecha a barra fixada.",
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
    borderless: true
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
    borderless: true
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
    borderless: true
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
    borderless: true
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

function resolveTheme(theme: AppSettings["theme"], prefersDark: boolean): Exclude<AppSettings["theme"], "auto"> {
  return theme === "auto" ? (prefersDark ? "dark" : "light") : theme;
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

function applyFloatingPresetToSettings(settings: AppSettings, preset: FloatingPreset): AppSettings {
  return normalizeSettingsDraft(settings, {
    defaultType: preset.defaultType,
    quickTabs: cloneValue(preset.quickTabs),
    floating: {
      ...settings.floating,
      visibleFields: normalizeFloatingFields(preset.fields),
      borderless: preset.borderless ?? settings.floating.borderless,
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
    return `caixa-${getLocalDateKey(now).slice(0, 7)}.${extension}`;
  }
  if (settings.fileStrategy === "fixedAll") {
    return `caixa-geral.${extension}`;
  }
  if (settings.fileStrategy === "byType") {
    return `venda-${date}.${extension}`;
  }
  return `vendas-${date}.${extension}`;
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
  const warnings = [];
  if (previous.outputDirectory !== next.outputDirectory) {
    warnings.push("pasta padrao das planilhas");
  }
  if (previous.fileFormat !== next.fileFormat || previous.fileStrategy !== next.fileStrategy || previous.spreadsheetMode !== next.spreadsheetMode) {
    warnings.push("formato ou organizacao da planilha");
  }
  if (previous.server.port !== next.server.port || previous.server.password !== next.server.password) {
    warnings.push("porta ou senha do servidor");
  }
  if (JSON.stringify(previous.server.permissions) !== JSON.stringify(next.server.permissions)) {
    warnings.push("permissoes dos dispositivos remotos");
  }
  if (JSON.stringify(previous.shortcuts) !== JSON.stringify(next.shortcuts)) {
    warnings.push("atalhos de teclado");
  }
  return warnings;
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
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("register");
  const [pinned, setPinnedState] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modeCommand, setModeCommand] = useState<ModeCommand | null>(null);
  const [importPreview, setImportPreview] = useState<LedgerImportPreview | null>(null);
  const [importingPreview, setImportingPreview] = useState(false);
  const [currentDateKey, setCurrentDateKey] = useState(() => getLocalDateKey());

  const todayEntries = useMemo(() => filterEntriesByLocalDate(entries, currentDateKey), [entries, currentDateKey]);
  const summary = useMemo(() => summarizeEntries(todayEntries), [todayEntries]);

  const reload = async () => {
    const snapshot = await window.caixa.getSnapshot();
    setEntries(snapshot.entries);
    setSettings((current) =>
      current && JSON.stringify(current) === JSON.stringify(snapshot.settings) ? current : snapshot.settings
    );
    setServer(snapshot.server);
    setExportStatus(snapshot.exportStatus);
    setPinnedState(await window.caixa.getPinned());
  };

  useEffect(() => {
    reload();
    const offEntries = window.caixa.onEntriesChanged(reload);
    const offServer = window.caixa.onServerChanged((state) => setServer(state));
    const offPinned = window.caixa.onPinnedChanged((nextPinned) => setPinnedState(nextPinned));
    const offSettings = window.caixa.onSettingsChanged((nextSettings) => setSettings(nextSettings));
    return () => {
      offEntries();
      offServer();
      offPinned();
      offSettings();
    };
  }, []);

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
      document.documentElement.dataset.fieldSize = settings.fieldSize;
      document.documentElement.dataset.floatingBorderless = settings.floating.borderless ? "true" : "false";
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
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
      if (action === "pin") {
        await togglePinned();
      } else if (action === "money") {
        commandMode("Dinheiro/Troco");
      } else if (action === "table") {
        commandMode("Mesa");
      } else if (action === "bus") {
        commandMode("Onibus");
      } else if (action === "history") {
        setActiveTab("history");
      } else if (action === "settings") {
        setActiveTab("settings");
      } else if (action === "repeatLast") {
        await repeatLastEntry();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, settings, pinned]);

  const showToast = (tone: ToastState["tone"], message: string) => {
    setToast({ tone, message });
  };

  const commandMode = (type: EntryType) => {
    setActiveTab("register");
    setModeCommand({ type, nonce: Date.now() });
  };

  const saveSettings = async (next: AppSettings) => {
    const saved = await window.caixa.saveSettings(next);
    setSettings(saved);
    showToast("success", "Configuracoes salvas.");
  };

  const addEntry = async (draft: EntryDraft) => {
    const result = await window.caixa.addEntry(draft);
    await reload();
    setExportStatus(result.exportStatus);
    showToast(result.exportStatus.ok ? "success" : "error", result.exportStatus.ok ? "Lancamento registrado." : result.exportStatus.message || "Lancamento salvo localmente.");
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
    const next = !pinned;
    const result = await window.caixa.setPinned(next, {
      opacity: settings.floating.opacity,
      borderless: settings.floating.borderless,
      lockPosition: settings.floating.lockPosition
    });
    setPinnedState(result);
  };

  if (!settings || !server) {
    return (
      <div className="boot-screen">
        <div className="pulse-mark" />
        <strong>Carregando Contabilizador Caixa...</strong>
      </div>
    );
  }

  if (IS_FLOATING_WINDOW) {
    return (
      <div className="pinned-app">
        <QuickEntry
          entries={entries}
          settings={settings}
          pinned
          modeCommand={modeCommand}
          onSubmit={addEntry}
          onUnpin={togglePinned}
        />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  const header = headerForTab(activeTab, summary.count);

  return (
    <div className="app-shell">
      <aside className="sidebar app-topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <img src={CDA_ICON_SRC} alt="CDA" draggable={false} />
          </div>
          <div>
            <strong>Contabilizador</strong>
            <span>PDV local rapido</span>
          </div>
        </div>

        <nav className="tabs">
          {TAB_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeTab === item.key ? "active" : ""}
                onClick={() => setActiveTab(item.key)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-card topbar-card">
          <span>{settings.privacy.hideHeaderTotal ? "Total oculto" : "Total hoje"}</span>
          <strong className={settings.privacy.hideHeaderTotal ? "private-value" : ""}>
            {settings.privacy.hideHeaderTotal ? "Privado" : formatCurrency(summary.total)}
          </strong>
          <small>{summary.count} lancamentos</small>
        </div>

        <button className="pin-button" onClick={togglePinned}>
          <Pin size={18} />
          {pinned ? "Fechar barra fixada" : "Abrir barra fixada"}
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">{header.eyebrow}</span>
            <h1>{header.title}</h1>
          </div>
          <div className="module-status">
            <span>{header.status}</span>
            <strong>{header.detail}</strong>
          </div>
          <div className="status-strip">
            <StatusPill label="Excel/CSV" ok={exportStatus?.ok ?? true} text={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente` : "sincronizado"} />
            <StatusPill label="Servidor" ok={server.running} text={server.running ? `:${server.port}` : "off"} />
          </div>
        </header>

        {activeTab === "register" && (
          <div className="register-layout">
            <QuickEntry
              entries={entries}
              settings={settings}
              pinned={false}
              modeCommand={modeCommand}
              onSubmit={addEntry}
              onUnpin={togglePinned}
            />
            <TodayPanel summary={summary} entries={todayEntries} settings={settings} onMode={commandMode} />
          </div>
        )}

        {activeTab === "history" && (
          <HistoryPanel
            entries={entries}
            onChange={async () => {
              await reload();
            }}
            onToast={showToast}
          />
        )}

        {activeTab === "reports" && (
            <ReportsPanel entries={entries} settings={settings} summary={summary} exportStatus={exportStatus} onExport={async () => {
            const status = await window.caixa.exportNow();
            setExportStatus(status);
            showToast(status.ok ? "success" : "error", status.message || "Exportacao executada.");
          }} onExportFiltered={async (ids, label) => {
            const status = await window.caixa.exportFilteredReport(ids, label);
            setExportStatus(status);
            showToast(status.ok ? "success" : "error", status.message || "Exportacao executada.");
          }} />
        )}

        {activeTab === "server" && (
          <ServerPanel
            settings={settings}
            server={server}
            onSaveSettings={saveSettings}
            onServerChange={setServer}
            onToast={showToast}
          />
        )}

        {activeTab === "settings" && (
            <SettingsPanel
              settings={settings}
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
    </div>
  );
}

function QuickEntry({
  entries,
  settings,
  pinned,
  modeCommand,
  onSubmit,
  onUnpin
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  pinned: boolean;
  modeCommand: ModeCommand | null;
  onSubmit: (draft: EntryDraft) => Promise<void>;
  onUnpin?: () => Promise<void> | void;
}) {
  const [type, setType] = useState<EntryType>(settings.defaultType);
  const [valueText, setValueText] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState(settings.defaultPeople);
  const [tableNumber, setTableNumber] = useState("");
  const [busNumber, setBusNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Nao informado");
  const [cashLinkedType, setCashLinkedType] = useState<EntryType>(() => quickTabForType(enabledQuickTabs(settings), settings.defaultType)?.cashLinkedType || "Mesa");
  const [paidWithText, setPaidWithText] = useState("");
  const [observations, setObservations] = useState("");
  const [roundingStep, setRoundingStep] = useState(settings.defaultRoundingStep);
  const [roundingDirection, setRoundingDirection] = useState<RoundDirection>(settings.defaultRoundingDirection);
  const [registerDifference, setRegisterDifference] = useState(true);
  const [showSplitAdjustment, setShowSplitAdjustment] = useState(false);
  const [activeQuickTabId, setActiveQuickTabId] = useState(() => quickTabForType(enabledQuickTabs(settings), settings.defaultType)?.id || "account");
  const [submitting, setSubmitting] = useState(false);

  const value = parseMoney(valueText);
  const paidWith = parseMoney(paidWithText);
  const split = calculateSplit(value, people, roundingStep, roundingDirection, registerDifference);
  const effectivePaidWith = paidWith > 0 ? paidWith : value;
  const cash = calculateCash(value, effectivePaidWith);
  const lastActive = entries.find((entry) => entry.status === "active");
  const tableFieldEnabled = settings.tableNumberEnabled !== false;
  const busFieldEnabled = settings.busNumberEnabled !== false;
  const floatingVisibleFields = normalizeFloatingFields(settings.floating.visibleFields);

  useEffect(() => {
    if (modeCommand) {
      if (settings.floating.syncMoneyWithEntryType && modeCommand.type === "Dinheiro/Troco") {
        setCashLinkedType(cashLinkFromEntryType(type, cashLinkedType));
      }
      setType(modeCommand.type);
      const matchingTab = quickTabForType(enabledQuickTabs(settings), modeCommand.type);
      setActiveQuickTabId(matchingTab?.id || "manual");
    }
  }, [modeCommand?.nonce, settings.floating.syncMoneyWithEntryType, settings.quickTabs]);

  useEffect(() => {
    const tabs = enabledQuickTabs(settings);
    const currentTab = tabs.find((tab) => tab.id === activeQuickTabId);
    if (currentTab?.type === type) {
      return;
    }
    const matchingTab = quickTabForType(tabs, type);
    setActiveQuickTabId(matchingTab?.id || currentTab?.id || "manual");
  }, [settings.quickTabs, type, activeQuickTabId]);

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

  const visible = (field: string) => !pinned || floatingVisibleFields.includes(field);

  const clearForm = () => {
    setValueText("");
    setDescription("");
    setPeople(settings.defaultPeople);
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
    const isMoney = type === "Dinheiro/Troco";
    const effectiveType: EntryType =
      pinned && type !== "Dinheiro/Troco" && people > 1 ? "Divisao de conta" : type;
    const effectiveSplit = effectiveType === "Divisao de conta" ? split : undefined;
    const effectiveCash = effectiveType === "Dinheiro/Troco" ? cash : undefined;
    const effectiveDescription =
      description ||
      (isMoney && cashLinkedType === "Mesa" && tableNumber ? `Mesa ${tableNumber}` : "") ||
      (isMoney && cashLinkedType === "Onibus" && busNumber ? `Onibus ${busNumber}` : "");
    const draft: EntryDraft = {
      type: effectiveType,
      value,
      description: effectiveDescription,
      people: effectiveSplit?.people ?? people,
      tableNumber: tableFieldEnabled && !(isMoney && cashLinkedType !== "Mesa") ? tableNumber : "",
      busNumber: busFieldEnabled && !(isMoney && cashLinkedType !== "Onibus") ? busNumber : "",
      paymentMethod: effectiveType === "Dinheiro/Troco" ? "Dinheiro" : paymentMethod,
      paidWith: effectiveType === "Dinheiro/Troco" ? effectivePaidWith : paidWith,
      observations,
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
    const quickTabs = enabledQuickTabs(settings);
    const isMoney = type === "Dinheiro/Troco";
    const nextModeLabel = isMoney ? "Conta" : "Dinheiro";
    const moneyDisabled = false;
    const disabled = submitting || value <= 0 || moneyDisabled;
    const floatingTypes: EntryType[] = ["Venda", "Mesa", "Onibus", "Extra", "Taxa", "Personalizado"];
    const activeQuickTab = quickTabs.find((tab) => tab.id === activeQuickTabId);
    const compactFloating = Boolean(activeQuickTab?.compact);
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
    const showTabs = visible("tabs") && quickTabs.length > 0;
    const showMode = visible("mode");
    const showType = visible("type");
    const showPeople = visible("people");
    const detailFieldId = detailKind === "mesa" ? "tableNumber" : detailKind === "onibus" ? "busNumber" : "";
    const showDetail = Boolean(detailFieldId && visible(detailFieldId));
    const showDescription = visible("description");
    const showPaidWith = visible("paidWith");
    const showPaymentMethod = visible("paymentMethod") && !isMoney && !compactFloating;
    const showResult = visible("result");
    const showSubmit = visible("submit");
    const applyQuickTab = (tab: QuickTabSettings) => {
      setActiveQuickTabId(tab.id);
      setType(tab.type);
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
        setType("Dinheiro/Troco");
        setCashLinkedType(syncModes ? cashLinkFromEntryType(type, cashLinkedType) : moneyTab?.cashLinkedType || "Mesa");
        setActiveQuickTabId(moneyTab?.id || "manual");
        return;
      }
      const nextType: EntryType = syncModes ? entryTypeFromCashLink(cashLinkedType) : "Venda";
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
      setType(nextType);
      if (settings.floating.syncMoneyWithEntryType) {
        setCashLinkedType(cashLinkFromEntryType(nextType, cashLinkedType));
      }
      const matchingTab = quickTabs.find((tab) => tab.type === nextType && !tab.compact);
      setActiveQuickTabId(matchingTab?.id || "manual");
    };

    return (
      <form className={`floating-bar ${isMoney ? "money" : "account"} ${showDetail ? "has-detail" : ""} ${compactFloating ? "compact-tab" : ""} ${showTabs ? "with-tabs" : ""}`} onSubmit={onSubmitForm} onKeyDown={onEntryKeyDown}>
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
              {CASH_LINKED_TYPES.map((item) => (
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
              {PAYMENT_METHODS.map((item) => (
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
              <button type="button" key={item} className={type === item ? "selected" : ""} onClick={() => setType(item)}>
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="entry-grid">
        {visible("type") && (
          <label className="field">
            <span>Tipo</span>
            <select value={type} onChange={(event) => setType(event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => (
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

        {tableFieldEnabled && (type === "Mesa" || (type === "Dinheiro/Troco" && cashLinkedType === "Mesa")) && !pinned && (
          <label className="field small-field">
            <span>Mesa</span>
            <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} placeholder="8" />
          </label>
        )}

        {busFieldEnabled && (type === "Onibus" || (type === "Dinheiro/Troco" && cashLinkedType === "Onibus")) && !pinned && (
          <label className="field small-field">
            <span>Onibus</span>
            <input value={busNumber} onChange={(event) => setBusNumber(event.target.value)} placeholder="2" />
          </label>
        )}

        {!pinned && (
          <label className="field">
            <span>Pagamento</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}

        {type === "Dinheiro/Troco" && !pinned && (
          <label className="field">
            <span>Vincular a</span>
            <select value={cashLinkedType} onChange={(event) => setCashLinkedType(event.target.value as EntryType)}>
              {CASH_LINKED_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {type === "Divisao de conta" && !pinned && (
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

      {type === "Dinheiro/Troco" && !pinned && (
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

      {!pinned && (
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
              <option key={step} value={step}>{formatCurrency(step)}</option>
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
              <span key={item.label}>{item.quantity}x {item.label}</span>
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
  onMode
}: {
  summary: DaySummary;
  entries: LedgerEntry[];
  settings: AppSettings;
  onMode: (type: EntryType) => void;
}) {
  const latest = entries.filter((entry) => entry.status !== "deleted").slice(0, 5);
  const showTotals = !settings.privacy.hideHeaderTotal;
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
              <strong>{formatCurrency(entry.finalValue)}</strong>
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
  onChange,
  onToast
}: {
  entries: LedgerEntry[];
  onChange: () => Promise<void>;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("visiveis");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const haystack = `${entry.description} ${entry.tableNumber} ${entry.busNumber} ${entry.paymentMethod}`.toLowerCase();
      const sameType = type === "Todos" || entry.type === type;
      const sameStatus =
        statusFilter === "todos" ||
        (statusFilter === "visiveis" && entry.status !== "deleted") ||
        (statusFilter === "active" && entry.status === "active") ||
        (statusFilter === "cancelled" && entry.status === "cancelled") ||
        (statusFilter === "deleted" && entry.status === "deleted");
      const sameDate = !date || getLocalDateKey(entry.createdAt) === date;
      return sameType && sameStatus && sameDate && haystack.includes(query.toLowerCase());
    });
  }, [entries, query, type, statusFilter, date]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await onChange();
      onToast("success", success);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel concluir.");
    }
  };

  return (
    <section className="panel">
      <div className="filter-bar">
        <label className="field">
          <span>Buscar</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Descricao, mesa, onibus..." />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option>Todos</option>
            {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="visiveis">Visiveis</option>
            <option value="active">Ativos</option>
            <option value="cancelled">Cancelados</option>
            <option value="deleted">Lixeira</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="field">
          <span>Data</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
            {filtered.map((entry) => {
              const { time } = formatDateTime(entry.createdAt);
              return (
                <tr key={entry.id} className={entry.status !== "active" ? "muted-row" : ""}>
                  <td>{time}</td>
                  <td>{entry.customType || entry.type}</td>
                  <td>{entry.description}</td>
                  <td>{entry.tableNumber || "-"}</td>
                  <td>{entry.busNumber || "-"}</td>
                  <td>{entry.paymentMethod}</td>
                  <td>{formatCurrency(entry.finalValue)}</td>
                  <td><span className={`status-dot ${entry.status}`}>{statusLabel(entry.status)}</span></td>
                  <td>
                    <div className="row-actions">
                      <button title="Editar" onClick={() => setEditing(entry)}><Edit3 size={15} /></button>
                      <button title="Duplicar" onClick={() => run(() => window.caixa.duplicateEntry(entry.id), "Lancamento duplicado.")}><Copy size={15} /></button>
                      {entry.status === "deleted" ? (
                        <button title="Restaurar" onClick={() => run(() => window.caixa.updateEntry(entry.id, { status: "active" }), "Lancamento restaurado.")}><Undo2 size={15} /></button>
                      ) : (
                        <>
                          <button title="Cancelar" onClick={() => run(() => window.caixa.cancelEntry(entry.id), "Lancamento cancelado.")}><MinusCircle size={15} /></button>
                          <button title="Enviar para lixeira" onClick={() => window.confirm("Enviar este lancamento para a lixeira? Ele sai da planilha, mas ainda pode ser restaurado.") && run(() => window.caixa.removeEntry(entry.id), "Lancamento enviado para a lixeira.")}><Trash2 size={15} /></button>
                        </>
                      )}
                      <button title="Apagar definitivo" className="danger-icon" onClick={() => window.confirm("Apagar definitivamente? Isso remove do historico local e da proxima exportacao.") && run(() => window.caixa.deleteEntry(entry.id), "Lancamento apagado definitivamente.")}><X size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filtered.length && <p className="empty-text">Nada encontrado com esses filtros.</p>}

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
    </section>
  );
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

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <strong>Editar lancamento</strong>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="entry-grid">
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
            onClick={() =>
              onSave({
                type,
                description,
                finalValue: parseMoney(finalValue),
                tableNumber,
                busNumber,
                paymentMethod,
                observations
              })
            }
          >
            <Save size={18} />
            Salvar
          </button>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ReportsPanel({
  entries,
  settings,
  summary,
  exportStatus,
  onExport,
  onExportFiltered
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  summary: DaySummary;
  exportStatus: ExportStatus | null;
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
  const [showSensitive, setShowSensitive] = useState(!settings.privacy.hideReportTotals);

  useEffect(() => {
    setShowSensitive(!settings.privacy.hideReportTotals);
  }, [settings.privacy.hideReportTotals]);

  const periodEntries = entries.filter((entry) => {
    const date = getLocalDateKey(entry.createdAt);
    const haystack = `${entry.description} ${entry.tableNumber} ${entry.busNumber} ${entry.originDevice}`.toLowerCase();
    return (
      (!from || date >= from) &&
      (!to || date <= to) &&
      (type === "Todos" || entry.type === type) &&
      (payment === "Todos" || entry.paymentMethod === payment) &&
      (!table || entry.tableNumber === table) &&
      (!bus || entry.busNumber === bus) &&
      haystack.includes(query.toLowerCase())
    );
  });
  const periodSummary = summarizeEntries(periodEntries);
  const activeRows = periodEntries.filter((entry) => entry.status === "active");
  const cancelledCount = periodEntries.filter((entry) => entry.status === "cancelled").length;
  const deletedCount = periodEntries.filter((entry) => entry.status === "deleted").length;
  const dailyTotals = summarizeByDay(activeRows);
  const originTotals = summarizeByOrigin(activeRows);
  const peakDay = [...dailyTotals].sort((left, right) => right.total - left.total)[0];
  const topEntries = [...activeRows].sort((left, right) => getEntryAmount(right) - getEntryAmount(left)).slice(0, 5);
  const dailyAverage = dailyTotals.length ? roundMoney(periodSummary.total / dailyTotals.length) : 0;
  const cashShare = periodSummary.total ? Math.round((periodSummary.cashTotal / periodSummary.total) * 100) : 0;
  const busShare = periodSummary.total ? Math.round((periodSummary.busTotal / periodSummary.total) * 100) : 0;
  const tables = uniqueFilled(entries.map((entry) => entry.tableNumber));
  const buses = uniqueFilled(entries.map((entry) => entry.busNumber));
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
          <p className="muted-copy">Filtre por periodo, tipo, mesa, onibus, pagamento ou origem e exporte apenas o recorte que esta na tela.</p>
        </div>
        <div className="report-actions">
          <label className="switch-line">
            <input type="checkbox" checked={showSensitive} onChange={(event) => setShowSensitive(event.target.checked)} />
            Mostrar totais sensiveis
          </label>
          <button className="ghost-button" onClick={onExport}><FileSpreadsheet size={18} /> Planilha geral</button>
          <button className="primary-button" onClick={() => onExportFiltered(periodEntries.map((entry) => entry.id), exportLabel)}><Download size={18} /> Exportar filtrado</button>
        </div>
      </div>

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
          value={showSensitive ? formatCurrency(periodSummary.total) : "Restrito"}
          detail={`${activeRows.length} ativos em ${periodEntries.length} encontrados`}
        />
        <ReportCloseCard
          label="Dia mais forte"
          value={showSensitive ? (peakDay ? formatCurrency(peakDay.total) : formatCurrency(0)) : "Restrito"}
          detail={peakDay ? `${formatReportDate(peakDay.dateKey, true)} com ${peakDay.count} registro(s)` : "Sem lancamentos no recorte"}
        />
        <ReportCloseCard
          label="Media diaria"
          value={showSensitive ? formatCurrency(dailyAverage) : "Restrito"}
          detail={`${dailyTotals.length || 0} dia(s) com movimento`}
        />
        <ReportCloseCard
          label="Mix rapido"
          value={showSensitive ? `${cashShare}% dinheiro` : "Restrito"}
          detail={showSensitive ? `${busShare}% onibus | ${cancelledCount} cancelado(s)` : `${cancelledCount} cancelado(s)`}
        />
      </div>

      <div className="metric-grid">
        <Metric label="Total do periodo" value={showSensitive ? formatCurrency(periodSummary.total) : "Restrito"} />
        <Metric label="Quantidade" value={String(periodSummary.count)} />
        <Metric label="Media" value={showSensitive ? formatCurrency(periodSummary.average) : "Restrito"} />
        <Metric label="Maior venda" value={showSensitive ? formatCurrency(periodSummary.biggestSale) : "Restrito"} />
        <Metric label="Onibus" value={showSensitive ? formatCurrency(periodSummary.busTotal) : "Restrito"} />
        <Metric label="Dinheiro" value={showSensitive ? formatCurrency(periodSummary.cashTotal) : "Restrito"} />
        <Metric label="Sobras" value={showSensitive ? formatCurrency(periodSummary.differenceTotal) : "Restrito"} />
        <Metric label="Cancelados" value={String(cancelledCount)} />
        <Metric label="Lixeira" value={String(deletedCount)} />
        <Metric label="Arquivo" value={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente` : "OK"} />
      </div>

      {showSensitive ? (
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
        <DailyTrendCard rows={dailyTotals} showSensitive={showSensitive} />
        <TopEntriesCard entries={topEntries} showSensitive={showSensitive} />
        <ReportAlertsCard
          cancelledCount={cancelledCount}
          deletedCount={deletedCount}
          pendingCount={exportStatus?.pendingCount || 0}
          differenceTotal={periodSummary.differenceTotal}
          showSensitive={showSensitive}
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
                <small>{entry.customType || entry.type} | {entry.paymentMethod}</small>
                <b>{showSensitive ? formatCurrency(entry.finalValue) : "Restrito"}</b>
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
  const max = Math.max(...rows.map((row) => Math.abs(row.total)), 0);
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
              <span style={{ width: `${Math.max(3, Math.min(100, max ? (Math.abs(row.total) / max) * 100 : 0))}%` }} />
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
                <small>{date} {time} | {entry.customType || entry.type} | {entry.paymentMethod}</small>
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
  onSaveSettings,
  onServerChange,
  onToast
}: {
  settings: AppSettings;
  server: ServerState;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onServerChange: (server: ServerState) => void;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const [port, setPort] = useState(settings.server.port);
  const [password, setPassword] = useState(settings.server.password);
  const [permissions, setPermissions] = useState(settings.server.permissions);
  const [mode, setMode] = useState<ServerPanelMode>("create");
  const [connectHost, setConnectHost] = useState(server.url || "");
  const [connectPassword, setConnectPassword] = useState("");
  const [connectDeviceName, setConnectDeviceName] = useState("App cliente");
  const [remoteSession, setRemoteSession] = useState<RemoteClientSession | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState("");
  const remoteSocket = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      remoteSocket.current?.close();
      remoteSocket.current = null;
    };
  }, []);

  const start = async () => {
    try {
      const nextSettings = { ...settings, server: { ...settings.server, port, password, permissions } };
      await onSaveSettings(nextSettings);
      const next = await window.caixa.startServer(port, password);
      onServerChange(next);
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

  const remoteRequest = async <T,>(session: RemoteClientSession, path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${session.baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-caixa-password": session.password,
        "x-device-name": session.deviceName,
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

  const refreshRemote = async (session = remoteSession) => {
    if (!session) {
      return;
    }
    const data = await remoteRequest<RemoteEntriesResponse>(session, "/api/entries");
    setRemoteSession({
      ...session,
      entries: data.entries,
      summary: data.summary,
      permissions: data.permissions
    });
  };

  const connectRemote = async () => {
    setRemoteLoading(true);
    setRemoteMessage("");
    try {
      const baseUrl = normalizeRemoteBaseUrl(connectHost);
      const session: RemoteClientSession = {
        baseUrl,
        password: connectPassword,
        deviceName: connectDeviceName.trim() || "App cliente",
        entries: [],
        summary: null,
        permissions: { view: false, create: false, edit: false, delete: false, viewEntryValues: false, viewTotals: false },
        connectedAt: new Date().toISOString()
      };
      const data = await remoteRequest<RemoteEntriesResponse>(session, "/api/entries");
      const connectedSession = { ...session, entries: data.entries, summary: data.summary, permissions: data.permissions };
      setRemoteSession(connectedSession);
      remoteSocket.current?.close();
      const wsUrl = `${baseUrl.replace(/^http/i, "ws")}/sync?password=${encodeURIComponent(connectPassword)}&device=${encodeURIComponent(session.deviceName)}`;
      remoteSocket.current = new WebSocket(wsUrl);
      remoteSocket.current.onopen = () => setRemoteMessage("Tempo real ativo.");
      remoteSocket.current.onmessage = () => {
        void refreshRemote(connectedSession);
      };
      remoteSocket.current.onclose = () => setRemoteMessage("Conexao em tempo real fechada. Use Atualizar ou conecte novamente.");
      onToast("success", "Cliente conectado ao caixa principal.");
    } catch (error) {
      setRemoteMessage(error instanceof Error ? error.message : "Nao foi possivel conectar.");
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel conectar.");
    } finally {
      setRemoteLoading(false);
    }
  };

  const disconnectRemote = () => {
    remoteSocket.current?.close();
    remoteSocket.current = null;
    setRemoteSession(null);
    setRemoteMessage("");
    onToast("info", "Cliente remoto desconectado.");
  };

  const submitRemoteEntry = async (draft: EntryDraft) => {
    if (!remoteSession?.permissions.create) {
      onToast("error", "Este cliente nao tem permissao para registrar.");
      return;
    }
    await remoteRequest<{ entry: LedgerEntry }>(remoteSession, "/api/entries", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    await refreshRemote();
    onToast("success", "Lancamento enviado ao caixa principal.");
  };

  const editRemoteEntry = async (entry: LedgerEntry) => {
    if (!remoteSession?.permissions.edit) {
      return;
    }
    const description = window.prompt("Nova descricao", entry.description || "");
    if (description === null) {
      return;
    }
    const payload: Record<string, unknown> = { description };
    if (remoteSession.permissions.viewEntryValues) {
      const value = window.prompt("Novo valor", String(entry.finalValue || 0).replace(".", ","));
      if (value !== null) {
        payload.value = parseMoney(value);
      }
    }
    await remoteRequest<{ entry: LedgerEntry }>(remoteSession, `/api/entries/${entry.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await refreshRemote();
    onToast("success", "Lancamento remoto editado.");
  };

  const cancelRemoteEntry = async (entry: LedgerEntry) => {
    if (!remoteSession?.permissions.edit) {
      return;
    }
    await remoteRequest<{ entry: LedgerEntry }>(remoteSession, `/api/entries/${entry.id}/cancel`, { method: "POST" });
    await refreshRemote();
    onToast("info", "Lancamento remoto cancelado.");
  };

  const deleteRemoteEntry = async (entry: LedgerEntry, permanent = false) => {
    if (!remoteSession?.permissions.delete) {
      return;
    }
    if (!window.confirm(permanent ? "Apagar definitivamente no caixa principal?" : "Enviar para a lixeira no caixa principal?")) {
      return;
    }
    await remoteRequest<{ ok: boolean }>(remoteSession, `/api/entries/${entry.id}${permanent ? "?permanent=1" : ""}`, {
      method: "DELETE"
    });
    await refreshRemote();
    onToast(permanent ? "info" : "success", permanent ? "Lancamento remoto apagado." : "Lancamento remoto enviado para a lixeira.");
  };

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
        <button className={mode === "connect" ? "active" : ""} onClick={() => setMode("connect")}><PlugZap size={16} /> Conectar</button>
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
                  <input value={connectHost} onChange={(event) => setConnectHost(event.target.value)} placeholder="http://192.168.0.10:4317" />
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
              <div className="connection-steps">
                <span><Wifi size={16} /> 1. Abra o servidor no PC principal.</span>
                <span><KeyRound size={16} /> 2. Digite endereco, senha e o nome deste caixa.</span>
                <span><PlugZap size={16} /> 3. Clique em Conectar no app para operar como extensao do caixa principal.</span>
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
                  onClick={() => window.open(connectPassword ? `${normalizeRemoteBaseUrl(connectHost)}?password=${encodeURIComponent(connectPassword)}&device=${encodeURIComponent(connectDeviceName || "App cliente")}` : normalizeRemoteBaseUrl(connectHost))}
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
              onRefresh={() => refreshRemote()}
              onDisconnect={disconnectRemote}
              onSubmit={submitRemoteEntry}
              onEdit={editRemoteEntry}
              onCancel={cancelRemoteEntry}
              onDelete={deleteRemoteEntry}
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
            {(["view", "create", "edit", "delete", "viewEntryValues", "viewTotals"] as const).map((key) => (
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
  const permissionBadges = [
    session.permissions.view ? "Visualizar" : "",
    session.permissions.create ? "Registrar" : "",
    session.permissions.edit ? "Editar" : "",
    session.permissions.delete ? "Apagar" : "",
    session.permissions.viewEntryValues ? "Ver valores" : "Valores ocultos",
    session.permissions.viewTotals ? "Ver totais" : "Totais ocultos"
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

      {session.permissions.create ? (
        <QuickEntry
          entries={session.entries}
          settings={settings}
          pinned={false}
          modeCommand={null}
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
          <span>{visibleEntries.length} visiveis | {deletedEntries.length} na lixeira</span>
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

function normalizeRemoteBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Informe o endereco do servidor.");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function SettingsPanel({
  settings,
  onSave,
  onToast,
  onImportLedger,
  onImportLedgerFolder
}: {
  settings: AppSettings;
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

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (category === "advanced") {
      loadDiagnostics();
    }
  }, [category]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const chooseFolder = async () => {
    const folder = await window.caixa.chooseOutputDirectory();
    if (folder) {
      update("outputDirectory", folder);
    }
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

  const createProfile = () => {
    const name = newProfileName.trim();
    if (!name) {
      onToast("error", "Digite um nome para o novo perfil.");
      return;
    }
    if (draft.profiles[name] && !window.confirm(`O perfil ${name} ja existe. Atualizar com o estado atual?`)) {
      return;
    }
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

  const deleteProfile = (name: string) => {
    if (Object.keys(draft.profiles).length <= 1) {
      onToast("error", "Mantenha pelo menos um perfil.");
      return;
    }
    if (!window.confirm(`Apagar o perfil ${name}?`)) {
      return;
    }
    setDraft((current) => {
      const nextProfiles = { ...current.profiles };
      delete nextProfiles[name];
      const nextActive = current.activeProfile === name ? Object.keys(nextProfiles)[0] : current.activeProfile;
      return { ...current, profiles: nextProfiles, activeProfile: nextActive };
    });
    onToast("info", `Perfil ${name} removido do rascunho.`);
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
    if (!window.confirm("Restaurar este backup? O estado atual sera salvo antes da restauracao.")) {
      return;
    }
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
          layout: defaults.layout
        };
      }
      if (target === "floating") {
        return { ...current, floating: defaults.floating };
      }
      if (target === "quick") {
        return { ...current, quickTabs: defaults.quickTabs };
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
      if (target === "files") {
        return {
          ...current,
          fileFormat: defaults.fileFormat,
          fileStrategy: defaults.fileStrategy,
          spreadsheetMode: defaults.spreadsheetMode,
          dateFormat: defaults.dateFormat,
          csvSeparator: defaults.csvSeparator,
          visibleColumns: defaults.visibleColumns,
          backupEnabled: defaults.backupEnabled
        };
      }
      if (target === "server") {
        return { ...current, server: defaults.server };
      }
      if (target === "reports") {
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

  const saveDraft = async () => {
    const warnings = settingsChangeWarnings(settings, draft);
    if (
      warnings.length &&
      !window.confirm(`Essas configuracoes alteram ${warnings.join(", ")}. Deseja continuar e salvar?`)
    ) {
      onToast("info", "Salvamento cancelado. Revise o rascunho antes de aplicar.");
      return;
    }
    await onSave(draft);
  };

  const settingsCategories: Array<{ key: SettingsCategory; label: string; description: string; icon: typeof Settings }> = [
    { key: "appearance", label: "Aparencia", description: "Tema, cor, densidade e formato geral da interface.", icon: Palette },
    { key: "floating", label: "Barra fixada", description: "Comportamento da barra flutuante sempre visivel.", icon: Pin },
    { key: "quick", label: "Barra rapida", description: "Abas e modos que aparecem na barra fixada.", icon: SlidersHorizontal },
    { key: "defaults", label: "Vendas", description: "Tipo, pessoas e arredondamento usados por padrao.", icon: Send },
    { key: "profiles", label: "Perfis", description: "Perfis para alternar entre PC, notebook, tela pequena e barra fixada.", icon: MonitorUp },
    { key: "files", label: "Planilha e backup", description: "Pasta, formato, colunas, backups e organizacao dos arquivos.", icon: FileSpreadsheet },
    { key: "reports", label: "Relatorios", description: "Visibilidade de totais e comportamento de relatorios.", icon: BarChart3 },
    { key: "server", label: "Servidor", description: "Porta, senha e permissoes para outro dispositivo.", icon: RadioTower },
    { key: "shortcuts", label: "Atalhos", description: "Comandos de teclado para operar mais rapido.", icon: KeyRound },
    { key: "updates", label: "Atualizacoes", description: "Checagem de versoes publicadas no GitHub.", icon: Download },
    { key: "advanced", label: "Avancado", description: "Restauracao, backup e acoes administrativas.", icon: DatabaseBackup }
  ];
  const activeCategory = settingsCategories.find((item) => item.key === category) || settingsCategories[0];
  const filePreview = filePreviewForSettings(draft);

  const categoryClass = (target: SettingsCategory, extra = "") =>
    `${extra || "settings-group"} ${category === target ? "active-category" : "hidden-category"}`;

  return (
    <section className="panel settings-panel">
      <div className="settings-layout">
        <aside className="settings-nav">
          {settingsCategories.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={category === item.key ? "active" : ""} onClick={() => setCategory(item.key)}>
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </aside>

        <div className="settings-content">
          <div className="settings-hero">
            <div>
              <span className="settings-overline">Ajustes</span>
              <h2>{activeCategory.label}</h2>
              <p>{activeCategory.description}</p>
            </div>
            <div className="preset-row settings-presets" aria-label="Acoes da categoria">
              <button className="ghost-button" type="button" onClick={() => resetCategory(category)}><RotateCcw size={16} /> Restaurar categoria</button>
            </div>
          </div>

      <div className="settings-grid">
        <section className={categoryClass("appearance")}>
          <h3>Aparencia</h3>
          <label className="field"><span>Tema</span>
            <select
              value={draft.theme}
              onChange={(event) => {
                const theme = event.target.value as AppSettings["theme"];
                setDraft((current) => ({ ...current, theme, accentColor: themeDefaultAccent(theme) }));
              }}
            >
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
              <option value="auto">Automatico</option>
              <option value="contrast">Alto contraste</option>
              <option value="datacaixa">DataCaixa PDV</option>
              <option value="datacaixa-dark">DataCaixa PDV escuro</option>
              <option value="italia">Italia</option>
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
          <label className="field"><span>Densidade</span>
            <select value={draft.density} onChange={(event) => update("density", event.target.value as AppSettings["density"])}>
              <option value="compact">Compacta</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Confortavel</option>
            </select>
          </label>
          <label className="field"><span>Layout</span>
            <select value={draft.layout} onChange={(event) => update("layout", event.target.value as AppSettings["layout"])}>
              <option value="complete">Completo</option>
              <option value="compact">Compacto</option>
              <option value="pinnedBar">Barra fixada</option>
              <option value="grid">Grade</option>
              <option value="sidePanel">Painel lateral</option>
            </select>
          </label>
        </section>

        <section className={categoryClass("defaults")}>
          <h3>Padroes</h3>
          <label className="field"><span>Tipo padrao</span>
            <select value={draft.defaultType} onChange={(event) => update("defaultType", event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field"><span>Pessoas padrao</span><input type="number" min={1} value={draft.defaultPeople} onChange={(event) => update("defaultPeople", Number(event.target.value || 1))} /></label>
          <label className="field"><span>Arredondamento</span>
            <select value={draft.defaultRoundingStep} onChange={(event) => update("defaultRoundingStep", Number(event.target.value))}>
              {ROUNDING_STEPS.map((step) => <option value={step} key={step}>{formatCurrency(step)}</option>)}
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

        <section className={categoryClass("profiles", "settings-group wide")}>
          <h3>Perfis de configuracao</h3>
          <p className="settings-note">
            Perfis guardam tema, densidade, layout, barra fixada, abas rapidas, atalhos e padroes de venda.
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

        <section className={categoryClass("files", "settings-group wide")}>
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
            <button className="primary-button" type="button" onClick={onImportLedger}>
              <Upload size={18} />
              Importar Excel/CSV
            </button>
            <button className="ghost-button" type="button" onClick={onImportLedgerFolder}>
              <Upload size={18} />
              Importar pasta
            </button>
            <button className="ghost-button" type="button" onClick={openCurrentExport}>
              <ExternalLink size={18} />
              Gerar/abrir arquivo
            </button>
          </div>
          <label className="field path-field"><span>Pasta padrao</span><input value={draft.outputDirectory} onChange={(event) => update("outputDirectory", event.target.value)} /><button onClick={chooseFolder} type="button">Escolher</button></label>
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
          <label className="switch-line"><input type="checkbox" checked={draft.backupEnabled} onChange={(event) => update("backupEnabled", event.target.checked)} /> Criar backup automatico</label>
        </section>

        <section className={categoryClass("floating", "settings-group wide")}>
          <h3>Modo fixado</h3>
          <div className="floating-preset-grid">
            {FLOATING_PRESETS.map((preset) => {
              const active =
                draft.defaultType === preset.defaultType &&
                normalizeFloatingFields(draft.floating.visibleFields).join("|") === normalizeFloatingFields(preset.fields).join("|") &&
                draft.quickTabs.filter((tab) => tab.enabled).map((tab) => tab.id).join("|") ===
                  preset.quickTabs.filter((tab) => tab.enabled).map((tab) => tab.id).join("|");
              return (
                <button
                  key={preset.id}
                  className={`floating-preset-card ${active ? "active" : ""}`}
                  type="button"
                  onClick={() => applyFloatingPreset(preset)}
                >
                  <strong>{preset.title}</strong>
                  <span>{preset.description}</span>
                  <small>{normalizeFloatingFields(preset.fields).length} elementos na barra</small>
                </button>
              );
            })}
          </div>
          <label className="field"><span>Tema da barra</span>
            <select value={draft.floating.theme || "follow"} onChange={(event) => update("floating", { ...draft.floating, theme: event.target.value as AppSettings["floating"]["theme"] })}>
              <option value="follow">Seguir tema do app</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
              <option value="auto">Automatico</option>
              <option value="contrast">Alto contraste</option>
              <option value="datacaixa">DataCaixa PDV</option>
              <option value="datacaixa-dark">DataCaixa PDV escuro</option>
              <option value="italia">Italia</option>
            </select>
          </label>
          <label className="field">
            <span>Opacidade ({Math.round(draft.floating.opacity * 100)}%)</span>
            <input
              className="range-input"
              type="range"
              min={0.35}
              max={1}
              step={0.01}
              value={draft.floating.opacity}
              style={{ "--range-fill": `${Math.round(((draft.floating.opacity - 0.35) / 0.65) * 100)}%` } as React.CSSProperties}
              onChange={(event) => update("floating", { ...draft.floating, opacity: Number(event.target.value) })}
            />
          </label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.lockPosition} onChange={(event) => update("floating", { ...draft.floating, lockPosition: event.target.checked })} /> Travar posicao</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.borderless} onChange={(event) => update("floating", { ...draft.floating, borderless: event.target.checked })} /> Visual sem borda de janela</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.syncMoneyWithEntryType} onChange={(event) => update("floating", { ...draft.floating, syncMoneyWithEntryType: event.target.checked })} /> Manter Mesa ou Onibus ao trocar Conta/Dinheiro</label>
          <div className="floating-field-picker">
            <div className="section-title">
              <strong>Elementos da barra</strong>
              <span>Desmarque para deixar a barra mais limpa.</span>
            </div>
            {FLOATING_FIELD_OPTIONS.filter((field) => field.id !== "value").map((field) => (
              <label key={field.id} className="toggle-card">
                <input
                  type="checkbox"
                  checked={normalizeFloatingFields(draft.floating.visibleFields).includes(field.id)}
                  onChange={() => toggleFloatingField(field.id)}
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>{field.helper}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="settings-note">
            A barra fixada abre em uma janela separada, sem moldura, com Tipo, Valor, Pessoas ou Pago com,
            Descricao, Troco e Enviar. Quando a sincronizacao esta ligada, Conta Onibus vira Dinheiro/Onibus e volta para Onibus.
          </p>
        </section>

        <section className={categoryClass("quick", "settings-group wide")}>
          <h3>Barra rapida</h3>
          <p className="settings-note">
            Escolha quais abas aparecem na barra fixada e o que cada uma faz. A ordem daqui e a mesma ordem da barra.
          </p>
          <div className="quick-tab-editor">
            {draft.quickTabs.map((tab, index) => (
              <article key={tab.id} className={`quick-tab-row ${tab.enabled ? "enabled" : ""} ${tab.type === "Dinheiro/Troco" ? "has-money-link" : ""}`}>
                <label className="switch-line quick-switch">
                  <input
                    type="checkbox"
                    checked={tab.enabled}
                    onChange={(event) => updateQuickTab(tab.id, { enabled: event.target.checked })}
                  />
                  Ativa
                </label>
                <label className="field">
                  <span>Nome da aba</span>
                  <input value={tab.label} onChange={(event) => updateQuickTab(tab.id, { label: event.target.value })} />
                </label>
                <label className="field">
                  <span>Modo ao clicar</span>
                  <select
                    value={tab.type}
                    onChange={(event) => updateQuickTab(tab.id, { type: event.target.value as EntryType })}
                  >
                    {ENTRY_TYPES.filter((item) => item !== "Cancelado/Estorno").map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                {tab.type === "Dinheiro/Troco" && (
                  <label className="field">
                    <span>Dinheiro vincula com</span>
                    <select
                      value={tab.cashLinkedType || "Mesa"}
                      onChange={(event) => updateQuickTab(tab.id, { cashLinkedType: event.target.value as EntryType })}
                    >
                      {CASH_LINKED_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="switch-line quick-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(tab.compact)}
                    onChange={(event) => updateQuickTab(tab.id, { compact: event.target.checked })}
                  />
                  Compacta
                </label>
                <div className="quick-order">
                  <button type="button" disabled={index === 0} onClick={() => moveQuickTab(tab.id, -1)} title="Subir">
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" disabled={index === draft.quickTabs.length - 1} onClick={() => moveQuickTab(tab.id, 1)} title="Descer">
                    <ArrowDown size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={categoryClass("reports", "settings-group wide")}>
          <h3>Privacidade e relatorios</h3>
          <label className="switch-line">
            <input
              type="checkbox"
              checked={draft.privacy.hideHeaderTotal}
              onChange={(event) => update("privacy", { ...draft.privacy, hideHeaderTotal: event.target.checked })}
            />
            Ocultar total no topo e no painel do caixa
          </label>
          <label className="switch-line">
            <input
              type="checkbox"
              checked={draft.privacy.hideReportTotals}
              onChange={(event) => update("privacy", { ...draft.privacy, hideReportTotals: event.target.checked })}
            />
            Abrir relatorios locais com totais ocultos
          </label>
          <p className="settings-note">Isso esconde totais gerais na interface local, mas nao apaga valores dos lancamentos nem muda a planilha.</p>
        </section>

        <section className={categoryClass("server", "settings-group wide")}>
          <h3>Servidor e sincronizacao</h3>
          <label className="field"><span>Porta padrao</span><input type="number" value={draft.server.port} onChange={(event) => update("server", { ...draft.server, port: Number(event.target.value || 4317) })} /></label>
          <label className="field"><span>Senha salva</span><input type="password" value={draft.server.password} onChange={(event) => update("server", { ...draft.server, password: event.target.value })} placeholder="Opcional, pode definir ao abrir" /></label>
          <div className="permission-box permission-grid">
            {(["view", "create", "edit", "delete", "viewEntryValues", "viewTotals"] as const).map((key) => (
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
          <h3>Atalhos</h3>
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
          <h3>Atualizacoes</h3>
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

        <section className={categoryClass("advanced", "settings-group wide")}>
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
              <small>Backups do historico interno</small>
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
              <span>Salva historico e configuracoes em um JSON proprio do app. Antes de restaurar, o estado atual tambem recebe um backup de seguranca.</span>
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
            <button className="ghost-button" type="button" onClick={() => {
              setDraft(createSettingsFallback(draft));
              onToast("info", "Configuracoes restauradas. Salve para aplicar.");
            }}>
              <RotateCcw size={16} /> Restaurar tudo
            </button>
          </div>
        </section>

        <section className={categoryClass("files", "settings-group wide")}>
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
      </div>
        </div>
      </div>

      <div className="submit-row sticky-save">
        <button className="primary-button" onClick={saveDraft}><Save size={18} /> Salvar configuracoes</button>
        <button className="ghost-button" onClick={() => {
          setDraft(settings);
          onToast("info", "Alteracoes descartadas.");
        }}>Descartar</button>
      </div>
    </section>
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
    register: "Registro rapido",
    history: "Historico editavel",
    reports: "Relatorios",
    server: "Servidor local",
    settings: "Configuracoes"
  };
  return map[tab];
}

function headerForTab(tab: TabKey, todayCount: number): { eyebrow: string; title: string; status: string; detail: string } {
  const map: Record<TabKey, { eyebrow: string; title: string; status: string; detail: string }> = {
    register: {
      eyebrow: "Operacao diaria",
      title: titleForTab(tab),
      status: todayCount ? "Caixa em movimento" : "Pronto para lancar",
      detail: "Fluxo rapido"
    },
    history: {
      eyebrow: "Consulta e auditoria",
      title: titleForTab(tab),
      status: "Edite, duplique ou restaure registros",
      detail: "Historico"
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
    pin: "Fixar/desfixar",
    history: "Abrir historico",
    settings: "Abrir ajustes",
    repeatLast: "Repetir ultimo",
    escape: "Limpar/fechar"
  };
  return labels[key] || key;
}

function permissionLabel(key: "view" | "create" | "edit" | "delete" | "viewEntryValues" | "viewTotals"): string {
  return {
    view: "Somente visualizar",
    create: "Registrar vendas",
    edit: "Editar lancamentos",
    delete: "Apagar lancamentos",
    viewEntryValues: "Ver valores das vendas",
    viewTotals: "Ver totais vendidos"
  }[key];
}
