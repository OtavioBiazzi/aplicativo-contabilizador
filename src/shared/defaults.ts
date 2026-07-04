import type { AppSettings, EntryType, PaymentMethod, QuickTabSettings } from "./types.js";

// Lista de tipos de lançamento disponíveis
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

// Lista de formas de pagamento suportadas
export const PAYMENT_METHODS: PaymentMethod[] = [
  "Nao informado",
  "Dinheiro",
  "Pix",
  "Debito",
  "Credito",
  "Voucher",
  "Misto"
];

// Colunas padrão para planilhas completas
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

// Colunas padrão para planilhas simples. Inclui a forma de pagamento para
// permitir distinguir entre débito e crédito nas exportações.
export const SIMPLE_COLUMNS = [
  "Data",
  "Hora",
  "Valor pago",
  "Descricao",
  "Tipo",
  "Pessoas",
  "Forma de pagamento",
  "Pago com",
  "Troco"
];

export const DEFAULT_FLOATING_FIELDS = [
  "tabs",
  "mode",
  "type",
  "value",
  "people",
  "tableNumber",
  "busNumber",
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

/**
 * Gera as configurações padrão do aplicativo.
 * Adiciona a coluna "Forma de pagamento" às planilhas simples, inclui a
 * permissão allowReports para controlar geração de relatórios e adiciona
 * um campo savedPosition em floating para permitir salvar a posição da barra.
 */
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
    tableNumberEnabled: true,
    busNumberEnabled: true,
    theme: "datacaixa",
    accentColor: "#0565b7",
    fieldSize: "medium",
    density: "normal",
    layout: "complete",
    activeProfile: "Perfil PC",
    profiles: {
      "Perfil PC": { theme: "datacaixa", fieldSize: "medium", density: "normal", layout: "complete" },
      "Perfil Notebook": { theme: "datacaixa", density: "compact", fieldSize: "small", layout: "compact" },
      "Perfil tela pequena": {
        theme: "datacaixa",
        density: "compact",
        fieldSize: "small",
        layout: "compact",
        floating: {
          visibleFields: ["mode", "value", "tableNumber", "busNumber", "paidWith", "submit"],
          layoutMode: "mini",
          opacity: 1,
          borderless: true,
          lockPosition: false,
          dragWholeBar: true,
          theme: "follow",
          syncMoneyWithEntryType: true,
          savedPosition: undefined
        }
      },
      "Perfil fixado": {
        layout: "pinnedBar",
        density: "compact",
        fieldSize: "small",
        floating: {
          visibleFields: ["mode", "value", "people", "tableNumber", "busNumber", "paidWith", "result", "submit"],
          layoutMode: "compact",
          opacity: 1,
          borderless: true,
          lockPosition: false,
          dragWholeBar: false,
          theme: "follow",
          syncMoneyWithEntryType: true,
          savedPosition: undefined
        }
      }
    },
    privacy: {
      hideHeaderTotal: false,
      hideReportTotals: false
    },
    quickTabs: DEFAULT_QUICK_TABS,
    floating: {
      visibleFields: DEFAULT_FLOATING_FIELDS,
      layoutMode: "adaptive",
      opacity: 1,
      borderless: true,
      lockPosition: false,
      dragWholeBar: false,
      theme: "follow",
      syncMoneyWithEntryType: true,
      savedPosition: undefined
    },
    server: {
      port: 4317,
      password: "",
      autoConnection: {
        mode: "none",
        host: "",
        password: "",
        deviceName: "App cliente"
      },
      permissions: {
        view: true,
        create: true,
        edit: false,
        delete: false,
        viewEntryValues: true,
        viewTotals: true,
        allowClientCustomization: false,
        allowReports: true
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