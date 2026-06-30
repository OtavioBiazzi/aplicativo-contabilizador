import type { AppSettings, EntryType, PaymentMethod, QuickTabSettings } from "./types.js";

export const ENTRY_TYPES: EntryType[] = [
  "Venda",
  "Mesa",
  "Onibus",
  "Dinheiro/Troco",
  "Divisao de conta",
  "Taxa",
  "Extra",
  "Cancelado/Estorno",
  "Personalizado"
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  "Nao informado",
  "Dinheiro",
  "Pix",
  "Debito",
  "Credito",
  "Voucher",
  "Misto"
];

export const DEFAULT_COLUMNS = [
  "Data",
  "Hora",
  "Tipo",
  "Valor pago",
  "Valor original",
  "Valor final",
  "Pessoas",
  "Valor por pessoa",
  "Arredondamento",
  "Sobra/diferenca",
  "Descricao",
  "Mesa",
  "Onibus",
  "Forma de pagamento",
  "Pago com",
  "Troco",
  "Observacoes",
  "Dispositivo/origem",
  "ID do lancamento",
  "Status"
];

export const SIMPLE_COLUMNS = ["Data", "Hora", "Valor pago", "Descricao", "Tipo", "Pessoas", "Pago com", "Troco"];

export const DEFAULT_FLOATING_FIELDS = [
  "tabs",
  "mode",
  "type",
  "value",
  "people",
  "detail",
  "description",
  "paidWith",
  "result",
  "submit"
];

export const DEFAULT_QUICK_TABS: QuickTabSettings[] = [
  { id: "account", label: "Conta", enabled: true, type: "Venda" },
  { id: "money", label: "Dinheiro", enabled: true, type: "Dinheiro/Troco", cashLinkedType: "Mesa" },
  { id: "table", label: "Mesa", enabled: true, type: "Mesa" },
  { id: "bus", label: "Onibus", enabled: true, type: "Onibus" },
  { id: "minimal", label: "Minimo", enabled: false, type: "Venda", compact: true },
  { id: "custom", label: "Extra", enabled: false, type: "Personalizado" }
];

export function createDefaultSettings(outputDirectory: string): AppSettings {
  return {
    outputDirectory,
    fileFormat: "xlsx",
    fileStrategy: "daily",
    spreadsheetMode: "simple",
    dateFormat: "yyyy-MM-dd",
    csvSeparator: ";",
    currency: "BRL",
    visibleColumns: SIMPLE_COLUMNS,
    backupEnabled: true,
    defaultType: "Venda",
    defaultPeople: 1,
    defaultRoundingStep: 0.25,
    defaultRoundingDirection: "up",
    theme: "light",
    accentColor: "#0565b7",
    fieldSize: "medium",
    density: "normal",
    layout: "complete",
    activeProfile: "Perfil PC",
    profiles: {
      "Perfil PC": {},
      "Perfil Notebook": { density: "compact", layout: "compact" },
      "Perfil tela pequena": { density: "compact", fieldSize: "small", layout: "sidePanel" },
      "Perfil fixado": { layout: "pinnedBar", density: "compact" }
    },
    quickTabs: DEFAULT_QUICK_TABS,
    floating: {
      visibleFields: DEFAULT_FLOATING_FIELDS,
      opacity: 1,
      borderless: false,
      lockPosition: false,
      theme: "follow",
      syncMoneyWithEntryType: true
    },
    server: {
      port: 4317,
      password: "",
      permissions: {
        view: true,
        create: true,
        edit: false,
        delete: false,
        viewTotals: true
      }
    },
    shortcuts: {
      submit: "Enter",
      submitAndClear: "Ctrl+Enter",
      money: "Ctrl+D",
      table: "Ctrl+M",
      bus: "Ctrl+O",
      pin: "Ctrl+F",
      history: "Ctrl+H",
      settings: "Ctrl+,",
      repeatLast: "Ctrl+R",
      escape: "Esc"
    }
  };
}
