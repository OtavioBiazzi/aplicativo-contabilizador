import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  Banknote,
  Check,
  ClipboardList,
  ContactRound,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  Minus,
  Plus,
  ReceiptText,
  Pencil,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Utensils,
  X
} from "lucide-react";
import type { PdvCartItem, PdvCategory, PdvCategoryDraft, PdvCustomer, PdvCustomerDraft, PdvExportFilters, PdvOpenTable, PdvPayment, PdvPaymentMethod, PdvProduct, PdvProductDraft, PdvProductImportPreview, PdvProductImportResult, PdvReceivable, PdvReceivablePatch, PdvReceivablePayment, PdvSale, PdvSettings, PdvSnapshot, PdvTableStatus, PdvTransferSelection } from "./shared/pdvTypes";
import type { RoundDirection } from "./shared/types";
import { calculateSplit } from "./shared/calculations";
import { readReceiptPrintDestination, saveReceiptPrintDestination, type ReceiptPrintTarget } from "./shared/receiptPrintPreference";

type PdvTab = "sale" | "tables" | "products" | "history" | "reports" | "advanced";
export type PdvAdvancedSection = "tables" | "appearance" | "operation" | "printing" | "data";
type PdvRemoteSession = { baseUrl: string; password: string; deviceName: string; appVersion: string; connectedAt?: string; roundingStep?: number; roundingDirection?: RoundDirection; allowPrint?: boolean; allowEdit?: boolean; snapshot?: PdvSnapshot | null; permissions?: { allowClientCustomization: boolean } };
type PendingRemoteTable = { tableNumber: number; people: number; note: string; items: PdvCartItem[]; subtables?: string[]; updatedAt: string };
type PdvClientVisualSettings = Pick<PdvSettings, "gridColumns" | "categoryColumns" | "tableColumns" | "productCardHeight" | "productFontSize" | "categoryCardHeight" | "tableCardHeight">;
type PdvOperationId = ReturnType<typeof crypto.randomUUID>;
type TableCloseScope =
  | { kind: "all" }
  | { kind: "main" }
  | { kind: "subtable"; subtableName: string };
type CheckoutTarget =
  | { kind: "direct"; total: number; items?: PdvCartItem[]; manual?: boolean; saleType?: PdvSale["type"]; operationId?: PdvOperationId }
  | { kind: "table"; table: PdvOpenTable; total: number; discount: number; initialPayments?: PdvPayment[]; operationId: PdvOperationId }
  | { kind: "table-scope"; table: PdvOpenTable; scope: Exclude<TableCloseScope, { kind: "all" }>; total: number; discount: number; initialPayments?: PdvPayment[]; items: PdvCartItem[]; operationId: PdvOperationId }
  | { kind: "table-partial-items"; table: PdvOpenTable; total: number; items: PdvCartItem[]; operationId: PdvOperationId }
  | { kind: "table-subtable"; table: PdvOpenTable; subtableName: string; total: number; items: PdvCartItem[]; operationId: PdvOperationId }
  | { kind: "table-partial-manual"; table: PdvOpenTable; total: number; items: PdvCartItem[]; operationId: PdvOperationId };

const PAYMENT_METHODS: PdvPaymentMethod[] = ["Dinheiro", "Debito", "Credito", "Pix", "Outros", "Nao definido", "Conta a receber"];
const CHECKOUT_PAYMENT_METHODS: PdvPaymentMethod[] = ["Dinheiro", "Debito", "Credito", "Pix", "Outros", "Conta a receber"];
const CLIENT_VISUAL_SETTINGS_KEY = "caixa.pdv.client-visual-settings";
const LAST_SUBTABLE_STORAGE_PREFIX = "caixa.pdv.last-subtable.";
const QUICK_VALUE_MODE_STORAGE_KEY = "caixa.pdv.quick-value-mode";
type PendingProduct = { product: PdvProduct; quantity: number; measureLabel?: string; unitPrice?: number; finalTotal?: number };
type PendingMeasureProduct = { product: PdvProduct; direct: boolean };

function preferredSubtable(tableNumber: number, names: string[], enabled: boolean): string {
  if (!enabled) {
    return "";
  }
  const saved = window.localStorage.getItem(`${LAST_SUBTABLE_STORAGE_PREFIX}${tableNumber}`) || "";
  return names.includes(saved) ? saved : "";
}

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function readClientVisualSettings(): Partial<PdvClientVisualSettings> {
  try {
    const value = JSON.parse(window.localStorage.getItem(CLIENT_VISUAL_SETTINGS_KEY) || "{}") as Partial<PdvClientVisualSettings>;
    const fields: Array<keyof PdvClientVisualSettings> = ["gridColumns", "categoryColumns", "tableColumns", "productCardHeight", "productFontSize", "categoryCardHeight", "tableCardHeight"];
    return fields.reduce<Partial<PdvClientVisualSettings>>((current, field) => {
      const numeric = Number(value[field]);
      if (Number.isFinite(numeric) && numeric > 0) current[field] = Math.round(numeric);
      return current;
    }, {});
  } catch {
    return {};
  }
}

function samePdvValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shortTime(value: string | null): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTableSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function tableSearchDetails(table: PdvOpenTable, rawQuery: string): { matches: boolean; subtables: string[] } {
  const query = normalizeTableSearch(rawQuery);
  if (!query) {
    return { matches: true, subtables: [] };
  }

  const tableNumberQuery = query.replace(/^mesa\s*/, "").trim();
  const matchesNumber = /^\d+$/.test(tableNumberQuery) && Number(tableNumberQuery) === table.number;
  const subtableNames = [...new Set([
    ...(table.subtables || []),
    ...table.items.map((item) => item.subtableName || "").filter(Boolean)
  ])];
  const matchingSubtables = subtableNames.filter((name) => normalizeTableSearch(name).includes(query));

  return {
    matches: matchesNumber || matchingSubtables.length > 0,
    subtables: matchingSubtables
  };
}

function temporarySubtableName(existingNames: string[]): string {
  const normalized = new Set(existingNames.map((name) => normalizeTableSearch(name)));
  let index = 1;
  while (normalized.has(normalizeTableSearch(`Temporaria ${index}`))) {
    index += 1;
  }
  return `Temporaria ${index}`;
}

function reportPeriodRange(period: "today" | "yesterday" | "week" | "month"): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (period === "yesterday") {
    start.setDate(now.getDate() - 1);
    end.setDate(now.getDate() - 1);
  }
  if (period === "week") {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(now.getDate() - diff);
  }
  if (period === "month") {
    start.setDate(1);
  }
  return { from: localDateInputValue(start), to: localDateInputValue(end) };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function formatQuantity(value: number): string {
  return roundQuantity(Number(value) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
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

function unpaidQuantity(item: PdvCartItem): number {
  const remaining = Math.max(0, item.quantity - Math.min(item.quantity, Math.max(0, item.paidQuantity || 0)));
  return isMeasuredCartItem(item) ? roundQuantity(remaining) : roundMoney(remaining);
}

function unpaidItemTotal(item: PdvCartItem): number {
  if (!item.quantity) return 0;
  const paid = Math.min(item.quantity, Math.max(0, item.paidQuantity || 0));
  if (paid <= 0.000001) return roundMoney(item.total);
  const remaining = unpaidQuantity(item);
  if (remaining <= 0.000001) return 0;
  return roundMoney(item.total * (remaining / item.quantity));
}

function pendingRemoteTableKey(baseUrl: string): string {
  return `contabilizador-pdv-pending-tables:${baseUrl}`;
}

function readPendingRemoteTables(baseUrl: string): PendingRemoteTable[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingRemoteTableKey(baseUrl)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingRemoteTables(baseUrl: string, tables: PendingRemoteTable[]) {
  if (tables.length) {
    localStorage.setItem(pendingRemoteTableKey(baseUrl), JSON.stringify(tables));
  } else {
    localStorage.removeItem(pendingRemoteTableKey(baseUrl));
  }
}

function createCartItem(product: PdvProduct, quantity: number, complements: PdvCartItem["complements"] = [], customUnitPrice?: number, subtableName = "", measureLabel = "", customTotal?: number): PdvCartItem {
  const safeQuantity = Math.max(0.001, roundQuantity(quantity || 1));
  const complementTotal = roundMoney((complements || []).reduce((total, item) => total + item.price, 0));
  const unitPrice = roundMoney((customUnitPrice ?? product.price) + complementTotal);
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    productName: complements?.length ? `${product.name} + ${complements.map((item) => item.name).join(" + ")}` : product.name,
    categoryName: product.categoryName,
    quantity: safeQuantity,
    measureLabel,
    unitPrice,
    baseUnitPrice: customUnitPrice ?? product.price,
    discount: 0,
    total: customTotal === undefined
      ? roundMoney(unitPrice * safeQuantity)
      : roundMoney(Math.max(0, customTotal + complementTotal * safeQuantity)),
    subtableName,
    complements
  };
}

function complementsForProduct(product: PdvProduct, products: PdvProduct[]): PdvProduct[] {
  return products
    .filter((item) => product.complementProductIds?.includes(item.id))
    .filter((item) => item.id !== product.id && item.active && item.canBeComplement)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "pt-BR"));
}

async function remotePdvRequest<T>(session: PdvRemoteSession, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-caixa-password": session.password,
      "x-device-name": session.deviceName,
      "x-caixa-version": session.appVersion,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${data?.error || "Nao foi possivel sincronizar com o servidor."} (HTTP ${response.status})`);
  }
  return data as T;
}

function useModalConfirmShortcut(onConfirm: () => void, onCancel: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector(".pdv-nested-backdrop")) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && !event.repeat) {
        if (event.target instanceof HTMLTextAreaElement) {
          return;
        }
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onConfirm, enabled]);
}

function itemsForCloseScope(items: PdvCartItem[], scope: TableCloseScope): PdvCartItem[] {
  return items
    .filter((item) =>
      scope.kind === "all"
      || (scope.kind === "main" && !item.subtableName)
      || (scope.kind === "subtable" && (item.subtableName || "") === scope.subtableName)
    )
    .flatMap((item) => {
      const quantity = unpaidQuantity(item);
      if (quantity <= 0.009) return [];
      const ratio = item.quantity > 0 ? quantity / item.quantity : 1;
      return [{
        ...item,
        quantity,
        paidQuantity: 0,
        discount: roundMoney(item.discount * ratio),
        total: unpaidItemTotal(item)
      }];
    });
}

export interface PdvAdvancedSettingsActions {
  save: () => Promise<void>;
  discard: () => void;
}

export function PdvApp({
  embedded = false,
  initialTab = "sale",
  hideTopbar = false,
  remoteSession = null,
  reloadToken = 0,
  roundingStep = 0.01,
  roundingDirection = "nearest",
  toastDuration = 3200,
  initialHistoryView = "sales",
  hideHistoryNavigation = false,
  advancedSection,
  hideAdvancedNavigation = false,
  onDirectCartChange,
  snapshotOverride,
  receiptPrintTargets = [],
  onRemoteReceiptPrint,
  onNavigateMain,
  advancedSettingsActionsRef,
  onAdvancedSettingsDirtyChange
}: {
  embedded?: boolean;
  initialTab?: PdvTab;
  hideTopbar?: boolean;
  remoteSession?: PdvRemoteSession | null;
  reloadToken?: number;
  roundingStep?: number;
  roundingDirection?: RoundDirection;
  toastDuration?: number;
  initialHistoryView?: HistoryView;
  hideHistoryNavigation?: boolean;
  advancedSection?: PdvAdvancedSection;
  hideAdvancedNavigation?: boolean;
  onDirectCartChange?: (hasItems: boolean) => void;
  snapshotOverride?: PdvSnapshot | null;
  receiptPrintTargets?: Array<{ id: string; label: string }>;
  onRemoteReceiptPrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onNavigateMain?: (tab: "history" | "reports") => void;
  advancedSettingsActionsRef?: React.MutableRefObject<PdvAdvancedSettingsActions | null>;
  onAdvancedSettingsDirtyChange?: (dirty: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<PdvSnapshot | null>(null);
  const [tab, setTab] = useState<PdvTab>(initialTab);
  const [activeCategory, setActiveCategory] = useState("todos");
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<PdvCartItem[]>([]);
  const [directSaleMode, setDirectSaleMode] = useState<"Venda direta" | "Onibus">("Venda direta");
  const [selectedDirectItemIds, setSelectedDirectItemIds] = useState<string[]>([]);
  const [discount, setDiscount] = useState(0);
  const [tableFilter, setTableFilter] = useState<PdvTableStatus | "Todas">("Todas");
  const [tableSearch, setTableSearch] = useState("");
  const [activeTable, setActiveTable] = useState<PdvOpenTable | null>(null);
  const [tableCart, setTableCart] = useState<PdvCartItem[]>([]);
  const [tablePeople, setTablePeople] = useState(1);
  const [tableNote, setTableNote] = useState("");
  const [subtableNames, setSubtableNames] = useState<string[]>([]);
  const [selectedTableItemIds, setSelectedTableItemIds] = useState<string[]>([]);
  const [partialSelectedItemIds, setPartialSelectedItemIds] = useState<string[]>([]);
  const [partialManualValue, setPartialManualValue] = useState("");
  const [currentSubtable, setCurrentSubtable] = useState("");
  const [pendingProduct, setPendingProduct] = useState<PendingProduct | null>(null);
  const [pendingMeasureProduct, setPendingMeasureProduct] = useState<PendingMeasureProduct | null>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; table: PdvOpenTable } | null>(null);
  const [toast, setToast] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<{ sale: PdvSale; receivable?: PdvReceivable } | null>(null);
  const [tableCloseMenuOpen, setTableCloseMenuOpen] = useState(false);
  const [tableCloseScope, setTableCloseScope] = useState<TableCloseScope>({ kind: "all" });
  const [partialItemsModalOpen, setPartialItemsModalOpen] = useState(false);
  const [partialValueModalOpen, setPartialValueModalOpen] = useState(false);
  const [quickValueModalOpen, setQuickValueModalOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [correctingPartialPayment, setCorrectingPartialPayment] = useState<{ sale: PdvSale; payment: PdvPayment } | null>(null);
  const [tableSaveState, setTableSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [clientVisualSettings, setClientVisualSettings] = useState<Partial<PdvClientVisualSettings>>(readClientVisualSettings);
  const tableAutosaveTimer = useRef<number | null>(null);
  // Todas as gravacoes da mesa passam por esta fila. Sem isso, uma resposta antiga
  // podia terminar depois da mais nova e repor no banco uma versao desatualizada.
  const tableSaveChain = useRef<Promise<void>>(Promise.resolve());
  const tableSaveRevision = useRef(0);
  const tableMutationRevision = useRef(0);
  const persistedTableMutationRevision = useRef(0);
  const snapshotLoadInFlight = useRef<Promise<PdvSnapshot> | null>(null);
  const snapshotLoadQueued = useRef(false);
  const lastPersistedTableMeta = useRef<{ number: number; people: number; note: string } | null>(null);
  const isRemoteClient = Boolean(remoteSession);
  const canConfigureServer = !isRemoteClient || Boolean(remoteSession?.permissions?.allowClientCustomization);
  const remoteTablesActive = Boolean(remoteSession && tab === "tables");
  // O cliente usa o mesmo catalogo e as mesmas mesas do servidor em todas as abas do PDV.
  // A venda direta continua sendo finalizada localmente, mas nunca pode ficar sem produtos por ler um catalogo local vazio.
  const remotePdvActive = Boolean(remoteSession);

  const getPdvSnapshot = () => remotePdvActive && remoteSession
    ? remotePdvRequest<PdvSnapshot>(remoteSession, "/api/pdv/snapshot")
    : window.caixa.getPdvSnapshot();
  const openPdvTable = (tableNumber: number, people?: number, note?: string) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/open`, { method: "POST", body: JSON.stringify({ people, note }) }).then(() => undefined)
    : window.caixa.openPdvTable(tableNumber, people, note);
  const ensureTableMeta = async (tableNumber: number, people: number, note: string) => {
    const normalized = { number: tableNumber, people: Math.max(1, Math.floor(people || 1)), note: note || "" };
    const previous = lastPersistedTableMeta.current;
    if (previous && previous.number === normalized.number && previous.people === normalized.people && previous.note === normalized.note) {
      return;
    }
    await openPdvTable(normalized.number, normalized.people, normalized.note);
    lastPersistedTableMeta.current = normalized;
  };
  const setPdvTableStatus = (tableNumber: number, status: PdvTableStatus) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/status`, { method: "PATCH", body: JSON.stringify({ status }) }).then(() => undefined)
    : window.caixa.setPdvTableStatus(tableNumber, status);
  const savePdvTableItems = async (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => {
    if (!remoteTablesActive || !remoteSession) {
      await window.caixa.savePdvTableItems(tableNumber, items, subtables);
      return;
    }
    try {
      await remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/items`, {
        method: "PUT",
        body: JSON.stringify({ items, subtables })
      });
      clearQueuedRemoteTable(tableNumber);
    } catch (error) {
      const current = snapshot?.tables.find((table) => table.number === tableNumber);
      queueRemoteTable(tableNumber, current?.people || 1, current?.note || "", items, subtables);
      throw error;
    }
  };
  const transferPdvTableItems = async (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => {
    // A transferencia deve partir da ultima versao visivel, inclusive quando o
    // autosave ainda nao teve tempo de enviar o produto recem-adicionado.
    if (activeTable?.number === sourceTableNumber && tableMutationRevision.current !== persistedTableMutationRevision.current) {
      await ensureTableMeta(sourceTableNumber, tablePeople, tableNote);
      await savePdvTableItems(sourceTableNumber, tableCart, subtableNames);
      persistedTableMutationRevision.current = tableMutationRevision.current;
    }
    return remoteTablesActive && remoteSession
      ? remotePdvRequest<{ ok: boolean; items: PdvCartItem[] }>(remoteSession, `/api/pdv/tables/${sourceTableNumber}/transfer`, { method: "POST", body: JSON.stringify({ targetTableNumber, selections }) }).then((result) => result.items)
      : window.caixa.transferPdvTableItems(sourceTableNumber, targetTableNumber, selections);
  };
  const queueRemoteTable = (tableNumber: number, people: number, note: string, items: PdvCartItem[], subtables?: string[]) => {
    if (!remoteSession) {
      return;
    }
    const queued = readPendingRemoteTables(remoteSession.baseUrl).filter((item) => item.tableNumber !== tableNumber);
    queued.push({ tableNumber, people: Math.max(1, Math.floor(people || 1)), note: note || "", items, subtables, updatedAt: new Date().toISOString() });
    writePendingRemoteTables(remoteSession.baseUrl, queued);
  };
  const clearQueuedRemoteTable = (tableNumber: number) => {
    if (!remoteSession) {
      return;
    }
    writePendingRemoteTables(remoteSession.baseUrl, readPendingRemoteTables(remoteSession.baseUrl).filter((item) => item.tableNumber !== tableNumber));
  };
  const saveClientVisualSettings = (patch: Partial<PdvClientVisualSettings>) => {
    setClientVisualSettings((current) => {
      const next = { ...current, ...patch };
      window.localStorage.setItem(CLIENT_VISUAL_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetTableMutationTracking = () => {
    tableMutationRevision.current = 0;
    persistedTableMutationRevision.current = 0;
  };
  const markTableMutation = () => {
    tableMutationRevision.current += 1;
  };
  const updateLocalTableCart: React.Dispatch<React.SetStateAction<PdvCartItem[]>> = (next) => {
    markTableMutation();
    setTableCart(next);
  };
  const updateLocalTablePeople = (value: number) => {
    markTableMutation();
    setTablePeople(value);
  };
  const updateLocalTableNote = (value: string) => {
    markTableMutation();
    setTableNote(value);
  };
  const updateLocalSubtableNames: React.Dispatch<React.SetStateAction<string[]>> = (next) => {
    markTableMutation();
    setSubtableNames(next);
  };

  useEffect(() => {
    if (!remoteTablesActive || !remoteSession) {
      return;
    }
    const pending = readPendingRemoteTables(remoteSession.baseUrl);
    if (!pending.length) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const remaining: PendingRemoteTable[] = [];
      for (const table of pending.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
        try {
          await remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${table.tableNumber}/open`, { method: "POST", body: JSON.stringify({ people: table.people, note: table.note }) });
          await remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${table.tableNumber}/items`, { method: "PUT", body: JSON.stringify({ items: table.items, subtables: table.subtables }) });
        } catch {
          remaining.push(table);
        }
      }
      if (!cancelled) {
        writePendingRemoteTables(remoteSession.baseUrl, remaining);
        if (!remaining.length) {
          setToast("Mesas pendentes foram sincronizadas.");
          await load();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [remoteSession?.baseUrl, remoteSession?.connectedAt, remoteTablesActive, reloadToken]);
  const closePdvTable = (tableNumber: number, payments: PdvPayment[], closeDiscount = 0, operationId: PdvOperationId = crypto.randomUUID()) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, `/api/pdv/tables/${tableNumber}/close`, { method: "POST", headers: { "x-idempotency-key": operationId }, body: JSON.stringify({ payments, discount: closeDiscount }) }).then((result) => result.sale)
    : window.caixa.closePdvTable(tableNumber, payments, closeDiscount, operationId);
  const cancelPdvTable = (tableNumber: number) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale | null }>(remoteSession, `/api/pdv/tables/${tableNumber}/cancel`, { method: "POST" }).then((result) => result.sale)
    : window.caixa.cancelPdvTable(tableNumber);
  const saveDirectPdvSale = (items: PdvCartItem[], directDiscount: number, payments: PdvPayment[], saleType: PdvSale["type"] = directSaleMode, operationId: PdvOperationId = crypto.randomUUID()) => remotePdvActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, "/api/pdv/sales/direct", {
        method: "POST",
        headers: { "x-idempotency-key": operationId },
        body: JSON.stringify({ items, discount: directDiscount, payments, saleType })
      }).then((result) => result.sale)
    : window.caixa.saveDirectSale(items, directDiscount, payments, saleType, operationId);
  const savePdvTablePartial = (tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], partialDiscount = 0, observations = "", operationId: PdvOperationId = crypto.randomUUID()) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, `/api/pdv/tables/${tableNumber}/partial`, { method: "POST", headers: { "x-idempotency-key": operationId }, body: JSON.stringify({ items, payments, discount: partialDiscount, observations }) }).then((result) => result.sale)
    : window.caixa.savePdvTablePartial(tableNumber, items, payments, partialDiscount, operationId, observations);
  const updatePdvSalePayments = (saleId: string, payments: PdvPayment[]) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, `/api/pdv/sales/${saleId}/payments`, { method: "PATCH", body: JSON.stringify({ payments }) }).then((result) => result.sale)
    : window.caixa.updatePdvSalePayments(saleId, payments);
  const clientConfigurationBlocked = () => Promise.reject(new Error("Produtos e regras do PDV sao definidos somente no servidor."));
  const updatePdvProducts = (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => isRemoteClient
    ? clientConfigurationBlocked()
    : window.caixa.updatePdvProducts(ids, patch);
  const savePdvCategory = (draft: PdvCategoryDraft) => isRemoteClient
    ? clientConfigurationBlocked() as Promise<PdvCategory>
    : window.caixa.savePdvCategory(draft);
  const savePdvProduct = (draft: PdvProductDraft) => isRemoteClient
    ? clientConfigurationBlocked() as Promise<PdvProduct>
    : window.caixa.savePdvProduct(draft);
  const removePdvProduct = (id: string) => isRemoteClient
    ? clientConfigurationBlocked() as ReturnType<typeof window.caixa.removePdvProduct>
    : window.caixa.removePdvProduct(id);
  const savePdvSettings = (patch: Partial<PdvSettings>) => isRemoteClient && remoteSession
    ? canConfigureServer
      ? remotePdvRequest<{ settings: PdvSettings }>(remoteSession, "/api/pdv/settings", { method: "PATCH", body: JSON.stringify(patch) }).then((result) => result.settings)
      : clientConfigurationBlocked() as Promise<PdvSettings>
    : window.caixa.savePdvSettings(patch);
  const savePdvCustomer = (draft: PdvCustomerDraft) => remotePdvActive && remoteSession
    ? remotePdvRequest<{ customer: PdvCustomer }>(remoteSession, "/api/pdv/customers", { method: "POST", body: JSON.stringify(draft) }).then((result) => result.customer)
    : window.caixa.savePdvCustomer(draft);
  const applyConfirmedReceivable = (receivable: PdvReceivable) => {
    setSnapshot((current) => current ? {
      ...current,
      receivables: current.receivables.map((item) => item.id === receivable.id ? receivable : item)
    } : current);
    return receivable;
  };
  const receivePdvReceivable = async (id: string, payment: PdvReceivablePayment, operationId: string = crypto.randomUUID()) => {
    const receivable = remotePdvActive && remoteSession
      ? await remotePdvRequest<{ receivable: PdvReceivable }>(remoteSession, `/api/pdv/receivables/${id}/payments`, { method: "POST", headers: { "x-idempotency-key": operationId }, body: JSON.stringify({ payment }) }).then((result) => result.receivable)
      : await window.caixa.receivePdvReceivable(id, payment, operationId);
    return applyConfirmedReceivable(receivable);
  };
  const updatePdvReceivable = async (id: string, patch: PdvReceivablePatch) => {
    const receivable = remotePdvActive && remoteSession
      ? await remotePdvRequest<{ receivable: PdvReceivable }>(remoteSession, `/api/pdv/receivables/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((result) => result.receivable)
      : await window.caixa.updatePdvReceivable(id, patch);
    return applyConfirmedReceivable(receivable);
  };
  const cancelPdvReceivable = (id: string) => remotePdvActive && remoteSession
    ? remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/receivables/${id}/cancel`, { method: "POST" }).then(() => undefined)
    : window.caixa.cancelPdvReceivable(id);
  const importPdvPreset = () => isRemoteClient ? clientConfigurationBlocked() as Promise<PdvProductImportResult> : window.caixa.importCoseProducts();
  const previewPdvPreset = () => isRemoteClient ? clientConfigurationBlocked() as Promise<PdvProductImportPreview> : window.caixa.previewCoseProducts();
  const removePdvPreset = () => isRemoteClient ? clientConfigurationBlocked() as Promise<number> : window.caixa.removeCoseProducts();

  const load = async () => {
    if (snapshotLoadInFlight.current) {
      snapshotLoadQueued.current = true;
      return snapshotLoadInFlight.current;
    }
    const request = getPdvSnapshot().then((next) => {
      setSnapshot(next);
      return next;
    });
    snapshotLoadInFlight.current = request;
    try {
      return await request;
    } finally {
      snapshotLoadInFlight.current = null;
      if (snapshotLoadQueued.current) {
        snapshotLoadQueued.current = false;
        void load();
      }
    }
  };

  const queueTableSave = async (payload: { tableNumber: number; people: number; note: string; items: PdvCartItem[]; subtables: string[]; mutationRevision: number }, refresh = true) => {
    const revision = ++tableSaveRevision.current;
    setTableSaveState("saving");
    const save = async () => {
      await ensureTableMeta(payload.tableNumber, payload.people, payload.note);
      await savePdvTableItems(payload.tableNumber, payload.items, payload.subtables);
    };
    const queued = tableSaveChain.current.catch(() => undefined).then(save);
    tableSaveChain.current = queued;
    try {
      await queued;
      if (revision === tableSaveRevision.current) {
        if (refresh) {
          // Enquanto a gravacao e confirmada, o snapshot atualmente renderizado
          // ainda pode conter a versao anterior da mesa. Busque e aplique a
          // resposta confirmada antes de liberar a reconciliacao automatica.
          const confirmed = await getPdvSnapshot();
          if (payload.mutationRevision === tableMutationRevision.current) {
            setSnapshot(confirmed);
            applyFreshOpenTable(confirmed, payload.tableNumber);
            persistedTableMutationRevision.current = payload.mutationRevision;
          } else {
            setSnapshot(confirmed);
          }
        } else if (payload.mutationRevision === tableMutationRevision.current) {
          persistedTableMutationRevision.current = payload.mutationRevision;
        }
        setTableSaveState("saved");
      }
    } catch (error) {
      if (revision === tableSaveRevision.current) {
        setTableSaveState("error");
      }
      throw error;
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), Math.max(1200, toastDuration || 3200));
    return () => window.clearTimeout(timer);
  }, [toast, toastDuration]);

  useEffect(() => {
    onDirectCartChange?.(cart.length > 0);
  }, [cart.length, onDirectCartChange]);

  const applyFreshOpenTable = (next: PdvSnapshot, tableNumber: number) => {
    const fresh = next.tables.find((table) => table.number === tableNumber);
    if (!fresh) return;
    setActiveTable((current) => samePdvValue(current, fresh) ? current : fresh);
    setTableCart((current) => samePdvValue(current, fresh.items) ? current : fresh.items);
    setTablePeople((current) => current === (fresh.people || 1) ? current : fresh.people || 1);
    setTableNote((current) => current === (fresh.note || "") ? current : fresh.note || "");
    setSubtableNames((current) => samePdvValue(current, fresh.subtables || []) ? current : fresh.subtables || []);
    setSelectedTableItemIds((current) => current.filter((id) => fresh.items.some((item) => item.id === id)));
    setPartialSelectedItemIds((current) => current.filter((id) => fresh.items.some((item) => item.id === id && unpaidQuantity(item) > 0.009)));
    lastPersistedTableMeta.current = { number: fresh.number, people: fresh.people || 1, note: fresh.note || "" };
  };

  useEffect(() => {
    if (snapshotOverride !== undefined) {
      if (snapshotOverride) setSnapshot(snapshotOverride);
      return;
    }
    load();
    return window.caixa.onPdvChanged(load);
  }, [remoteSession?.baseUrl, remotePdvActive, reloadToken, snapshotOverride !== undefined]);

  useEffect(() => {
    if (!snapshotOverride) return;
    setSnapshot(snapshotOverride);
    if (
      activeTable
      && tableSaveState !== "saving"
      && tableAutosaveTimer.current === null
      && tableMutationRevision.current === persistedTableMutationRevision.current
    ) {
      applyFreshOpenTable(snapshotOverride, activeTable.number);
    }
  }, [snapshotOverride]);

  useEffect(() => {
    if (!remoteSession?.snapshot) return;
    setSnapshot(remoteSession.snapshot);
    if (
      activeTable
      && tableSaveState !== "saving"
      && tableAutosaveTimer.current === null
      && tableMutationRevision.current === persistedTableMutationRevision.current
    ) {
      applyFreshOpenTable(remoteSession.snapshot, activeTable.number);
    }
  }, [remoteSession?.snapshot]);

  useEffect(() => {
    if (!activeTable || !snapshot || tableSaveState === "saving" || tableAutosaveTimer.current !== null) {
      return;
    }
    if (tableMutationRevision.current !== persistedTableMutationRevision.current) {
      return;
    }
    const fresh = snapshot.tables.find((table) => table.number === activeTable.number);
    if (fresh && !samePdvValue(tableCart, fresh.items)) {
      applyFreshOpenTable(snapshot, activeTable.number);
    }
  }, [snapshot, activeTable?.number, tableCart, tableSaveState]);

  useEffect(() => {
    setTab(initialTab);
    if (initialTab === "tables") {
      setActiveTable(null);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!activeTable || tab !== "tables" || checkoutTarget || tableCloseMenuOpen) {
      return;
    }
    if (tableMutationRevision.current === persistedTableMutationRevision.current) {
      return;
    }
    if (tableAutosaveTimer.current !== null) {
      window.clearTimeout(tableAutosaveTimer.current);
    }
    // Protege o carrinho otimista contra snapshots antigos enquanto aguarda a fila.
    setTableSaveState("saving");
    tableAutosaveTimer.current = window.setTimeout(() => {
      tableAutosaveTimer.current = null;
      void (async () => {
        try {
          await queueTableSave({
            tableNumber: activeTable.number,
            people: tablePeople,
            note: tableNote,
            items: tableCart,
            subtables: subtableNames,
            mutationRevision: tableMutationRevision.current
          });
        } catch (error) {
          if (remoteTablesActive) {
            queueRemoteTable(activeTable.number, tablePeople, tableNote, tableCart, subtableNames);
          }
          setTableSaveState("error");
          setToast(error instanceof Error ? error.message : "Nao foi possivel salvar a mesa no servidor.");
        }
      })();
    }, 180);
    return () => {
      if (tableAutosaveTimer.current !== null) {
        window.clearTimeout(tableAutosaveTimer.current);
        tableAutosaveTimer.current = null;
      }
    };
  }, [activeTable?.number, tab, tableCart, tablePeople, tableNote, subtableNames, checkoutTarget, tableCloseMenuOpen, remoteTablesActive, remoteSession?.baseUrl]);
  const products = useMemo(() => {
    const items = snapshot?.products.filter((product) => product.active && product.showOnPdv) || [];
    const direction = snapshot?.settings.productSortDirection === "za" ? -1 : 1;
    return items
      .filter((product) => activeCategory === "todos" || product.categoryId === activeCategory)
      .sort((left, right) => direction * left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
  }, [activeCategory, snapshot?.products]);

  const saleTotal = useMemo(() => roundMoney(cart.reduce((total, item) => total + item.total, 0)), [cart]);
  const saleFinal = Math.max(0, roundMoney(saleTotal - discount));
  const tableTotal = useMemo(() => roundMoney(tableCart.reduce((total, item) => total + unpaidItemTotal(item), 0)), [tableCart]);
  const partialSalesForActiveTable = activeTable ? snapshot?.recentSales.filter((sale) => sale.type === "Mesa" && sale.status === "Parcial" && (
    activeTable.sessionId
      ? sale.tableSessionId === activeTable.sessionId || (!sale.tableSessionId && Boolean(activeTable.openedAt) && sale.tableNumber === activeTable.number && sale.createdAt >= activeTable.openedAt!)
      : sale.tableNumber === activeTable.number && Boolean(activeTable.openedAt) && sale.createdAt >= activeTable.openedAt!
  )) || [] : [];

  const addProduct = (product: PdvProduct, direct = false, bypassReopen = false) => {
    if (activeTable?.status === "Fechamento" && !bypassReopen) {
      setConfirmRequest({
        title: "Reabrir mesa para adicionar produto?",
        message: "Os pagamentos ja registrados serao preservados. Apenas os itens novos ou pendentes entrarao no proximo saldo.",
        action: async () => {
          await setPdvTableStatus(activeTable.number, "Ocupada");
          setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
          addProduct(product, direct, true);
        }
      });
      return;
    }
    if (product.unitMode !== "unidade") {
      setPendingMeasureProduct({ product, direct });
      return;
    }
    addResolvedProduct(product, { quantity }, direct);
  };

  const addResolvedProduct = (product: PdvProduct, resolvedQuantity: { quantity: number; measureLabel?: string; unitPrice?: number; finalTotal?: number }, direct = false) => {
    const availableComplements = snapshot ? complementsForProduct(product, snapshot.products) : [];
    if (snapshot?.settings.complementsEnabled && !direct && (product.hasComplements || product.complementProductIds.length > 0) && availableComplements.length > 0) {
      setPendingProduct({ product, ...resolvedQuantity });
      return;
    }
    const item = createCartItem(product, resolvedQuantity.quantity, [], resolvedQuantity.unitPrice, activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "", resolvedQuantity.measureLabel, resolvedQuantity.finalTotal);
    const items = expandIndividualUnits(item, Boolean(snapshot?.settings.individualUnitItems));
    if (activeTable) {
      updateLocalTableCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
      setQuantity(1);
      return;
    }
    setCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
    setQuantity(1);
  };

  const finishDirectSale = () => {
    if (!cart.length) {
      setToast("Adicione ao menos um produto.");
      return;
    }
    setCheckoutTarget({ kind: "direct", total: saleFinal, operationId: crypto.randomUUID() });
  };

  const maybePrintSale = async (sale: PdvSale, latestSnapshot?: PdvSnapshot) => {
    if (!snapshot || !snapshot.settings.receiptAutoPrint) return;
    const latest = latestSnapshot || await getPdvSnapshot();
    const customerId = sale.payments.find((payment) => payment.method === "Conta a receber")?.customerId;
    const customer = latest.customers.find((item) => item.id === customerId);
    const result = await window.caixa.printPdvReceipt(sale, customer, undefined, {
      action: latest.settings.receiptPrinterName ? "print" : "open",
      printerName: latest.settings.receiptPrinterName
    });
    if (!result.ok && !/cancel/i.test(result.message)) setToast(result.message);
  };

  const confirmDirectSale = async (payments: PdvPayment[], items = cart, saleType: PdvSale["type"] = directSaleMode, operationId: PdvOperationId = crypto.randomUUID()) => {
    setBusy(true);
    try {
      const sale = await saveDirectPdvSale(items, discount, payments, saleType, operationId);
      setCart([]);
      setSelectedDirectItemIds([]);
      setDiscount(0);
      setCheckoutTarget(null);
      setToast(saleType === "Onibus" ? "Venda de onibus finalizada." : saleType === "Mesa" ? "Mesa avulsa finalizada." : "Venda finalizada.");
      const latest = await load();
      if (latest.settings.receiptOpenAfterSale) {
        setCompletedReceipt({ sale, receivable: latest.receivables.find((item) => item.saleId === sale.id) });
      }
      await maybePrintSale(sale, latest);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Nao foi possivel finalizar a venda.");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const openTable = async (table: PdvOpenTable, requestedSubtable = "") => {
    try {
      // A busca serve somente para localizar. Depois de entrar, voltar ao mapa
      // deve sempre mostrar todas as mesas novamente.
      setTableSearch("");
      if (table.status === "Livre") {
        await openPdvTable(table.number, 1, "");
        // Evita uma segunda ida completa ao servidor apenas para abrir uma mesa
        // livre. O proximo snapshot em tempo real confirma o mesmo estado.
        const opened = { ...table, status: "Ocupada" as PdvTableStatus, openedAt: new Date().toISOString(), people: 1, note: "", items: [] };
        resetTableMutationTracking();
        setActiveTable(opened);
        setTableCart(opened.items);
        setTablePeople(opened.people || 1);
        setTableNote(opened.note || "");
        setSubtableNames(opened.subtables || []);
        setTableSaveState("idle");
        setSelectedTableItemIds([]);
        setCurrentSubtable((opened.subtables || []).includes(requestedSubtable)
          ? requestedSubtable
          : preferredSubtable(table.number, opened.subtables || [], Boolean(snapshot?.settings.rememberLastSubtable)));
        lastPersistedTableMeta.current = { number: table.number, people: opened.people || 1, note: opened.note || "" };
        return;
      }
      resetTableMutationTracking();
      setActiveTable(table);
      setTableCart(table.items);
      setTablePeople(table.people || 1);
      setTableNote(table.note || "");
      setSubtableNames(table.subtables || []);
      setTableSaveState("idle");
      setSelectedTableItemIds([]);
      setCurrentSubtable((table.subtables || []).includes(requestedSubtable)
        ? requestedSubtable
        : preferredSubtable(table.number, table.subtables || [], Boolean(snapshot?.settings.rememberLastSubtable)));
      lastPersistedTableMeta.current = { number: table.number, people: table.people || 1, note: table.note || "" };
    } catch (error) {
      setTableSaveState("error");
      setToast(error instanceof Error ? error.message : "Nao foi possivel abrir a mesa no servidor.");
    }
  };

  useEffect(() => {
    if (!activeTable) {
      return;
    }
    const key = `${LAST_SUBTABLE_STORAGE_PREFIX}${activeTable.number}`;
    if (snapshot?.settings.rememberLastSubtable && currentSubtable) {
      window.localStorage.setItem(key, currentSubtable);
    } else {
      window.localStorage.removeItem(key);
    }
  }, [activeTable?.number, currentSubtable, snapshot?.settings.rememberLastSubtable]);

  const runTableAction = async (action: string, table: PdvOpenTable) => {
    setTableMenu(null);
    if (action === "open") {
      await openTable(table);
      return;
    }
    if (action === "reserve") {
      await setPdvTableStatus(table.number, "Reservada");
      await load();
      return;
    }
    if (action === "free") {
      if (table.items.length) {
        setConfirmRequest({
          title: `Liberar mesa ${table.number}?`,
          message: "Os itens em aberto serao cancelados e a mesa voltara a ficar livre.",
          action: async () => {
            await savePdvTableItems(table.number, []);
            await setPdvTableStatus(table.number, "Livre");
            await load();
          }
        });
        return;
      }
      await savePdvTableItems(table.number, []);
      await setPdvTableStatus(table.number, "Livre");
      await load();
      return;
    }
    if (action === "closing") {
      await setPdvTableStatus(table.number, "Fechamento");
      await load();
      return;
    }
    if (action === "details") {
      const peopleLine = snapshot?.settings.tablePeopleEnabled ? `\nPessoas: ${table.people || "-"}` : "";
      setNotice(`Mesa ${String(table.number).padStart(3, "0")}\nStatus: ${table.status}\nAbertura: ${shortTime(table.openedAt) || "-"}${peopleLine}\nTotal: ${money(table.total)}\nObservacao: ${table.note || "-"}`);
      return;
    }
    if (action === "history") {
      setTab("history");
      return;
    }
    if (action === "cancel") {
      setConfirmRequest({
        title: `Cancelar mesa ${String(table.number).padStart(3, "0")}?`,
        message: "A mesa sera liberada. Os itens pendentes ficarao registrados como cancelados no Historico, sem entrar no faturamento ou no Excel.",
        action: async () => {
          await cancelPdvTable(table.number);
          await load();
        }
      });
    }
  };

  const addConfiguredProduct = (product: PdvProduct, unitPrice: number, complements: PdvCartItem["complements"]) => {
    const resolvedQuantity = pendingProduct?.product.id === product.id ? pendingProduct : { quantity, measureLabel: undefined };
    const subtableName = activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "";
    const grouped = snapshot?.settings.groupComplementsWithProduct ?? true;
    const mainItem = createCartItem(product, resolvedQuantity.quantity, grouped ? complements || [] : [], unitPrice ?? pendingProduct?.unitPrice, subtableName, resolvedQuantity.measureLabel, pendingProduct?.finalTotal);
    const separateComplements = !grouped
      ? (complements || []).map((complement) => ({
          id: crypto.randomUUID(), productId: complement.productId, productName: complement.name, categoryName: "Adicionais", quantity: resolvedQuantity.quantity,
          measureLabel: resolvedQuantity.measureLabel, unitPrice: complement.price, baseUnitPrice: complement.price, discount: 0,
          total: roundMoney(resolvedQuantity.quantity * complement.price), subtableName, note: `Adicional de ${product.name}`, complements: []
        } satisfies PdvCartItem))
      : [];
    const items = [mainItem, ...separateComplements].flatMap((item) => expandIndividualUnits(item, Boolean(snapshot?.settings.individualUnitItems)));
    if (activeTable) {
      updateLocalTableCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
    } else {
      setCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
    }
    setQuantity(1);
    setPendingProduct(null);
  };

  const saveTable = async () => {
    if (!activeTable) {
      return;
    }
    try {
      await queueTableSave({ tableNumber: activeTable.number, people: tablePeople, note: tableNote, items: tableCart, subtables: subtableNames, mutationRevision: tableMutationRevision.current });
    } catch (error) {
      if (remoteTablesActive) {
        queueRemoteTable(activeTable.number, tablePeople, tableNote, tableCart, subtableNames);
      }
      throw error;
    }
    setToast(`Mesa ${String(activeTable.number).padStart(3, "0")} salva.`);
    await load();
  };

  const persistTableBeforeAction = async () => {
    if (!activeTable) {
      return false;
    }
    if (tableAutosaveTimer.current !== null) {
      window.clearTimeout(tableAutosaveTimer.current);
      tableAutosaveTimer.current = null;
    }
    try {
      await queueTableSave({ tableNumber: activeTable.number, people: tablePeople, note: tableNote, items: tableCart, subtables: subtableNames, mutationRevision: tableMutationRevision.current });
    } catch (error) {
      if (remoteTablesActive) {
        queueRemoteTable(activeTable.number, tablePeople, tableNote, tableCart, subtableNames);
      }
      throw error;
    }
    return true;
  };

  const finalizeFullyPaidTable = () => {
    if (!activeTable) {
      return;
    }
    const scopedItems = tableCart.filter((item) =>
      tableCloseScope.kind === "all"
      || (tableCloseScope.kind === "main" && !item.subtableName)
      || (tableCloseScope.kind === "subtable" && (item.subtableName || "") === tableCloseScope.subtableName)
    );
    const scopeLabel = tableCloseScope.kind === "subtable"
      ? `submesa ${tableCloseScope.subtableName}`
      : tableCloseScope.kind === "main" ? "mesa principal" : "mesa";
    setConfirmRequest({
      title: `Concluir ${scopeLabel} ${String(activeTable.number).padStart(3, "0")}?`,
      message: `Todos os itens deste escopo foram pagos em fechamentos parciais. A ${scopeLabel} sera concluida e os pagamentos permanecerao no historico.`,
      action: async () => {
        const scopedIds = new Set(scopedItems.map((item) => item.id));
        const nextItems = tableCloseScope.kind === "all"
          ? []
          : tableCart.filter((item) => !scopedIds.has(item.id) && !(
            tableCloseScope.kind === "subtable" && (item.subtableName || "") === tableCloseScope.subtableName
          ));
        const nextSubtables = tableCloseScope.kind === "subtable"
          ? subtableNames.filter((name) => name !== tableCloseScope.subtableName)
          : tableCloseScope.kind === "all" ? [] : subtableNames;
        await savePdvTableItems(activeTable.number, nextItems, nextSubtables);
        await setPdvTableStatus(activeTable.number, nextItems.length || nextSubtables.length ? "Ocupada" : "Livre");
        setPartialSelectedItemIds([]);
        setPartialItemsModalOpen(false);
        setTableCloseScope({ kind: "all" });
        const refreshed = await load();
        if (nextItems.length || nextSubtables.length) {
          setTableCart(nextItems);
          setSubtableNames(nextSubtables);
          setCurrentSubtable("");
          applyFreshOpenTable(refreshed, activeTable.number);
        } else {
          setActiveTable(null);
          setTableCart([]);
        }
      }
    });
  };

  const requestCloseTable = async () => {
    if (!activeTable || busy || checkoutTarget || tableCloseMenuOpen || partialItemsModalOpen || partialValueModalOpen) {
      return;
    }
    if (tableTotal <= 0.009 && activeTable.items.length) {
      finalizeFullyPaidTable();
      return;
    }
    if (tableTotal <= 0.009) return;
    if (snapshot?.settings.subtablesEnabled && currentSubtable) {
      await requestCloseSubtable(currentSubtable);
      return;
    }
    const hasIndependentSubtables = subtableNames.length > 0 || tableCart.some((item) => item.subtableName);
    const scope: TableCloseScope = hasIndependentSubtables ? { kind: "main" } : { kind: "all" };
    const scopedItems = itemsForCloseScope(tableCart, scope);
    if (!scopedItems.length) {
      setToast(hasIndependentSubtables ? "A mesa principal nao tem itens para fechar." : "Mesa sem itens para fechar.");
      return;
    }
    await persistTableBeforeAction();
    await setPdvTableStatus(activeTable.number, "Fechamento");
    setActiveTable((current) => current ? { ...current, status: "Fechamento" } : current);
    setTableCloseScope(scope);
    setPartialItemsModalOpen(false);
    setPartialValueModalOpen(false);
    setTableCloseMenuOpen(true);
  };

  const resetPaidItemStates = (ids?: string[], selectAfter = false) => {
    if (!activeTable) return;
    const targetIds = ids?.length ? new Set(ids) : new Set(tableCart.filter((item) => (item.paidQuantity || 0) > 0).map((item) => item.id));
    if (!targetIds.size) return;
    setConfirmRequest({
      title: "Resetar estados dos itens?",
      message: "Esta acao fara os itens voltarem ao estado de nao pagos, mas mantera os pagamentos ja registrados no historico. Eles poderao entrar novamente no saldo da mesa.",
      action: async () => {
        const next = tableCart.map((item) => targetIds.has(item.id) ? { ...item, paidQuantity: 0 } : item);
        setTableCart(next);
        setPartialSelectedItemIds(selectAfter ? [...targetIds] : []);
        await savePdvTableItems(activeTable.number, next, subtableNames);
        await setPdvTableStatus(activeTable.number, "Ocupada");
        setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
        await load();
      }
    });
  };

  const requestPartialByItems = async (items?: PdvCartItem[]) => {
    if (!activeTable) {
      return;
    }
    const selected = items?.length ? items : tableCart.filter((item) => partialSelectedItemIds.includes(item.id));
    if (!selected.length) {
      setToast("Selecione itens da mesa para fechar parcial.");
      return;
    }
    await persistTableBeforeAction();
    setCheckoutTarget({ kind: "table-partial-items", table: activeTable, total: roundMoney(selected.reduce((total, item) => total + item.total, 0)), items: selected, operationId: crypto.randomUUID() });
  };

  const requestCloseSubtable = async (name: string) => {
    if (!activeTable) {
      return;
    }
    const scope: TableCloseScope = { kind: "subtable", subtableName: name };
    const selected = itemsForCloseScope(tableCart, scope);
    if (!selected.length) {
      setToast("Essa submesa nao tem itens para fechar.");
      return;
    }
    await persistTableBeforeAction();
    await setPdvTableStatus(activeTable.number, "Fechamento");
    setActiveTable((current) => current ? { ...current, status: "Fechamento" } : current);
    setTableCloseScope(scope);
    setPartialItemsModalOpen(false);
    setPartialValueModalOpen(false);
    setTableCloseMenuOpen(true);
  };

  const deleteSubtable = async (name: string) => {
    if (!activeTable || !name) {
      return;
    }
    setConfirmRequest({
      title: `Apagar submesa ${name}?`,
      message: "Os itens dessa submesa serao cancelados. A mesa principal sera mantida.",
      action: async () => {
        const remainingItems = tableCart.filter((item) => (item.subtableName || "") !== name);
        const remainingSubtables = subtableNames.filter((item) => item !== name);
        setTableCart(remainingItems);
        setSelectedTableItemIds((current) => current.filter((id) => remainingItems.some((item) => item.id === id)));
        setCurrentSubtable((current) => current === name ? "" : current);
        setSubtableNames(remainingSubtables);
        await savePdvTableItems(activeTable.number, remainingItems, remainingSubtables);
        setToast(`Submesa ${name} apagada.`);
        await load();
      }
    });
  };

  const deleteAllSubtables = async () => {
    if (!activeTable) {
      return;
    }
    setConfirmRequest({
      title: "Apagar todas as submesas?",
      message: "Os itens das submesas serao cancelados. Os itens da mesa principal serao mantidos.",
      action: async () => {
        const remainingItems = tableCart.filter((item) => !item.subtableName);
        setTableCart(remainingItems);
        setSelectedTableItemIds([]);
        setCurrentSubtable("");
        setSubtableNames([]);
        await savePdvTableItems(activeTable.number, remainingItems, []);
        setToast("Todas as submesas foram apagadas.");
        await load();
      }
    });
  };

  const moveSelectedItemsToSubtable = async (name: string) => {
    if (!activeTable || !selectedTableItemIds.length) {
      setToast("Selecione itens para mover.");
      return;
    }
    const selected = new Set(selectedTableItemIds);
    const movedItems = tableCart.map((item) => selected.has(item.id) ? { ...item, subtableName: name } : item);
    setTableCart(movedItems);
    setSelectedTableItemIds([]);
    await savePdvTableItems(activeTable.number, movedItems, subtableNames);
    setToast(name ? `Itens movidos para ${name}.` : "Itens movidos para a mesa principal.");
    await load();
  };

  const renameSubtable = async (oldName: string, newName: string) => {
    const nextName = newName.trim();
    if (!activeTable || !oldName || !nextName || oldName === nextName) {
      return;
    }
    const rename = async () => {
      const renamedItems = tableCart.map((item) => (item.subtableName || "") === oldName ? { ...item, subtableName: nextName } : item);
      const renamedSubtables = [...new Set(subtableNames.map((item) => item === oldName ? nextName : item))];
      setTableCart(renamedItems);
      setSubtableNames(renamedSubtables);
      setCurrentSubtable(nextName);
      await savePdvTableItems(activeTable.number, renamedItems, renamedSubtables);
      setToast(`Submesa ${oldName} renomeada para ${nextName}.`);
      await load();
    };
    if (tableCart.some((item) => (item.subtableName || "") === nextName)) {
      setConfirmRequest({ title: `Juntar submesas em ${nextName}?`, message: "Ja existe uma submesa com esse nome. Os itens serao reunidos nela.", action: rename });
      return;
    }
    await rename();
  };

  const requestPartialByValue = (manualValue?: number) => {
    if (!activeTable) {
      return;
    }
    const value = manualValue ?? parseBrazilianNumber(partialManualValue);
    if (value <= 0) {
      return;
    }
    const manualItem: PdvCartItem = {
      id: crypto.randomUUID(),
      productId: "manual-partial",
      productName: `Fechamento parcial manual mesa ${String(activeTable.number).padStart(3, "0")}`,
      categoryName: "Fechamento parcial",
      quantity: 1,
      unitPrice: roundMoney(value),
      discount: 0,
      total: roundMoney(value),
      note: "Parcial por valor manual. Mesa permanece aberta."
    };
    setPartialManualValue("");
    setPartialValueModalOpen(false);
    setCheckoutTarget({ kind: "table-partial-manual", table: activeTable, total: manualItem.total, items: [manualItem], operationId: crypto.randomUUID() });
  };

  const confirmCloseTable = async (payments: PdvPayment[]) => {
    if (!activeTable) {
      return;
    }
    setBusy(true);
    try {
      await savePdvTableItems(activeTable.number, tableCart, subtableNames);
      const tableDiscount = checkoutTarget?.kind === "table" ? checkoutTarget.discount : 0;
      const sale = await closePdvTable(activeTable.number, payments, tableDiscount, checkoutTarget?.kind === "table" ? checkoutTarget.operationId : undefined);
      setToast(`Mesa ${String(activeTable.number).padStart(3, "0")} fechada.`);
      setActiveTable(null);
      setTableCart([]);
      setCheckoutTarget(null);
      setTableCloseScope({ kind: "all" });
      const latest = await load();
      if (latest.settings.receiptOpenAfterSale) {
        setCompletedReceipt({ sale, receivable: latest.receivables.find((item) => item.saleId === sale.id) });
      }
      await maybePrintSale(sale, latest);
    } finally {
      setBusy(false);
    }
  };

  const confirmPartialTable = async (target: Extract<CheckoutTarget, { kind: "table-scope" | "table-partial-items" | "table-subtable" | "table-partial-manual" }>, payments: PdvPayment[], observations = "") => {
    setBusy(true);
    try {
      const partialDiscount = target.kind === "table-scope" ? target.discount : 0;
      const sale = await savePdvTablePartial(target.table.number, target.items, payments, partialDiscount, observations, target.operationId);
      if (target.kind === "table-subtable" || target.kind === "table-scope") {
        const scope: Exclude<TableCloseScope, { kind: "all" }> = target.kind === "table-subtable"
          ? { kind: "subtable", subtableName: target.subtableName }
          : target.scope;
        const remainingItems = tableCart.filter((item) =>
          scope.kind === "main" ? Boolean(item.subtableName) : (item.subtableName || "") !== scope.subtableName
        );
        const remainingSubtables = scope.kind === "subtable"
          ? subtableNames.filter((name) => name !== scope.subtableName)
          : subtableNames;
        const nextStatus: PdvTableStatus = remainingItems.length || remainingSubtables.length ? "Ocupada" : "Livre";
        await savePdvTableItems(target.table.number, remainingItems, remainingSubtables);
        await setPdvTableStatus(target.table.number, nextStatus);
        setTableCart(remainingItems);
        setSubtableNames(remainingSubtables);
        setCurrentSubtable((current) => scope.kind === "subtable" && current === scope.subtableName ? "" : current);
        setSelectedTableItemIds([]);
        setPartialSelectedItemIds([]);
        setCheckoutTarget(null);
        setTableCloseScope({ kind: "all" });
        setToast(scope.kind === "subtable" ? `Submesa ${scope.subtableName} fechada.` : "Mesa principal fechada. As submesas continuam abertas.");
        const refreshed = await load();
        if (refreshed.settings.receiptOpenAfterSale) {
          setCompletedReceipt({ sale, receivable: refreshed.receivables.find((item) => item.saleId === sale.id) });
        }
        await maybePrintSale(sale, refreshed);
        if (remainingItems.length || remainingSubtables.length) {
          applyFreshOpenTable(refreshed, target.table.number);
        } else {
          setActiveTable(null);
        }
        return;
      }
      if (target.kind === "table-partial-items") {
        const selectedById = new Map(target.items.map((item) => [item.id, item.quantity]));
        setTableCart((current) => current.map((item) => selectedById.has(item.id) ? {
          ...item,
          paidQuantity: isMeasuredCartItem(item)
            ? roundQuantity(Math.min(item.quantity, (item.paidQuantity || 0) + (selectedById.get(item.id) || 0)))
            : roundMoney(Math.min(item.quantity, (item.paidQuantity || 0) + (selectedById.get(item.id) || 0)))
        } : item));
        setPartialSelectedItemIds([]);
      }
      setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
      setCheckoutTarget(null);
      setToast(target.kind === "table-partial-items" ? "Parcial por itens registrada." : "Parcial manual registrada.");
      const refreshed = await load();
      applyFreshOpenTable(refreshed, target.table.number);
      if (target.kind === "table-partial-items") {
        setPartialItemsModalOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const importCose = async () => {
    setBusy(true);
    try {
      const result = await window.caixa.importCoseProducts();
      setToast(`${result.importedProducts} produtos importados da Cose Dell Abadia.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const previewImportFile = () => isRemoteClient
    ? clientConfigurationBlocked() as Promise<PdvProductImportPreview | null>
    : window.caixa.previewPdvProductsFile();
  const importFile = async (filePath: string) => {
    setBusy(true);
    try {
      const result = await window.caixa.importPdvProductsFile(filePath);
      if (!result) return { filePath, importedProducts: 0, importedCategories: 0, skippedRows: 0 };
      setToast(`${result.importedProducts} produtos importados.`);
      await load();
      return result;
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="pdv-loading">Carregando PDV local...</div>;
  }

  const visibleSettings = isRemoteClient ? { ...snapshot.settings, ...clientVisualSettings } : snapshot.settings;
  const visibleTables = snapshot.tables.filter((table) => {
    const matchesStatus = tableFilter === "Todas" || table.status === tableFilter;
    return matchesStatus && tableSearchDetails(table, tableSearch).matches;
  });
  const activeCloseItems = activeTable ? itemsForCloseScope(tableCart, tableCloseScope) : [];
  const activeCloseTotal = roundMoney(activeCloseItems.reduce((total, item) => total + item.total, 0));

  return (
    <div className={`pdv-shell ${embedded ? "embedded" : ""} ${hideTopbar ? "no-topbar" : ""}`}>
      {!hideTopbar && (
        <aside className="pdv-topbar">
          <div className="pdv-brand">
            <img src="/cda-icon.png" alt="" />
            <div>
              <strong>Caixa PDV</strong>
              <span>Venda local, mesas e produtos</span>
            </div>
          </div>
          <nav className="pdv-tabs">
            <TabButton icon={ShoppingCart} active={tab === "sale"} onClick={() => setTab("sale")} label="Venda" />
            <TabButton icon={Utensils} active={tab === "tables"} onClick={() => setTab("tables")} label="Mesas" />
            <TabButton icon={LayoutGrid} active={tab === "products"} onClick={() => setTab("products")} label="Produtos" />
            <TabButton icon={ClipboardList} active={tab === "history"} onClick={() => setTab("history")} label="Historico" />
            <TabButton icon={ReceiptText} active={tab === "reports"} onClick={() => setTab("reports")} label="Relatorios" />
            <TabButton icon={Settings} active={tab === "advanced"} onClick={() => setTab("advanced")} label="Avancado" />
          </nav>
        </aside>
      )}

      <main className="pdv-workspace">
        {tab === "sale" && (
          <PdvSaleScreen
            title="Venda direta"
            snapshot={snapshot}
            products={products}
            activeCategory={activeCategory}
            quantity={quantity}
            cart={cart}
            discount={discount}
            busy={busy}
            setActiveCategory={setActiveCategory}
            setQuantity={setQuantity}
            addProduct={addProduct}
            setCart={setCart}
            setDiscount={setDiscount}
            selectedItemIds={selectedDirectItemIds}
            setSelectedItemIds={setSelectedDirectItemIds}
            finishLabel="Receber e finalizar"
            onFinish={finishDirectSale}
            settings={visibleSettings}
            saleMode={directSaleMode}
            setSaleMode={setDirectSaleMode}
          />
        )}

        {tab === "tables" && !activeTable && (
          <section className="pdv-panel pdv-tables-screen">
            <div className="pdv-section-head">
              <div>
                <span className="pdv-eyebrow">Mapa de mesas</span>
                <h1>Mesas</h1>
              </div>
              <div className="pdv-filter-row pdv-table-filter-tools" aria-label="Buscar e filtrar mesas">
                <label className="pdv-table-search">
                  <Search size={17} aria-hidden="true" />
                  <input
                    aria-label="Buscar mesa ou submesa"
                    value={tableSearch}
                    onChange={(event) => setTableSearch(event.target.value)}
                    placeholder="Buscar mesa ou submesa"
                  />
                  {tableSearch && (
                    <button type="button" aria-label="Limpar busca de mesas" onClick={() => setTableSearch("")}>
                      <X size={16} />
                    </button>
                  )}
                </label>
                {(["Todas", "Livre", "Ocupada", "Fechamento", "Reservada"] as const).map((status) => (
                  <button className={`${status.toLowerCase()} ${tableFilter === status ? "active" : ""}`} key={status} onClick={() => setTableFilter(status)}>
                    {status}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="pdv-table-grid"
              style={{
                "--pdv-table-cols": visibleSettings.tableColumns || 9,
                "--pdv-table-card-height": `${visibleSettings.tableCardHeight || 96}px`
              } as React.CSSProperties}
            >
              {visibleTables.map((table) => {
                const searchDetails = tableSearchDetails(table, tableSearch);
                const searchedSubtable = searchDetails.subtables.length === 1 ? searchDetails.subtables[0] : "";
                const hasSubtableDefinitions = Boolean(table.subtables?.length || table.items.some((item) => item.subtableName));
                const hasMainItems = table.items.some((item) => !item.subtableName);
                const hasSubtableItems = table.items.some((item) => item.subtableName);
                return (
                  <article
                    className={`pdv-table-card ${table.status.toLowerCase()} ${hasSubtableDefinitions ? "has-subtables" : ""} ${hasSubtableItems && hasMainItems ? "mixed-subtables" : ""} ${hasSubtableDefinitions && !table.items.length ? "empty-subtables" : ""}`}
                    key={table.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTable(table, searchedSubtable)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTableMenu({ x: event.clientX, y: event.clientY, table });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTable(table, searchedSubtable);
                      }
                    }}
                  >
                    <strong>{String(table.number).padStart(3, "0")}</strong>
                    <span>{table.status}</span>
                    <small>Abertura: {shortTime(table.openedAt) || "-"}</small>
                    {snapshot.settings.tablePeopleEnabled && <small>Pessoas: {table.people || "-"}</small>}
                    {table.note && <small className="pdv-table-note" title={table.note}>Obs.: {table.note}</small>}
                    {searchDetails.subtables.length > 0 && (
                      <small className="pdv-table-search-match" title={searchDetails.subtables.join(", ")}>
                        Submesa: {searchDetails.subtables.join(", ")}
                      </small>
                    )}
                    <b>{table.total ? money(table.total) : "Vr Total:"}</b>
                  </article>
                );
              })}
              {!visibleTables.length && (
                <div className="pdv-table-search-empty">
                  <Search size={24} />
                  <strong>Nenhuma mesa encontrada</strong>
                  <span>Tente outro número, nome de submesa ou filtro.</span>
                </div>
              )}
              {!tableSearch.trim() && (
                <button className="pdv-table-card pdv-quick-value-card" type="button" onClick={() => setQuickValueModalOpen(true)}>
                  <strong>+</strong>
                </button>
              )}
            </div>
            {tableMenu && (
              <ContextMenu x={tableMenu.x} y={tableMenu.y} onClose={() => setTableMenu(null)}>
                <button onClick={() => runTableAction("open", tableMenu.table)}>Abrir mesa</button>
                <button onClick={() => runTableAction(tableMenu.table.status === "Livre" ? "reserve" : "free", tableMenu.table)}>
                  {tableMenu.table.status === "Livre" ? "Reservar mesa" : tableMenu.table.status === "Reservada" ? "Cancelar reserva" : "Liberar mesa"}
                </button>
                <button onClick={() => runTableAction("closing", tableMenu.table)}>Marcar fechamento</button>
                <button onClick={() => runTableAction("details", tableMenu.table)}>Ver detalhes</button>
                <button onClick={() => runTableAction("history", tableMenu.table)}>Ver historico da mesa</button>
                <button className="danger" onClick={() => runTableAction("cancel", tableMenu.table)}>Cancelar mesa</button>
              </ContextMenu>
            )}
          </section>
        )}

        {tab === "tables" && activeTable && (
          <PdvSaleScreen
            title={`Mesa ${String(activeTable.number).padStart(3, "0")}`}
            subtitle={`Aberta ${shortTime(activeTable.openedAt) || "agora"}${snapshot.settings.tablePeopleEnabled ? ` | ${activeTable.people || 1} pessoa(s)` : ""}${tableSaveState === "error" ? " | erro ao salvar" : ""}`}
            snapshot={snapshot}
            products={products}
            activeCategory={activeCategory}
            quantity={quantity}
            cart={tableCart}
            discount={0}
            busy={busy}
            setActiveCategory={setActiveCategory}
            setQuantity={setQuantity}
            addProduct={addProduct}
            setCart={updateLocalTableCart}
            setDiscount={() => undefined}
            finishLabel="Fechar conta"
            onFinish={requestCloseTable}
            tablePeople={tablePeople}
            tableNote={tableNote}
            activeTableNumber={activeTable.number}
            setTablePeople={updateLocalTablePeople}
            setTableNote={updateLocalTableNote}
            selectedItemIds={selectedTableItemIds}
            setSelectedItemIds={setSelectedTableItemIds}
            settings={visibleSettings}
            currentSubtable={currentSubtable}
            subtableNames={subtableNames}
            setSubtableNames={updateLocalSubtableNames}
            setCurrentSubtable={setCurrentSubtable}
            onCloseSubtable={requestCloseSubtable}
            onDeleteSubtable={deleteSubtable}
            onDeleteAllSubtables={deleteAllSubtables}
            onMoveSelectedToSubtable={moveSelectedItemsToSubtable}
            onRenameSubtable={renameSubtable}
            onOpenTransferredTable={async (tableNumber, subtableName) => {
              const refreshed = await load();
              resetTableMutationTracking();
              applyFreshOpenTable(refreshed, tableNumber);
              setCurrentSubtable(subtableName || "");
              setSelectedTableItemIds([]);
            }}
            openPdvTable={openPdvTable}
            savePdvTableItems={savePdvTableItems}
            transferPdvTableItems={transferPdvTableItems}
            onCancelWholeTable={async () => {
              await cancelPdvTable(activeTable.number);
              setActiveTable(null);
              setTableCart([]);
              setSelectedTableItemIds([]);
              await load();
            }}
          />
        )}

        {tab === "products" && <ProductsScreen snapshot={snapshot} readOnly={isRemoteClient} onImportCose={importPdvPreset} onPreviewCose={previewPdvPreset} onRemoveCose={removePdvPreset} onPreviewImportFile={previewImportFile} onImportFile={importFile} busy={busy} onProductsUpdated={load} updatePdvProducts={updatePdvProducts} savePdvCategory={savePdvCategory} savePdvProduct={savePdvProduct} removePdvProduct={removePdvProduct} />}
        {tab === "history" && <HistoryScreen snapshot={snapshot} initialView={initialHistoryView} hideNavigation={hideHistoryNavigation} readOnly={isRemoteClient} onChanged={load} saveCustomer={savePdvCustomer} receiveReceivable={receivePdvReceivable} updateReceivable={updatePdvReceivable} cancelReceivable={cancelPdvReceivable} allowPrint={!isRemoteClient || (snapshot.settings.receiptAllowClientPrint !== false && remoteSession?.allowPrint !== false)} receiptPrintTargets={receiptPrintTargets} onRemoteReceiptPrint={onRemoteReceiptPrint} onNavigateMain={onNavigateMain} />}
        {tab === "reports" && <ReportsScreen snapshot={snapshot} />}
        {tab === "advanced" && <AdvancedScreen snapshot={snapshot} readOnly={!canConfigureServer} clientVisualSettings={clientVisualSettings} onClientVisualSettingsChange={saveClientVisualSettings} onImportCose={importPdvPreset} onPreviewCose={previewPdvPreset} onPreviewImportFile={previewImportFile} onImportFile={importFile} busy={busy} onSettingsUpdated={load} savePdvSettings={savePdvSettings} externalActionsRef={advancedSettingsActionsRef} onDirtyChange={onAdvancedSettingsDirtyChange} forcedSection={advancedSection} hideNavigation={hideAdvancedNavigation} />}
      </main>

      {toast && (
        <button className="pdv-toast" onClick={() => setToast("")}>
          <Check size={18} /> {toast}
        </button>
      )}
      {checkoutTarget && (
        <PaymentModal
          total={checkoutTarget.total}
          busy={busy}
          customers={snapshot.customers}
          onSaveCustomer={savePdvCustomer}
          skipConfirmation={Boolean(snapshot.settings.skipPaymentConfirmation)}
          title={checkoutTarget.kind === "direct" && checkoutTarget.manual ? "Receber valor avulso" : "Pagamento"}
          initialPayments={checkoutTarget.kind === "table" || checkoutTarget.kind === "table-scope" ? checkoutTarget.initialPayments || [] : []}
          previousPayments={checkoutTarget.kind === "direct" ? [] : snapshot.recentSales
            .filter((sale) => sale.type === "Mesa" && sale.status === "Parcial" && (
              checkoutTarget.table.sessionId
                ? sale.tableSessionId === checkoutTarget.table.sessionId || (!sale.tableSessionId && Boolean(checkoutTarget.table.openedAt) && sale.tableNumber === checkoutTarget.table.number && sale.createdAt >= checkoutTarget.table.openedAt!)
                : sale.tableNumber === checkoutTarget.table.number && Boolean(checkoutTarget.table.openedAt) && sale.createdAt >= checkoutTarget.table.openedAt!
            ))
            .flatMap((sale) => sale.payments.map((payment) => ({ ...payment, saleId: sale.id, operationLabel: sale.observations || shortTime(sale.createdAt) || "Fechamento parcial" })))}
          onEditPreviousPayment={isRemoteClient && remoteSession?.allowEdit !== true ? undefined : (payment) => {
            const sale = snapshot.recentSales.find((item) => item.id === payment.saleId);
            const original = sale?.payments.find((item) => item.id === payment.id);
            if (sale && original) setCorrectingPartialPayment({ sale, payment: original });
          }}
          showDescription={Boolean(checkoutTarget.kind !== "direct" && checkoutTarget.kind !== "table")}
          onCancel={() => {
            if (checkoutTarget.kind === "table-partial-items") {
              // Restaurar seleÃ§Ã£o anterior ao voltar do pagamento
              setPartialSelectedItemIds(checkoutTarget.items.map((i) => i.id));
              setCheckoutTarget(null);
              setPartialItemsModalOpen(true);
            } else if (checkoutTarget.kind === "table" || checkoutTarget.kind === "table-scope") {
              setCheckoutTarget(null);
              setTableCloseMenuOpen(true);
            } else {
              setCheckoutTarget(null);
            }
          }}
          onConfirm={(payments, observations) => {
            if (checkoutTarget.kind === "direct") {
              return confirmDirectSale(payments, checkoutTarget.items || cart, checkoutTarget.saleType, checkoutTarget.operationId);
            } else if (checkoutTarget.kind === "table") {
              return confirmCloseTable(payments);
            } else {
              return confirmPartialTable(checkoutTarget, payments, observations);
            }
          }}
        />
      )}
      {!checkoutTarget && tableCloseMenuOpen && activeTable && (
        <TableCloseMenu
          table={{ ...activeTable, people: tablePeople, items: activeCloseItems, total: activeCloseTotal }}
          subtotal={activeCloseTotal}
          scopeLabel={tableCloseScope.kind === "subtable"
            ? `Submesa ${tableCloseScope.subtableName}`
            : tableCloseScope.kind === "main" ? "Mesa principal" : undefined}
          roundingStep={snapshot.settings.roundingStep ?? remoteSession?.roundingStep ?? roundingStep}
          roundingDirection={snapshot.settings.roundingDirection ?? remoteSession?.roundingDirection ?? roundingDirection}
          onPeopleChange={updateLocalTablePeople}
          onCancel={() => {
            setTableCloseMenuOpen(false);
            setTableCloseScope({ kind: "all" });
            void setPdvTableStatus(activeTable.number, "Ocupada");
            setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
          }}
          onPartialItems={() => {
            setTableCloseMenuOpen(false);
            setPartialItemsModalOpen(true);
          }}
          onCloseTotal={(total, discount, initialPayments) => {
            setTableCloseMenuOpen(false);
            if (tableCloseScope.kind === "all") {
              setCheckoutTarget({ kind: "table", table: activeTable, total, discount, initialPayments, operationId: crypto.randomUUID() });
            } else {
              setCheckoutTarget({
                kind: "table-scope",
                table: activeTable,
                scope: tableCloseScope,
                total,
                discount,
                initialPayments,
                items: activeCloseItems,
                operationId: crypto.randomUUID()
              });
            }
          }}
        />
      )}
      {!checkoutTarget && !tableCloseMenuOpen && partialItemsModalOpen && activeTable && (
        <PartialItemsModal
          table={activeTable}
          cart={tableCloseScope.kind === "all"
            ? tableCart
            : tableCart.filter((item) => tableCloseScope.kind === "main"
              ? !item.subtableName
              : (item.subtableName || "") === tableCloseScope.subtableName)}
          previousPartials={snapshot.recentSales.filter((sale) => sale.type === "Mesa" && sale.status === "Parcial" && (
            activeTable.sessionId
              ? sale.tableSessionId === activeTable.sessionId || (!sale.tableSessionId && Boolean(activeTable.openedAt) && sale.tableNumber === activeTable.number && sale.createdAt >= activeTable.openedAt!)
              : sale.tableNumber === activeTable.number && Boolean(activeTable.openedAt) && sale.createdAt >= activeTable.openedAt!
          ))}
          defaultSelectedIds={partialSelectedItemIds}
          onSelectedIdsChange={setPartialSelectedItemIds}
          onResetPaidItems={resetPaidItemStates}
          onComplete={finalizeFullyPaidTable}
          onCancel={() => {
            setPartialItemsModalOpen(false);
            setTableCloseScope({ kind: "all" });
            void setPdvTableStatus(activeTable.number, "Ocupada");
            setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
          }}
          onConfirm={(items) => {
            setPartialItemsModalOpen(false);
            requestPartialByItems(items);
          }}
        />
      )}
      {!checkoutTarget && !tableCloseMenuOpen && !partialItemsModalOpen && partialValueModalOpen && activeTable && (
        <PartialValueModal
          table={activeTable}
          maxValue={tableTotal}
          onCancel={() => setPartialValueModalOpen(false)}
          onConfirm={(value) => requestPartialByValue(value)}
        />
      )}
      {!checkoutTarget && !tableCloseMenuOpen && !partialItemsModalOpen && !partialValueModalOpen && quickValueModalOpen && (
        <QuickValueModal
          onCancel={() => setQuickValueModalOpen(false)}
          onConfirm={(item, mode) => {
            setQuickValueModalOpen(false);
            setDirectSaleMode(mode === "Onibus" ? "Onibus" : "Venda direta");
            setCheckoutTarget({
              kind: "direct",
              total: item.total,
              items: [item],
              manual: true,
              saleType: mode === "Mesa" ? "Mesa" : mode === "Onibus" ? "Onibus" : "Venda direta",
              operationId: crypto.randomUUID()
            });
          }}
        />
      )}
      {confirmRequest && (
        <PdvConfirmModal
          title={confirmRequest.title}
          message={confirmRequest.message}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            const request = confirmRequest;
            setConfirmRequest(null);
            void request.action().catch((error) => setToast(error instanceof Error ? error.message : "Nao foi possivel concluir a acao."));
          }}
        />
      )}
      {correctingPartialPayment && (
        <PaymentMethodCorrectionModal
          payment={correctingPartialPayment.payment}
          onCancel={() => setCorrectingPartialPayment(null)}
          onConfirm={async (correctedPayment) => {
            const { sale, payment } = correctingPartialPayment;
            await updatePdvSalePayments(sale.id, sale.payments.map((item) => item.id === payment.id ? correctedPayment : item));
            setCorrectingPartialPayment(null);
            await load();
          }}
        />
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      {pendingProduct && snapshot.settings.complementsEnabled && (
        <ComplementModal
          product={pendingProduct.product}
          quantity={pendingProduct.quantity}
          complements={complementsForProduct(pendingProduct.product, snapshot.products)}
          onCancel={() => addConfiguredProduct(pendingProduct.product, pendingProduct.unitPrice ?? pendingProduct.product.price, [])}
          onConfirm={addConfiguredProduct}
        />
      )}
      {pendingMeasureProduct && (
        <QuantityPriceModal
          product={pendingMeasureProduct.product}
          defaultQuantity={quantity}
          onCancel={() => setPendingMeasureProduct(null)}
          onConfirm={(resolved) => {
            const target = pendingMeasureProduct;
            setPendingMeasureProduct(null);
            addResolvedProduct(target.product, resolved, target.direct);
          }}
        />
      )}
      {completedReceipt && (
        <PdvReceiptDraftModal
          sale={completedReceipt.sale}
          receivable={completedReceipt.receivable}
          receiptSettings={snapshot.settings}
          customers={snapshot.customers}
          allowPrint={!isRemoteClient || (snapshot.settings.receiptAllowClientPrint !== false && remoteSession?.allowPrint !== false)}
          printTargets={receiptPrintTargets}
          onRemotePrint={onRemoteReceiptPrint}
          onClose={() => setCompletedReceipt(null)}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

function PdvSaleScreen(props: {
  title: string;
  subtitle?: string;
  snapshot: PdvSnapshot;
  products: PdvProduct[];
  activeCategory: string;
  quantity: number;
  cart: PdvCartItem[];
  discount: number;
  busy: boolean;
  finishLabel: string;
  setActiveCategory: (value: string) => void;
  setQuantity: (value: number) => void;
  addProduct: (product: PdvProduct, direct?: boolean) => void;
  setCart: (items: PdvCartItem[] | ((current: PdvCartItem[]) => PdvCartItem[])) => void;
  setDiscount: (value: number) => void;
  onFinish: () => void;
  tablePeople?: number;
  tableNote?: string;
  activeTableNumber?: number;
  setTablePeople?: (value: number) => void;
  setTableNote?: (value: string) => void;
  selectedItemIds?: string[];
  setSelectedItemIds?: (value: string[] | ((current: string[]) => string[])) => void;
  settings: PdvSnapshot["settings"];
  saleMode?: "Venda direta" | "Onibus";
  setSaleMode?: (value: "Venda direta" | "Onibus") => void;
  currentSubtable?: string;
  subtableNames?: string[];
  setCurrentSubtable?: (value: string) => void;
  setSubtableNames?: (value: string[] | ((current: string[]) => string[])) => void;
  onCloseSubtable?: (name: string) => void;
  onDeleteSubtable?: (name: string) => void;
  onDeleteAllSubtables?: () => void;
  onMoveSelectedToSubtable?: (name: string) => void;
  onRenameSubtable?: (oldName: string, newName: string) => void;
  onOpenTransferredTable?: (tableNumber: number, subtableName?: string) => void | Promise<void>;
  openPdvTable?: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  savePdvTableItems?: (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => Promise<void>;
  transferPdvTableItems?: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
  onCancelWholeTable?: () => void | Promise<void>;
}) {
  const visibleCart = props.activeTableNumber && props.settings.subtablesEnabled
    ? props.cart.filter((item) => (item.subtableName || "") === (props.currentSubtable || ""))
    : props.cart;
  const updateVisibleCart = (updater: (items: PdvCartItem[]) => PdvCartItem[]) => {
    if (!props.activeTableNumber || !props.settings.subtablesEnabled) {
      props.setCart(updater);
      return;
    }
    props.setCart((current) => {
      const visibleIds = new Set(current.filter((item) => (item.subtableName || "") === (props.currentSubtable || "")).map((item) => item.id));
      const nextVisible = updater(current.filter((item) => visibleIds.has(item.id)));
      let visibleIndex = 0;
      const next = current.map((item) => visibleIds.has(item.id) ? nextVisible[visibleIndex++] : item);
      return [...next, ...nextVisible.slice(visibleIndex)];
    });
  };
  const subtotal = roundMoney(visibleCart.reduce((total, item) => total + (props.activeTableNumber ? unpaidItemTotal(item) : item.total), 0));
  const finalTotal = Math.max(0, roundMoney(subtotal - props.discount));
  const cartListRef = useRef<HTMLDivElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: PdvCartItem } | null>(null);
  const [transferItem, setTransferItem] = useState<PdvCartItem | null>(null);
  const [transferListOpen, setTransferListOpen] = useState(false);
  const [transferAllOnOpen, setTransferAllOnOpen] = useState(false);
  const [transferPreferredSubtable, setTransferPreferredSubtable] = useState("");
  const [editingItem, setEditingItem] = useState<{
    item: PdvCartItem;
    mode: "quantity" | "discount" | "price" | "note";
    discountKind?: "value" | "percent";
  } | null>(null);
  const [splitItem, setSplitItem] = useState<PdvCartItem | null>(null);
  const [movingItem, setMovingItem] = useState<{ item: PdvCartItem; after: boolean } | null>(null);
  const [removeRequest, setRemoveRequest] = useState<PdvCartItem | null>(null);
  const [cancelTableRequest, setCancelTableRequest] = useState(false);
  const [subtableManagerOpen, setSubtableManagerOpen] = useState(false);
  const [directDiscountOpen, setDirectDiscountOpen] = useState(false);
  const [productLookupOpen, setProductLookupOpen] = useState(false);
  const [cartDensity, setCartDensity] = useState<"ultra" | "compact" | "normal" | "comfortable">(() => {
    const saved = window.localStorage.getItem("caixa.pdv.cart-density-v2");
    return saved === "ultra" || saved === "compact" || saved === "normal" || saved === "comfortable" ? saved : "compact";
  });
  const [cartPaneWidth, setCartPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("caixa.pdv.cart-pane-width"));
    return Number.isFinite(saved) ? Math.min(50, Math.max(26, saved)) : 34;
  });
  const [cartListHeight, setCartListHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem("caixa.pdv.cart-list-height"));
    return Number.isFinite(saved) ? Math.min(900, Math.max(88, saved)) : Math.max(320, Math.min(560, window.innerHeight - 240));
  });
  const [categoryPaneHeight, setCategoryPaneHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem("caixa.pdv.category-pane-height"));
    // 136px era o padrao antigo e consumia quase uma linha inteira de produtos
    // em notebooks. Valores realmente personalizados continuam preservados.
    const resolved = Number.isFinite(saved) && saved !== 136 ? saved : 104;
    return Math.min(280, Math.max(82, resolved));
  });
  const previousVisibleItemIds = useRef<string[]>([]);
  const requestedItemId = props.selectedItemIds?.[0] || "";
  const previousRequestedIndex = previousVisibleItemIds.current.indexOf(requestedItemId);
  const positionalFallback = requestedItemId && previousRequestedIndex >= 0
    ? visibleCart[Math.min(previousRequestedIndex, Math.max(0, visibleCart.length - 1))]?.id
    : "";
  const activeItemId = requestedItemId && visibleCart.some((item) => item.id === requestedItemId)
    ? requestedItemId
    : positionalFallback || visibleCart.at(-1)?.id || "";
  const activeItem = visibleCart.find((item) => item.id === activeItemId) || visibleCart.at(-1) || null;
  const subtableNames = [...new Set([...(props.subtableNames || []), ...props.cart.map((item) => item.subtableName || "").filter(Boolean)])];
  const operationalDensity = (props.settings.productCardHeight || 60) <= 54 ? "compact" : (props.settings.productCardHeight || 60) >= 70 ? "comfortable" : "normal";
  const cartAreaRef = useRef<HTMLElement | null>(null);
  const persistSubtableNames = (nextNames: string[]) => {
    props.setSubtableNames?.(nextNames);
    // O efeito de autosave da mesa grava nomes e itens como um unico snapshot.
    // Gravar apenas os nomes aqui usava um carrinho capturado antes da ultima mudanca.
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (itemMenu) { event.preventDefault(); setItemMenu(null); return; }
      if (transferItem) { event.preventDefault(); setTransferItem(null); return; }
      if (transferListOpen) { event.preventDefault(); setTransferListOpen(false); return; }
      if (editingItem) { event.preventDefault(); setEditingItem(null); return; }
      if (splitItem) { event.preventDefault(); setSplitItem(null); return; }
      if (movingItem) { event.preventDefault(); setMovingItem(null); return; }
      if (directDiscountOpen) { event.preventDefault(); setDirectDiscountOpen(false); return; }
      if (productLookupOpen) { event.preventDefault(); setProductLookupOpen(false); return; }
      if (subtableManagerOpen) { event.preventDefault(); setSubtableManagerOpen(false); }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [itemMenu, transferItem, transferListOpen, editingItem, splitItem, movingItem, directDiscountOpen, productLookupOpen, subtableManagerOpen]);

  useEffect(() => {
    window.localStorage.setItem("caixa.pdv.cart-density-v2", cartDensity);
  }, [cartDensity]);

  useEffect(() => {
    window.localStorage.setItem("caixa.pdv.cart-pane-width", String(cartPaneWidth));
  }, [cartPaneWidth]);

  useEffect(() => {
    window.localStorage.setItem("caixa.pdv.category-pane-height", String(categoryPaneHeight));
  }, [categoryPaneHeight]);

  useEffect(() => {
    window.localStorage.setItem("caixa.pdv.cart-list-height", String(cartListHeight));
  }, [cartListHeight]);

  const startResize = (axis: "horizontal" | "vertical" | "cart-height", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialCartWidth = cartPaneWidth;
    const initialCategoryHeight = categoryPaneHeight;
    const initialCartListHeight = cartListHeight;
    const cartAreaHeight = cartAreaRef.current?.getBoundingClientRect().height || window.innerHeight;
    const move = (nextEvent: PointerEvent) => {
      if (axis === "horizontal") {
        const delta = ((startX - nextEvent.clientX) / Math.max(1, window.innerWidth)) * 100;
        setCartPaneWidth(Math.min(50, Math.max(26, initialCartWidth + delta)));
      } else if (axis === "vertical") {
        setCategoryPaneHeight(Math.min(280, Math.max(96, initialCategoryHeight + nextEvent.clientY - startY)));
      } else {
        const controlsSpace = cartDensity === "ultra" ? 88 : cartDensity === "compact" ? 96 : 142;
        const maxHeight = Math.max(88, Math.min(900, cartAreaHeight - controlsSpace));
        setCartListHeight(Math.min(maxHeight, Math.max(88, initialCartListHeight + nextEvent.clientY - startY)));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  useEffect(() => {
    if (!props.setSelectedItemIds) {
      return;
    }
    const selectedId = props.selectedItemIds?.[0];
    const nextIds = visibleCart.map((item) => item.id);
    const previousIds = previousVisibleItemIds.current;
    if (!visibleCart.length) {
      props.setSelectedItemIds([]);
      previousVisibleItemIds.current = [];
      return;
    }
    const addedId = nextIds.find((id) => !previousIds.includes(id));
    if (!selectedId) {
      props.setSelectedItemIds([addedId || visibleCart[visibleCart.length - 1].id]);
    } else if (!nextIds.includes(selectedId)) {
      const previousIndex = previousIds.indexOf(selectedId);
      const fallback = nextIds[Math.min(Math.max(0, previousIndex), nextIds.length - 1)] || nextIds.at(-1);
      props.setSelectedItemIds(fallback ? [fallback] : []);
    } else if (addedId) {
      props.setSelectedItemIds([addedId]);
    }
    previousVisibleItemIds.current = nextIds;
  }, [visibleCart, props.currentSubtable]);

  useEffect(() => {
    if (!activeItemId || !cartListRef.current) return;
    const item = cartListRef.current.querySelector<HTMLElement>(`[data-cart-item-id="${activeItemId}"]`);
    item?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [activeItemId, visibleCart.length, visibleCart.at(-1)?.id]);

  const selectCartItemByDirection = (direction: -1 | 1) => {
    if (!props.setSelectedItemIds || !visibleCart.length) {
      return;
    }
    const currentId = activeItemId || visibleCart[visibleCart.length - 1].id;
    const currentIndex = Math.max(0, visibleCart.findIndex((item) => item.id === currentId));
    const nextIndex = Math.max(0, Math.min(visibleCart.length - 1, currentIndex + direction));
    props.setSelectedItemIds([visibleCart[nextIndex].id]);
  };

  const selectAfterRemoving = (id: string) => {
    if (!props.setSelectedItemIds) {
      return;
    }
    const index = visibleCart.findIndex((item) => item.id === id);
    const remaining = visibleCart.filter((item) => item.id !== id);
    const fallback = remaining[Math.min(Math.max(0, index), remaining.length - 1)] || remaining.at(-1);
    props.setSelectedItemIds(fallback ? [fallback.id] : []);
  };

  const repeatLastItem = () => {
    const last = visibleCart[visibleCart.length - 1];
    if (!last) {
      return;
    }
    updateVisibleCart((current) => mergeCartItem(current, { ...last, id: crypto.randomUUID(), quantity: 1, measureLabel: "", total: roundMoney(last.unitPrice) }, props.snapshot.settings.stackIdenticalItems));
  };
  const runItemAction = async (action: string, item: PdvCartItem) => {
    setItemMenu(null);
    if (action === "quantity") {
      setEditingItem({ item, mode: "quantity" });
    }
    if (action === "discount-value") {
      setEditingItem({ item, mode: "discount", discountKind: "value" });
    }
    if (action === "discount-percent") {
      setEditingItem({ item, mode: "discount", discountKind: "percent" });
    }
    if (action === "price") {
      setEditingItem({ item, mode: "price" });
    }
    if (action === "note") {
      setEditingItem({ item, mode: "note" });
    }
    if (action === "split") {
      setSplitItem(item);
    }
    if (action === "remove") {
      setRemoveRequest(item);
    }
    if (action === "up") {
      updateVisibleCart((current) => moveCartItem(current, item.id, -1));
    }
    if (action === "down") {
      updateVisibleCart((current) => moveCartItem(current, item.id, 1));
    }
    if (action === "before" || action === "after") {
      setMovingItem({ item, after: action === "after" });
    }
    if (action === "transfer-table") {
      setTransferItem(item);
    }
    if (action === "transfer-subtable") {
      setTransferItem(item);
    }
  };
  return (
    <section
      className={`pdv-sale-grid pdv-density-${operationalDensity} ${props.activeTableNumber ? "pdv-table-open-grid" : ""}`}
      style={{
        "--pdv-cart-pane-width": `${cartPaneWidth}%`
      } as React.CSSProperties}
    >
      <div className="pdv-panel pdv-products-area">
        <div className="pdv-operational-head">
          <div className="pdv-sale-identity">
            <span className="pdv-eyebrow">Lancamento rapido</span>
            <h1>{props.title}</h1>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <div className={`pdv-quantity-box ${props.activeTableNumber && props.settings.subtablesEnabled ? "has-subtable" : ""} ${!props.activeTableNumber && props.saleMode ? "has-sale-mode" : ""}`}>
            {props.activeTableNumber && props.settings.subtablesEnabled && (
              <button className="pdv-subtable-trigger" type="button" onClick={() => setSubtableManagerOpen(true)}>
                Submesa: {props.currentSubtable || "Principal"}
              </button>
            )}
            <span>Qtde</span>
            <button onClick={() => props.setQuantity(Math.max(1, props.quantity - 1))}><Minus size={18} /></button>
            <input type="number" min={1} value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value || 1))} />
            <button onClick={() => props.setQuantity(props.quantity + 1)}><Plus size={18} /></button>
            <button title="Limpar quantidade" onClick={() => props.setQuantity(1)}>Limpar</button>
            <button title="Repetir ultimo produto" disabled={!props.cart.length} onClick={repeatLastItem}>Repetir</button>
            {!props.activeTableNumber && props.saleMode && props.setSaleMode && (
              <select className="pdv-sale-mode-select" value={props.saleMode} onChange={(event) => props.setSaleMode?.(event.target.value as "Venda direta" | "Onibus") } title="Tipo desta venda">
                <option value="Venda direta">Venda</option>
                <option value="Onibus">Onibus</option>
              </select>
            )}
          </div>
        </div>

        <div
          className="pdv-category-grid"
          style={{
            "--pdv-category-cols": props.settings.categoryColumns || 5,
            "--pdv-category-card-height": `${props.settings.categoryCardHeight || 52}px`,
            "--pdv-category-pane-height": `${categoryPaneHeight}px`
          } as React.CSSProperties}
        >
          <button className={props.activeCategory === "todos" ? "active" : ""} onClick={() => props.setActiveCategory("todos")}>Todos</button>
          {props.snapshot.categories.filter((category) => category.active).map((category) => (
            <button className={props.activeCategory === category.id ? "active" : ""} key={category.id} onClick={() => props.setActiveCategory(category.id)}>
              {category.name}
            </button>
          ))}
        </div>
        <div className="pdv-resize-handle pdv-resize-vertical" role="separator" aria-label="Redimensionar categorias e produtos" onPointerDown={(event) => startResize("vertical", event)} />
        <div
          className="pdv-product-grid"
          style={{
            "--pdv-grid-cols": props.settings.gridColumns || 5,
            "--pdv-product-card-height": `${props.settings.productCardHeight || 60}px`,
            "--pdv-product-font-size": `${props.settings.productFontSize || 14}px`
          } as React.CSSProperties}
        >
          {props.products.map((product) => (
            <button key={product.id} title={product.name} onClick={(event) => props.addProduct(product, event.shiftKey)}>
              <strong>{product.name}</strong>
              <span>{props.activeCategory === "todos" ? `${product.categoryName} | ` : ""}{money(product.price)}{product.unitMode === "kg" ? "/kg" : product.unitMode === "grama" ? "/g" : ""}</span>
            </button>
          ))}
          {!props.products.length && <div className="pdv-empty">Importe produtos ou ajuste a pesquisa.</div>}
        </div>
      </div>
      <div className="pdv-resize-handle pdv-resize-horizontal" role="separator" aria-label="Redimensionar produtos e carrinho" onPointerDown={(event) => startResize("horizontal", event)} />

      <aside ref={cartAreaRef} className={`pdv-panel pdv-cart-area cart-${cartDensity}`} style={{ "--pdv-cart-list-height": `${cartListHeight}px` } as React.CSSProperties}>
        <div className="pdv-cart-head">
          <div className="pdv-cart-title">
            <h2>Carrinho</h2>
            <span>{formatQuantity(visibleCart.reduce((total, item) => total + item.quantity, 0))} item(ns)</span>
          </div>
          <button className="pdv-cart-product-search" type="button" title="Consultar todos os produtos" onClick={() => setProductLookupOpen(true)}>
            <Search size={18} />
            Produtos
          </button>
          <div className="pdv-cart-density" aria-label="Tamanho dos itens do carrinho">
            <button type="button" title="Diminuir itens do carrinho" aria-label="Diminuir itens do carrinho" disabled={cartDensity === "ultra"} onClick={() => setCartDensity((current) => current === "comfortable" ? "normal" : current === "normal" ? "compact" : "ultra")}>-</button>
            <button type="button" title="Aumentar itens do carrinho" aria-label="Aumentar itens do carrinho" disabled={cartDensity === "comfortable"} onClick={() => setCartDensity((current) => current === "ultra" ? "compact" : current === "compact" ? "normal" : "comfortable")}>+</button>
          </div>
        </div>
        <div
          ref={cartListRef}
          className="pdv-cart-list"
          tabIndex={0}
          onContextMenu={(event) => {
            if (event.target !== event.currentTarget || !activeItem) {
              return;
            }
            event.preventDefault();
            setItemMenu({ x: event.clientX, y: event.clientY, item: activeItem });
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              selectCartItemByDirection(-1);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              selectCartItemByDirection(1);
            }
          }}
        >
          {visibleCart.map((item, index) => (
            <article
              key={item.id}
              data-cart-item-id={item.id}
              title={item.productName}
              className={`${activeItemId === item.id ? "selected" : ""} ${unpaidQuantity(item) <= 0.009 ? "paid" : ""}`.trim()}
              onClick={() => props.setSelectedItemIds?.([item.id])}
              onContextMenu={(event) => {
                event.preventDefault();
                props.setSelectedItemIds?.([item.id]);
                setItemMenu({ x: event.clientX, y: event.clientY, item });
              }}
              onDoubleClick={() => runItemAction("remove", item)}
            >
              <div>
                <strong>{index + 1}. {item.productName}</strong>
                <span>{item.measureLabel || formatQuantity(item.quantity)} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}{item.note ? ` | ${item.note}` : ""}{unpaidQuantity(item) <= 0.009 ? " | Pago" : item.paidQuantity ? ` | Restam ${formatQuantity(unpaidQuantity(item))}` : ""}</span>
                {adjustedItemOriginalTotal(item) !== null && (
                  <small className="pdv-cart-price-adjustment">
                    Original <s>{money(adjustedItemOriginalTotal(item)!)}</s> | Final {money(item.total)}
                  </small>
                )}
              </div>
              <b>{money(props.activeTableNumber ? unpaidItemTotal(item) : item.total)}</b>
            </article>
          ))}
          {!visibleCart.length && <div className="pdv-empty">Nenhum produto lancado nesta conta.</div>}
        </div>
        <div className="pdv-resize-handle pdv-resize-cart-height" role="separator" aria-label="Redimensionar altura da lista do carrinho" title="Arraste para aumentar ou diminuir a lista do carrinho" onPointerDown={(event) => startResize("cart-height", event)} />
        {itemMenu && (
          <ContextMenu x={itemMenu.x} y={itemMenu.y} onClose={() => setItemMenu(null)}>
            <button onClick={() => runItemAction("quantity", itemMenu.item)}>Alterar quantidade</button>
            <button onClick={() => runItemAction("discount-value", itemMenu.item)}>Desconto em R$</button>
            <button onClick={() => runItemAction("discount-percent", itemMenu.item)}>Desconto em %</button>
            <button onClick={() => runItemAction("price", itemMenu.item)}>Alterar preco neste lancamento</button>
            <button onClick={() => runItemAction("note", itemMenu.item)}>Adicionar observacao</button>
            <button disabled={Boolean(itemMenu.item.paidQuantity)} onClick={() => runItemAction("split", itemMenu.item)}>Dividir item entre pessoas</button>
            {props.setCurrentSubtable && <button onClick={() => runItemAction("transfer-table", itemMenu.item)}>Transferir para outra mesa</button>}
            {props.setCurrentSubtable && <button onClick={() => runItemAction("transfer-subtable", itemMenu.item)}>Transferir para submesa</button>}
            <button onClick={() => runItemAction("up", itemMenu.item)}>Mover para cima</button>
            <button onClick={() => runItemAction("down", itemMenu.item)}>Mover para baixo</button>
            <button onClick={() => runItemAction("before", itemMenu.item)}>Colocar antes de outro item</button>
            <button onClick={() => runItemAction("after", itemMenu.item)}>Colocar depois de outro item</button>
            <button className="danger" onClick={() => runItemAction("remove", itemMenu.item)}>Remover/cancelar produto</button>
          </ContextMenu>
        )}
        {!props.activeTableNumber && (
          <button className="pdv-ghost-button pdv-direct-discount-button" disabled={!props.cart.length} onClick={() => setDirectDiscountOpen(true)}>
            Desconto da venda{props.discount > 0 ? `: ${money(props.discount)}` : ""}
          </button>
        )}
        <div className="pdv-total-box">
          <span>Valor Total</span>
          <strong>{money(finalTotal)}</strong>
          <small>Subtotal {money(subtotal)}</small>
        </div>
            {props.activeTableNumber && (
          <div className="pdv-table-quick-actions">
            <button
              className="pdv-ghost-button"
              onClick={() => {
                const selected = visibleCart.find((row) => row.id === props.selectedItemIds?.[0]) || visibleCart[visibleCart.length - 1];
                if (selected) {
                  setEditingItem({ item: selected, mode: "note" });
                }
              }}
              disabled={!visibleCart.length}
            >
              Observacao
            </button>
            <button
              className="pdv-ghost-button"
              disabled={!visibleCart.length}
              onClick={() => {
                setTransferAllOnOpen(false);
                setTransferPreferredSubtable("");
                setTransferListOpen(true);
              }}
            >
              Transferir
            </button>
          </div>
        )}
        {!props.activeTableNumber && (
          <div className="pdv-action-row pdv-table-cart-actions pdv-direct-cart-actions">
            <button
              className="pdv-danger-button"
              disabled={!props.cart.length}
              onClick={() => {
                if (props.cart.length) setCancelTableRequest(true);
              }}
            >
              Cancelar
            </button>
            <button className="pdv-primary-button" disabled={props.busy || !props.cart.some((item) => unpaidQuantity(item) > 0.009)} onClick={props.onFinish}>
              {props.finishLabel}
            </button>
          </div>
        )}
        {props.activeTableNumber && (
          <div className="pdv-action-row pdv-table-cart-actions">
            <button
              className="pdv-danger-button"
              disabled={!props.cart.some((item) => unpaidQuantity(item) > 0.009)}
              onClick={() => {
                if (props.cart.length) setCancelTableRequest(true);
              }}
            >
              Cancelar
            </button>
            <button className="pdv-primary-button" disabled={props.busy || !props.cart.length} onClick={props.onFinish}>
              Fechar conta
            </button>
          </div>
        )}
        {transferListOpen && props.activeTableNumber && (
          <TransferListModal
            cart={visibleCart}
            tables={props.snapshot.tables}
            sourceTableNumber={props.activeTableNumber}
            openPdvTable={props.openPdvTable}
            savePdvTableItems={props.savePdvTableItems}
            transferPdvTableItems={props.transferPdvTableItems}
            selectAllInitially={transferAllOnOpen}
            preferredTargetSubtable={transferPreferredSubtable}
            onCancel={() => {
              setTransferListOpen(false);
              setTransferAllOnOpen(false);
              setTransferPreferredSubtable("");
            }}
            onTransferred={(nextSource, targetTableNumber, targetSubtable) => {
              props.setCart(nextSource);
              props.setSelectedItemIds?.(nextSource.at(-1) ? [nextSource.at(-1)!.id] : []);
              setTransferListOpen(false);
              setTransferAllOnOpen(false);
              setTransferPreferredSubtable("");
              void props.onOpenTransferredTable?.(targetTableNumber, targetSubtable);
            }}
          />
        )}
        {subtableManagerOpen && props.activeTableNumber && (
          <SubtableManagerModal
            cart={props.cart}
            currentSubtable={props.currentSubtable || ""}
            names={subtableNames}
            onClose={() => setSubtableManagerOpen(false)}
            onSelect={(name) => {
              props.setCurrentSubtable?.(name);
              setSubtableManagerOpen(false);
            }}
            onCreate={(name) => {
              props.setCurrentSubtable?.(name);
              persistSubtableNames(subtableNames.includes(name) ? subtableNames : [...subtableNames, name]);
              setSubtableManagerOpen(false);
            }}
            onRename={props.onRenameSubtable}
            onDelete={props.onDeleteSubtable}
            onCloseSubtable={props.onCloseSubtable}
            onDeleteAll={props.onDeleteAllSubtables}
            onTransfer={(name) => {
              props.setCurrentSubtable?.(name);
              setSubtableManagerOpen(false);
              setTransferAllOnOpen(true);
              setTransferPreferredSubtable(name);
              setTransferListOpen(true);
            }}
          />
        )}
        {transferItem && props.activeTableNumber && (
          <TransferItemModal
            item={transferItem}
            sourceTableNumber={props.activeTableNumber}
            tables={props.snapshot.tables}
            cart={props.cart}
            openPdvTable={props.openPdvTable}
            savePdvTableItems={props.savePdvTableItems}
            transferPdvTableItems={props.transferPdvTableItems}
            onCancel={() => setTransferItem(null)}
            onTransferred={(nextSource, targetTableNumber, targetSubtable) => {
              props.setCart(nextSource);
              props.setSelectedItemIds?.([]);
              setTransferItem(null);
              void props.onOpenTransferredTable?.(targetTableNumber, targetSubtable);
            }}
          />
        )}
        {editingItem && (
          <ItemEditModal
            item={editingItem.item}
            mode={editingItem.mode}
            discountKind={editingItem.discountKind}
            onCancel={() => setEditingItem(null)}
            onConfirm={(patch) => {
              updateVisibleCart((current) => updateCartItem(current, editingItem.item.id, patch));
              setEditingItem(null);
            }}
          />
        )}
        {productLookupOpen && (
          <ProductLookupModal
            products={props.snapshot.products.filter((product) => product.active && product.showOnPdv)}
            pageSize={props.settings.productLookupPageSize || 30}
            onCancel={() => setProductLookupOpen(false)}
            onSelect={(selectedProducts) => {
              selectedProducts.forEach((product) => {
                props.addProduct(product, selectedProducts.length > 1);
              });
              setProductLookupOpen(false);
            }}
          />
        )}
        {splitItem && (
          <SplitItemModal
            item={splitItem}
            onCancel={() => setSplitItem(null)}
            onConfirm={(people) => {
              const totalCents = Math.round(splitItem.total * 100);
              const discountCents = Math.round(splitItem.discount * 100);
              const baseTotalCents = Math.floor(totalCents / people);
              const totalRemainder = totalCents % people;
              const baseDiscountCents = Math.floor(discountCents / people);
              const discountRemainder = discountCents % people;
              const parts = Array.from({ length: people }, (_, index): PdvCartItem => ({
                ...splitItem,
                id: crypto.randomUUID(),
                quantity: roundQuantity(splitItem.quantity / people),
                total: (baseTotalCents + (index >= people - totalRemainder ? 1 : 0)) / 100,
                discount: (baseDiscountCents + (index >= people - discountRemainder ? 1 : 0)) / 100,
                paidQuantity: 0,
                measureLabel: `Parte ${index + 1}/${people}`,
                note: [splitItem.note, `Parte ${index + 1} de ${people}`].filter(Boolean).join(" | ")
              }));
              updateVisibleCart((current) => current.flatMap((item) => item.id === splitItem.id ? parts : [item]));
              props.setSelectedItemIds?.([parts[0].id]);
              setSplitItem(null);
            }}
          />
        )}
        {removeRequest && (
          <PdvConfirmModal
            title="Remover produto da conta?"
            message={`${removeRequest.productName} sera removido desta conta.`}
            onCancel={() => setRemoveRequest(null)}
            onConfirm={() => {
              selectAfterRemoving(removeRequest.id);
              props.setCart((current) => current.filter((row) => row.id !== removeRequest.id));
              setRemoveRequest(null);
            }}
          />
        )}
        {cancelTableRequest && (
          <CancelItemsModal
            isTable={Boolean(props.activeTableNumber)}
            cart={visibleCart}
            scopeLabel={props.activeTableNumber && props.settings.subtablesEnabled
              ? props.currentSubtable
                ? `submesa ${props.currentSubtable}`
                : subtableNames.length
                  ? "mesa principal"
                  : "mesa inteira"
              : undefined}
            onCancel={() => setCancelTableRequest(false)}
            onClear={() => {
              if (props.activeTableNumber && props.settings.subtablesEnabled && props.currentSubtable && props.onDeleteSubtable) {
                void Promise.resolve(props.onDeleteSubtable(props.currentSubtable)).then(() => setCancelTableRequest(false));
                return;
              }
              if (props.activeTableNumber && props.settings.subtablesEnabled && !props.currentSubtable && props.cart.some((item) => item.subtableName)) {
                props.setCart((current) => current.filter((item) => Boolean(item.subtableName)));
                props.setSelectedItemIds?.([]);
                setCancelTableRequest(false);
                return;
              }
              if (props.activeTableNumber && props.onCancelWholeTable) {
                void Promise.resolve(props.onCancelWholeTable()).then(() => setCancelTableRequest(false));
              } else {
                props.setCart([]);
                props.setSelectedItemIds?.([]);
                setCancelTableRequest(false);
              }
            }}
            onRemove={(item) => {
              selectAfterRemoving(item.id);
              props.setCart((current) => current.filter((row) => row.id !== item.id));
              setCancelTableRequest(false);
            }}
          />
        )}
        {movingItem && (
          <MoveItemModal
            item={movingItem.item}
            after={movingItem.after}
            cart={props.cart}
            onCancel={() => setMovingItem(null)}
            onConfirm={(referenceIndex) => {
              updateVisibleCart((current) => moveCartItemNear(current, movingItem.item.id, referenceIndex, movingItem.after));
              setMovingItem(null);
            }}
          />
        )}
        {directDiscountOpen && !props.activeTableNumber && (
          <DirectDiscountModal
            subtotal={subtotal}
            discount={props.discount}
            onCancel={() => setDirectDiscountOpen(false)}
            onConfirm={(value) => {
              props.setDiscount(value);
              setDirectDiscountOpen(false);
            }}
          />
        )}
      </aside>
    </section>
  );
}

function SplitItemModal({
  item,
  onCancel,
  onConfirm
}: {
  item: PdvCartItem;
  onCancel: () => void;
  onConfirm: (people: number) => void;
}) {
  const [people, setPeople] = useState(2);
  const totalCents = Math.round(item.total * 100);
  const baseCents = Math.floor(totalCents / people);
  const remainder = totalCents % people;
  const parts = Array.from({ length: people }, (_, index) => (baseCents + (index >= people - remainder ? 1 : 0)) / 100);
  useModalConfirmShortcut(() => onConfirm(people), onCancel, people >= 2);
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-split-item-modal" tabIndex={-1} autoFocus>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Divisao de produto</span>
            <h1>{item.productName}</h1>
            <p>O total de {money(item.total)} sera preservado exatamente.</p>
          </div>
          <button className="pdv-icon-button" type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        <label className="pdv-split-item-control">
          <span>Dividir entre quantas pessoas?</span>
          <div>
            <button type="button" onClick={() => setPeople((current) => Math.max(2, current - 1))}><Minus size={18} /></button>
            <input autoFocus type="number" min={2} max={20} value={people} onChange={(event) => setPeople(Math.max(2, Math.min(20, Number(event.target.value) || 2)))} />
            <button type="button" onClick={() => setPeople((current) => Math.min(20, current + 1))}><Plus size={18} /></button>
          </div>
        </label>
        <div className="pdv-split-item-preview">
          {parts.map((amount, index) => (
            <div key={index}>
              <span>Parte {index + 1}</span>
              <strong>{money(amount)}</strong>
            </div>
          ))}
        </div>
        {remainder > 0 && <small className="pdv-split-item-note">Os {remainder} centavo(s) restantes foram distribuidos nas ultimas partes.</small>}
        <div className="pdv-action-row">
          <button className="pdv-danger-button" type="button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" type="button" onClick={() => onConfirm(people)}>Dividir item</button>
        </div>
      </section>
    </div>
  );
}

function ProductLookupModal({
  products,
  pageSize,
  onCancel,
  onSelect
}: {
  products: PdvProduct[];
  pageSize: number;
  onCancel: () => void;
  onSelect: (products: PdvProduct[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const normalizedQuery = normalizeTableSearch(query);
  const filtered = products
    .filter((product) => !normalizedQuery || [
      product.name,
      product.categoryName,
      product.sku || "",
      product.barcode || ""
    ].some((value) => normalizeTableSearch(value).includes(normalizedQuery)))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
  const safePageSize = Math.max(10, Math.min(100, Math.floor(pageSize || 30)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * safePageSize, (safePage + 1) * safePageSize);
  const [activeId, setActiveId] = useState(products[0]?.id || "");
  const active = visible.find((product) => product.id === activeId) || visible[0];
  const selectedProducts = products.filter((product) => selectedIds.includes(product.id));
  const visibleIds = visible.map((product) => product.id).join("|");

  useEffect(() => {
    setPage(0);
  }, [normalizedQuery]);

  useEffect(() => {
    setSelectionAnchor(null);
  }, [safePage, normalizedQuery]);

  useEffect(() => {
    if (!active || active.id === activeId) return;
    setActiveId(active.id);
  }, [visibleIds, active?.id, activeId]);

  const submitProducts = (items: PdvProduct[]) => {
    if (!items.length) return;
    if (items.length > 1 && items.some((product) => product.unitMode !== "unidade")) {
      setNotice("Produtos vendidos por peso precisam ser adicionados individualmente para informar o peso correto.");
      return;
    }
    onSelect(items);
  };

  const toggleSelection = (product: PdvProduct, index: number, extendRange: boolean) => {
    setActiveId(product.id);
    if (extendRange && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, index);
      const end = Math.max(selectionAnchor, index);
      const rangeIds = visible.slice(start, end + 1).map((item) => item.id);
      setSelectedIds((current) => [...new Set([...current, ...rangeIds])]);
      return;
    }
    setSelectionAnchor(index);
    setSelectedIds((current) => current.includes(product.id)
      ? current.filter((id) => id !== product.id)
      : [...current, product.id]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (notice) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && (selectedProducts.length || active)) {
        event.preventDefault();
        submitProducts(selectedProducts.length ? selectedProducts : [active!]);
        return;
      }
      const textInputActive = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === " " && active && !textInputActive) {
        event.preventDefault();
        toggleSelection(active, Math.max(0, visible.findIndex((product) => product.id === active.id)), event.shiftKey);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !textInputActive) {
        event.preventDefault();
        setSelectedIds((current) => [...new Set([...current, ...visible.map((product) => product.id)])]);
        return;
      }
      if (!["ArrowUp", "ArrowDown"].includes(event.key) || !visible.length) return;
      event.preventDefault();
      const currentIndex = Math.max(0, visible.findIndex((product) => product.id === active?.id));
      const nextIndex = Math.max(0, Math.min(visible.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      setActiveId(visible[nextIndex].id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onSelect, active?.id, visibleIds, selectedIds.join("|"), selectionAnchor, notice]);

  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section
        className="pdv-payment-modal pdv-product-lookup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdv-product-lookup-title"
      >
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Consulta rapida</span>
            <h1 id="pdv-product-lookup-title">Todos os produtos</h1>
            <p>Pesquise por nome, codigo, codigo de barras ou grupo.</p>
          </div>
          <button className="pdv-icon-button" type="button" aria-label="Fechar consulta de produtos" onClick={onCancel}><X size={18} /></button>
        </div>
        <label className="pdv-product-lookup-search">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar produto..." />
          <span>{filtered.length} encontrado(s)</span>
        </label>
        <div className="pdv-product-lookup-table" role="table" aria-label="Produtos da loja">
          <div className="pdv-product-lookup-head" role="row">
            <span>Sel.</span><span>Codigo</span><span>Codigo de barras</span><span>Descricao</span><span>Grupo</span><span>Estoque</span><span>Un.</span><span>Preco</span>
          </div>
          {visible.map((product, index) => (
            <button
              type="button"
              role="row"
              aria-pressed={selectedIds.includes(product.id)}
              className={`${selectedIds.includes(product.id) ? "selected" : ""} ${active?.id === product.id ? "active" : ""}`.trim()}
              key={product.id}
              onClick={(event) => toggleSelection(product, index, event.shiftKey)}
              onDoubleClick={() => submitProducts([product])}
            >
              <span className="pdv-product-lookup-check" aria-hidden="true">{selectedIds.includes(product.id) ? "✓" : ""}</span>
              <span>{product.sku || product.id.slice(-6)}</span>
              <span>{product.barcode || "-"}</span>
              <strong>{product.name}</strong>
              <span>{product.categoryName}</span>
              <span>{product.trackStock ? formatQuantity(product.stockQuantity || 0) : "-"}</span>
              <span>{product.unit || "UNID"}</span>
              <b>{money(product.price)}</b>
            </button>
          ))}
          {!visible.length && <div className="pdv-empty">Nenhum produto encontrado.</div>}
        </div>
        <div className="pdv-product-lookup-footer">
          <small>
            {selectedProducts.length
              ? `${selectedProducts.length} produto(s) selecionado(s) · Shift+clique seleciona um intervalo`
              : "Clique para selecionar · Shift+clique seleciona um intervalo · duplo clique adiciona um"}
          </small>
          <div>
            <button className="pdv-ghost-button" type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Anterior</button>
            <span>Pagina {safePage + 1} de {totalPages}</span>
            <button className="pdv-ghost-button" type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}>Proxima</button>
          </div>
          <div className="pdv-product-lookup-actions">
            {selectedProducts.length > 0 && <button className="pdv-ghost-button" type="button" onClick={() => setSelectedIds([])}>Limpar</button>}
            <button
              className="pdv-primary-button"
              type="button"
              disabled={!selectedProducts.length && !active}
              onClick={() => submitProducts(selectedProducts.length ? selectedProducts : active ? [active] : [])}
            >
              {selectedProducts.length > 1 ? `Adicionar ${selectedProducts.length} produtos` : "Adicionar produto"}
            </button>
          </div>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

function SubtableManagerModal({
  cart,
  currentSubtable,
  names,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onCloseSubtable,
  onDeleteAll,
  onTransfer
}: {
  cart: PdvCartItem[];
  currentSubtable: string;
  names: string[];
  onClose: () => void;
  onSelect: (name: string) => void;
  onCreate: (name: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: (name: string) => void;
  onCloseSubtable?: (name: string) => void;
  onDeleteAll?: () => void;
  onTransfer?: (name: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const totalFor = (name: string) => roundMoney(cart.filter((item) => (item.subtableName || "") === name).reduce((total, item) => total + item.total, 0));
  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
  };
  const navigateControls = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)"));
    const index = controls.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    controls[(index + direction + controls.length) % controls.length]?.focus();
  };
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-subtable-manager-modal" onKeyDownCapture={navigateControls}>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Mesa dividida</span>
            <h1>Submesas</h1>
            <p>Escolha a conta que vai receber os proximos produtos.</p>
          </div>
          <button className="pdv-icon-button" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pdv-subtable-create">
          <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} placeholder="Nome da nova submesa" />
          <button className="pdv-primary-button" type="button" disabled={!newName.trim()} onClick={create}>Criar submesa</button>
        </div>
        <div className="pdv-subtable-list">
          <article className={!currentSubtable ? "active" : ""}>
            <button type="button" onClick={() => onSelect("")}><strong>Mesa principal</strong><span>{cart.filter((item) => !item.subtableName).length} item(ns) | {money(totalFor(""))}</span></button>
          </article>
          {names.map((name) => (
            <article className={currentSubtable === name ? "active" : ""} key={name}>
              <button type="button" onClick={() => onSelect(name)}><strong>{name}</strong><span>{cart.filter((item) => item.subtableName === name).length} item(ns) | {money(totalFor(name))}</span></button>
              <div className="pdv-subtable-row-actions">
                <button type="button" className="pdv-ghost-button" onClick={() => { setRenameTarget(name); setRenameValue(name); }}>Renomear</button>
                {onTransfer && cart.some((item) => item.subtableName === name && unpaidQuantity(item) > 0.009) && <button type="button" className="pdv-ghost-button" onClick={() => onTransfer(name)}>Transferir</button>}
                {onCloseSubtable && <button type="button" className="pdv-ghost-button" onClick={() => { onCloseSubtable(name); onClose(); }}>Fechar</button>}
                {onDelete && <button type="button" className="pdv-danger-button" onClick={() => { onDelete(name); onClose(); }}>Cancelar submesa</button>}
              </div>
              {renameTarget === name && (
                <div className="pdv-subtable-rename">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && renameValue.trim()) {
                        event.preventDefault();
                        onRename?.(name, renameValue.trim());
                        setRenameTarget(null);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenameTarget(null);
                      }
                    }}
                  />
                  <button type="button" className="pdv-primary-button" disabled={!renameValue.trim()} onClick={() => { onRename?.(name, renameValue.trim()); setRenameTarget(null); }}>Salvar nome</button>
                  <button type="button" className="pdv-ghost-button" onClick={() => setRenameTarget(null)}>Cancelar</button>
                </div>
              )}
            </article>
          ))}
        </div>
        <div className="pdv-action-row">
          {names.length > 0 && onDeleteAll && <button type="button" className="pdv-danger-button" onClick={() => { onDeleteAll(); onClose(); }}>Apagar todas as submesas</button>}
          <button type="button" className="pdv-ghost-button" onClick={onClose}>Voltar para a mesa</button>
        </div>
      </section>
    </div>
  );
}

function PdvReceiptDraftModal({
  sale,
  customers,
  receivable,
  receiptSettings,
  allowPrint,
  printTargets,
  onRemotePrint,
  onClose,
  onNotice
}: {
  sale: PdvSale;
  customers: PdvCustomer[];
  receivable?: PdvReceivable;
  receiptSettings: PdvSettings;
  allowPrint: boolean;
  printTargets: Array<{ id: string; label: string }>;
  onRemotePrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [customerId, setCustomerId] = useState(receivable?.customerId || "");
  const [customerName, setCustomerName] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [printerName, setPrinterName] = useState("");
  const availablePrintTargets: ReceiptPrintTarget[] = [
    { id: "local", label: "Este computador" },
    ...printTargets
  ];
  const [printDestination, setPrintDestination] = useState(() => readReceiptPrintDestination(availablePrintTargets));
  const [busy, setBusy] = useState(false);
  const selectedCustomer = customers.find((item) => item.id === customerId);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.caixa.getPdvReceiptPreview(sale, selectedCustomer, receivable, customerName.trim(), customerDocument.trim(), receiptSettings),
      window.caixa.listPdvPrinters(),
      window.caixa.getPdvSnapshot()
    ]).then(([html, availablePrinters, localSnapshot]) => {
      if (!active) return;
      setPreviewHtml(html);
      setPrinters(availablePrinters);
      setPrinterName((current) => current || localSnapshot.settings.receiptPrinterName || availablePrinters.find((item) => item.isDefault)?.name || "");
    }).catch((error) => {
      if (active) onNotice(error instanceof Error ? error.message : "Nao foi possivel preparar o recibo.");
    });
    return () => {
      active = false;
    };
  }, [sale, selectedCustomer, receivable, customerName, customerDocument, receiptSettings]);

  const generate = async (action: "open" | "save" | "print") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "print" && printDestination !== "local" && onRemotePrint) {
        const result = await onRemotePrint(printDestination, {
          sale,
          customer: selectedCustomer,
          receivable,
          customerName: customerName.trim(),
          customerDocument: customerDocument.trim()
        });
        onNotice(result.message);
        if (result.ok) onClose();
        return;
      }
      const result = await window.caixa.printPdvReceipt(sale, selectedCustomer, receivable, {
        customerName: customerName.trim(),
        customerDocument: customerDocument.trim(),
        action,
        printerName,
        receiptSettings
      });
      onNotice(result.message);
      if (result.ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop receipt-modal-backdrop">
      <section className="modal history-receipt-modal receipt-viewer-modal" role="dialog" aria-modal="true" aria-label="Gerar recibo">
        <div className="modal-head">
          <div>
            <span className="settings-overline">{receivable ? "Conta a receber" : "Recibo nao fiscal"}</span>
            <strong>{receivable ? receivable.customerName : sale.tableNumber ? `Mesa ${String(sale.tableNumber).padStart(3, "0")}` : "Venda"}</strong>
            <p>{receivable ? `Saldo atual: ${money(receivable.balance)}` : "Confira os dados antes de imprimir."}</p>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div className="history-receipt-body receipt-viewer-body">
          <div className="receipt-preview-shell">
            {previewHtml
              ? <iframe title="Pre-visualizacao da conta" srcDoc={previewHtml} className="receipt-preview-frame" />
              : <div className="receipt-preview-loading">Preparando visualizacao...</div>}
          </div>
          <div className="receipt-viewer-options">
            <label className="field"><span>Cliente cadastrado</span><select value={customerId} onChange={(event) => {
              setCustomerId(event.target.value);
              if (event.target.value) {
                setCustomerName("");
                setCustomerDocument("");
              }
            }}><option value="">Consumidor nao identificado</option>{customers.filter((item) => item.active).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            {!customerId && <label className="field"><span>Nome somente neste recibo</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Opcional" /></label>}
            {!customerId && <label className="field"><span>CPF/CNPJ somente neste recibo</span><input value={customerDocument} onChange={(event) => setCustomerDocument(formatCpfCnpj(event.target.value))} placeholder="Opcional" inputMode="numeric" /></label>}
            <label className="field"><span>Imprimir em</span><select value={printDestination} onChange={(event) => { setPrintDestination(event.target.value); saveReceiptPrintDestination(event.target.value, availablePrintTargets); }}><option value="local">Este computador</option>{printTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
            {printDestination === "local" && <label className="field"><span>Impressora deste computador</span><select value={printerName} onChange={(event) => setPrinterName(event.target.value)}><option value="">Escolha uma impressora</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? " (Padrao)" : ""}</option>)}</select></label>}
            {!allowPrint && <p className="receipt-printer-warning">O servidor nao permitiu impressao neste cliente. O PDF continua disponivel.</p>}
            {printDestination === "local" && !printers.length && <p className="receipt-printer-warning">O Windows nao informou impressoras disponiveis. Atualize a lista em Ajuste &gt; Impressao.</p>}
            <p className="settings-note">Papel, cores, logotipo e conteudo seguem as configuracoes do computador servidor.</p>
          </div>
        </div>
        <div className="modal-actions receipt-modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="ghost-button" onClick={() => void generate("save")} disabled={busy}>Salvar PDF</button>
          <button className="ghost-button" onClick={() => void generate("open")} disabled={busy}>Abrir PDF</button>
          <button className="primary-button" onClick={() => void generate("print")} disabled={busy || !allowPrint || (printDestination === "local" && !printerName)}>
            <ReceiptText size={16} /> {busy ? "Enviando..." : "Imprimir"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PaymentModal({
  total,
  busy,
  customers,
  onSaveCustomer,
  initialPayments = [],
  previousPayments = [],
  onEditPreviousPayment,
  showDescription = false,
  title = "Pagamento",
  confirmLabel = "Finalizar conta",
  skipConfirmation = false,
  onCancel,
  onConfirm
}: {
  total: number;
  busy: boolean;
  customers: PdvCustomer[];
  onSaveCustomer: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  initialPayments?: PdvPayment[];
  previousPayments?: Array<PdvPayment & { saleId?: string; operationLabel?: string }>;
  onEditPreviousPayment?: (payment: PdvPayment & { saleId?: string; operationLabel?: string }) => void;
  showDescription?: boolean;
  title?: string;
  confirmLabel?: string;
  skipConfirmation?: boolean;
  onCancel: () => void;
  onConfirm: (payments: PdvPayment[], observations?: string) => void | Promise<void>;
}) {
  const [payments, setPayments] = useState<PdvPayment[]>(initialPayments);
  const [paymentEntryMethod, setPaymentEntryMethod] = useState<PdvPaymentMethod | null>(null);
  const [editingPayment, setEditingPayment] = useState<PdvPayment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [observations, setObservations] = useState("");
  const [focusedPaymentIndex, setFocusedPaymentIndex] = useState(0);
  const finishLocked = useRef(false);
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const remaining = Math.max(0, roundMoney(total - paid));

  const openPaymentMethod = (selectedMethod: PdvPaymentMethod) => {
    if (remaining <= 0.009) {
      return;
    }
    setEditingPayment(null);
    setPaymentEntryMethod(selectedMethod);
  };

  const addPayment = (payment: PdvPayment) => {
    const available = roundMoney(remaining + (editingPayment?.amount || 0));
    if (payment.amount <= 0 || payment.amount - available > 0.009) {
      return;
    }
    setPayments((current) => editingPayment
      ? current.map((item) => item.id === editingPayment.id ? { ...payment, id: editingPayment.id } : item)
      : [...current, payment]);
    setEditingPayment(null);
    setPaymentEntryMethod(null);
  };

  const finish = async () => {
    if (finishLocked.current || submitting || busy) {
      return;
    }
    if (remaining > 0.009) {
      setNotice("Ainda existe valor restante para fechar a conta.");
      return;
    }
    if (!skipConfirmation && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    finishLocked.current = true;
    setSubmitting(true);
    try {
      await onConfirm(payments.map((payment) => ({ ...payment, description: observations.trim() || payment.description })), observations);
    } catch (error) {
      finishLocked.current = false;
      setSubmitting(false);
      setNotice(error instanceof Error ? error.message : "Nao foi possivel registrar o pagamento. Confira a conexao e tente novamente.");
    }
  };

  const handleReceiveKeyDown = (event: React.KeyboardEvent) => {
    const paymentShortcut: Record<string, PdvPaymentMethod> = {
      F1: "Dinheiro",
      F2: "Debito",
      F3: "Credito",
      F4: "Pix",
      F5: "Outros",
      F6: "Conta a receber"
    };
    if (!paymentEntryMethod && paymentShortcut[event.key]) {
      event.preventDefault();
      openPaymentMethod(paymentShortcut[event.key]);
      return;
    }
    // Ignora a repeticao de uma tecla mantida ao abrir o modal anterior.
    // Isso evita que Enter vindo do valor avulso abra Dinheiro automaticamente.
    if (event.key === "Enter" && event.repeat) {
      event.preventDefault();
      return;
    }
    if (!paymentEntryMethod && (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? 2
            : -2;
      setFocusedPaymentIndex((current) => (current + direction + CHECKOUT_PAYMENT_METHODS.length) % CHECKOUT_PAYMENT_METHODS.length);
      return;
    }
    if (event.key === "Escape" && !paymentEntryMethod) {
      event.preventDefault();
      if (payments.length) {
        setNotice("Existem pagamentos em preenchimento. Use Voltar para descartar com seguranca.");
      } else {
        onCancel();
      }
      return;
    }
    if (event.key === "Enter" && !paymentEntryMethod) {
      if (!submitting && !busy && remaining > 0.009) {
        event.preventDefault();
        openPaymentMethod(CHECKOUT_PAYMENT_METHODS[focusedPaymentIndex]);
      } else if (!submitting && !busy) {
        event.preventDefault();
        void finish();
      }
      return;
    }
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (paymentEntryMethod || confirming || notice) {
        return;
      }
      handleReceiveKeyDown(event as unknown as React.KeyboardEvent);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [paymentEntryMethod, confirming, notice, submitting, busy, payments, remaining, observations, focusedPaymentIndex]);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-receive-modal" tabIndex={-1}>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechar conta</span>
            <h1>{title}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Total da conta" value={money(total)} />
          <Metric title="Total pago" value={money(paid)} />
          <Metric title="Valor restante" value={money(remaining)} />
        </div>
        <div className="pdv-payment-methods">
          {CHECKOUT_PAYMENT_METHODS.map((item, index) => (
            <button key={item} className={focusedPaymentIndex === index ? "active" : ""} aria-selected={focusedPaymentIndex === index} disabled={remaining <= 0.009} onClick={() => { setFocusedPaymentIndex(index); openPaymentMethod(item); }}>
              <span>{item}</span>
              <small>F{index + 1}</small>
            </button>
          ))}
        </div>
        <div className="pdv-payment-list">
          {payments.map((payment) => (
            <article key={payment.id}>
              <strong>{payment.method}</strong>
              <span>{money(payment.amount)}{payment.change ? ` | Troco ${money(payment.change)}` : ""}{payment.description ? ` | ${payment.description}` : ""}</span>
              <button className="pdv-icon-button" title="Editar pagamento" onClick={() => { setEditingPayment(payment); setPaymentEntryMethod(payment.method); }}>
                <Pencil size={15} />
              </button>
              <button className="pdv-icon-button" onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}>
                <Trash2 size={16} />
              </button>
            </article>
          ))}
          {!payments.length && <p className="pdv-empty">Selecione uma forma de pagamento para continuar.</p>}
        </div>
        {previousPayments.length > 0 && (
          <section className="pdv-previous-payment-list" aria-label="Pagamentos parciais anteriores">
            <div>
              <strong>Pagamentos ja registrados nesta mesa</strong>
              <b>{money(previousPayments.reduce((sum, payment) => sum + payment.amount, 0))}</b>
            </div>
            <div className="pdv-previous-payment-scroll">
              {previousPayments.map((payment) => (
                <article key={payment.id}>
                  <span>{payment.method}{payment.description ? ` | ${payment.description}` : payment.operationLabel ? ` | ${payment.operationLabel}` : ""}</span>
                  <b>{money(payment.amount)}</b>
                  {onEditPreviousPayment && <button className="pdv-icon-button" title="Corrigir forma de pagamento" onClick={() => onEditPreviousPayment(payment)}><Pencil size={14} /></button>}
                </article>
              ))}
            </div>
          </section>
        )}
        {showDescription && (
          <label className="pdv-payment-description">
            <span>Nome da pessoa / identificacao deste pagamento</span>
            <input autoFocus value={observations} maxLength={120} onChange={(event) => setObservations(event.target.value)} placeholder="Ex.: Joao, Maria ou Pessoa 1" />
            <small>Este nome ficara no historico e no recibo individual deste fechamento.</small>
          </label>
        )}
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-primary-button" disabled={busy || submitting || (payments.length > 0 && remaining > 0.009)} onClick={finish}>
            {busy || submitting ? "Salvando..." : confirmLabel}
          </button>
        </div>
        {paymentEntryMethod && (
          paymentEntryMethod === "Conta a receber" ? (
            <ReceivablePaymentModal
              key={`receivable-${remaining}`}
              remaining={roundMoney(remaining + (editingPayment?.amount || 0))}
              customers={customers}
              initialPayment={editingPayment || undefined}
              onSaveCustomer={onSaveCustomer}
              onCancel={() => { setPaymentEntryMethod(null); setEditingPayment(null); }}
              onConfirm={addPayment}
            />
          ) : (
            <PaymentAmountModal
              key={`${paymentEntryMethod}-${remaining}`}
              method={paymentEntryMethod}
              remaining={roundMoney(remaining + (editingPayment?.amount || 0))}
              initialPayment={editingPayment || undefined}
              onCancel={() => { setPaymentEntryMethod(null); setEditingPayment(null); }}
              onConfirm={addPayment}
            />
          )
        )}
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
        {!skipConfirmation && confirming && (
          <PdvConfirmModal
            title={confirmLabel === "Finalizar conta" ? "Confirmar fechamento" : "Confirmar pagamentos"}
            message={confirmLabel === "Finalizar conta" ? "Os pagamentos serao registrados e a conta sera encerrada." : "Deseja salvar a nova forma de pagamento?"}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void finish()}
          />
        )}
      </section>
    </div>
  );
}

function PaymentMethodCorrectionModal({ payment, onCancel, onConfirm }: { payment: PdvPayment; onCancel: () => void; onConfirm: (payment: PdvPayment) => void | Promise<void> }) {
  const [method, setMethod] = useState<PdvPaymentMethod>(payment.method);
  const [receivedText, setReceivedText] = useState(String(payment.received || payment.amount).replace(".", ","));
  const received = roundMoney(Math.max(0, parseBrazilianNumber(receivedText)));
  const invalidCash = method === "Dinheiro" && received + 0.009 < payment.amount;
  const correctedPayment: PdvPayment = method === "Dinheiro"
    ? { ...payment, method, received: Math.max(payment.amount, received), change: roundMoney(Math.max(0, received - payment.amount)) }
    : { ...payment, method, received: undefined, change: undefined };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Enter" && !invalidCash) { event.preventDefault(); void onConfirm(correctedPayment); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [method, receivedText, invalidCash, onCancel, onConfirm]);
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-confirm-modal pdv-payment-correction-modal">
        <div className="pdv-section-head">
          <div><span className="pdv-eyebrow">Corrigir pagamento</span><h1>{money(payment.amount)}</h1></div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <p>Escolha a forma correta. O valor pago e o total da mesa nao serao alterados.</p>
        <div className="pdv-payment-methods">
          {CHECKOUT_PAYMENT_METHODS.filter((item) => item !== "Conta a receber").map((item) => <button key={item} className={method === item ? "active" : ""} onClick={() => setMethod(item)}>{item}</button>)}
        </div>
        {method === "Dinheiro" && <div className="pdv-payment-inputs">
          <label><span>Valor pago</span><input value={money(payment.amount)} disabled /></label>
          <label><span>Valor recebido</span><input autoFocus inputMode="decimal" value={receivedText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setReceivedText(event.target.value.replace(/[^0-9,.]/g, ""))} /></label>
          <div className="pdv-payment-calculated"><span>Troco</span><strong>{money(correctedPayment.change || 0)}</strong></div>
        </div>}
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={invalidCash} onClick={() => void onConfirm(correctedPayment)}>Salvar correcao</button>
        </div>
      </section>
    </div>
  );
}

function ReceivablePaymentModal({
  remaining,
  customers,
  initialPayment,
  onSaveCustomer,
  onCancel,
  onConfirm
}: {
  remaining: number;
  customers: PdvCustomer[];
  initialPayment?: PdvPayment;
  onSaveCustomer: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  onCancel: () => void;
  onConfirm: (payment: PdvPayment) => void;
}) {
  const [customerId, setCustomerId] = useState(initialPayment?.customerId || "");
  const [amountText, setAmountText] = useState(String(initialPayment?.amount ?? remaining).replace(".", ","));
  const [dueDate, setDueDate] = useState(initialPayment?.dueDate || "");
  const [description, setDescription] = useState(initialPayment?.description || "");
  const [localCustomers, setLocalCustomers] = useState(customers);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [notice, setNotice] = useState("");
  const amount = roundMoney(Math.max(0, parseBrazilianNumber(amountText)));
  const activeCustomers = localCustomers.filter((customer) => customer.active || customer.id === customerId);

  const confirm = () => {
    const customer = localCustomers.find((item) => item.id === customerId);
    if (!customer) {
      setNotice("Selecione ou cadastre o cliente que ficara responsavel.");
      return;
    }
    if (amount <= 0 || amount - remaining > 0.009) {
      setNotice(`O valor deve estar entre R$ 0,01 e ${money(remaining)}.`);
      return;
    }
    onConfirm({
      id: initialPayment?.id || crypto.randomUUID(),
      method: "Conta a receber",
      amount,
      customerId: customer.id,
      customerName: customer.name,
      dueDate: dueDate || undefined,
      description: description.trim() || undefined
    });
  };

  const createCustomer = async () => {
    if (!newCustomerName.trim() || savingCustomer) return;
    setSavingCustomer(true);
    try {
      const customer = await onSaveCustomer({ name: newCustomerName.trim(), active: true });
      setLocalCustomers((current) => [...current.filter((item) => item.id !== customer.id), customer].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")));
      setCustomerId(customer.id);
      setNewCustomerName("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel cadastrar o cliente.");
    } finally {
      setSavingCustomer(false);
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (notice) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [notice, customerId, amountText, dueDate, description, localCustomers]);

  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-receivable-entry-modal">
        <div className="pdv-section-head">
          <div><span className="pdv-eyebrow">Pagamento futuro</span><h1>Conta a receber</h1></div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Restante da conta" value={money(remaining)} />
          <Metric title="Ficara pendente" value={money(amount)} />
          <Metric title="Recebido agora" value={money(0)} />
        </div>
        <div className="pdv-editor-grid">
          <label className="pdv-wide-field">
            <span>Cliente responsavel</span>
            <select autoFocus value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Selecione um cliente</option>
              {activeCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` - ${customer.phone}` : ""}</option>)}
            </select>
          </label>
          <label><span>Valor a receber</span><input inputMode="decimal" value={amountText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setAmountText(event.target.value)} /></label>
          <label><span>Vencimento opcional</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label className="pdv-wide-field"><span>Observacao opcional</span><input value={description} maxLength={120} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: pagar sexta-feira" /></label>
        </div>
        <div className="pdv-inline-customer-create">
          <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Cadastro rapido: nome do novo cliente" />
          <button className="pdv-ghost-button" disabled={!newCustomerName.trim() || savingCustomer} onClick={() => void createCustomer()}>
            <ContactRound size={16} /> {savingCustomer ? "Cadastrando..." : "Cadastrar cliente"}
          </button>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={!customerId || amount <= 0 || amount - remaining > 0.009} onClick={confirm}>Adicionar a conta</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

export function PaymentAmountModal({
  method,
  remaining,
  initialPayment,
  context = "sale",
  onCancel,
  onConfirm
}: {
  method: PdvPaymentMethod;
  remaining: number;
  initialPayment?: PdvPayment;
  context?: "sale" | "payable";
  onCancel: () => void;
  onConfirm: (payment: PdvPayment) => void;
}) {
  const initialRemainingText = String(remaining).replace(".", ",");
  const [amountText, setAmountText] = useState(String(initialPayment?.amount ?? remaining).replace(".", ","));
  const [receivedText, setReceivedText] = useState(String(initialPayment?.received ?? initialPayment?.amount ?? remaining).replace(".", ","));
  const [amountTouched, setAmountTouched] = useState(false);
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [activeField, setActiveField] = useState<"amount" | "received">(method === "Dinheiro" ? "received" : "amount");
  const [notice, setNotice] = useState("");
  const replaceOnNextVirtualKey = useRef(true);

  const normalizeNumericText = (value: string) => value.replace(/[^0-9,.]/g, "").replace(".", ",");
  const typedAmount = Math.max(0, parseBrazilianNumber(amountText));
  const amount = Math.min(remaining, typedAmount);
  const received = method === "Dinheiro" ? Math.max(0, parseBrazilianNumber(receivedText)) : amount;
  const change = method === "Dinheiro" ? Math.max(0, roundMoney(received - amount)) : 0;

  const invalidAmount = amount <= 0 || typedAmount - remaining > 0.009;
  const invalidCash = method === "Dinheiro" && received + 0.009 < amount;

  const amountTextFromReceived = (receivedValue: number) => {
    const nextAmount = Math.min(remaining, Math.max(0, receivedValue));
    return String(roundMoney(nextAmount)).replace(".", ",");
  };

  const updateAmount = (value: string) => {
    const next = normalizeNumericText(value);
    replaceOnNextVirtualKey.current = false;
    setAmountTouched(true);
    setAmountText(next);
    if (method === "Dinheiro" && !receivedTouched) {
      setReceivedText(next);
    }
  };

  const updateReceived = (value: string) => {
    const next = normalizeNumericText(value);
    replaceOnNextVirtualKey.current = false;
    setReceivedTouched(true);
    setReceivedText(next);

    // Dinheiro deve permitir pagamento parcial. Se o usuario ainda nao mexeu manualmente
    // no campo "Valor que entra no pagamento", ele acompanha o recebido ate o limite do restante.
    // Assim: recebeu 15 em conta de 20 => entra 15. Recebeu 50 em conta de 20 => entra 20 e troco 30.
    if (method === "Dinheiro" && !amountTouched) {
      setAmountText(amountTextFromReceived(parseBrazilianNumber(next)));
    }
  };

  const setActiveText = (value: string) => {
    if (method === "Dinheiro" && activeField === "received") {
      updateReceived(value);
      return;
    }
    updateAmount(value);
  };

  const getActiveText = () => method === "Dinheiro" && activeField === "received" ? receivedText : amountText;

  const append = (value: string) => {
    const current = getActiveText();
    if (replaceOnNextVirtualKey.current) {
      replaceOnNextVirtualKey.current = false;
      setActiveText(value === "," ? "0," : value);
      return;
    }
    if (value === "," && (current.includes(",") || current.includes("."))) {
      return;
    }
    const next = value === "," && !current
      ? "0,"
      : current === "0" && value !== ","
        ? value
        : `${current}${value}`;
    setActiveText(next);
  };

  const erase = () => {
    const current = getActiveText();
    setActiveText(current.slice(0, -1) || "0");
  };

  const confirm = () => {
    if (invalidAmount) {
      setNotice(`O valor nao pode passar do restante (${money(remaining)}).`);
      return;
    }
    if (invalidCash) {
      setNotice("Valor recebido em dinheiro precisa cobrir o valor do pagamento.");
      return;
    }
    onConfirm({
      id: initialPayment?.id || crypto.randomUUID(),
      method,
      amount: roundMoney(amount),
      received: method === "Dinheiro" ? roundMoney(received) : undefined,
      change: method === "Dinheiro" ? roundMoney(change) : undefined
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!invalidAmount && !invalidCash) {
        confirm();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === ".") {
      event.preventDefault();
      append(",");
    }
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (notice) {
        return;
      }
      handleKeyDown(event as unknown as React.KeyboardEvent);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [notice, invalidAmount, invalidCash, activeField, amountText, receivedText]);

  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-payment-amount-modal pdv-operational-modal" tabIndex={-1}>
        <div className="pdv-window-title">
          <strong>{context === "payable" ? "Informar valor pago" : "Informar pagamento"}</strong>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-quantity-product">{method}</div>
        <div className="pdv-quantity-body">
          <div className="pdv-question-mark">?</div>
          <div className="pdv-quantity-fields">
            <label>
              <span>Valor restante</span>
              <input value={initialRemainingText} readOnly />
            </label>

            {method === "Dinheiro" ? (
              <>
                <label>
                  <span>{context === "payable" ? "Valor entregue em dinheiro" : "Valor recebido do cliente"}</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    value={receivedText}
                    onFocus={(event) => { setActiveField("received"); replaceOnNextVirtualKey.current = true; event.currentTarget.select(); }}
                    onChange={(event) => updateReceived(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                <span>Valor do pagamento</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amountText}
                  onFocus={(event) => { setActiveField("amount"); replaceOnNextVirtualKey.current = true; event.currentTarget.select(); }}
                  onChange={(event) => updateAmount(event.target.value)}
                />
              </label>
            )}

            <div className="pdv-calculated-price">
              <span>{method === "Dinheiro" ? "Troco" : "Valor registrado"}</span>
              <strong>{method === "Dinheiro" ? money(change) : money(amount)}</strong>
              <small>{method === "Dinheiro"
                ? context === "payable" ? `${money(amount)} sera registrado como pago` : `${money(amount)} registrado na conta`
                : "Nao pode ultrapassar o restante"}</small>
            </div>
          </div>
        </div>

        <div className="pdv-keypad">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ",", "del"].map((key) => (
            <button key={key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => key === "del" ? erase() : append(key)}>{key}</button>
          ))}
          <button className="enter" type="button" onMouseDown={(event) => event.preventDefault()} onClick={confirm}>Enter</button>
        </div>

        <div className="pdv-action-row">
          <button className="pdv-primary-button" disabled={invalidAmount || invalidCash} onClick={confirm}><Check size={16} /> OK</button>
          <button className="pdv-danger-button" onClick={onCancel}><X size={16} /> Cancelar</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

function QuickValueModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (item: PdvCartItem, mode: "Venda" | "Mesa" | "Onibus" | "Outros") => void }) {
  const [valueText, setValueText] = useState("");
  const [mode, setMode] = useState<"Venda" | "Mesa" | "Onibus" | "Outros">(() => {
    const saved = window.localStorage.getItem(QUICK_VALUE_MODE_STORAGE_KEY);
    return saved === "Mesa" || saved === "Onibus" || saved === "Outros" ? saved : "Venda";
  });
  const [description, setDescription] = useState("");
  const value = Math.max(0, parseBrazilianNumber(valueText));
  const confirm = () => {
    if (value <= 0) return;
    window.localStorage.setItem(QUICK_VALUE_MODE_STORAGE_KEY, mode);
    onConfirm({
      id: crypto.randomUUID(),
      productId: `valor-avulso-${mode.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-")}`,
      productName: description.trim() || mode,
      categoryName: mode,
      quantity: 1,
      unitPrice: roundMoney(value),
      baseUnitPrice: roundMoney(value),
      discount: 0,
      total: roundMoney(value),
      note: description.trim() || `${mode} pelo mapa de mesas`
    }, mode);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      confirm();
    }
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
  };
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-quick-value-modal" tabIndex={-1} autoFocus onKeyDown={onKeyDown}>
        <div className="pdv-section-head">
          <div><span className="pdv-eyebrow">Lancamento rapido</span><h1>Registrar valor avulso</h1></div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label>
            <span>Tipo de lancamento</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as "Venda" | "Mesa" | "Onibus" | "Outros")}>
              <option>Venda</option>
              <option>Mesa</option>
              <option>Onibus</option>
              <option>Outros</option>
            </select>
          </label>
          <label><span>Descricao opcional</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={mode === "Mesa" ? "Ex.: Mesa 12" : "Ex.: identificacao do lancamento"} /></label>
          <label><span>Valor</span><input autoFocus inputMode="decimal" value={valueText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValueText(event.target.value)} placeholder="0,00" /></label>
        </div>
        <div className="pdv-payment-summary"><Metric title="Valor a receber" value={money(value)} /></div>
        <div className="pdv-action-row"><button className="pdv-danger-button" onClick={onCancel}>Cancelar</button><button className="pdv-primary-button" disabled={value <= 0} onClick={confirm}>Ir para pagamento</button></div>
      </section>
    </div>
  );
}

function PartialValueModal({
  table,
  maxValue,
  onCancel,
  onConfirm
}: {
  table: PdvOpenTable;
  maxValue: number;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [valueText, setValueText] = useState(String(maxValue).replace(".", ","));
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const value = Math.max(0, parseBrazilianNumber(valueText));
  const confirm = () => {
    if (value <= 0) {
      setNotice("Informe um valor parcial maior que zero.");
      return;
    }
    if (value > maxValue && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onConfirm(roundMoney(value));
  };
  useModalConfirmShortcut(confirm, onCancel, !confirming && !notice);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-partial-value-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechamento parcial</span>
            <h1>Mesa {String(table.number).padStart(3, "0")}</h1>
            <p>Informe o valor que sera recebido agora. A mesa continua aberta.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Total aberto" value={money(maxValue)} />
          <Metric title="Valor parcial" value={money(value)} />
          <Metric title="Restante previsto" value={money(Math.max(0, roundMoney(maxValue - value)))} />
        </div>
        <div className="pdv-editor-grid">
          <label>
            <span>Valor parcial</span>
            <input autoFocus value={valueText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValueText(event.target.value)} />
          </label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" onClick={confirm}>Continuar pagamento</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
        {confirming && (
          <PdvConfirmModal
            title="Valor acima do total"
            message="Esse valor ultrapassa o total aberto da mesa. Deseja continuar?"
            onCancel={() => setConfirming(false)}
            onConfirm={confirm}
          />
        )}
      </section>
    </div>
  );
}

function MoveItemModal({
  item,
  cart,
  after,
  onCancel,
  onConfirm
}: {
  item: PdvCartItem;
  cart: PdvCartItem[];
  after: boolean;
  onCancel: () => void;
  onConfirm: (referenceIndex: number) => void;
}) {
  const currentIndex = cart.findIndex((row) => row.id === item.id);
  const candidates = cart
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.id !== item.id);
  const [referenceId, setReferenceId] = useState(candidates[0]?.row.id || "");
  const [notice, setNotice] = useState("");
  const confirm = () => {
    const referenceIndex = cart.findIndex((row) => row.id === referenceId);
    if (referenceIndex < 0) {
      setNotice("Escolha um item de referencia.");
      return;
    }
    onConfirm(referenceIndex);
  };
  useModalConfirmShortcut(confirm, onCancel, !notice);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-move-item-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Organizar conta</span>
            <h1>{after ? "Colocar depois" : "Colocar antes"}</h1>
            <p>{currentIndex >= 0 ? `${currentIndex + 1}. ` : ""}{item.productName}</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label className="pdv-wide-field">
            <span>Item de referencia</span>
            <select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
              {candidates.map((entry) => (
                <option key={entry.row.id} value={entry.row.id}>
                  {entry.index + 1}. {entry.row.productName} - {money(entry.row.total)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={!candidates.length} onClick={confirm}>Aplicar</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

function RenameSubtableModal({
  currentName,
  onCancel,
  onConfirm
}: {
  currentName: string;
  onCancel: () => void;
  onConfirm: (nextName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [notice, setNotice] = useState("");
  const confirm = () => {
    const next = name.trim();
    if (!next) {
      setNotice("Informe um nome para a submesa.");
      return;
    }
    onConfirm(next);
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-rename-subtable-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Submesa</span>
            <h1>Renomear submesa</h1>
            <p>{currentName}</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label className="pdv-wide-field">
            <span>Novo nome</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" onClick={confirm}>Salvar nome</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

function ItemEditModal({
  item,
  mode,
  discountKind = "value",
  onCancel,
  onConfirm
}: {
  item: PdvCartItem;
  mode: "quantity" | "discount" | "price" | "note";
  discountKind?: "value" | "percent";
  onCancel: () => void;
  onConfirm: (patch: Partial<Pick<PdvCartItem, "quantity" | "discount" | "note" | "unitPrice" | "measureLabel" | "total">>) => void;
}) {
  const isMeasured = /\bg\s*$/i.test(item.measureLabel || "");
  const measuredGrams = isMeasured ? Math.max(0, parseBrazilianNumber(item.measureLabel || "")) : 0;
  const measuredInKg = isMeasured && item.quantity < 1 && measuredGrams >= 1;
  const gross = isMeasured ? roundMoney(item.total + (item.discount || 0)) : roundMoney(item.quantity * item.unitPrice);
  const [quantityText, setQuantityText] = useState(String(isMeasured ? measuredGrams : item.quantity).replace(".", ","));
  const [discountValueText, setDiscountValueText] = useState(discountKind === "value" ? String(item.discount || 0).replace(".", ",") : "");
  const [discountPercentText, setDiscountPercentText] = useState(
    discountKind === "percent" && gross > 0
      ? formatQuantity(roundQuantity(((item.discount || 0) / gross) * 100)).replace(".", ",")
      : ""
  );
  const [priceText, setPriceText] = useState(String(isMeasured ? item.total : item.unitPrice).replace(".", ","));
  const [note, setNote] = useState(item.note || "");
  const discountByValue = Math.max(0, parseBrazilianNumber(discountValueText));
  const discountByPercent = roundMoney(gross * (Math.max(0, parseBrazilianNumber(discountPercentText)) / 100));
  const previewDiscount = Math.min(gross, roundMoney(discountByValue + discountByPercent));
  const previewTotal = Math.max(0, roundMoney(gross - previewDiscount));

  const confirm = () => {
    if (mode === "quantity") {
      const typedQuantity = Math.max(0.01, parseBrazilianNumber(quantityText));
      if (isMeasured) {
        onConfirm({
          quantity: roundQuantity(measuredInKg ? typedQuantity / 1000 : typedQuantity),
          measureLabel: `${typedQuantity} g`,
          total: item.total
        });
      } else {
        onConfirm({ quantity: roundQuantity(typedQuantity) });
      }
      return;
    }
    if (mode === "discount") {
      onConfirm(isMeasured ? { discount: previewDiscount, total: previewTotal } : { discount: previewDiscount });
      return;
    }
    if (mode === "price") {
      const value = Math.max(0, parseBrazilianNumber(priceText));
      // Em produtos por peso, o preco cadastrado por kg/g continua intacto.
      // Esta acao altera somente o valor final deste lancamento.
      onConfirm(isMeasured ? { total: roundMoney(value) } : { unitPrice: value });
      return;
    }
    onConfirm({ note });
  };

  const title = mode === "quantity"
    ? "Alterar quantidade"
    : mode === "discount"
      ? "Desconto do item"
      : mode === "price"
        ? "Alterar preco"
        : "Observacao do item";
  useModalConfirmShortcut(confirm, onCancel);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-item-edit-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Item da conta</span>
            <h1>{title}</h1>
            <p>{item.productName}</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          {mode === "quantity" && (
            <label>
              <span>Quantidade</span>
              <input autoFocus inputMode="decimal" value={quantityText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setQuantityText(event.target.value)} />
            </label>
          )}
          {mode === "discount" && (
            <>
              <label>
                <span>Desconto em R$</span>
                <input
                  autoFocus={discountKind === "value"}
                  inputMode="decimal"
                  value={discountValueText}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setDiscountValueText(event.target.value);
                    if (event.target.value) setDiscountPercentText("");
                  }}
                />
              </label>
              <label>
                <span>Desconto em %</span>
                <input
                  autoFocus={discountKind === "percent"}
                  inputMode="decimal"
                  value={discountPercentText}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setDiscountPercentText(event.target.value);
                    if (event.target.value) setDiscountValueText("");
                  }}
                  placeholder="0"
                />
              </label>
            </>
          )}
          {mode === "price" && (
            <label>
              <span>{isMeasured ? "Valor final apenas neste lancamento" : "Preco apenas neste lancamento"}</span>
              <input autoFocus inputMode="decimal" value={priceText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setPriceText(event.target.value)} />
            </label>
          )}
          {mode === "note" && (
            <label className="pdv-wide-field">
              <span>Observacao</span>
              <input autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: sem cebola, caprichar, cliente pediu..." />
            </label>
          )}
        </div>
        <div className="pdv-payment-summary">
          <Metric title={isMeasured ? "Peso" : "Quantidade"} value={isMeasured ? item.measureLabel || formatQuantity(item.quantity) : formatQuantity(item.quantity)} />
          <Metric title={isMeasured ? "Preco por kg/g" : "Unitario"} value={money(item.unitPrice)} />
          <Metric title="Total final" value={money(mode === "price" && isMeasured ? parseBrazilianNumber(priceText) : mode === "discount" ? previewTotal : item.total)} />
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" onClick={confirm}>Confirmar</button>
        </div>
      </section>
    </div>
  );
}

function TransferListModal({
  cart,
  tables,
  sourceTableNumber,
  openPdvTable,
  savePdvTableItems,
  transferPdvTableItems,
  selectAllInitially = false,
  preferredTargetSubtable = "",
  onCancel,
  onTransferred
}: {
  cart: PdvCartItem[];
  tables: PdvOpenTable[];
  sourceTableNumber: number;
  openPdvTable?: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  savePdvTableItems?: (tableNumber: number, items: PdvCartItem[]) => Promise<void>;
  transferPdvTableItems?: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
  selectAllInitially?: boolean;
  preferredTargetSubtable?: string;
  onCancel: () => void;
  onTransferred: (nextSource: PdvCartItem[], targetTableNumber: number, targetSubtable?: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => selectAllInitially ? cart.map((item) => item.id) : []);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(cart.map((item) => [item.id, String(unpaidQuantity(item)).replace(".", ",")])));
  const [targetTableNumber, setTargetTableNumber] = useState(sourceTableNumber);
  const [targetSubtable, setTargetSubtable] = useState(preferredTargetSubtable);
  const [creatingTargetSubtable, setCreatingTargetSubtable] = useState(Boolean(preferredTargetSubtable));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedItems = cart.filter((item) => selectedIds.includes(item.id));
  const selectedTotal = roundMoney(selectedItems.reduce((total, item) => {
    const quantity = transferQuantity(item, quantities[item.id]);
    const ratio = item.quantity > 0 ? quantity / item.quantity : 1;
    return total + (isMeasuredCartItem(item) ? item.total * ratio : quantity * item.unitPrice);
  }, 0));
  const targetTable = tables.find((table) => table.number === targetTableNumber);
  const existingSubtables = [...new Set([...(targetTable?.subtables || []), ...(targetTable?.items.map((row) => row.subtableName || "").filter(Boolean) || [])])];
  const toggle = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const selectAll = () => setSelectedIds(cart.map((item) => item.id));
  const clearSelection = () => setSelectedIds([]);
  const confirm = async () => {
    if (busy || !selectedItems.length || !targetTable) {
      return;
    }
    if (
      targetTableNumber === sourceTableNumber
      && selectedItems.every((item) => (item.subtableName || "") === targetSubtable.trim())
    ) {
      setNotice("Os itens selecionados ja estao nesse destino.");
      return;
    }
    setBusy(true);
    try {
      const selections: PdvTransferSelection[] = selectedItems.map((item) => ({
        itemId: item.id,
        quantity: transferQuantity(item, quantities[item.id]),
        subtableName: targetSubtable.trim() || undefined
      }));
      let nextSource: PdvCartItem[];
      if (transferPdvTableItems) {
        nextSource = await transferPdvTableItems(sourceTableNumber, targetTableNumber, selections);
      } else {
        const movedItems = selectedItems.map((item) => splitCartItemForTransfer(item, transferQuantity(item, quantities[item.id]), targetSubtable.trim()));
        await (openPdvTable || window.caixa.openPdvTable)(targetTableNumber, targetTable.people || 1, targetTable.note || "");
        await (savePdvTableItems || window.caixa.savePdvTableItems)(targetTableNumber, [...targetTable.items, ...movedItems]);
        nextSource = selectedItems.reduce((items, item) => subtractCartItemQuantity(items, item.id, transferQuantity(item, quantities[item.id])), cart);
        await (savePdvTableItems || window.caixa.savePdvTableItems)(sourceTableNumber, nextSource);
      }
      onTransferred(nextSource, targetTableNumber, targetSubtable.trim() || undefined);
    } catch (error) {
      setBusy(false);
      setNotice(error instanceof Error ? error.message : "Nao foi possivel transferir os produtos. Tente novamente.");
    }
  };
  useModalConfirmShortcut(() => { void confirm(); }, onCancel, !busy && !notice);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-transfer-list-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Transferir produtos</span>
            <h1>Escolha os itens da mesa</h1>
            <p>Marque os produtos, ajuste a quantidade de cada um e escolha o destino.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-transfer-target">
          <label>
            <span>Mesa destino</span>
            <select value={targetTableNumber} onChange={(event) => {
              setTargetTableNumber(Number(event.target.value));
              setTargetSubtable(preferredTargetSubtable);
              setCreatingTargetSubtable(Boolean(preferredTargetSubtable));
            }}>
              {tables.map((table) => (
                <option key={table.number} value={table.number}>Mesa {String(table.number).padStart(3, "0")} - {table.status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Submesa destino</span>
            <select
              value={creatingTargetSubtable ? "__new__" : targetSubtable}
              onChange={(event) => {
                const value = event.target.value;
                setCreatingTargetSubtable(value === "__new__");
                setTargetSubtable(value === "__new__" ? "" : value);
              }}
            >
              <option value="">Mesa principal</option>
              {existingSubtables.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="__new__">Criar nova submesa...</option>
            </select>
            {creatingTargetSubtable && <input autoFocus value={targetSubtable} onChange={(event) => setTargetSubtable(event.target.value)} placeholder="Nome da nova submesa" />}
            <button
              className="pdv-ghost-button pdv-temporary-subtable-button"
              type="button"
              onClick={() => {
                setTargetSubtable(temporarySubtableName(existingSubtables));
                setCreatingTargetSubtable(true);
              }}
            >
              + Submesa temporaria
            </button>
          </label>
          <Metric title="Selecionado" value={money(selectedTotal)} />
        </div>
        <div className="pdv-transfer-select-row">
          <button className="pdv-ghost-button" type="button" disabled={!cart.length} onClick={selectAll}>Selecionar todos</button>
          <button className="pdv-ghost-button" type="button" disabled={!selectedIds.length} onClick={clearSelection}>Limpar selecao</button>
        </div>
        <div className="pdv-transfer-list">
          {cart.map((item, index) => (
            <button className={selectedIds.includes(item.id) ? "selected" : ""} key={item.id} onClick={() => toggle(item.id)}>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} onClick={(event) => event.stopPropagation()} />
              <span>{index + 1}. {item.productName}</span>
              <small>{item.measureLabel || formatQuantity(item.quantity)} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}</small>
              <label className="pdv-transfer-qty" onClick={(event) => event.stopPropagation()}>
                Qtde
                <input value={quantities[item.id] ?? formatQuantity(item.quantity)} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
              </label>
              <strong>{money(roundMoney(isMeasuredCartItem(item)
                ? item.total * (item.quantity > 0 ? transferQuantity(item, quantities[item.id]) / item.quantity : 1)
                : transferQuantity(item, quantities[item.id]) * item.unitPrice))}</strong>
            </button>
          ))}
          {!cart.length && <div className="pdv-empty">Nenhum produto para transferir.</div>}
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-primary-button" disabled={busy || !selectedItems.length} onClick={confirm}>{busy ? "Transferindo..." : "Transferir selecionados"}</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}
function PartialItemsModal({
  table,
  cart,
  previousPartials,
  defaultSelectedIds,
  onSelectedIdsChange,
  onResetPaidItems,
  onComplete,
  onCancel,
  onConfirm
}: {
  table: PdvOpenTable;
  cart: PdvCartItem[];
  previousPartials: PdvSale[];
  defaultSelectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onResetPaidItems: (ids?: string[], selectAfter?: boolean) => void;
  onComplete: () => void;
  onCancel: () => void;
  onConfirm: (items: PdvCartItem[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultSelectedIds.filter((id) => cart.some((item) => item.id === id && unpaidQuantity(item) > 0.009)));
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(cart.map((item) => [item.id, formatQuantity(item.quantity)])));

  const updateSelected = (next: string[] | ((current: string[]) => string[])) => {
    setSelectedIds((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      const valid = resolved.filter((id) => cart.some((item) => item.id === id && unpaidQuantity(item) > 0.009));
      onSelectedIdsChange(valid);
      return valid;
    });
  };
  const selectedItems = cart.filter((item) => selectedIds.includes(item.id)).map((item) => {
    const qText = quantities[item.id];
    const q = Math.min(unpaidQuantity(item), Math.max(0.01, parseBrazilianNumber(qText || String(unpaidQuantity(item)))));
    const ratio = item.quantity > 0 ? q / item.quantity : 1;
    return {
      ...item,
      quantity: q,
      discount: roundMoney(item.discount * ratio),
      total: isMeasuredCartItem(item)
        ? roundMoney(Math.max(0, item.total * ratio))
        : roundMoney(Math.max(0, item.unitPrice * q - item.discount * ratio)),
      paidQuantity: 0
    };
  });
  
  const selectedTotal = roundMoney(selectedItems.reduce((total, item) => total + item.total, 0));
  const remainingTotal = roundMoney(cart.reduce((total, item) => total + unpaidItemTotal(item), 0) - selectedTotal);
  const allPaid = cart.length > 0 && cart.every((item) => unpaidQuantity(item) <= 0.009);
  const paidTotal = roundMoney(previousPartials.reduce((total, sale) => total + sale.total, 0));
  const confirm = () => {
    if (selectedItems.length) {
      onConfirm(selectedItems);
    }
  };
  useModalConfirmShortcut(allPaid ? onComplete : confirm, onCancel, allPaid || selectedItems.length > 0);
  
  const toggle = (id: string) => {
    const current = cart.find((item) => item.id === id);
    if (!current || unpaidQuantity(current) <= 0.009) {
      return;
    }
    updateSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-partial-items-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechamento parcial</span>
            <h1>Mesa {String(table.number).padStart(3, "0")}</h1>
            <p>Escolha os produtos e quantidades que serao pagos agora.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Selecionado agora" value={money(selectedTotal)} />
          <Metric title="Fica na mesa" value={money(Math.max(0, remainingTotal))} />
          <Metric title={allPaid ? "Situacao" : "Itens escolhidos"} value={allPaid ? "Tudo pago" : String(selectedItems.length)} />
        </div>
        {previousPartials.length > 0 && (
          <section className="pdv-partial-payments" aria-label="Pagamentos parciais ja registrados">
            <div>
              <strong>Ja pago nesta mesa</strong>
              <b>{money(paidTotal)}</b>
            </div>
            <div className="pdv-partial-payments-list">
              {previousPartials.flatMap((sale) => sale.payments.map((payment) => ({ sale, payment }))).map(({ sale, payment }) => (
                <article key={payment.id}>
                  <span>{new Date(sale.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} | {payment.method}{payment.description ? ` | ${payment.description}` : ""}</span>
                  <b>{money(payment.amount)}</b>
                </article>
              ))}
            </div>
          </section>
        )}
        <div className="pdv-transfer-list">
          {cart.map((item, index) => {
            const isSelected = selectedIds.includes(item.id);
            const remainingQuantity = unpaidQuantity(item);
            const isPaid = remainingQuantity <= 0.009;
            const qVal = quantities[item.id] ?? String(remainingQuantity).replace(".", ",");
            const parsedQ = parseBrazilianNumber(qVal);
            const currentItemTotal = isSelected
              ? roundMoney(isMeasuredCartItem(item) ? item.total * (item.quantity > 0 ? parsedQ / item.quantity : 1) : parsedQ * item.unitPrice)
              : unpaidItemTotal(item);
            return (
              <button
                className={`${isSelected ? "selected" : ""} ${isPaid ? "locked paid" : ""}`.trim()}
                key={item.id}
                onClick={(event) => {
                  if (isPaid && event.shiftKey) {
                    onResetPaidItems([item.id], true);
                    return;
                  }
                  toggle(item.id);
                }}
                onContextMenu={(event) => {
                  if (isPaid && event.shiftKey) {
                    event.preventDefault();
                    onResetPaidItems([item.id], false);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isPaid}
                  onChange={() => toggle(item.id)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span>{index + 1}. {item.productName}</span>
                <small>{item.measureLabel || formatQuantity(item.quantity)} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}{isPaid ? " | Pago" : item.paidQuantity ? ` | Restam ${formatQuantity(remainingQuantity)}` : ""}</small>
                {isSelected && (
                  <label className="pdv-transfer-qty" onClick={(event) => event.stopPropagation()}>
                    Qtde
                    <input
                      value={qVal}
                      disabled={isPaid}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  </label>
                )}
                <strong>{money(currentItemTotal)}</strong>
              </button>
            );
          })}
        </div>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" onClick={() => updateSelected([])} disabled={!selectedIds.length}>Limpar selecao</button>
          <button className="pdv-ghost-button" onClick={() => onResetPaidItems()}>Resetar estados</button>
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          {allPaid ? (
            <button className="pdv-primary-button" onClick={onComplete}>Concluir mesa</button>
          ) : (
            <button className="pdv-primary-button" disabled={!selectedItems.length} onClick={confirm}>Fechar parcial</button>
          )}
        </div>
      </section>
    </div>
  );
}

function TransferItemModal({
  item,
  sourceTableNumber,
  tables,
  cart,
  openPdvTable,
  savePdvTableItems,
  transferPdvTableItems,
  onCancel,
  onTransferred
}: {
  item: PdvCartItem;
  sourceTableNumber: number;
  tables: PdvOpenTable[];
  cart: PdvCartItem[];
  openPdvTable?: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  savePdvTableItems?: (tableNumber: number, items: PdvCartItem[]) => Promise<void>;
  transferPdvTableItems?: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
  onCancel: () => void;
  onTransferred: (nextSource: PdvCartItem[], targetTableNumber: number, targetSubtable?: string) => void;
}) {
  const [targetTableNumber, setTargetTableNumber] = useState(sourceTableNumber);
  const [targetSubtable, setTargetSubtable] = useState(item.subtableName || "");
  const [creatingTargetSubtable, setCreatingTargetSubtable] = useState(false);
  const [quantityText, setQuantityText] = useState(formatQuantity(item.quantity));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const targetTable = tables.find((table) => table.number === targetTableNumber);
  const existingSubtables = [...new Set([...(targetTable?.subtables || []), ...(targetTable?.items.map((row) => row.subtableName || "").filter(Boolean) || [])])];
  const quantity = roundQuantity(Math.min(item.quantity, Math.max(0.001, parseBrazilianNumber(quantityText))));

  const confirm = async () => {
    if (busy) {
      return;
    }
    const target = tables.find((table) => table.number === targetTableNumber);
    if (!target) {
      setNotice("Mesa destino nao encontrada.");
      return;
    }
    if (targetTableNumber === sourceTableNumber && (targetSubtable || "") === (item.subtableName || "")) {
      setNotice("Escolha outra mesa ou outra submesa.");
      return;
    }
    setBusy(true);
    try {
      let nextSource: PdvCartItem[];
      if (transferPdvTableItems) {
        nextSource = await transferPdvTableItems(sourceTableNumber, targetTableNumber, [{ itemId: item.id, quantity, subtableName: targetSubtable.trim() || undefined }]);
      } else {
        const transferItem = splitCartItemForTransfer(item, quantity, targetSubtable.trim());
        await (openPdvTable || window.caixa.openPdvTable)(targetTableNumber, target.people || 1, target.note || "");
        await (savePdvTableItems || window.caixa.savePdvTableItems)(targetTableNumber, [...target.items, transferItem]);
        nextSource = subtractCartItemQuantity(cart, item.id, quantity);
        await (savePdvTableItems || window.caixa.savePdvTableItems)(sourceTableNumber, nextSource);
      }
      onTransferred(nextSource, targetTableNumber, targetSubtable.trim() || undefined);
    } catch (error) {
      setBusy(false);
      setNotice(error instanceof Error ? error.message : "Nao foi possivel transferir o produto. Tente novamente.");
    }
  };
  useModalConfirmShortcut(() => { void confirm(); }, onCancel, !busy && !notice);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-transfer-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Transferir</span>
            <h1>{item.productName}</h1>
            <p>Escolha a mesa ou submesa destino sem baguncar a tela principal.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label>
            <span>Mesa destino</span>
            <select value={targetTableNumber} onChange={(event) => {
              setTargetTableNumber(Number(event.target.value));
              setTargetSubtable("");
              setCreatingTargetSubtable(false);
            }}>
              {tables.map((table) => (
                <option key={table.number} value={table.number}>Mesa {String(table.number).padStart(3, "0")} - {table.status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Quantidade a transferir</span>
            <input value={quantityText} onChange={(event) => setQuantityText(event.target.value)} />
          </label>
          <label>
            <span>Submesa destino</span>
            <select
              value={creatingTargetSubtable ? "__new__" : targetSubtable}
              onChange={(event) => {
                const value = event.target.value;
                setCreatingTargetSubtable(value === "__new__");
                setTargetSubtable(value === "__new__" ? "" : value);
              }}
            >
              <option value="">Mesa principal</option>
              {existingSubtables.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="__new__">Criar nova submesa...</option>
            </select>
            {creatingTargetSubtable && <input autoFocus value={targetSubtable} onChange={(event) => setTargetSubtable(event.target.value)} placeholder="Nome da nova submesa" />}
            <button
              className="pdv-ghost-button pdv-temporary-subtable-button"
              type="button"
              onClick={() => {
                setTargetSubtable(temporarySubtableName(existingSubtables));
                setCreatingTargetSubtable(true);
              }}
            >
              + Submesa temporaria
            </button>
          </label>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Origem" value={`Mesa ${String(sourceTableNumber).padStart(3, "0")}`} />
          <Metric title="Destino" value={`Mesa ${String(targetTableNumber).padStart(3, "0")}`} />
          <Metric title="Valor" value={money(roundMoney(item.unitPrice * quantity))} />
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={busy} onClick={confirm}>{busy ? "Transferindo..." : "Transferir"}</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}

function QuantityPriceModal({
  product,
  defaultQuantity,
  onCancel,
  onConfirm
}: {
  product: PdvProduct;
  defaultQuantity: number;
  onCancel: () => void;
  onConfirm: (resolved: { quantity: number; measureLabel?: string; unitPrice?: number; finalTotal?: number }) => void;
}) {
  const isKg = product.unitMode === "kg";
  const isGram = product.unitMode === "grama";
  const isMeasured = isKg || isGram;
  const [activeField, setActiveField] = useState<"quantity" | "value">(isMeasured ? "value" : "quantity");
  const [quantityText, setQuantityText] = useState(isMeasured ? "" : String(defaultQuantity || 1).replace(".", ","));
  const [valueText, setValueText] = useState(isMeasured ? money(roundMoney(product.price * (isKg ? 1 : 1000))).replace("R$", "").trim() : String(product.price || 0).replace(".", ","));
  const [notice, setNotice] = useState("");
  const rawQuantity = Math.max(0, parseBrazilianNumber(quantityText));
  const typedValue = roundMoney(Math.max(0, parseBrazilianNumber(valueText)));
  const calculatedMeasuredQuantity = product.price > 0 ? typedValue / product.price : 1;
  const shownGrams = isMeasured ? Math.max(1, Math.round(isKg ? calculatedMeasuredQuantity * 1000 : calculatedMeasuredQuantity)) : rawQuantity;
  const saleQuantity = isMeasured
    ? roundQuantity(isKg ? shownGrams / 1000 : shownGrams)
    : roundQuantity(rawQuantity);
  const finalPrice = isMeasured
    ? typedValue
    : roundMoney(typedValue * Math.max(0, saleQuantity));
  const unitPrice = isMeasured ? product.price : typedValue;
  const unitLabel = isMeasured ? "g" : product.unit || "UNID";
  const append = (value: string) => {
    if (isMeasured || activeField === "value") {
      setValueText((current) => (current === "0" ? value : `${current}${value}`));
      return;
    }
    setQuantityText((current) => (current === "0" ? value : `${current}${value}`));
  };
  const erase = () => {
    if (isMeasured || activeField === "value") {
      setValueText((current) => current.slice(0, -1) || "0");
      return;
    }
    setQuantityText((current) => current.slice(0, -1) || "0");
  };
  const onQuantityChange = (value: string) => {
    if (isMeasured) {
      return;
    }
    setActiveField("quantity");
    setQuantityText(value);
  };
  const onValueChange = (value: string) => {
    setActiveField("value");
    setValueText(value);
  };
  const confirm = () => {
    if (saleQuantity <= 0 || finalPrice <= 0) {
      setNotice("Informe quantidade e valor maiores que zero.");
      return;
    }
    onConfirm({
      quantity: saleQuantity,
      measureLabel: `${isMeasured ? shownGrams : rawQuantity} ${unitLabel}`,
      unitPrice,
      // O peso e apenas referencia visual: o total digitado sempre vence.
      finalTotal: isMeasured ? finalPrice : undefined
    });
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (notice) {
        return;
      }
      handleKeyDown(event as unknown as React.KeyboardEvent);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [notice, activeField, quantityText, valueText, rawQuantity, typedValue]);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-quantity-modal" tabIndex={-1} autoFocus>
        <div className="pdv-window-title">
          <strong>Informe a Quantidade</strong>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-quantity-product">{product.name}</div>
        <div className="pdv-quantity-body">
          <div className="pdv-question-mark">?</div>
          <div className="pdv-quantity-fields">
            <label>
              <span>{isMeasured ? "Peso em gramas" : "Informe a Quantidade"} <b>{unitLabel}</b></span>
              <div className="pdv-inline-stepper">
                <input autoFocus={!isMeasured} readOnly={isMeasured} inputMode="decimal" value={isMeasured ? String(shownGrams).replace(".", ",") : quantityText} onFocus={(event) => { if (!isMeasured) setActiveField("quantity"); event.currentTarget.select(); }} onChange={(event) => onQuantityChange(event.target.value)} />
                <button disabled={isMeasured} onClick={() => onQuantityChange(String(Math.max(0, rawQuantity - 1)).replace(".", ","))}>-</button>
                <button disabled={isMeasured} onClick={() => onQuantityChange(String(rawQuantity + 1).replace(".", ","))}>+</button>
              </div>
            </label>
            <label>
              <span>{isKg ? "Valor final desejado" : "Valor unitario"}</span>
              <input autoFocus={isMeasured} inputMode="decimal" value={valueText} onFocus={(event) => { setActiveField("value"); event.currentTarget.select(); }} onChange={(event) => onValueChange(event.target.value)} />
            </label>
            {isMeasured && <p className="pdv-helper-note">Digite somente o valor final. Os gramas sao calculados automaticamente para referencia e nao alteram o preco.</p>}
            <div className="pdv-calculated-price">
              <span>Final do item</span>
              <strong>{money(finalPrice)}</strong>
              <small>{isMeasured ? `${shownGrams} g a ${money(product.price)}/${isKg ? "kg" : "g"}` : `${money(unitPrice)} por ${product.unit || product.unitMode}`}</small>
            </div>
          </div>
        </div>
        <div className="pdv-keypad">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ",", "del"].map((key) => (
            <button key={key} onClick={() => key === "del" ? erase() : append(key)}>{key}</button>
          ))}
          <button className="enter" onClick={confirm}>Enter</button>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-primary-button" onClick={confirm}><Check size={16} /> OK</button>
          <button className="pdv-danger-button" onClick={onCancel}><X size={16} /> Cancelar</button>
        </div>
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      </section>
    </div>
  );
}
function SubtablePicker({
  cart,
  value,
  onChange,
  onCloseSubtable,
  onDeleteSubtable,
  onDeleteAllSubtables,
  onMoveSelectedToSubtable,
  onRenameSubtable
}: {
  cart: PdvCartItem[];
  value: string;
  onChange: (value: string) => void;
  onCloseSubtable?: (name: string) => void;
  onDeleteSubtable?: (name: string) => void;
  onDeleteAllSubtables?: () => void;
  onMoveSelectedToSubtable?: (name: string) => void;
  onRenameSubtable?: (oldName: string, newName: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState("");
  const names = [...new Set([...cart.map((item) => item.subtableName || "").filter(Boolean), value].filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  const totals = names.map((name) => ({
    name,
    total: roundMoney(cart.filter((item) => (item.subtableName || "") === name).reduce((sum, item) => sum + item.total, 0))
  }));
  const mainTotal = roundMoney(cart.filter((item) => !item.subtableName).reduce((sum, item) => sum + item.total, 0));
  return (
    <div className="pdv-subtable-panel">
      <div className="pdv-subtable-picker">
        <button className={value ? "" : "active"} onClick={() => onChange("")}>Mesa principal {money(mainTotal)}</button>
        {totals.map((item) => (
          <button className={value === item.name ? "active" : ""} key={item.name} onClick={() => onChange(item.name)}>
            {item.name} {money(item.total)}
          </button>
        ))}
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Nova submesa" />
        <button onClick={() => {
          const next = draft.trim() || `Submesa ${names.length + 1}`;
          onChange(next);
          setDraft("");
        }}>
          Criar
        </button>
      </div>
      <div className="pdv-subtable-actions">
        <button className="pdv-ghost-button" onClick={() => onMoveSelectedToSubtable?.(value)}>Mover selecionados para atual</button>
        {value && <button className="pdv-ghost-button" onClick={() => setRenaming(value)}>Renomear submesa</button>}
        {value && <button className="pdv-ghost-button" onClick={() => onCloseSubtable?.(value)}>Fechar submesa</button>}
        {value && <button className="pdv-danger-button" onClick={() => onDeleteSubtable?.(value)}>Apagar submesa</button>}
        {names.length > 0 && <button className="pdv-danger-button" onClick={onDeleteAllSubtables}>Apagar todas submesas</button>}
      </div>
      {renaming && (
        <RenameSubtableModal
          currentName={renaming}
          onCancel={() => setRenaming("")}
          onConfirm={(nextName) => {
            onRenameSubtable?.(renaming, nextName);
            setRenaming("");
          }}
        />
      )}
    </div>
  );
}

function ComplementModal({
  product,
  quantity,
  complements,
  onCancel,
  onConfirm
}: {
  product: PdvProduct;
  quantity: number;
  complements: PdvProduct[];
  onCancel: () => void;
  onConfirm: (product: PdvProduct, unitPrice: number, complements: PdvCartItem["complements"]) => void;
}) {
  const [unitPrice, setUnitPrice] = useState(product.price);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedComplements = complements.filter((item) => selectedIds.includes(item.id)).map((item) => ({ productId: item.id, name: item.name, price: item.price }));
  const complementsTotal = roundMoney(selectedComplements.reduce((total, item) => total + item.price, 0));
  const finalUnit = roundMoney(unitPrice + complementsTotal);
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm(product, unitPrice, selectedComplements);
    }
  };
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-complement-modal" tabIndex={-1} autoFocus onKeyDown={handleKeyDown}>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Adicionais opcionais</span>
            <h1>{product.name}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Preco base" value={money(unitPrice)} />
          <Metric title="Adicionais" value={money(complementsTotal)} />
          <Metric title="Total do item" value={money(finalUnit * quantity)} />
        </div>
        <label className="pdv-price-edit">
          <span>Preco unitario somente neste lancamento</span>
          <input type="number" min={0} step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value || 0))} />
        </label>
        <div className="pdv-complement-grid">
          {complements.map((item) => (
            <button className={selectedIds.includes(item.id) ? "active" : ""} key={item.id} onClick={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}>
              <strong>{item.name}</strong>
              <span>{money(item.price)}</span>
            </button>
          ))}
          {!complements.length && <p className="pdv-empty">Nenhum complemento configurado.</p>}
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-ghost-button" onClick={() => onConfirm(product, unitPrice, [])}>Sem adicionais</button>
          <button className="pdv-primary-button" onClick={() => onConfirm(product, unitPrice, selectedComplements)}>Adicionar item</button>
        </div>
      </section>
    </div>
  );
}

function DirectDiscountModal({
  subtotal,
  discount,
  onCancel,
  onConfirm
}: {
  subtotal: number;
  discount: number;
  onCancel: () => void;
  onConfirm: (discount: number) => void;
}) {
  const [discountValue, setDiscountValue] = useState(String(discount || "").replace(".", ","));
  const [discountPercent, setDiscountPercent] = useState("");
  const calculatedDiscount = Math.min(
    subtotal,
    roundMoney(parseBrazilianNumber(discountValue) + subtotal * (parseBrazilianNumber(discountPercent) / 100))
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm(calculatedDiscount);
    }
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-direct-discount-modal" tabIndex={-1} autoFocus onKeyDown={handleKeyDown}>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Venda direta</span>
            <h1>Aplicar desconto</h1>
            <p>O desconto vale somente para esta venda.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Subtotal" value={money(subtotal)} />
          <Metric title="Desconto" value={money(calculatedDiscount)} />
          <Metric title="Total final" value={money(Math.max(0, roundMoney(subtotal - calculatedDiscount)))} />
        </div>
        <div className="pdv-editor-grid pdv-close-discounts">
          <label>
            <span>Desconto em R$</span>
            <input autoFocus inputMode="decimal" value={discountValue} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0,00" />
          </label>
          <label>
            <span>Desconto em %</span>
            <input inputMode="decimal" value={discountPercent} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDiscountPercent(event.target.value)} placeholder="0" />
          </label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" onClick={() => onConfirm(calculatedDiscount)}>Aplicar desconto</button>
        </div>
      </section>
    </div>
  );
}

function TableCloseMenu({
  table,
  subtotal,
  scopeLabel,
  roundingStep: configuredRoundingStep,
  roundingDirection: configuredRoundingDirection,
  onPeopleChange,
  onCancel,
  onPartialItems,
  onCloseTotal
}: {
  table: PdvOpenTable;
  subtotal: number;
  scopeLabel?: string;
  roundingStep?: number;
  roundingDirection?: RoundDirection;
  onPeopleChange?: (people: number) => void;
  onCancel: () => void;
  onPartialItems: () => void;
  onCloseTotal: (total: number, discount: number, initialPayments?: PdvPayment[]) => void;
}) {
  const [discountValue, setDiscountValue] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [people, setPeople] = useState(Math.max(1, table.people || 1));
  const [roundingStep, setRoundingStep] = useState(configuredRoundingStep || 0.01);
  const [roundingDirection, setRoundingDirection] = useState<RoundDirection>(configuredRoundingDirection || "nearest");
  const [focusedAction, setFocusedAction] = useState(0);
  const discount = Math.min(subtotal, roundMoney(parseBrazilianNumber(discountValue) + subtotal * (parseBrazilianNumber(discountPercent) / 100)));
  const total = Math.max(0, roundMoney(subtotal - discount));
  const split = calculateSplit(total, people, roundingStep, roundingDirection, false);
  const splitPreview = Array.from({ length: Math.max(1, people) }, (_, index) => ({
    id: `person-${index + 1}`,
    amount: split.perPersonRounded
  }));
  const changePeople = (next: number) => {
    const normalized = Math.max(1, Math.floor(next || 1));
    setPeople(normalized);
    onPeopleChange?.(normalized);
  };

  useEffect(() => {
    if (configuredRoundingStep || configuredRoundingDirection) {
      setRoundingStep(configuredRoundingStep || 0.01);
      setRoundingDirection(configuredRoundingDirection || "nearest");
      return;
    }
    void window.caixa.getSnapshot().then((snapshot) => {
      setRoundingStep(snapshot.settings.defaultRoundingStep || 0.01);
      setRoundingDirection(snapshot.settings.defaultRoundingDirection || "nearest");
    });
  }, [configuredRoundingStep, configuredRoundingDirection]);

  const runFocusedAction = () => {
    if (focusedAction === 0) onCloseTotal(total, discount);
    if (focusedAction === 1) onPartialItems();
    if (focusedAction === 2) onCancel();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      onCloseTotal(total, discount);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      onPartialItems();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      if (target.tagName === "INPUT") return;
      event.preventDefault();
      setFocusedAction((current) => (current + 1) % 3);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      if (target.tagName === "INPUT") return;
      event.preventDefault();
      setFocusedAction((current) => (current + 2) % 3);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runFocusedAction();
    }
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      handleKeyDown(event as unknown as React.KeyboardEvent);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [focusedAction, total, discount]);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-close-menu" tabIndex={-1} autoFocus>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechar conta</span>
            <h1>{scopeLabel ? `${scopeLabel} · ` : "Mesa "}{String(table.number).padStart(3, "0")}</h1>
            <p>Revise desconto, divisao por pessoas e escolha como fechar.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Total bruto" value={money(subtotal)} />
          <Metric title="Desconto" value={money(discount)} />
          <Metric title="Total final" value={money(total)} />
        </div>
        <div className="pdv-editor-grid pdv-close-discounts">
          <label>
            <span>Desconto em R$</span>
            <input value={discountValue} onChange={(event) => {
              setDiscountValue(event.target.value);
              if (event.target.value) setDiscountPercent("");
            }} placeholder="0,00" />
          </label>
          <label>
            <span>Desconto em %</span>
            <input value={discountPercent} onChange={(event) => {
              setDiscountPercent(event.target.value);
              if (event.target.value) setDiscountValue("");
            }} placeholder="0" />
          </label>
        </div>
        <div className="pdv-close-split">
          <div>
            <strong>Dividir por pessoas</strong>
            <span>Aproximacao: {String(roundingStep).replace(".", ",")} / {roundingDirection}</span>
          </div>
          <div className="pdv-inline-stepper">
            <input type="number" min={1} value={people} onChange={(event) => changePeople(Number(event.target.value || 1))} />
            <button onClick={() => changePeople(people - 1)}>-</button>
            <button onClick={() => changePeople(people + 1)}>+</button>
          </div>
          <div className="pdv-split-preview">
            <span>Valor por pessoa: <b>{money(split.perPersonRounded)}</b></span>
            <span>{people} pessoa(s) selecionada(s)</span>
            {Math.abs(split.difference) > 0.009 && <span>Ajuste da aproximacao: <b>{money(split.difference)}</b></span>}
          </div>
        </div>
        <div className="pdv-action-row">
          <button className={`pdv-primary-button ${focusedAction === 0 ? "keyboard-focus" : ""}`} onClick={() => onCloseTotal(total, discount)}>Fechar total <small>F1</small></button>
          <button className={`pdv-ghost-button ${focusedAction === 1 ? "keyboard-focus" : ""}`} onClick={onPartialItems}>Fechar parcial <small>F2</small></button>
          <button className={`pdv-danger-button ${focusedAction === 2 ? "keyboard-focus" : ""}`} onClick={onCancel}>Voltar <small>Esc</small></button>
        </div>
      </section>
    </div>
  );
}

function CoseImportButton({ onPreview, onImport, onImported, busy }: { onPreview: () => Promise<PdvProductImportPreview>; onImport: () => Promise<PdvProductImportResult>; onImported: () => void | Promise<void>; busy: boolean }) {
  const [preview, setPreview] = useState<PdvProductImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const openPreview = async () => {
    setLoading(true);
    try {
      setPreview(await onPreview());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel analisar a planilha Cose Dell Abadia.");
    } finally {
      setLoading(false);
    }
  };
  const confirm = async () => {
    setLoading(true);
    try {
      const result = await onImport();
      setPreview(null);
      await onImported();
      setNotice(`${result.importedProducts} produtos e ${result.importedCategories} categorias importados.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel importar os produtos.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <button className="pdv-primary-button" disabled={busy || loading} onClick={() => void openPreview()}><Download size={18} /> {loading ? "Analisando..." : "Importar Cose Dell Abadia"}</button>
      {preview && (
        <div className="pdv-modal-backdrop">
          <section className="pdv-payment-modal pdv-cose-preview-modal">
            <div className="pdv-section-head">
              <div><span className="pdv-eyebrow">Previa de importacao</span><h1>Cose Dell Abadia</h1><p>Confira a alteracao antes de substituir os produtos importados.</p></div>
              <button className="pdv-icon-button" onClick={() => setPreview(null)}><X size={18} /></button>
            </div>
            <div className="pdv-payment-summary">
              <Metric title="Produtos na planilha" value={String(preview.products)} />
              <Metric title="Novos" value={String(preview.addedProducts)} />
              <Metric title="Atualizados" value={String(preview.updatedProducts)} />
            <Metric title="Desativados" value={String(preview.removedProducts)} />
            <Metric title="Manuais preservados" value={String(preview.manualProductsPreserved)} />
            <Metric title="Conflitos manuais" value={String(preview.manualConflicts)} />
            <Metric title="Ignorados" value={String(preview.ignoredRows)} />
          </div>
            <p className="pdv-confirm-message">A importacao atualiza somente itens da Cose Dell Abadia. Produtos manuais que nao fazem parte dela permanecem no cadastro; conflitos de nome e categoria tambem sao preservados.</p>
            <div className="pdv-action-row"><button className="pdv-danger-button" disabled={loading} onClick={() => setPreview(null)}>Cancelar</button><button className="pdv-primary-button" disabled={loading} onClick={() => void confirm()}>{loading ? "Importando..." : "Confirmar importacao"}</button></div>
          </section>
        </div>
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </>
  );
}

function FileImportButton({ onPreview, onImport, onImported, busy }: { onPreview: () => Promise<PdvProductImportPreview | null>; onImport: (filePath: string) => Promise<PdvProductImportResult>; onImported: () => void | Promise<void>; busy: boolean }) {
  const [preview, setPreview] = useState<PdvProductImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const openPreview = async () => {
    setLoading(true);
    try {
      setPreview(await onPreview());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel analisar a planilha.");
    } finally {
      setLoading(false);
    }
  };
  const confirm = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const result = await onImport(preview.filePath);
      setPreview(null);
      await onImported();
      setNotice(`${result.importedProducts} produtos e ${result.importedCategories} categorias importados.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel importar os produtos.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <button className="pdv-ghost-button" disabled={busy || loading} onClick={() => void openPreview()}><FileSpreadsheet size={18} /> {loading ? "Analisando..." : "Importar arquivo"}</button>
      {preview && (
        <div className="pdv-modal-backdrop">
          <section className="pdv-payment-modal pdv-cose-preview-modal">
            <div className="pdv-section-head">
              <div><span className="pdv-eyebrow">Previa de importacao</span><h1>Produtos da planilha</h1><p>Confira as alteracoes antes de confirmar o arquivo selecionado.</p></div>
              <button className="pdv-icon-button" onClick={() => setPreview(null)}><X size={18} /></button>
            </div>
            <div className="pdv-payment-summary">
              <Metric title="Produtos na planilha" value={String(preview.products)} />
              <Metric title="Novos" value={String(preview.addedProducts)} />
              <Metric title="Atualizados" value={String(preview.updatedProducts)} />
              <Metric title="Desativados" value={String(preview.removedProducts)} />
              <Metric title="Manuais preservados" value={String(preview.manualProductsPreserved)} />
              <Metric title="Conflitos manuais" value={String(preview.manualConflicts)} />
              <Metric title="Ignorados" value={String(preview.ignoredRows)} />
            </div>
            <p className="pdv-confirm-message">Produtos manuais com o mesmo nome e categoria nao serao sobrescritos. O banco e salvo em backup antes da importacao.</p>
            <div className="pdv-action-row"><button className="pdv-danger-button" disabled={loading} onClick={() => setPreview(null)}>Cancelar</button><button className="pdv-primary-button" disabled={loading} onClick={() => void confirm()}>{loading ? "Importando..." : "Confirmar importacao"}</button></div>
          </section>
        </div>
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </>
  );
}

function ProductsScreen({ snapshot, readOnly = false, onImportCose, onPreviewCose, onRemoveCose, onPreviewImportFile, onImportFile, busy, onProductsUpdated, updatePdvProducts, savePdvCategory, savePdvProduct, removePdvProduct }: { snapshot: PdvSnapshot; readOnly?: boolean; onImportCose: () => Promise<PdvProductImportResult>; onPreviewCose: () => Promise<PdvProductImportPreview>; onRemoveCose: () => Promise<number>; onPreviewImportFile: () => Promise<PdvProductImportPreview | null>; onImportFile: (filePath: string) => Promise<PdvProductImportResult>; busy: boolean; onProductsUpdated: () => void; updatePdvProducts: (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => Promise<void>; savePdvCategory: (draft: PdvCategoryDraft) => Promise<PdvCategory>; savePdvProduct: (draft: PdvProductDraft) => Promise<PdvProduct>; removePdvProduct: (id: string) => ReturnType<typeof window.caixa.removePdvProduct> }) {
  const [section, setSection] = useState<"products" | "categories" | "complements" | "imports">("products");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState(snapshot.categories[0]?.id || "");
  const [filterCategoryId, setFilterCategoryId] = useState("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | "ativos" | "inativos" | "ocultos">("todos");
  const [productQuery, setProductQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<PdvProduct | "new" | null>(null);
  const [editingCategory, setEditingCategory] = useState<PdvCategory | "new" | null>(null);
  const [removeProductRequest, setRemoveProductRequest] = useState<PdvProduct | null>(null);
  const [removeCoseConfirm, setRemoveCoseConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const filteredProducts = snapshot.products.filter((product) => {
    const categoryMatch = filterCategoryId === "todos" || product.categoryId === filterCategoryId;
    const normalizedQuery = productQuery.trim().toLocaleLowerCase("pt-BR");
    const queryMatch = !normalizedQuery || [
      product.name,
      product.sku,
      product.barcode,
      product.supplier
    ].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    const statusMatch = statusFilter === "todos"
      || (statusFilter === "ativos" && product.active && product.showOnPdv)
      || (statusFilter === "inativos" && !product.active)
      || (statusFilter === "ocultos" && !product.showOnPdv);
    const sectionMatch = section !== "complements" || product.canBeComplement || product.hasComplements || product.complementProductIds.length > 0;
    return categoryMatch && queryMatch && statusMatch && sectionMatch;
  });
  const showAllProducts = () => {
    setSection("products");
    setProductQuery("");
    setFilterCategoryId("todos");
    setStatusFilter("todos");
    setSelectedIds([]);
  };
  const updateSelected = async (patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => {
    await updatePdvProducts(selectedIds, patch);
    setSelectedIds([]);
    onProductsUpdated();
  };
  const saveProduct = async (draft: PdvProductDraft) => {
    await savePdvProduct(draft);
    setEditingProduct(null);
    onProductsUpdated();
  };
  const saveCategory = async (draft: PdvCategoryDraft) => {
    await savePdvCategory(draft);
    setEditingCategory(null);
    onProductsUpdated();
  };
  const removeProduct = async () => {
    if (!removeProductRequest) return;
    const result = await removePdvProduct(removeProductRequest.id);
    setRemoveProductRequest(null);
    setSelectedIds((current) => current.filter((id) => id !== result.id));
    setNotice(result.mode === "deleted"
      ? "Produto excluido. Nenhum historico foi alterado."
      : "Produto arquivado porque possui lancamentos. O historico foi preservado.");
    onProductsUpdated();
  };
  return (
    <section className="pdv-panel pdv-products-settings-screen">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Catalogo e estoque</span>
          <h1>Produtos e categorias</h1>
          <p>{snapshot.products.length} produtos em {snapshot.categories.length} categorias · {snapshot.products.filter((product) => product.trackStock).length} com estoque controlado.</p>
        </div>
        <div className="pdv-action-row">
          {!readOnly && section === "products" && <button className="pdv-primary-button" onClick={() => setEditingProduct("new")}><Plus size={16} /> Novo produto</button>}
          {!readOnly && section === "categories" && <button className="pdv-primary-button" onClick={() => setEditingCategory("new")}><Plus size={16} /> Nova categoria</button>}
        </div>
      </div>
      <div className="pdv-settings-nav" role="tablist" aria-label="Cadastro do PDV">
        <button className={section === "products" ? "active" : ""} onClick={() => setSection("products")}>Produtos <span>{snapshot.products.length}</span></button>
        <button className={section === "categories" ? "active" : ""} onClick={() => setSection("categories")}>Categorias <span>{snapshot.categories.length}</span></button>
        <button className={section === "complements" ? "active" : ""} onClick={() => setSection("complements")}>Adicionais</button>
        <button className={section === "imports" ? "active" : ""} onClick={() => setSection("imports")}>Importacao</button>
      </div>

      {(section === "products" || section === "complements") && (
        <div className="pdv-products-content">
          <div className="pdv-product-filterbar">
            <button className={filterCategoryId === "todos" && statusFilter === "todos" && !productQuery ? "active" : ""} onClick={showAllProducts}>
              Todos os produtos <span>{snapshot.products.length}</span>
            </button>
            <div className="pdv-search pdv-settings-search">
              <Search size={17} />
              <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Nome, codigo, barras ou fornecedor" />
            </div>
            <select value={filterCategoryId} onChange={(event) => setFilterCategoryId(event.target.value)}>
              <option value="todos">Todas as categorias</option>
              {snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="todos">Todos os estados</option>
              <option value="ativos">Ativos no PDV</option>
              <option value="inativos">Inativos</option>
              <option value="ocultos">Ocultos do PDV</option>
            </select>
            <strong>{filteredProducts.length} exibido(s)</strong>
          </div>
          {!readOnly && selectedIds.length > 0 && (
            <div className="pdv-selection-toolbar">
              <strong>{selectedIds.length} selecionado(s)</strong>
              <select value={targetCategoryId} onChange={(event) => setTargetCategoryId(event.target.value)}>
                {snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <button onClick={() => updateSelected({ categoryId: targetCategoryId })}>Mover</button>
              <button onClick={() => updateSelected({ showOnPdv: true })}>Exibir</button>
              <button onClick={() => updateSelected({ showOnPdv: false })}>Ocultar</button>
              <button onClick={() => updateSelected({ favorite: true })}>Favoritar</button>
              <button onClick={() => setSelectedIds([])}>Limpar</button>
            </div>
          )}
          <div className="pdv-product-table">
            {filteredProducts.map((product) => (
              <article key={product.id} className={product.active ? "" : "inactive"}>
                {!readOnly && <input type="checkbox" aria-label={`Selecionar ${product.name}`} checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, product.id])] : current.filter((id) => id !== product.id))} />}
                <div className="pdv-product-main">
                  <strong>{product.name}</strong>
                  <small>{product.categoryName} · {product.unitMode === "kg" ? "Kg" : product.unitMode === "grama" ? "Grama" : "Unidade"}{product.sku ? ` · ${product.sku}` : ""}</small>
                </div>
                <div className="pdv-product-price-cell">
                  <b>{money(product.price)}</b>
                  <small>{product.costPrice ? `Custo ${money(product.costPrice)}` : "Custo nao informado"}</small>
                </div>
                <div className="pdv-product-badges">
                  <span className={product.active && product.showOnPdv ? "success" : "muted"}>{product.active ? (product.showOnPdv ? "No PDV" : "Oculto") : "Inativo"}</span>
                  {product.trackStock && (
                    <span className={(product.stockQuantity || 0) <= (product.minimumStock || 0) ? "danger" : "success"}>
                      Estoque {formatQuantity(product.stockQuantity || 0)}
                    </span>
                  )}
                  {Boolean(product.favorite) && <span>Favorito</span>}
                  {Boolean(product.canBeComplement) && <span>Adicional</span>}
                  {product.complementProductIds.length > 0 && <span>{product.complementProductIds.length} vinculado(s)</span>}
                  {product.importSource && <span>{product.importSource}</span>}
                </div>
                {!readOnly && (
                  <div className="pdv-row-actions">
                    <button className="pdv-icon-button" title="Editar produto" onClick={() => setEditingProduct(product)}><Pencil size={16} /></button>
                    <button className="pdv-icon-button danger" title="Excluir ou arquivar produto" onClick={() => setRemoveProductRequest(product)}><Trash2 size={16} /></button>
                  </div>
                )}
              </article>
            ))}
            {!filteredProducts.length && <div className="pdv-empty">Nenhum produto encontrado. Use “Todos os produtos” para limpar os filtros.</div>}
          </div>
        </div>
      )}

      {section === "categories" && (
        <div className="pdv-category-settings-list">
          {snapshot.categories.map((category) => {
            const count = snapshot.products.filter((product) => product.categoryId === category.id).length;
            return (
              <article key={category.id} className={category.active ? "" : "inactive"}>
                <div><strong>{category.name}</strong><span>{count} produto(s)</span></div>
                <small>{category.active ? "Visivel no lancamento" : "Categoria oculta"}{category.favorite ? " · Favorita" : ""}</small>
                {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditingCategory(category)}>Editar</button>}
              </article>
            );
          })}
        </div>
      )}

      {section === "imports" && (
        <div className="pdv-import-settings">
          <div>
            <strong>Importar arquivo Excel ou CSV</strong>
            <span>Adicione e atualize produtos sem usar a planilha como banco principal.</span>
            {!readOnly && <FileImportButton busy={busy} onPreview={onPreviewImportFile} onImport={onImportFile} onImported={onProductsUpdated} />}
          </div>
          <div>
            <strong>Preset Cose Dell Abadia</strong>
            <span>{snapshot.products.filter((product) => product.importSource === "Cose Dell Abadia").length} produto(s) identificados nesta importacao.</span>
            {!readOnly && <CoseImportButton busy={busy} onPreview={onPreviewCose} onImport={onImportCose} onImported={onProductsUpdated} />}
            {!readOnly && <button className="pdv-danger-button" disabled={busy || !snapshot.products.some((product) => product.importSource === "Cose Dell Abadia")} onClick={() => setRemoveCoseConfirm(true)}>Remover somente esta importacao</button>}
          </div>
        </div>
      )}
      {editingProduct && (
        <ProductEditorModal
          product={editingProduct === "new" ? null : editingProduct}
          categories={snapshot.categories}
          products={snapshot.products}
          complementsEnabled={snapshot.settings.complementsEnabled}
          onCancel={() => setEditingProduct(null)}
          onSave={saveProduct}
        />
      )}
      {editingCategory && (
        <CategoryEditorModal
          category={editingCategory === "new" ? null : editingCategory}
          onCancel={() => setEditingCategory(null)}
          onSave={saveCategory}
        />
      )}
      {removeCoseConfirm && (
        <PdvConfirmModal
          title="Remover importacao Cose Dell Abadia?"
          message="Somente os produtos identificados como importados da Cose serao removidos. Cadastros manuais e vendas ja registradas serao preservados."
          onCancel={() => setRemoveCoseConfirm(false)}
          onConfirm={() => { void onRemoveCose().then(() => { setRemoveCoseConfirm(false); onProductsUpdated(); }); }}
        />
      )}
      {removeProductRequest && (
        <PdvConfirmModal
          title={`Excluir ${removeProductRequest.name}?`}
          message="Se o produto ja fizer parte de vendas ou mesas, ele sera apenas arquivado. Historico, relatorios e valores antigos continuarao preservados."
          onCancel={() => setRemoveProductRequest(null)}
          onConfirm={() => { void removeProduct(); }}
        />
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </section>
  );
}

function ProductEditorModal({ product, categories, products, complementsEnabled, onCancel, onSave }: { product: PdvProduct | null; categories: PdvCategory[]; products: PdvProduct[]; complementsEnabled: boolean; onCancel: () => void; onSave: (draft: PdvProductDraft) => void }) {
  const [section, setSection] = useState<"commercial" | "stock" | "availability" | "complements">("commercial");
  const [draft, setDraft] = useState<PdvProductDraft>({
    id: product?.id,
    name: product?.name || "",
    categoryId: product?.categoryId || categories[0]?.id || "",
    price: product?.price || 0,
    costPrice: product?.costPrice || 0,
    unit: product?.unit || "UNID",
    unitMode: product?.unitMode || "unidade",
    active: product?.active ?? true,
    showOnPdv: product?.showOnPdv ?? true,
    favorite: product?.favorite ?? false,
    canBeComplement: product?.canBeComplement ?? false,
    hasComplements: product?.hasComplements ?? false,
    complementProductIds: product?.complementProductIds || [],
    sortOrder: product?.sortOrder || 0,
    trackStock: product?.trackStock ?? false,
    stockQuantity: product?.stockQuantity || 0,
    minimumStock: product?.minimumStock || 0,
    sku: product?.sku || "",
    barcode: product?.barcode || "",
    supplier: product?.supplier || "",
    description: product?.description || ""
  });
  const [priceText, setPriceText] = useState(product ? String(product.price).replace(".", ",") : "");
  const [costText, setCostText] = useState(product?.costPrice ? String(product.costPrice).replace(".", ",") : "");
  const [stockText, setStockText] = useState(product ? String(product.stockQuantity || 0).replace(".", ",") : "0");
  const [minimumStockText, setMinimumStockText] = useState(product ? String(product.minimumStock || 0).replace(".", ",") : "0");
  const complementOptions = products.filter((item) => item.id !== product?.id && item.canBeComplement);
  const parsedPrice = roundMoney(parseBrazilianNumber(priceText || String(draft.price)));
  const parsedCost = roundMoney(parseBrazilianNumber(costText || "0"));
  const parsedStock = roundQuantity(parseBrazilianNumber(stockText || "0"));
  const parsedMinimumStock = roundQuantity(parseBrazilianNumber(minimumStockText || "0"));
  const margin = parsedPrice > 0 ? ((parsedPrice - parsedCost) / parsedPrice) * 100 : 0;
  const saveDraft = () => onSave({
    ...draft,
    price: parsedPrice,
    costPrice: parsedCost,
    stockQuantity: parsedStock,
    minimumStock: parsedMinimumStock
  });
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-editor-modal pdv-product-editor-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Cadastro</span>
            <h1>{product ? "Editar produto" : "Novo produto"}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-product-editor-summary">
          <div><span>Venda</span><strong>{money(parsedPrice)}</strong></div>
          <div><span>Custo</span><strong>{money(parsedCost)}</strong></div>
          <div className={margin < 0 ? "danger" : ""}><span>Margem bruta</span><strong>{Number.isFinite(margin) ? `${formatQuantity(margin)}%` : "0%"}</strong></div>
          <div><span>Estoque</span><strong>{draft.trackStock ? formatQuantity(parsedStock) : "Sem controle"}</strong></div>
        </div>
        <nav className="pdv-product-editor-nav" aria-label="Secoes do produto">
          <button className={section === "commercial" ? "active" : ""} onClick={() => setSection("commercial")}>Dados e precos</button>
          <button className={section === "stock" ? "active" : ""} onClick={() => setSection("stock")}>Estoque e codigos</button>
          <button className={section === "availability" ? "active" : ""} onClick={() => setSection("availability")}>Disponibilidade</button>
          {complementsEnabled && <button className={section === "complements" ? "active" : ""} onClick={() => setSection("complements")}>Adicionais</button>}
        </nav>
        <div className="pdv-product-editor-body">
        {section === "commercial" && <section className="pdv-editor-section">
          <div className="pdv-editor-section-title">
            <strong>Dados comerciais</strong>
            <small>Identificacao, categoria, custo e preco praticado no caixa.</small>
          </div>
          <div className="pdv-editor-grid pdv-product-basics-grid">
            <label className="pdv-editor-field-wide"><span>Nome do produto</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ex.: Cafe com leite 300 ml" /></label>
            <label><span>Categoria</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label><span>Preco de venda</span><input inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} placeholder="Ex.: 12,90" /></label>
            <label><span>Preco de custo</span><input inputMode="decimal" value={costText} onChange={(event) => setCostText(event.target.value)} placeholder="Ex.: 6,40" /></label>
            <label>
              <span>Tipo de venda</span>
              <select value={draft.unitMode} onChange={(event) => {
                const unitMode = event.target.value as PdvProductDraft["unitMode"];
                setDraft({ ...draft, unitMode, unit: unitMode === "kg" ? "KG" : unitMode === "grama" ? "G" : "UNID" });
              }}>
                <option value="unidade">Unidade</option>
                <option value="kg">Quilograma</option>
                <option value="grama">Grama</option>
              </select>
            </label>
            <label><span>Unidade exibida</span><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value.toUpperCase() })} placeholder="UNID" /></label>
            <label className="pdv-editor-field-full"><span>Descricao interna</span><textarea value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Detalhes, tamanho, sabor ou observacoes para a equipe." /></label>
          </div>
        </section>}
        {section === "stock" && <section className="pdv-editor-section">
          <div className="pdv-editor-section-title">
            <strong>Estoque e identificacao</strong>
            <small>O estoque e baixado ao finalizar a venda e devolvido quando ela e cancelada.</small>
          </div>
          <label className="pdv-stock-control-toggle">
            <input type="checkbox" checked={Boolean(draft.trackStock)} onChange={(event) => setDraft({ ...draft, trackStock: event.target.checked })} />
            <span><strong>Controlar estoque deste produto</strong><small>Permite alertas de quantidade minima na Visao geral.</small></span>
          </label>
          <div className="pdv-editor-grid pdv-product-stock-grid">
            <label><span>Quantidade atual</span><input disabled={!draft.trackStock} inputMode="decimal" value={stockText} onChange={(event) => setStockText(event.target.value)} /></label>
            <label><span>Estoque minimo</span><input disabled={!draft.trackStock} inputMode="decimal" value={minimumStockText} onChange={(event) => setMinimumStockText(event.target.value)} /></label>
            <label><span>Codigo interno (SKU)</span><input value={draft.sku || ""} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} placeholder="Ex.: CAF-00300" /></label>
            <label><span>Codigo de barras</span><input inputMode="numeric" value={draft.barcode || ""} onChange={(event) => setDraft({ ...draft, barcode: event.target.value.replace(/\D/g, "") })} placeholder="Leia ou digite o codigo" /></label>
            <label className="pdv-editor-field-full"><span>Fornecedor</span><input value={draft.supplier || ""} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} placeholder="Nome do fornecedor principal" /></label>
          </div>
          {draft.trackStock && parsedStock <= parsedMinimumStock && (
            <p className="pdv-product-stock-warning">A quantidade atual esta no estoque minimo. Este produto aparecera como alerta na Visao geral.</p>
          )}
        </section>}
        {section === "availability" && <section className="pdv-editor-section">
          <div className="pdv-editor-section-title">
            <strong>Disponibilidade e comportamento</strong>
            <small>Controle onde o produto aparece sem alterar vendas antigas.</small>
          </div>
          <div className="pdv-product-toggle-grid">
            <label className="pdv-switch-line"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span><strong>Produto ativo</strong><small>Pode ser utilizado em novos lancamentos.</small></span></label>
            <label className="pdv-switch-line"><input type="checkbox" checked={draft.showOnPdv} onChange={(event) => setDraft({ ...draft, showOnPdv: event.target.checked })} /><span><strong>Exibir no PDV</strong><small>Aparece na grade de venda e mesas.</small></span></label>
            <label className="pdv-switch-line"><input type="checkbox" checked={draft.favorite} onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })} /><span><strong>Favorito no topo</strong><small>Recebe prioridade dentro da categoria.</small></span></label>
            {complementsEnabled && <label className="pdv-switch-line"><input type="checkbox" checked={draft.canBeComplement} onChange={(event) => setDraft({ ...draft, canBeComplement: event.target.checked })} /><span><strong>Pode ser adicional</strong><small>Pode ser vinculado a outros produtos.</small></span></label>}
            {complementsEnabled && <label className="pdv-switch-line"><input type="checkbox" checked={draft.hasComplements} onChange={(event) => setDraft({ ...draft, hasComplements: event.target.checked })} /><span><strong>Solicitar adicionais</strong><small>Abre a selecao antes de lancar no carrinho.</small></span></label>}
          </div>
        </section>}
        {section === "complements" && complementsEnabled && <section className="pdv-complement-config pdv-editor-section">
          <div className="pdv-editor-section-title">
            <strong>Adicionais permitidos</strong>
            <small>Somente produtos marcados como "Pode ser adicional" aparecem aqui.</small>
          </div>
          <div className="pdv-complement-config-list">
            {complementOptions.map((item) => (
              <label key={item.id} className="pdv-switch-line">
                <input
                  type="checkbox"
                  checked={draft.complementProductIds.includes(item.id)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      hasComplements: event.target.checked || current.complementProductIds.length > 1 || (!event.target.checked && current.complementProductIds.filter((id) => id !== item.id).length > 0),
                      complementProductIds: event.target.checked
                        ? [...current.complementProductIds, item.id]
                        : current.complementProductIds.filter((id) => id !== item.id)
                    }))
                  }
                />
                {item.name} - {money(item.price)}
              </label>
            ))}
            {!complementOptions.length && <p className="pdv-empty">Marque produtos como adicionais para vincular aqui.</p>}
          </div>
        </section>}
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={!draft.name.trim() || !draft.categoryId || parsedPrice <= 0} onClick={saveDraft}>Salvar produto</button>
        </div>
      </section>
    </div>
  );
}

function CategoryEditorModal({ category, onCancel, onSave }: { category: PdvCategory | null; onCancel: () => void; onSave: (draft: PdvCategoryDraft) => void }) {
  const [draft, setDraft] = useState<PdvCategoryDraft>({
    id: category?.id,
    name: category?.name || "",
    active: category?.active ?? true,
    favorite: category?.favorite ?? false,
    sortOrder: category?.sortOrder || 0
  });
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-editor-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Categorias</span>
            <h1>{category ? "Editar categoria" : "Nova categoria"}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label><span>Nome</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Categoria ativa</label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.favorite} onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })} /> Categoria favorita no topo</label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>Salvar categoria</button>
        </div>
      </section>
    </div>
  );
}

function ContextMenu({ x, y, children, onClose }: { x: number; y: number; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  const safeX = Math.max(8, Math.min(x, window.innerWidth - 260));
  const safeY = Math.max(8, Math.min(y, window.innerHeight - 380));
  return (
    <div className="pdv-context-menu" style={{ left: safeX, top: safeY }} onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

function CancelItemsModal({
  isTable,
  cart,
  scopeLabel,
  onCancel,
  onClear,
  onRemove
}: {
  isTable: boolean;
  cart: PdvCartItem[];
  scopeLabel?: string;
  onCancel: () => void;
  onClear: () => void;
  onRemove: (item: PdvCartItem) => void;
}) {
  const [selectedId, setSelectedId] = useState(cart[0]?.id || "");
  const selected = cart.find((item) => item.id === selectedId) || null;
  useModalConfirmShortcut(onClear, onCancel, true);
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-confirm-modal pdv-cancel-items-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Cancelar</span>
            <h1>{isTable ? "O que deseja cancelar?" : "Limpar carrinho?"}</h1>
            <p>{isTable ? `Cancele somente ${scopeLabel || "a mesa inteira"} ou remova um item dessa conta.` : "Todos os itens do carrinho serao removidos."}</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        {isTable && (
          <label className="pdv-wide-field">
            <span>Item especifico</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {cart.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.productName} - {money(item.total)}</option>)}
            </select>
          </label>
        )}
        <div className="pdv-action-row pdv-cancel-choice-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          {isTable && <button className="pdv-ghost-button" disabled={!selected} onClick={() => selected && onRemove(selected)}>Remover item</button>}
          <button className="pdv-primary-button" onClick={onClear}>{isTable ? `Cancelar ${scopeLabel || "mesa inteira"}` : "Limpar carrinho"}</button>
        </div>
      </section>
    </div>
  );
}

function PdvNoticeModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-confirm-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Atencao</span>
            <h1>Confira a informacao</h1>
          </div>
          <button className="pdv-icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="pdv-confirm-message pdv-preserve-lines">{message}</p>
        <div className="pdv-action-row">
          <button className="pdv-primary-button" onClick={onClose}>Entendi</button>
        </div>
      </section>
    </div>
  );
}

function PdvConfirmModal({
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel = "Confirmar",
  danger = false
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const confirmed = useRef(false);
  const runConfirm = () => {
    if (confirmed.current) {
      return;
    }
    confirmed.current = true;
    onConfirm();
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runConfirm();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onConfirm]);
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-confirm-modal" tabIndex={-1} autoFocus>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Confirmacao</span>
            <h1>{title}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <p className="pdv-confirm-message">{message}</p>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className={danger ? "pdv-danger-button" : "pdv-primary-button"} onClick={runConfirm}><Check size={16} /> {confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

type HistoryView = "sales" | "receivables" | "customers";

function HistoryViewTabs({ value, onChange, showSales = true }: { value: HistoryView; onChange: (value: HistoryView) => void; showSales?: boolean }) {
  return (
    <div className="pdv-settings-nav pdv-history-view-tabs" role="tablist" aria-label="Historico e contas">
      {showSales && <button className={value === "sales" ? "active" : ""} onClick={() => onChange("sales")}>Vendas</button>}
      <button className={value === "receivables" ? "active" : ""} onClick={() => onChange("receivables")}>Contas a receber</button>
      <button className={value === "customers" ? "active" : ""} onClick={() => onChange("customers")}>Clientes</button>
    </div>
  );
}

function ReceivablesScreen({
  snapshot,
  view,
  onViewChange,
  onChanged,
  onReceive,
  onCancelReceivable,
  showSales,
  hideNavigation,
  allowPrint,
  receiptPrintTargets,
  onRemoteReceiptPrint
}: {
  snapshot: PdvSnapshot;
  view: HistoryView;
  onViewChange: (value: HistoryView) => void;
  onChanged: () => void;
  onReceive: (id: string, payment: PdvReceivablePayment, operationId?: string) => Promise<PdvReceivable>;
  onCancelReceivable: (id: string) => Promise<void>;
  showSales: boolean;
  hideNavigation: boolean;
  allowPrint: boolean;
  receiptPrintTargets: Array<{ id: string; label: string }>;
  onRemoteReceiptPrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const [receiving, setReceiving] = useState<PdvReceivable | null>(null);
  const [cancelRequest, setCancelRequest] = useState<PdvReceivable | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<{ sale: PdvSale; receivable: PdvReceivable } | null>(null);
  const [notice, setNotice] = useState("");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const receivables = snapshot.receivables.filter((item) => {
    if (status === "Pendentes" && !["Em aberto", "Parcialmente recebida", "Vencida"].includes(item.status)) return false;
    if (status !== "Todos" && status !== "Pendentes" && item.status !== status) return false;
    if (!normalized) return true;
    const sale = snapshot.recentSales.find((value) => value.id === item.saleId);
    return [
      item.customerName,
      item.status,
      item.note,
      item.tableNumber ? `mesa ${item.tableNumber}` : "",
      money(item.originalAmount),
      ...(sale?.items.map((value) => value.productName) || [])
    ].join(" ").toLocaleLowerCase("pt-BR").includes(normalized);
  });
  const pending = snapshot.receivables.filter((item) => ["Em aberto", "Parcialmente recebida", "Vencida"].includes(item.status));
  const outstanding = roundMoney(pending.reduce((sum, item) => sum + item.balance, 0));
  const overdue = roundMoney(pending.filter((item) => item.status === "Vencida").reduce((sum, item) => sum + item.balance, 0));
  const receivedToday = roundMoney(snapshot.receivables.flatMap((item) => item.payments).filter((payment) => localDateInputValue(new Date(payment.createdAt)) === localDateInputValue()).reduce((sum, payment) => sum + payment.amount, 0));

  const registerPayment = async (receivable: PdvReceivable, payment: PdvPayment) => {
    if (payment.method === "Conta a receber") return;
    await onReceive(receivable.id, {
      ...payment,
      receivableId: receivable.id,
      createdAt: new Date().toISOString(),
      method: payment.method
    }, crypto.randomUUID());
    setReceiving(null);
    await onChanged();
    setNotice("Recebimento registrado e saldo atualizado.");
  };

  const openReceipt = (receivable: PdvReceivable) => {
    const sale = snapshot.recentSales.find((item) => item.id === receivable.saleId);
    if (!sale) {
      setNotice("A venda vinculada nao foi encontrada.");
      return;
    }
    setReceiptTarget({ sale, receivable });
  };

  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div><span className="pdv-eyebrow">Financeiro simples</span><h1>Contas a receber</h1><p>Vendas feitas para pagamento posterior e recebimentos registrados.</p></div>
      </div>
      {!hideNavigation && <HistoryViewTabs value={view} onChange={onViewChange} showSales={showSales} />}
      <div className="pdv-payment-summary pdv-receivable-metrics">
        <Metric title="Saldo a receber" value={money(outstanding)} />
        <Metric title="Vencido" value={money(overdue)} />
        <Metric title="Recebido hoje" value={money(receivedToday)} />
      </div>
      <div className="pdv-history-filters">
        <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, mesa, produto ou valor..." /></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Pendentes</option><option>Todos</option><option>Em aberto</option><option>Parcialmente recebida</option><option>Vencida</option><option>Recebida</option><option>Cancelada</option></select></label>
      </div>
      <div className="pdv-receivable-list">
        {receivables.map((receivable) => (
          <article key={receivable.id} className={`status-${receivable.status.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-")}`}>
            <div>
              <strong>{receivable.customerName}</strong>
              <span>{new Date(receivable.createdAt).toLocaleString("pt-BR")}{receivable.tableNumber ? ` | Mesa ${String(receivable.tableNumber).padStart(3, "0")}` : ""}{receivable.subtableName ? ` | ${receivable.subtableName}` : ""}</span>
              <small>{receivable.dueDate ? `Vencimento ${receivable.dueDate.split("-").reverse().join("/")}` : "Sem vencimento"} | {receivable.status}</small>
              {receivable.note && <small className="pdv-receivable-note">Obs.: {receivable.note}</small>}
            </div>
            <div><span>Original</span><b>{money(receivable.originalAmount)}</b></div>
            <div><span>Recebido</span><b>{money(receivable.receivedAmount)}</b></div>
            <div><span>Saldo</span><b>{money(receivable.balance)}</b></div>
            <div className="pdv-receivable-actions">
              <button className="pdv-ghost-button" onClick={() => openReceipt(receivable)}><ReceiptText size={15} /> Recibo</button>
              <button className="pdv-primary-button" disabled={receivable.balance <= 0.009 || receivable.status === "Cancelada"} onClick={() => setReceiving(receivable)}>Registrar pagamento</button>
              <button className="pdv-danger-button" disabled={receivable.receivedAmount > 0.009 || receivable.status === "Cancelada"} onClick={() => setCancelRequest(receivable)}>Cancelar</button>
            </div>
            {receivable.payments.length > 0 && (
              <details>
                <summary>{receivable.payments.length} recebimento(s)</summary>
                {receivable.payments.map((payment) => <p key={payment.id}>{new Date(payment.createdAt).toLocaleString("pt-BR")} | {payment.method} | {money(payment.amount)}{payment.change ? ` | Troco ${money(payment.change)}` : ""}</p>)}
              </details>
            )}
          </article>
        ))}
        {!receivables.length && <div className="pdv-empty">Nenhuma conta encontrada para os filtros.</div>}
      </div>
      {receiving && <ReceivableCollectionModal receivable={receiving} onCancel={() => setReceiving(null)} onConfirm={(payment) => registerPayment(receiving, payment)} />}
      {cancelRequest && <PdvConfirmModal title="Cancelar conta a receber?" message={`A conta de ${cancelRequest.customerName} sera marcada como cancelada. A venda permanecera no Historico.`} onCancel={() => setCancelRequest(null)} onConfirm={() => void onCancelReceivable(cancelRequest.id).then(async () => { setCancelRequest(null); await onChanged(); })} />}
      {receiptTarget && <PdvReceiptDraftModal sale={receiptTarget.sale} receivable={receiptTarget.receivable} receiptSettings={snapshot.settings} customers={snapshot.customers} allowPrint={allowPrint} printTargets={receiptPrintTargets} onRemotePrint={onRemoteReceiptPrint} onClose={() => setReceiptTarget(null)} onNotice={setNotice} />}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </section>
  );
}

function ReceivableCollectionModal({ receivable, onCancel, onConfirm }: { receivable: PdvReceivable; onCancel: () => void; onConfirm: (payment: PdvPayment) => void | Promise<void> }) {
  const methods: Array<Exclude<PdvPaymentMethod, "Conta a receber" | "Nao definido">> = ["Dinheiro", "Debito", "Credito", "Pix", "Outros"];
  const [method, setMethod] = useState<typeof methods[number] | null>(null);
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-collection-modal pdv-admin-modal">
        <div className="pdv-section-head"><div><span className="pdv-eyebrow">Recebimento</span><h1>{receivable.customerName}</h1><p>Saldo atual: {money(receivable.balance)}</p></div><button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button></div>
        <div className="pdv-payment-methods">
          {methods.map((value) => <button key={value} onClick={() => setMethod(value)}>{value}</button>)}
        </div>
        <div className="pdv-action-row"><button className="pdv-ghost-button" onClick={onCancel}>Voltar</button></div>
        {method && <PaymentAmountModal method={method} remaining={receivable.balance} onCancel={() => setMethod(null)} onConfirm={(payment) => void onConfirm(payment)} />}
      </section>
    </div>
  );
}

function CustomersScreen({
  snapshot,
  view,
  onViewChange,
  onSave,
  onChanged,
  showSales,
  hideNavigation,
  readOnly,
  onReceive,
  onUpdateReceivable,
  onCancelReceivable,
  allowPrint,
  receiptPrintTargets,
  onRemoteReceiptPrint,
  onNavigateMain
}: {
  snapshot: PdvSnapshot;
  view: HistoryView;
  onViewChange: (value: HistoryView) => void;
  onSave: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  onChanged: () => void;
  showSales: boolean;
  hideNavigation: boolean;
  readOnly: boolean;
  onReceive: (id: string, payment: PdvReceivablePayment, operationId?: string) => Promise<PdvReceivable>;
  onUpdateReceivable: (id: string, patch: PdvReceivablePatch) => Promise<PdvReceivable>;
  onCancelReceivable: (id: string) => Promise<void>;
  allowPrint: boolean;
  receiptPrintTargets: Array<{ id: string; label: string }>;
  onRemoteReceiptPrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onNavigateMain?: (tab: "history" | "reports") => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PdvCustomer | "new" | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<PdvCustomer | null>(null);
  const [notice, setNotice] = useState("");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const customers = snapshot.customers.filter((customer) => !normalized || [customer.name, customer.document, customer.phone, customer.email].join(" ").toLocaleLowerCase("pt-BR").includes(normalized));
  const balanceFor = (id: string) => roundMoney(snapshot.receivables.filter((item) => item.customerId === id && item.status !== "Cancelada").reduce((sum, item) => sum + item.balance, 0));
  const accountCountFor = (id: string) => snapshot.receivables.filter((item) => item.customerId === id).length;
  return (
    <section className="pdv-panel">
      <div className="pdv-section-head"><div><span className="pdv-eyebrow">Clientes e contas</span><h1>Clientes</h1><p>Cadastro, pendencias, recebimentos e historico em um unico lugar.</p></div>{!readOnly && <button className="pdv-primary-button" onClick={() => setEditing("new")}><Plus size={16} /> Novo cliente</button>}</div>
      {!hideNavigation && <HistoryViewTabs value={view} onChange={onViewChange} showSales={showSales} />}
      <div className="pdv-history-filters"><label><span>Buscar cliente</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, telefone, CPF/CNPJ..." /></label></div>
      <div className="pdv-customer-list">
        {customers.map((customer) => (
          <article key={customer.id} className={!customer.active ? "inactive" : ""}>
            <div><strong>{customer.name}</strong><span>{customer.phone || "Sem telefone"}{customer.document ? ` | ${customer.document}` : ""}</span><small>{customer.note || (customer.active ? "Cliente ativo" : "Cliente inativo")}</small></div>
            <div><span>{accountCountFor(customer.id)} conta(s)</span><b>{money(balanceFor(customer.id))}</b><small>Saldo pendente</small></div>
            <div className="pdv-customer-row-actions">
              <button className="pdv-primary-button" onClick={() => setSelectedCustomer(customer)}>Abrir ficha</button>
              {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditing(customer)}>Editar</button>}
            </div>
          </article>
        ))}
        {!customers.length && <div className="pdv-empty">Nenhum cliente encontrado.</div>}
      </div>
      {editing && (
        <CustomerEditorModal
          customer={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            try {
              await onSave(draft);
              setEditing(null);
              await onChanged();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Nao foi possivel salvar o cliente.");
            }
          }}
        />
      )}
      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          snapshot={snapshot}
          readOnly={readOnly}
          allowPrint={allowPrint}
          printTargets={receiptPrintTargets}
          onRemotePrint={onRemoteReceiptPrint}
          onClose={() => setSelectedCustomer(null)}
          onEdit={() => setEditing(selectedCustomer)}
          onChanged={onChanged}
          onReceive={onReceive}
          onUpdateReceivable={onUpdateReceivable}
          onCancelReceivable={onCancelReceivable}
          onNavigateMain={onNavigateMain}
          onNotice={setNotice}
        />
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </section>
  );
}

function CustomerDetailModal({
  customer,
  snapshot,
  readOnly,
  allowPrint,
  printTargets,
  onRemotePrint,
  onClose,
  onEdit,
  onChanged,
  onReceive,
  onUpdateReceivable,
  onCancelReceivable,
  onNavigateMain,
  onNotice
}: {
  customer: PdvCustomer;
  snapshot: PdvSnapshot;
  readOnly: boolean;
  allowPrint: boolean;
  printTargets: Array<{ id: string; label: string }>;
  onRemotePrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onReceive: (id: string, payment: PdvReceivablePayment, operationId?: string) => Promise<PdvReceivable>;
  onUpdateReceivable: (id: string, patch: PdvReceivablePatch) => Promise<PdvReceivable>;
  onCancelReceivable: (id: string) => Promise<void>;
  onNavigateMain?: (tab: "history" | "reports") => void;
  onNotice: (message: string) => void;
}) {
  const [section, setSection] = useState<"summary" | "pending" | "history">("summary");
  const [receiving, setReceiving] = useState<PdvReceivable | null>(null);
  const [editingReceivable, setEditingReceivable] = useState<PdvReceivable | null>(null);
  const [deletingReceivable, setDeletingReceivable] = useState<PdvReceivable | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<{ sale: PdvSale; receivable: PdvReceivable } | null>(null);
  const [selectedSale, setSelectedSale] = useState<PdvSale | null>(null);
  const customerReceivables = snapshot.receivables.filter((item) => item.customerId === customer.id);
  const pending = customerReceivables.filter((item) => !["Recebida", "Cancelada"].includes(item.status));
  const linkedSales = customerReceivables
    .map((receivable) => snapshot.recentSales.find((sale) => sale.id === receivable.saleId))
    .filter((sale): sale is PdvSale => Boolean(sale));
  const totalCredited = roundMoney(customerReceivables.filter((item) => item.status !== "Cancelada").reduce((sum, item) => sum + item.originalAmount, 0));
  const totalReceived = roundMoney(customerReceivables.reduce((sum, item) => sum + item.receivedAmount, 0));
  const outstanding = roundMoney(pending.reduce((sum, item) => sum + item.balance, 0));

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !receiving && !editingReceivable && !receiptTarget && !selectedSale) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [receiving, editingReceivable, receiptTarget, selectedSale, onClose]);

  const openReceipt = (receivable: PdvReceivable) => {
    const sale = snapshot.recentSales.find((item) => item.id === receivable.saleId);
    if (!sale) {
      onNotice("A venda vinculada nao foi encontrada.");
      return;
    }
    setReceiptTarget({ sale, receivable });
  };

  const registerPayment = async (receivable: PdvReceivable, payment: PdvPayment) => {
    if (payment.method === "Conta a receber") return;
    await onReceive(receivable.id, {
      ...payment,
      receivableId: receivable.id,
      createdAt: new Date().toISOString(),
      method: payment.method
    }, crypto.randomUUID());
    setReceiving(null);
    await onChanged();
    onNotice("Recebimento registrado e ficha atualizada.");
  };

  const navigateFromCustomer = () => {
    onClose();
    onNavigateMain?.("history");
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-customer-detail-modal pdv-admin-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Ficha do cliente</span>
            <h1>{customer.name}</h1>
            <p>{customer.document || "Sem CPF/CNPJ"}{customer.phone ? ` | ${customer.phone}` : ""}</p>
          </div>
          <button className="pdv-icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pdv-customer-detail-tabs" role="tablist">
          <button className={section === "summary" ? "active" : ""} onClick={() => setSection("summary")}>Resumo</button>
          <button className={section === "pending" ? "active" : ""} onClick={() => setSection("pending")}>Pendencias ({pending.length})</button>
          <button className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Historico ({customerReceivables.length})</button>
        </div>
        <div className="pdv-customer-detail-scroll">
          <div className="pdv-payment-summary pdv-customer-detail-metrics">
            <Metric title="Total em contas" value={money(totalCredited)} />
            <Metric title="Total recebido" value={money(totalReceived)} />
            <Metric title="Saldo pendente" value={money(outstanding)} />
          </div>
          {section === "summary" && (
            <div className="pdv-customer-summary-grid">
              <article><strong>Contato</strong><span>{customer.email || "Sem e-mail"}</span><span>{customer.address || "Sem endereco"}</span></article>
              <article><strong>Observacao</strong><span>{customer.note || "Nenhuma observacao cadastrada."}</span></article>
              <article><strong>Movimentacao</strong><span>{customerReceivables.length} conta(s) registrada(s)</span><span>{linkedSales.length} venda(s) localizada(s)</span></article>
            </div>
          )}
          {(section === "pending" || section === "history") && (
            <div className="pdv-customer-account-list">
              {(section === "pending" ? pending : customerReceivables).map((receivable) => {
                const sale = snapshot.recentSales.find((item) => item.id === receivable.saleId);
                return (
                  <article key={receivable.id} className={`status-${receivable.status.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-")}`}>
                    <div className="pdv-customer-account-head">
                      <div><strong>{receivable.tableNumber ? `Mesa ${String(receivable.tableNumber).padStart(3, "0")}` : "Venda"}</strong><span>{new Date(receivable.createdAt).toLocaleString("pt-BR")} | {receivable.status}</span></div>
                      <b>{money(receivable.balance)}</b>
                    </div>
                    <div className="pdv-customer-account-values"><span>Original {money(receivable.originalAmount)}</span><span>Recebido {money(receivable.receivedAmount)}</span><span>{receivable.dueDate ? `Vence ${receivable.dueDate.split("-").reverse().join("/")}` : "Sem vencimento"}</span></div>
                    {receivable.note && <p>{receivable.note}</p>}
                    {receivable.payments.length > 0 && <div className="pdv-customer-payment-history">{receivable.payments.map((payment) => <span key={payment.id}>{new Date(payment.createdAt).toLocaleString("pt-BR")} | {payment.method} | {money(payment.amount)}{payment.description ? ` | ${payment.description}` : ""}</span>)}</div>}
                    <div className="pdv-receivable-actions">
                      {sale && <button className="pdv-ghost-button" onClick={() => setSelectedSale(sale)}>Ver venda</button>}
                      {sale && <button className="pdv-ghost-button" onClick={() => openReceipt(receivable)}><ReceiptText size={15} /> Recibo</button>}
                      {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditingReceivable(receivable)}><Pencil size={15} /> Editar lancamento</button>}
                      {!readOnly && receivable.balance > 0.009 && receivable.status !== "Cancelada" && <button className="pdv-primary-button" onClick={() => setReceiving(receivable)}>Registrar pagamento</button>}
                    </div>
                  </article>
                );
              })}
              {(section === "pending" ? pending : customerReceivables).length === 0 && <div className="pdv-empty">{section === "pending" ? "Este cliente nao possui pendencias." : "Nenhuma movimentacao registrada."}</div>}
            </div>
          )}
        </div>
        <div className="pdv-action-row pdv-customer-detail-actions">
          <button className="pdv-ghost-button" onClick={navigateFromCustomer}><ClipboardList size={16} /> Ir para Historico</button>
          {!readOnly && <button className="pdv-ghost-button" onClick={onEdit}><Pencil size={16} /> Editar cliente</button>}
          <button className="pdv-primary-button" onClick={onClose}>Fechar</button>
        </div>
        {receiving && <ReceivableCollectionModal receivable={receiving} onCancel={() => setReceiving(null)} onConfirm={(payment) => registerPayment(receiving, payment)} />}
        {editingReceivable && <ReceivableEditorModal receivable={editingReceivable} sale={snapshot.recentSales.find((item) => item.id === editingReceivable.saleId)} onCancel={() => setEditingReceivable(null)} onDelete={() => setDeletingReceivable(editingReceivable)} onSave={async (patch) => {
          await onUpdateReceivable(editingReceivable.id, patch);
          setEditingReceivable(null);
          await onChanged();
          onNotice("Lancamento da pendencia atualizado.");
        }} />}
        {deletingReceivable && <PdvConfirmModal title="Excluir esta pendencia?" message={deletingReceivable.receivedAmount > 0.009 ? "Remova primeiro os recebimentos registrados. Depois a pendencia podera ser cancelada sem apagar a venda do Historico." : "A pendencia sera marcada como cancelada e deixara de compor o saldo do cliente. A venda permanecera no Historico para auditoria."} confirmLabel="Excluir pendencia" danger onCancel={() => setDeletingReceivable(null)} onConfirm={() => {
          if (deletingReceivable.receivedAmount > 0.009) {
            setDeletingReceivable(null);
            onNotice("Remova os recebimentos antes de excluir a pendencia.");
            return;
          }
          void onCancelReceivable(deletingReceivable.id).then(async () => {
            setDeletingReceivable(null);
            setEditingReceivable(null);
            await onChanged();
            onNotice("Pendencia cancelada e mantida no Historico.");
          });
        }} />}
        {receiptTarget && <PdvReceiptDraftModal sale={receiptTarget.sale} receivable={receiptTarget.receivable} receiptSettings={snapshot.settings} customers={snapshot.customers} allowPrint={allowPrint} printTargets={printTargets} onRemotePrint={onRemotePrint} onClose={() => setReceiptTarget(null)} onNotice={onNotice} />}
        {selectedSale && <SaleDetailModal sale={selectedSale} onClose={() => setSelectedSale(null)} onCancel={() => setSelectedSale(null)} canCancel={false} />}
      </section>
    </div>
  );
}

function ReceivableEditorModal({ receivable, sale, onCancel, onSave, onDelete }: { receivable: PdvReceivable; sale?: PdvSale; onCancel: () => void; onSave: (patch: PdvReceivablePatch) => void | Promise<void>; onDelete: () => void }) {
  const [dueDate, setDueDate] = useState(receivable.dueDate || "");
  const [note, setNote] = useState(receivable.note || "");
  const [items, setItems] = useState<PdvCartItem[]>(() => sale?.items.map((item) => ({ ...item })) || []);
  const [payments, setPayments] = useState<PdvReceivablePayment[]>(() => receivable.payments.map((payment) => ({ ...payment })));
  const [addingPayment, setAddingPayment] = useState(false);
  const itemTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.total || 0), 0));
  const otherPaid = roundMoney((sale?.payments || []).filter((payment) => payment.method !== "Conta a receber").reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const accountTotal = roundMoney(Math.max(0, itemTotal - otherPaid));
  const receivedTotal = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const remaining = roundMoney(accountTotal - receivedTotal);
  const valid = items.length > 0 && accountTotal > 0 && receivedTotal <= accountTotal + 0.009 && payments.every((payment) => payment.amount > 0);
  const confirm = () => valid && void onSave({ dueDate, note, items, payments });
  useModalConfirmShortcut(confirm, onCancel, valid && !addingPayment);
  const updateItem = (id: string, patch: Partial<PdvCartItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const updatePayment = (id: string, patch: Partial<PdvReceivablePayment>) => setPayments((current) => current.map((payment) => payment.id === id ? { ...payment, ...patch } : payment));
  const appendPayment = (payment: PdvPayment) => {
    if (payment.method === "Conta a receber" || payment.method === "Nao definido") {
      return;
    }
    const method: PdvReceivablePayment["method"] = payment.method;
    setPayments((current) => [...current, {
      id: payment.id || crypto.randomUUID(),
      receivableId: receivable.id,
      createdAt: new Date().toISOString(),
      method,
      amount: payment.amount,
      received: payment.received,
      change: payment.change,
      description: payment.description || "",
      originDevice: "Este computador",
      operationId: crypto.randomUUID()
    }]);
    setAddingPayment(false);
  };
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-admin-modal pdv-receivable-full-editor">
        <div className="pdv-section-head"><div><span className="pdv-eyebrow">Conta a receber</span><h1>Editar pendencia completa</h1><p>{receivable.customerName} | Conta {money(accountTotal)} | Recebido {money(receivedTotal)} | Saldo {money(Math.max(0, remaining))}</p></div><button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button></div>
        <div className="pdv-receivable-editor-scroll">
          <div className="pdv-editor-grid pdv-receivable-editor-fields">
            <label><span>Data de vencimento</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label className="pdv-wide-field"><span>Observacao da pendencia</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          <section className="pdv-receivable-editor-section">
            <div className="pdv-subsection-title"><div><strong>Produtos e valores</strong><span>Altere a quantidade ou o valor final lancado. O saldo sera recalculado.</span></div><b>{money(itemTotal)}</b></div>
            {otherPaid > 0.009 && <div className="pdv-account-allocation-note">Outros pagamentos desta venda: <strong>{money(otherPaid)}</strong>. Total vinculado a conta: <strong>{money(accountTotal)}</strong>.</div>}
            <div className="pdv-receivable-item-editor-list">
              {items.map((item, index) => (
                <article key={item.id}>
                  <div className="pdv-receivable-line-name"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.productName}</strong><small>{item.categoryName}{item.measureLabel ? ` | ${item.measureLabel}` : ""}</small></div></div>
                  <label>
                    <span>{isMeasuredCartItem(item) ? "Quantidade medida" : "Quantidade"}</span>
                    <input
                      type="number"
                      min={isMeasuredCartItem(item) ? 0.001 : 1}
                      step={isMeasuredCartItem(item) ? 0.001 : 1}
                      inputMode={isMeasuredCartItem(item) ? "decimal" : "numeric"}
                      value={item.quantity}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        const quantity = isMeasuredCartItem(item)
                          ? Math.max(0.001, roundQuantity(parsed || 0.001))
                          : Math.max(1, Math.trunc(parsed || 1));
                        updateItem(item.id, { quantity });
                      }}
                    />
                  </label>
                  <label><span>Valor final</span><input type="number" min="0" step="0.01" value={item.total} onChange={(event) => updateItem(item.id, { total: Math.max(0, roundMoney(Number(event.target.value) || 0)) })} /></label>
                  <button className="pdv-icon-button pdv-danger-icon" type="button" title="Remover produto da pendencia" disabled={items.length <= 1} onClick={() => setItems((current) => current.filter((value) => value.id !== item.id))}><Trash2 size={17} /></button>
                </article>
              ))}
            </div>
          </section>
          <section className="pdv-receivable-editor-section">
            <div className="pdv-subsection-title"><div><strong>Recebimentos registrados</strong><span>Edite forma, valor, dinheiro recebido ou remova um lançamento incorreto.</span></div><button className="pdv-ghost-button" type="button" disabled={remaining <= 0.009} onClick={() => setAddingPayment(true)}><Plus size={15} /> Adicionar</button></div>
            <div className="pdv-receivable-payment-editor-list">
              {payments.map((payment) => (
                <article key={payment.id}>
                  <label><span>Forma</span><select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PdvReceivablePayment["method"] })}>{["Dinheiro", "Debito", "Credito", "Pix", "Outros"].map((method) => <option key={method}>{method}</option>)}</select></label>
                  <label><span>Valor pago</span><input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => updatePayment(payment.id, { amount: Math.max(0, roundMoney(Number(event.target.value) || 0)) })} /></label>
                  {payment.method === "Dinheiro" && <label><span>Valor entregue</span><input type="number" min={payment.amount} step="0.01" value={payment.received ?? payment.amount} onChange={(event) => updatePayment(payment.id, { received: Math.max(0, roundMoney(Number(event.target.value) || 0)) })} /></label>}
                  <label className="pdv-payment-description"><span>Descricao</span><input value={payment.description || ""} onChange={(event) => updatePayment(payment.id, { description: event.target.value })} /></label>
                  <button className="pdv-icon-button pdv-danger-icon" type="button" title="Remover recebimento" onClick={() => setPayments((current) => current.filter((value) => value.id !== payment.id))}><Trash2 size={17} /></button>
                </article>
              ))}
              {!payments.length && <div className="pdv-empty pdv-compact-empty">Nenhum recebimento registrado. A pendencia continua em aberto.</div>}
            </div>
          </section>
          {!valid && <div className="pdv-inline-warning">Revise os valores: o total precisa ser positivo e nao pode ficar abaixo do valor ja recebido.</div>}
        </div>
        <div className="pdv-action-row pdv-receivable-editor-actions"><button className="pdv-danger-button pdv-delete-receivable" type="button" onClick={onDelete}><Trash2 size={16} /> Excluir pendencia</button><span /><button className="pdv-ghost-button" onClick={onCancel}>Voltar</button><button className="pdv-primary-button" disabled={!valid} onClick={confirm}>Salvar alteracoes</button></div>
        {addingPayment && (
          <ReceivableCollectionModal
            receivable={{
              ...receivable,
              originalAmount: accountTotal,
              receivedAmount: receivedTotal,
              balance: Math.max(0, remaining),
              payments
            }}
            onCancel={() => setAddingPayment(false)}
            onConfirm={appendPayment}
          />
        )}
      </section>
    </div>
  );
}

function CustomerEditorModal({ customer, onCancel, onSave }: { customer?: PdvCustomer; onCancel: () => void; onSave: (draft: PdvCustomerDraft) => void | Promise<void> }) {
  const [draft, setDraft] = useState<PdvCustomerDraft>(customer || { name: "", active: true });
  const confirm = () => {
    if (draft.name.trim()) void onSave(draft);
  };
  useModalConfirmShortcut(confirm, onCancel, Boolean(draft.name.trim()));
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-editor-modal pdv-admin-modal pdv-customer-editor-modal">
        <div className="pdv-section-head"><div><span className="pdv-eyebrow">Cliente</span><h1>{customer ? "Editar cliente" : "Novo cliente"}</h1></div><button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button></div>
        <div className="pdv-customer-editor-scroll">
          <div className="pdv-editor-section">
            <div className="pdv-editor-section-title"><strong>Identificacao</strong><small>Nome e documento usados na conta e no recibo.</small></div>
            <div className="pdv-editor-grid">
              <label className="pdv-wide-field"><span>Nome *</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label><span>CPF/CNPJ</span><input value={draft.document || ""} onChange={(event) => setDraft({ ...draft, document: formatCpfCnpj(event.target.value) })} inputMode="numeric" /></label>
              <label><span>Telefone</span><input value={draft.phone || ""} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
            </div>
          </div>
          <div className="pdv-editor-section">
            <div className="pdv-editor-section-title"><strong>Contato</strong><small>Informacoes opcionais para localizar o cliente.</small></div>
            <div className="pdv-editor-grid">
              <label><span>E-mail</span><input value={draft.email || ""} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
              <label><span>Endereco</span><input value={draft.address || ""} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>
              <label className="pdv-wide-field"><span>Observacao</span><textarea rows={3} value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
            </div>
          </div>
          <label className="pdv-switch-line pdv-customer-active-line"><input type="checkbox" checked={draft.active !== false} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Cliente ativo e disponivel para novas contas</label>
        </div>
        <div className="pdv-action-row"><button className="pdv-danger-button" onClick={onCancel}>Cancelar</button><button className="pdv-primary-button" disabled={!draft.name.trim()} onClick={confirm}>Salvar cliente</button></div>
      </section>
    </div>
  );
}

function HistoryScreen({
  snapshot,
  initialView = "sales",
  hideNavigation = false,
  readOnly = false,
  onChanged,
  saveCustomer,
  receiveReceivable,
  updateReceivable,
  cancelReceivable,
  allowPrint,
  receiptPrintTargets,
  onRemoteReceiptPrint,
  onNavigateMain
}: {
  snapshot: PdvSnapshot;
  initialView?: HistoryView;
  hideNavigation?: boolean;
  readOnly?: boolean;
  onChanged: () => void;
  saveCustomer: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  receiveReceivable: (id: string, payment: PdvReceivablePayment, operationId?: string) => Promise<PdvReceivable>;
  updateReceivable: (id: string, patch: PdvReceivablePatch) => Promise<PdvReceivable>;
  cancelReceivable: (id: string) => Promise<void>;
  allowPrint: boolean;
  receiptPrintTargets: Array<{ id: string; label: string }>;
  onRemoteReceiptPrint?: (targetId: string, payload: { sale: PdvSale; customer?: PdvCustomer; receivable?: PdvReceivable; customerName?: string; customerDocument?: string }) => Promise<{ ok: boolean; message: string }>;
  onNavigateMain?: (tab: "history" | "reports") => void;
}) {
  const [view, setView] = useState<HistoryView>(initialView);
  const showSales = initialView === "sales";
  const today = localDateInputValue();
  const [filters, setFilters] = useState(() => ({ from: today, to: today, query: "", type: "Todos", payment: "Todos", status: "Todos", table: "", origin: "Todos" }));
  const [selectedSale, setSelectedSale] = useState<PdvSale | null>(null);
  const [saleMenu, setSaleMenu] = useState<{ x: number; y: number; sale: PdvSale } | null>(null);
  const [editingPaymentsSale, setEditingPaymentsSale] = useState<PdvSale | null>(null);
  const [cancelRequest, setCancelRequest] = useState<PdvSale | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<PdvSale | null>(null);
  const [notice, setNotice] = useState("");
  const sales = filterSales(snapshot.recentSales, filters);

  const cancelSale = (sale: PdvSale) => {
    setCancelRequest(sale);
  };

  const confirmCancelSale = async () => {
    if (!cancelRequest) {
      return;
    }
    await window.caixa.cancelPdvSale(cancelRequest.id);
    setSelectedSale(null);
    setCancelRequest(null);
    onChanged();
  };

  const runSaleAction = async (action: string, sale: PdvSale) => {
    setSaleMenu(null);
    if (action === "details" || action === "items") {
      setSelectedSale(sale);
      return;
    }
    if (action === "export") {
      const date = sale.createdAt.slice(0, 10);
      const status = await window.caixa.exportPdvSales({ from: date, to: date, type: "Todos", payment: "Todos", status: "Todos", table: sale.tableNumber ? String(sale.tableNumber) : "" });
      setNotice(status.message || (status.ok ? "Exportacao concluida." : "Nao foi possivel exportar."));
      return;
    }
    if (action === "print") {
      const receivable = snapshot.receivables.find((item) => item.saleId === sale.id);
      const customer = receivable ? snapshot.customers.find((item) => item.id === receivable.customerId) : undefined;
      const result = await window.caixa.printPdvReceipt(sale, customer, receivable);
      setNotice(result.message);
      return;
    }
    if (action === "cancel" && sale.status !== "Cancelada") {
      await cancelSale(sale);
    }
    if (action === "payments" && sale.status !== "Cancelada") {
      setEditingPaymentsSale(sale);
    }
    if (action === "delete" && sale.status === "Cancelada") {
      setDeleteRequest(sale);
    }
  };

  const updateSalePayments = async (sale: PdvSale, payments: PdvPayment[]) => {
    await window.caixa.updatePdvSalePayments(sale.id, payments);
    setEditingPaymentsSale(null);
    setSelectedSale(null);
    onChanged();
  };

  if (view === "receivables") {
    return <ReceivablesScreen snapshot={snapshot} view={view} onViewChange={setView} onChanged={onChanged} onReceive={receiveReceivable} onCancelReceivable={cancelReceivable} showSales={showSales} hideNavigation={hideNavigation} allowPrint={allowPrint} receiptPrintTargets={receiptPrintTargets} onRemoteReceiptPrint={onRemoteReceiptPrint} />;
  }
  if (view === "customers") {
    return <CustomersScreen snapshot={snapshot} view={view} onViewChange={setView} onSave={saveCustomer} onChanged={onChanged} showSales={showSales} hideNavigation={hideNavigation} readOnly={readOnly} onReceive={receiveReceivable} onUpdateReceivable={updateReceivable} onCancelReceivable={cancelReceivable} allowPrint={allowPrint} receiptPrintTargets={receiptPrintTargets} onRemoteReceiptPrint={onRemoteReceiptPrint} onNavigateMain={onNavigateMain} />;
  }

  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Auditoria</span>
          <h1>Historico detalhado</h1>
        </div>
      </div>
      {!hideNavigation && <HistoryViewTabs value={view} onChange={setView} showSales={showSales} />}
      <div className="pdv-history-filters">
        <label><span>De</span><input type="date" title="Clique para abrir o calendario" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label><span>Ate</span><input type="date" title="Clique para abrir o calendario" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label><span>Busca</span><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Produto, mesa, pagamento..." /></label>
        <label><span>Tipo</span><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option>Todos</option><option>Venda direta</option><option>Onibus</option><option>Mesa</option></select></label>
        <label><span>Pagamento</span><select value={filters.payment} onChange={(event) => setFilters({ ...filters, payment: event.target.value })}><option>Todos</option>{PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option>Todos</option><option>Finalizada</option><option>Parcial</option><option>Cancelada</option></select></label>
        <label><span>Mesa</span><input value={filters.table} onChange={(event) => setFilters({ ...filters, table: event.target.value })} placeholder="001" /></label>
        <label><span>Origem</span><select value={filters.origin} onChange={(event) => setFilters({ ...filters, origin: event.target.value })}><option>Todos</option>{[...new Set(snapshot.recentSales.map((sale) => sale.originDevice || "Este computador"))].map((origin) => <option key={origin}>{origin}</option>)}</select></label>
      </div>
      <div className="pdv-history-list">
        {sales.map((sale) => (
          <article
            className={sale.status === "Cancelada" ? "cancelled" : ""}
            key={sale.id}
            onContextMenu={(event) => {
              event.preventDefault();
              setSaleMenu({ x: event.clientX, y: event.clientY, sale });
            }}
            onDoubleClick={() => setSelectedSale(sale)}
                  >
            <div>
              <strong>{sale.type}{sale.tableNumber ? ` ${String(sale.tableNumber).padStart(3, "0")}` : ""}</strong>
              <span>{new Date(sale.createdAt).toLocaleString("pt-BR")} | {sale.items.length} item(ns) | {sale.status}</span>
            </div>
            <span>{sale.payments.map((payment) => `${payment.method}: ${money(payment.amount)}${payment.description ? ` (${payment.description})` : ""}`).join(" + ")}</span>
            <b>{money(sale.total)}</b>
            <button className="pdv-ghost-button" onClick={() => setSelectedSale(sale)}>Detalhes</button>
          </article>
        ))}
        {!sales.length && <div className="pdv-empty">Nenhuma venda encontrada para os filtros.</div>}
      </div>
      {saleMenu && (
        <ContextMenu x={saleMenu.x} y={saleMenu.y} onClose={() => setSaleMenu(null)}>
          <button onClick={() => runSaleAction("details", saleMenu.sale)}>Ver detalhes</button>
          <button onClick={() => runSaleAction("items", saleMenu.sale)}>Ver produtos da venda</button>
          <button onClick={() => runSaleAction("export", saleMenu.sale)}>Exportar dia da venda</button>
          <button onClick={() => runSaleAction("print", saleMenu.sale)}>Imprimir recibo nao fiscal</button>
          {!readOnly && saleMenu.sale.status !== "Cancelada" && <button onClick={() => runSaleAction("payments", saleMenu.sale)}>Alterar forma de pagamento</button>}
          {!readOnly && saleMenu.sale.status !== "Cancelada" && <button className="danger" onClick={() => runSaleAction("cancel", saleMenu.sale)}>Cancelar/estornar</button>}
          {!readOnly && saleMenu.sale.status === "Cancelada" && <button className="danger" onClick={() => runSaleAction("delete", saleMenu.sale)}>Excluir registro cancelado</button>}
        </ContextMenu>
      )}
      {selectedSale && <SaleDetailModal sale={selectedSale} onClose={() => setSelectedSale(null)} onCancel={() => readOnly ? undefined : cancelSale(selectedSale)} />}
      {cancelRequest && (
        <PdvConfirmModal
          title="Cancelar venda?"
          message={`A venda ${cancelRequest.id.slice(0, 8)} continuara no historico como cancelada. Deseja confirmar?`}
          onCancel={() => setCancelRequest(null)}
          onConfirm={() => { void confirmCancelSale(); }}
        />
      )}
      {deleteRequest && (
        <PdvConfirmModal
          title="Excluir registro cancelado?"
          message="Esta exclusao e definitiva. O registro cancelado sera removido do Historico, sem alterar vendas validas."
          onCancel={() => setDeleteRequest(null)}
          onConfirm={() => {
            void window.caixa.deleteEntry(`pdv-${deleteRequest.id}`).then(() => {
              setDeleteRequest(null);
              setSelectedSale(null);
              onChanged();
            });
          }}
        />
      )}
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      {!readOnly && editingPaymentsSale && (
        <PaymentModal
          total={editingPaymentsSale.total}
          busy={false}
          customers={snapshot.customers}
          onSaveCustomer={saveCustomer}
          initialPayments={editingPaymentsSale.payments}
          title="Alterar pagamento"
          confirmLabel="Salvar pagamentos"
          onCancel={() => setEditingPaymentsSale(null)}
          onConfirm={(payments) => updateSalePayments(editingPaymentsSale, payments)}
        />
      )}
    </section>
  );
}

function ReportsScreen({ snapshot }: { snapshot: PdvSnapshot }) {
  const month = reportPeriodRange("month");
  const [filters, setFilters] = useState<PdvExportFilters>({ from: month.from, to: month.to, payment: "Todos", type: "Todos", status: "Finalizada", table: "" });
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const sales = filterSales(snapshot.recentSales, { ...filters, query: "" });
  const total = sales.reduce((sum, sale) => sum + sale.total, 0);
  const byPayment = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const productSales = new Map<string, { category: string; quantity: number; revenue: number }>();
  const byCategory = new Map<string, number>();
  const byHour = new Map<string, number>();
  const discounts = sales.reduce((sum, sale) => sum + sale.discount + sale.items.reduce((itemSum, item) => itemSum + item.discount, 0), 0);
  const outstandingReceivables = roundMoney(snapshot.receivables.filter((item) => !["Recebida", "Cancelada"].includes(item.status)).reduce((sum, item) => sum + item.balance, 0));
  const receivedFromAccounts = roundMoney(snapshot.receivables.flatMap((item) => item.payments).filter((payment) => {
    const date = localDateInputValue(new Date(payment.createdAt));
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  }).reduce((sum, payment) => sum + payment.amount, 0));
  sales.forEach((sale) => {
    sale.payments.forEach((payment) => byPayment.set(payment.method, (byPayment.get(payment.method) || 0) + payment.amount));
    sale.items.forEach((item) => {
      byProduct.set(item.productName, (byProduct.get(item.productName) || 0) + item.quantity);
      const product = productSales.get(item.productName) || { category: item.categoryName, quantity: 0, revenue: 0 };
      product.quantity += item.quantity;
      product.revenue += item.total;
      productSales.set(item.productName, product);
      byCategory.set(item.categoryName, (byCategory.get(item.categoryName) || 0) + item.total);
    });
    const hour = `${String(new Date(sale.createdAt).getHours()).padStart(2, "0")}:00`;
    byHour.set(hour, (byHour.get(hour) || 0) + sale.total);
  });
  const exportExcel = async () => {
    setExporting(true);
    try {
      const status = await window.caixa.exportPdvSales(filters);
      setNotice(status.ok ? status.message || "Relatorio PDV exportado." : status.message || "Nao foi possivel exportar.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Fechamento local</span>
          <h1>Relatorios</h1>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" disabled={exporting} onClick={() => window.caixa.openOutputDirectory()}>Abrir pasta</button>
          <button className="pdv-primary-button" disabled={exporting} onClick={exportExcel}>
            <FileSpreadsheet size={18} /> {exporting ? "Exportando..." : "Exportar Excel"}
          </button>
        </div>
      </div>
      <div className="pdv-history-filters">
        <div className="pdv-period-shortcuts">
          <button type="button" onClick={() => setFilters({ ...filters, ...reportPeriodRange("today") })}>Hoje</button>
          <button type="button" onClick={() => setFilters({ ...filters, ...reportPeriodRange("yesterday") })}>Ontem</button>
          <button type="button" onClick={() => setFilters({ ...filters, ...reportPeriodRange("week") })}>Semana</button>
          <button type="button" onClick={() => setFilters({ ...filters, ...reportPeriodRange("month") })}>Mes</button>
        </div>
        <label><span>De</span><input type="date" value={filters.from || ""} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label><span>Ate</span><input type="date" value={filters.to || ""} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label><span>Tipo</span><select value={filters.type || "Todos"} onChange={(event) => setFilters({ ...filters, type: event.target.value as PdvExportFilters["type"] })}><option>Todos</option><option>Venda direta</option><option>Onibus</option><option>Mesa</option></select></label>
        <label><span>Pagamento</span><select value={filters.payment || "Todos"} onChange={(event) => setFilters({ ...filters, payment: event.target.value as PdvExportFilters["payment"] })}><option>Todos</option>{PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Status</span><select value={filters.status || "Todos"} onChange={(event) => setFilters({ ...filters, status: event.target.value as PdvExportFilters["status"] })}><option>Todos</option><option>Finalizada</option><option>Parcial</option><option>Cancelada</option></select></label>
        <label><span>Mesa</span><input value={filters.table || ""} onChange={(event) => setFilters({ ...filters, table: event.target.value })} placeholder="001" /></label>
      </div>
      <div className="pdv-report-grid">
        <Metric title="Total vendido" value={money(total)} />
        <Metric title="Vendas" value={String(sales.length)} />
        <Metric title="Ticket medio" value={money(sales.length ? total / sales.length : 0)} />
        <Metric title="Mesas abertas" value={String(snapshot.tables.filter((table) => table.status === "Ocupada").length)} />
        <Metric title="Descontos" value={money(discounts)} />
        <Metric title="Mesas fechadas" value={String(sales.filter((sale) => sale.type === "Mesa" && sale.status === "Finalizada").length)} />
        <Metric title="Vendas diretas" value={String(sales.filter((sale) => sale.type === "Venda direta").length)} />
        <Metric title="Vendas de onibus" value={String(sales.filter((sale) => sale.type === "Onibus").length)} />
        <Metric title="Parciais" value={String(sales.filter((sale) => sale.status === "Parcial").length)} />
        <Metric title="Saldo a receber" value={money(outstandingReceivables)} />
        <Metric title="Recebido de contas" value={money(receivedFromAccounts)} />
      </div>
      <div className="pdv-report-columns">
        <ReportList title="Por pagamento" rows={[...byPayment.entries()]} format={money} />
        <ReportList title="Produtos mais vendidos" rows={[...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)} format={(value) => `${value} un.`} />
        <ReportList title="Categorias" rows={[...byCategory.entries()].sort((a, b) => b[1] - a[1])} format={money} />
        <ReportList title="Horarios de pico" rows={[...byHour.entries()].sort((a, b) => a[0].localeCompare(b[0]))} format={money} />
      </div>
      <section className="pdv-product-sales-report">
        <div className="pdv-product-sales-head">
          <div>
            <span className="pdv-eyebrow">Detalhamento do periodo</span>
            <h2>Produtos vendidos</h2>
          </div>
          <strong>{[...productSales.values()].reduce((sum, product) => sum + product.quantity, 0)} itens</strong>
        </div>
        <div className="pdv-product-sales-table-wrap">
          <table className="pdv-product-sales-table">
            <thead><tr><th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Valor medio</th><th>Faturamento</th></tr></thead>
            <tbody>
              {[...productSales.entries()]
                .sort((a, b) => b[1].quantity - a[1].quantity || b[1].revenue - a[1].revenue || a[0].localeCompare(b[0]))
                .map(([name, product]) => (
                  <tr key={name}>
                    <td><strong>{name}</strong></td>
                    <td>{product.category || "Sem categoria"}</td>
                    <td>{formatQuantity(product.quantity)}</td>
                    <td>{money(product.quantity ? product.revenue / product.quantity : 0)}</td>
                    <td><strong>{money(product.revenue)}</strong></td>
                  </tr>
                ))}
              {!productSales.size && <tr><td colSpan={5} className="pdv-empty-cell">Nenhum produto vendido no periodo selecionado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </section>
  );
}

function ClientVisualSettingsScreen({ snapshot, settings, onChange }: { snapshot: PdvSnapshot; settings: Partial<PdvClientVisualSettings>; onChange: (patch: Partial<PdvClientVisualSettings>) => void }) {
  const visible = useMemo(() => ({ ...snapshot.settings, ...settings }), [snapshot.settings, settings]);
  const [draft, setDraft] = useState<Partial<PdvClientVisualSettings>>(visible);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(visible);
  }, [snapshot.settings, settings, dirty]);
  const changeDraft = (patch: Partial<PdvClientVisualSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const applyPreset = (preset: "compact" | "normal" | "comfortable") => {
    const presets: Record<typeof preset, PdvClientVisualSettings> = {
      compact: { gridColumns: 7, categoryColumns: 7, tableColumns: 11, productCardHeight: 52, categoryCardHeight: 44, tableCardHeight: 74 },
      normal: { gridColumns: 5, categoryColumns: 5, tableColumns: 9, productCardHeight: 60, categoryCardHeight: 52, tableCardHeight: 88 },
      comfortable: { gridColumns: 5, categoryColumns: 5, tableColumns: 8, productCardHeight: 76, categoryCardHeight: 62, tableCardHeight: 104 }
    };
    changeDraft(presets[preset]);
  };
  return (
    <section className="pdv-panel pdv-settings-screen">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Cliente conectado</span>
          <h1>Ajustes deste computador</h1>
          <p>As regras do PDV acompanham o servidor. Aqui voce altera somente o tamanho e a distribuicao visual desta tela.</p>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" disabled={!dirty} onClick={() => { setDraft(visible); setDirty(false); }}>Descartar</button>
          <button className="pdv-primary-button" disabled={!dirty} onClick={() => { onChange(draft); setDirty(false); }}>Salvar alteracoes</button>
        </div>
      </div>
      <div className="pdv-visual-presets" aria-label="Densidade visual deste computador">
        <span>Densidade</span>
        <button onClick={() => applyPreset("compact")}>Compacto</button>
        <button onClick={() => applyPreset("normal")}>Normal</button>
        <button onClick={() => applyPreset("comfortable")}>Confortavel</button>
      </div>
      <div className="pdv-advanced-grid">
        <article>
          <LayoutGrid size={22} />
          <strong>Grade e tamanho local</strong>
          <label className="pdv-setting-line">
            <span>Produtos por linha</span>
            <select value={draft.gridColumns || 5} onChange={(event) => changeDraft({ gridColumns: Number(event.target.value) })}>
              {[4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} produtos por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Categorias por linha</span>
            <select value={draft.categoryColumns || 5} onChange={(event) => changeDraft({ categoryColumns: Number(event.target.value) })}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} categorias por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Mesas por linha</span>
            <select value={draft.tableColumns || 9} onChange={(event) => changeDraft({ tableColumns: Number(event.target.value) })}>
              {[5, 6, 7, 8, 9, 10, 11, 12].map((value) => <option key={value} value={value}>{value} mesas por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Altura dos produtos</span>
            <input type="number" min={44} max={110} value={draft.productCardHeight || 74} onChange={(event) => changeDraft({ productCardHeight: Number(event.target.value || 74) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Fonte dos produtos: {draft.productFontSize || 14}px</span>
            <input type="range" min={10} max={20} step={1} value={draft.productFontSize || 14} onChange={(event) => changeDraft({ productFontSize: Number(event.target.value) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das categorias</span>
            <input type="number" min={36} max={90} value={draft.categoryCardHeight || 64} onChange={(event) => changeDraft({ categoryCardHeight: Number(event.target.value || 64) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das mesas</span>
            <input type="number" min={58} max={130} value={draft.tableCardHeight || 96} onChange={(event) => changeDraft({ tableCardHeight: Number(event.target.value || 96) })} />
          </label>
        </article>
        <article>
          <Settings size={22} />
          <strong>Protegido pelo servidor</strong>
          <span>Produtos, precos, complementos, mesas, pagamentos, importacao e regras continuam sob controle do servidor conectado.</span>
          <small>Essas preferencias ficam salvas apenas neste computador cliente.</small>
        </article>
      </div>
    </section>
  );
}

function AdvancedScreen({ snapshot, readOnly = false, clientVisualSettings = {}, onClientVisualSettingsChange, onImportCose, onPreviewCose, onPreviewImportFile, onImportFile, busy, onSettingsUpdated, savePdvSettings, externalActionsRef, onDirtyChange, forcedSection, hideNavigation = false }: { snapshot: PdvSnapshot; readOnly?: boolean; clientVisualSettings?: Partial<PdvClientVisualSettings>; onClientVisualSettingsChange?: (patch: Partial<PdvClientVisualSettings>) => void; onImportCose: () => Promise<PdvProductImportResult>; onPreviewCose: () => Promise<PdvProductImportPreview>; onPreviewImportFile: () => Promise<PdvProductImportPreview | null>; onImportFile: (filePath: string) => Promise<PdvProductImportResult>; busy: boolean; onSettingsUpdated: () => void; savePdvSettings: (patch: Partial<PdvSettings>) => Promise<PdvSettings>; externalActionsRef?: React.MutableRefObject<PdvAdvancedSettingsActions | null>; onDirtyChange?: (dirty: boolean) => void; forcedSection?: PdvAdvancedSection; hideNavigation?: boolean }) {
  const [section, setSection] = useState<PdvAdvancedSection>(forcedSection || "tables");
  const [receiptSettingsSection, setReceiptSettingsSection] = useState<"identity" | "paper" | "printer" | "behavior">("identity");
  const [draft, setDraft] = useState<PdvSettings>(snapshot.settings);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [printerMessage, setPrinterMessage] = useState("");
  useEffect(() => {
    if (!dirty) setDraft(snapshot.settings);
  }, [snapshot.settings, dirty]);
  useEffect(() => {
    if (forcedSection) setSection(forcedSection);
  }, [forcedSection]);
  const changeDraft = (patch: Partial<PdvSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const saveChanges = async () => {
    setSaving(true);
    try {
      await savePdvSettings(draft);
      setDirty(false);
      onSettingsUpdated();
    } finally {
      setSaving(false);
    }
  };
  const discardChanges = () => {
    setDraft(snapshot.settings);
    setDirty(false);
  };
  const loadPrinters = async () => {
    const available = await window.caixa.listPdvPrinters();
    setPrinters(available);
    setPrinterMessage(available.length ? `${available.length} impressora(s) encontrada(s).` : "Nenhuma impressora foi informada pelo Windows.");
  };
  useEffect(() => {
    if (section === "printing") void loadPrinters();
  }, [section]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!externalActionsRef) return;
    externalActionsRef.current = { save: saveChanges, discard: discardChanges };
    return () => {
      externalActionsRef.current = null;
    };
  });
  if (readOnly) {
    return <ClientVisualSettingsScreen snapshot={snapshot} settings={clientVisualSettings} onChange={(patch) => onClientVisualSettingsChange?.(patch)} />;
  }
  const applyVisualPreset = (preset: "compact" | "normal" | "comfortable") => {
    const presets: Record<typeof preset, Partial<PdvSettings>> = {
      compact: { gridColumns: 7, categoryColumns: 7, tableColumns: 11, productCardHeight: 52, categoryCardHeight: 44, tableCardHeight: 74 },
      normal: { gridColumns: 5, categoryColumns: 5, tableColumns: 9, productCardHeight: 60, categoryCardHeight: 52, tableCardHeight: 88 },
      comfortable: { gridColumns: 5, categoryColumns: 5, tableColumns: 8, productCardHeight: 76, categoryCardHeight: 62, tableCardHeight: 104 }
    };
    changeDraft(presets[preset]);
  };
  const receiptPreviewWidthMm = draft.receiptPaperWidth === "58" ? 58 : draft.receiptPaperWidth === "a4" ? 210 : draft.receiptPaperWidth === "custom" ? Number(draft.receiptCustomPaperWidthMm || 80) : 80;
  const receiptDefaultMargin = draft.receiptPaperWidth === "a4" ? 10 : receiptPreviewWidthMm >= 80 ? 4 : 2;
  const receiptMargins = {
    left: Number(draft.receiptMarginLeftMm ?? receiptDefaultMargin),
    right: Number(draft.receiptMarginRightMm ?? receiptDefaultMargin),
    top: Number(draft.receiptMarginTopMm ?? (draft.receiptPaperWidth === "a4" ? 8 : 4)),
    bottom: Number(draft.receiptMarginBottomMm ?? (draft.receiptPaperWidth === "a4" ? 12 : 5))
  };
  const receiptFontSize = Number(draft.receiptFontSize || 11.5);
  const setReceiptNumber = (key: "receiptFontSize" | "receiptMarginLeftMm" | "receiptMarginRightMm" | "receiptMarginTopMm" | "receiptMarginBottomMm", value: string, min: number, max: number) => {
    const parsed = Number(value);
    changeDraft({ [key]: Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min } as Partial<PdvSettings>);
  };
  const applyReceiptPreset = (paper: "58" | "80") => changeDraft({
    receiptPaperWidth: paper,
    receiptFontSize: 11.5,
    receiptMarginLeftMm: paper === "80" ? 4 : 2,
    receiptMarginRightMm: paper === "80" ? 4 : 2,
    receiptMarginTopMm: 4,
    receiptMarginBottomMm: 5
  });
  const sectionCopy: Record<PdvAdvancedSection, { title: string; description: string }> = {
    tables: { title: "Mesas", description: "Configure a estrutura das mesas e das contas separadas." },
    appearance: { title: "Aparencia do PDV", description: "Ajuste a densidade de Venda, Mesas, produtos e categorias." },
    operation: { title: "Operacoes", description: "Defina o comportamento dos lancamentos, complementos, divisao e fechamento." },
    printing: { title: "Impressao", description: "Configure recibos, papel, identidade e impressora." },
    data: { title: "Dados locais do PDV", description: "Consulte o banco local e gerencie importacoes e exportacoes." }
  };
  return (
    <section className="pdv-panel pdv-settings-screen">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Configuracao do PDV</span>
          <h1>{sectionCopy[section].title}</h1>
          <p>{sectionCopy[section].description} Confirme em Salvar configuracoes no rodape.</p>
        </div>
        {!externalActionsRef && <div className="pdv-action-row">
          <button className="pdv-ghost-button" disabled={!dirty || saving} onClick={discardChanges}>Descartar</button>
          <button className="pdv-primary-button" disabled={!dirty || saving} onClick={() => void saveChanges()}>{saving ? "Salvando..." : "Salvar alteracoes"}</button>
        </div>}
      </div>
      {!hideNavigation && <div className="pdv-settings-nav" role="tablist" aria-label="Configuracoes do PDV">
        <button className={section === "tables" ? "active" : ""} onClick={() => setSection("tables")}>Mesas</button>
        <button className={section === "appearance" ? "active" : ""} onClick={() => setSection("appearance")}>Aparencia</button>
        <button className={section === "operation" ? "active" : ""} onClick={() => setSection("operation")}>Operacao</button>
        <button className={section === "printing" ? "active" : ""} onClick={() => setSection("printing")}>Impressao</button>
        <button className={section === "data" ? "active" : ""} onClick={() => setSection("data")}>Dados e Excel</button>
      </div>}

      <div className="pdv-settings-content">
        {section === "tables" && <div className="pdv-settings-form">
          <Utensils size={22} />
          <div><strong>Estrutura das mesas</strong><span>Quantidade, ordenacao e contas separadas.</span></div>
          <label className="pdv-setting-line">
            <span>Quantidade de mesas</span>
            <input type="number" min={1} max={300} value={draft.tableCount} onChange={(event) => changeDraft({ tableCount: Number(event.target.value || 47) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Ordem dos produtos</span>
            <select value={draft.productSortDirection || "az"} onChange={(event) => changeDraft({ productSortDirection: event.target.value as "az" | "za" })}>
              <option value="az">A a Z</option>
              <option value="za">Z a A</option>
            </select>
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={draft.subtablesEnabled} onChange={(event) => changeDraft({ subtablesEnabled: event.target.checked })} />
            Ativar submesas/contas separadas
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.rememberLastSubtable)} onChange={(event) => changeDraft({ rememberLastSubtable: event.target.checked })} />
            Reabrir cada mesa na ultima submesa selecionada
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={draft.tablePeopleEnabled} onChange={(event) => changeDraft({ tablePeopleEnabled: event.target.checked })} />
            Perguntar quantidade de pessoas ao abrir mesa
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.allowOfflineTables)} onChange={(event) => changeDraft({ allowOfflineTables: event.target.checked })} />
            Permitir mesas offline no cliente
          </label>
        </div>}

        {section === "appearance" && <div className="pdv-settings-form">
          <LayoutGrid size={22} />
          <div><strong>Tamanho do PDV</strong><span>Estas medidas controlam somente Venda, Mesas, produtos e categorias.</span></div>
          <div className="pdv-visual-presets" aria-label="Densidade visual padrao do PDV">
            <span>Aplicar medidas prontas</span>
            <button onClick={() => applyVisualPreset("compact")}>Compacto</button>
            <button onClick={() => applyVisualPreset("normal")}>Normal</button>
            <button onClick={() => applyVisualPreset("comfortable")}>Confortavel</button>
          </div>
          <label className="pdv-setting-line"><span>Produtos por linha</span><select value={draft.gridColumns || 5} onChange={(event) => changeDraft({ gridColumns: Number(event.target.value) })}>{[4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="pdv-setting-line"><span>Categorias por linha</span><select value={draft.categoryColumns || 5} onChange={(event) => changeDraft({ categoryColumns: Number(event.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="pdv-setting-line"><span>Mesas por linha</span><select value={draft.tableColumns || 9} onChange={(event) => changeDraft({ tableColumns: Number(event.target.value) })}>{[5, 6, 7, 8, 9, 10, 11, 12].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="pdv-setting-line"><span>Altura dos produtos</span><input type="number" min={44} max={110} value={draft.productCardHeight || 74} onChange={(event) => changeDraft({ productCardHeight: Number(event.target.value || 74) })} /></label>
          <label className="pdv-setting-line"><span>Fonte dos produtos: {draft.productFontSize || 14}px</span><input type="range" min={10} max={20} step={1} value={draft.productFontSize || 14} onChange={(event) => changeDraft({ productFontSize: Number(event.target.value) })} /></label>
          <label className="pdv-setting-line"><span>Altura das categorias</span><input type="number" min={36} max={90} value={draft.categoryCardHeight || 64} onChange={(event) => changeDraft({ categoryCardHeight: Number(event.target.value || 64) })} /></label>
          <label className="pdv-setting-line"><span>Altura das mesas</span><input type="number" min={58} max={130} value={draft.tableCardHeight || 96} onChange={(event) => changeDraft({ tableCardHeight: Number(event.target.value || 96) })} /></label>
          <label className="pdv-setting-line"><span>Produtos por pagina na consulta</span><input type="number" min={10} max={100} step={5} value={draft.productLookupPageSize || 30} onChange={(event) => changeDraft({ productLookupPageSize: Number(event.target.value || 30) })} /></label>
        </div>}

        {section === "operation" && <div className="pdv-settings-form">
          <Settings size={22} />
          <div><strong>Lancamento e pagamento</strong><span>Preferencias usadas em Venda e Mesas.</span></div>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.stackIdenticalItems)} onChange={(event) => changeDraft({ stackIdenticalItems: event.target.checked })} />
            Juntar produtos iguais no carrinho
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.individualUnitItems)} onChange={(event) => changeDraft({ individualUnitItems: event.target.checked })} />
            Exibir cada unidade individualmente
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={draft.complementsEnabled} onChange={(event) => changeDraft({ complementsEnabled: event.target.checked })} />
            Ativar complementos
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={draft.groupComplementsWithProduct ?? true} onChange={(event) => changeDraft({ groupComplementsWithProduct: event.target.checked })} />
            Mostrar adicionais junto ao produto principal
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.partialPaymentDescriptionEnabled)} onChange={(event) => changeDraft({ partialPaymentDescriptionEnabled: event.target.checked })} />
            Solicitar descricao nos pagamentos parciais
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(draft.skipPaymentConfirmation)} onChange={(event) => changeDraft({ skipPaymentConfirmation: event.target.checked })} />
            Finalizar pagamento sem pedir confirmacao
          </label>
          <label className="pdv-setting-line">
            <span>Aproximacao da divisao</span>
            <select value={draft.roundingStep || 0.01} onChange={(event) => changeDraft({ roundingStep: Number(event.target.value) })}>
              <option value={0.01}>Sem aproximacao</option>
              <option value={0.05}>R$ 0,05</option>
              <option value={0.1}>R$ 0,10</option>
              <option value={0.25}>R$ 0,25</option>
              <option value={0.5}>R$ 0,50</option>
              <option value={1}>R$ 1,00</option>
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Direcao da aproximacao</span>
            <select value={draft.roundingDirection || "nearest"} onChange={(event) => changeDraft({ roundingDirection: event.target.value as "nearest" | "up" | "down" })}>
              <option value="nearest">Mais proximo</option>
              <option value="up">Sempre para cima</option>
              <option value="down">Sempre para baixo</option>
            </select>
          </label>
        </div>}

        {section === "printing" && <div className="pdv-settings-form pdv-print-settings-form">
          <ReceiptText size={22} />
          <div><strong>Personalizacao do recibo</strong><span>Organize a identidade, o papel, a impressora e as regras usadas nas vendas, mesas e contas a receber.</span></div>
          <div className="pdv-print-subnav" role="tablist" aria-label="Opcoes de impressao">
            <button type="button" role="tab" aria-selected={receiptSettingsSection === "identity"} className={receiptSettingsSection === "identity" ? "active" : ""} onClick={() => setReceiptSettingsSection("identity")}>Identidade</button>
            <button type="button" role="tab" aria-selected={receiptSettingsSection === "paper"} className={receiptSettingsSection === "paper" ? "active" : ""} onClick={() => setReceiptSettingsSection("paper")}>Papel e margens</button>
            <button type="button" role="tab" aria-selected={receiptSettingsSection === "printer"} className={receiptSettingsSection === "printer" ? "active" : ""} onClick={() => setReceiptSettingsSection("printer")}>Impressora e destino</button>
            <button type="button" role="tab" aria-selected={receiptSettingsSection === "behavior"} className={receiptSettingsSection === "behavior" ? "active" : ""} onClick={() => setReceiptSettingsSection("behavior")}>Comportamento</button>
          </div>

          <div className="pdv-print-layout">
            <div className="pdv-print-controls">
              {receiptSettingsSection === "identity" && <section className="pdv-print-section">
                <div className="pdv-print-section-head">
                  <strong>Identidade do estabelecimento</strong>
                  <span>Essas informacoes aparecem no cabecalho e no rodape do recibo.</span>
                </div>
                <div className="pdv-print-field-grid">
                  <label className="pdv-setting-line"><span>Nome do estabelecimento</span><input value={draft.receiptBusinessName || ""} onChange={(event) => changeDraft({ receiptBusinessName: event.target.value })} /></label>
                  <label className="pdv-setting-line"><span>CPF/CNPJ opcional</span><input value={draft.receiptBusinessDocument || ""} onChange={(event) => changeDraft({ receiptBusinessDocument: formatCpfCnpj(event.target.value) })} inputMode="numeric" /></label>
                  <label className="pdv-setting-line"><span>Inscricao estadual (IE)</span><input value={draft.receiptBusinessStateRegistration || ""} onChange={(event) => changeDraft({ receiptBusinessStateRegistration: event.target.value })} /></label>
                  <label className="pdv-setting-line"><span>Telefone do estabelecimento</span><input value={draft.receiptBusinessPhone || ""} onChange={(event) => changeDraft({ receiptBusinessPhone: event.target.value })} /></label>
                  <label className="pdv-setting-line pdv-wide-field"><span>Endereco opcional</span><input value={draft.receiptBusinessAddress || ""} onChange={(event) => changeDraft({ receiptBusinessAddress: event.target.value })} /></label>
                  <label className="pdv-setting-line pdv-wide-field"><span>Mensagem do rodape</span><input value={draft.receiptFooter || ""} onChange={(event) => changeDraft({ receiptFooter: event.target.value })} /></label>
                </div>
                <div className="pdv-logo-setting">
                  <div>{draft.receiptLogoDataUrl ? <img src={draft.receiptLogoDataUrl} alt="Logotipo configurado" /> : <ReceiptText size={28} />}<span>{draft.receiptLogoDataUrl ? "Logotipo configurado" : "Sem logotipo"}</span></div>
                  <button className="pdv-ghost-button" type="button" onClick={async () => { const logo = await window.caixa.choosePdvReceiptLogo(); if (logo) changeDraft({ receiptLogoDataUrl: logo, receiptShowLogo: true }); }}>Escolher imagem</button>
                  {draft.receiptLogoDataUrl && <button className="pdv-danger-button" type="button" onClick={() => changeDraft({ receiptLogoDataUrl: "", receiptShowLogo: false })}>Remover</button>}
                </div>
                <label className="pdv-switch-line"><input type="checkbox" checked={draft.receiptShowLogo !== false} onChange={(event) => changeDraft({ receiptShowLogo: event.target.checked })} /> Mostrar logotipo no recibo</label>
              </section>}

              {receiptSettingsSection === "paper" && <section className="pdv-print-section">
                <div className="pdv-print-section-head">
                  <strong>Papel e area segura</strong>
                  <span>Escolha a bobina e ajuste a area util para impedir cortes nas laterais.</span>
                </div>
                <label className="pdv-setting-line pdv-paper-size-select">
                  <span>Tamanho do papel</span>
                  <select value={draft.receiptPaperWidth || "80"} onChange={(event) => changeDraft({ receiptPaperWidth: event.target.value as "58" | "80" | "a4" | "custom" })}>
                    <option value="58">Bobina termica 5,8 cm (58 mm)</option>
                    <option value="80">Bobina termica 8 cm (80 mm)</option>
                    <option value="a4">Folha A4 21 x 29,7 cm</option>
                    <option value="custom">Tamanho personalizado</option>
                  </select>
                </label>
                <div className="pdv-paper-presets" role="group" aria-label="Tamanho do papel">
                  {(["58", "80", "a4", "custom"] as const).map((paper) => (
                    <button type="button" key={paper} className={(draft.receiptPaperWidth || "80") === paper ? "active" : ""} onClick={() => changeDraft({ receiptPaperWidth: paper })}>
                      <strong>{paper === "58" ? "5,8 cm" : paper === "80" ? "8 cm" : paper === "a4" ? "A4" : "Personalizado"}</strong>
                      <span>{paper === "58" ? "Bobina de 58 mm" : paper === "80" ? "Bobina de 80 mm" : paper === "a4" ? "21 x 29,7 cm" : "Medida manual"}</span>
                    </button>
                  ))}
                </div>
                {draft.receiptPaperWidth === "custom" && <div className="pdv-print-field-grid">
                  <label className="pdv-setting-line"><span>Largura personalizada (cm)</span><input type="number" min={4} max={30} step={0.1} value={Number(((draft.receiptCustomPaperWidthMm || 80) / 10).toFixed(1))} onChange={(event) => changeDraft({ receiptCustomPaperWidthMm: Math.max(40, Math.min(300, (Number(event.target.value) || 8) * 10)) })} /></label>
                  <label className="pdv-setting-line"><span>Altura personalizada (cm)</span><input type="number" min={8} max={100} step={0.1} value={Number(((draft.receiptCustomPaperHeightMm || 200) / 10).toFixed(1))} onChange={(event) => changeDraft({ receiptCustomPaperHeightMm: Math.max(80, Math.min(1000, (Number(event.target.value) || 20) * 10)) })} /></label>
                </div>}
                <div className="pdv-receipt-calibration">
                  <div className="pdv-receipt-calibration-head"><div><strong>Margens e tipografia</strong><span>As medidas partem da borda fisica da bobina.</span></div><span className="pdv-measure-badge">{Number((receiptPreviewWidthMm / 10).toFixed(1)).toLocaleString("pt-BR")} cm / {receiptPreviewWidthMm} mm</span></div>
                  <div className="pdv-paper-margin-editor">
                    <label className="margin-top"><span>Superior</span><input type="number" min={0} max={30} step={0.1} value={receiptMargins.top} onChange={(event) => setReceiptNumber("receiptMarginTopMm", event.target.value, 0, 30)} /><small>mm</small></label>
                    <label className="margin-left"><span>Esquerda</span><input type="number" min={0} max={20} step={0.1} value={receiptMargins.left} onChange={(event) => setReceiptNumber("receiptMarginLeftMm", event.target.value, 0, 20)} /><small>mm</small></label>
                    <div className="pdv-paper-diagram" aria-hidden="true"><span>AREA UTIL</span><small>{Math.max(1, receiptPreviewWidthMm - receiptMargins.left - receiptMargins.right).toFixed(1)} mm</small></div>
                    <label className="margin-right"><span>Direita</span><input type="number" min={0} max={20} step={0.1} value={receiptMargins.right} onChange={(event) => setReceiptNumber("receiptMarginRightMm", event.target.value, 0, 20)} /><small>mm</small></label>
                    <label className="margin-bottom"><span>Inferior</span><input type="number" min={0} max={30} step={0.1} value={receiptMargins.bottom} onChange={(event) => setReceiptNumber("receiptMarginBottomMm", event.target.value, 0, 30)} /><small>mm</small></label>
                  </div>
                  <label className="pdv-setting-line pdv-receipt-font-field"><span>Tamanho da fonte</span><div><input type="range" min={9} max={16} step={0.5} value={receiptFontSize} onChange={(event) => setReceiptNumber("receiptFontSize", event.target.value, 9, 16)} /><strong>{receiptFontSize}px</strong></div></label>
                  <div className="pdv-receipt-presets"><span>Aplicar preset:</span><button type="button" onClick={() => applyReceiptPreset("80")}>8 cm (80 mm)</button><button type="button" onClick={() => applyReceiptPreset("58")}>5,8 cm (58 mm)</button><button type="button" onClick={() => changeDraft({ receiptFontSize: 11.5, receiptMarginLeftMm: receiptDefaultMargin, receiptMarginRightMm: receiptDefaultMargin, receiptMarginTopMm: draft.receiptPaperWidth === "a4" ? 8 : 4, receiptMarginBottomMm: draft.receiptPaperWidth === "a4" ? 12 : 5 })}>Restaurar</button></div>
                  <small className="pdv-receipt-calibration-note">Se ainda houver corte, configure o driver do Windows como bobina continua de {receiptPreviewWidthMm} mm e desative a opcao de ajustar a pagina.</small>
                </div>
              </section>}

              {receiptSettingsSection === "printer" && <section className="pdv-print-section">
                <div className="pdv-print-section-head">
                  <strong>Impressora e destino</strong>
                  <span>Defina o equipamento local e quais computadores podem receber o recibo.</span>
                </div>
                <div className="pdv-print-field-grid">
                  <label className="pdv-setting-line pdv-wide-field"><span>Impressora predefinida</span><select value={draft.receiptPrinterName || ""} onChange={(event) => changeDraft({ receiptPrinterName: event.target.value })}><option value="">Selecionar ao imprimir / usar PDF</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? " (Padrao)" : ""}</option>)}</select></label>
                  <label className="pdv-setting-line"><span>Quantidade de copias</span><input type="number" min={1} max={5} value={draft.receiptCopies || 1} onChange={(event) => changeDraft({ receiptCopies: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })} /></label>
                </div>
                <label className="pdv-switch-line"><input type="checkbox" checked={draft.receiptAllowClientPrint !== false} onChange={(event) => changeDraft({ receiptAllowClientPrint: event.target.checked })} /> Permitir impressao nos computadores clientes autorizados</label>
                <div className="pdv-printer-status"><span>{printerMessage || "Consulte as impressoras reconhecidas pelo Windows."}</span><button className="pdv-ghost-button" type="button" onClick={() => void loadPrinters()}>Atualizar impressoras</button></div>
                <small className="pdv-print-helper">Se a impressora estiver indisponivel, o aplicativo oferece o PDF como alternativa.</small>
              </section>}

              {receiptSettingsSection === "behavior" && <section className="pdv-print-section">
                <div className="pdv-print-section-head">
                  <strong>Comportamento do recibo</strong>
                  <span>Escolha quando imprimir e como organizar os itens.</span>
                </div>
                <div className="pdv-print-switches">
                  <label className="pdv-switch-line"><input type="checkbox" checked={Boolean(draft.receiptOpenAfterSale)} onChange={(event) => changeDraft({ receiptOpenAfterSale: event.target.checked })} /><span><strong>Abrir recibo ao finalizar</strong><small>Abre o menu do recibo com as opcoes de visualizar, salvar em PDF e imprimir. Vem desativado por padrao.</small></span></label>
                  <label className="pdv-switch-line"><input type="checkbox" checked={Boolean(draft.receiptAutoPrint)} onChange={(event) => changeDraft({ receiptAutoPrint: event.target.checked })} /><span><strong>Impressao automatica</strong><small>Imprime assim que a venda ou mesa for finalizada.</small></span></label>
                  <label className="pdv-switch-line"><input type="checkbox" checked={draft.receiptGroupIdenticalItems !== false} onChange={(event) => changeDraft({ receiptGroupIdenticalItems: event.target.checked })} /><span><strong>Agrupar produtos iguais</strong><small>Exibe, por exemplo, 4x Cafe em uma unica linha.</small></span></label>
                  <label className="pdv-switch-line"><input type="checkbox" checked={Boolean(draft.receiptUseColor)} onChange={(event) => changeDraft({ receiptUseColor: event.target.checked })} /><span><strong>Usar cores</strong><small>Aplica cores quando a impressora oferecer suporte.</small></span></label>
                </div>
                <div className="pdv-print-notice"><ReceiptText size={20} /><div><strong>Recibo nao fiscal</strong><span>O documento emitido serve como comprovante e nao substitui nota ou cupom fiscal.</span></div></div>
              </section>}
            </div>

            <aside className="pdv-print-preview-column">
              <div className="pdv-print-preview-head"><div><strong>Pre-visualizacao</strong><span>Atualizada conforme voce configura.</span></div><b>{Number((receiptPreviewWidthMm / 10).toFixed(1)).toLocaleString("pt-BR")} cm</b></div>
              <div
                className={`pdv-receipt-settings-preview paper-${draft.receiptPaperWidth || "80"}`}
                style={draft.receiptPaperWidth === "custom"
                  ? { "--receipt-custom-width": `${Math.min(360, Math.max(180, receiptPreviewWidthMm * 3.4))}px`, "--receipt-preview-font": `${receiptFontSize}px`, "--receipt-preview-left": `${receiptMargins.left / receiptPreviewWidthMm * 100}%`, "--receipt-preview-right": `${receiptMargins.right / receiptPreviewWidthMm * 100}%` } as React.CSSProperties
                  : { "--receipt-preview-font": `${receiptFontSize}px`, "--receipt-preview-left": `${receiptMargins.left / receiptPreviewWidthMm * 100}%`, "--receipt-preview-right": `${receiptMargins.right / receiptPreviewWidthMm * 100}%` } as React.CSSProperties}
              >
                <div className="pdv-receipt-paper">
                  <div className={`pdv-receipt-brand ${draft.receiptShowLogo !== false && draft.receiptLogoDataUrl ? "has-logo" : ""}`}>
                    {draft.receiptShowLogo !== false && draft.receiptLogoDataUrl && <img src={draft.receiptLogoDataUrl} alt="Logotipo do recibo" />}
                    <div>
                      <strong>{!draft.receiptBusinessName || draft.receiptBusinessName.trim().toLocaleLowerCase("pt-BR") === "contabilizador caixa" ? "RECIBO" : draft.receiptBusinessName}</strong>
                      {draft.receiptBusinessDocument && <span>{draft.receiptBusinessDocument}</span>}
                      {draft.receiptBusinessStateRegistration && <span>IE: {draft.receiptBusinessStateRegistration}</span>}
                      {draft.receiptBusinessAddress && <span>{draft.receiptBusinessAddress}</span>}
                      {draft.receiptBusinessPhone && <span>Fone: {draft.receiptBusinessPhone}</span>}
                    </div>
                  </div>
                  <i />
                  <b>MODELO DO RECIBO</b>
                  <div><span>1x Produto de exemplo</span><strong>R$ 10,00</strong></div>
                  <i />
                  <div className="total"><span>Total</span><strong>R$ 10,00</strong></div>
                  <small>{draft.receiptFooter || "Obrigado pela preferencia."}</small>
                </div>
              </div>
            </aside>
          </div>
        </div>}

        {section === "data" && <div className="pdv-settings-form">
          <Banknote size={22} />
          <div><strong>Banco e exportacao</strong><span>Produtos e vendas ficam no SQLite. O Excel e gerado a partir dele.</span></div>
          <small className="pdv-data-path" title={snapshot.dataFile}>{snapshot.dataFile}</small>
          <button className="pdv-ghost-button" type="button" onClick={() => window.caixa.openOutputDirectory()}>Abrir pasta dos Excel</button>
          <div className="pdv-import-actions">
            <CoseImportButton busy={busy} onPreview={onPreviewCose} onImport={onImportCose} onImported={onSettingsUpdated} />
            <FileImportButton busy={busy} onPreview={onPreviewImportFile} onImport={onImportFile} onImported={onSettingsUpdated} />
          </div>
        </div>}
      </div>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="pdv-metric">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReportList({ title, rows, format }: { title: string; rows: Array<[string, number]>; format: (value: number) => string }) {
  return (
    <div className="pdv-report-list">
      <h2>{title}</h2>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{format(value)}</strong>
        </div>
      ))}
      {!rows.length && <p className="pdv-empty">Sem dados.</p>}
    </div>
  );
}

function SaleDetailModal({ sale, onClose, onCancel, canCancel = true }: { sale: PdvSale; onClose: () => void; onCancel: () => void; canCancel?: boolean }) {
  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        detailScrollRef.current?.scrollBy({ top: event.key === "ArrowDown" ? 80 : -80, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-sale-detail-modal" tabIndex={-1} autoFocus>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Detalhes da venda</span>
            <h1>{sale.type}{sale.tableNumber ? ` ${String(sale.tableNumber).padStart(3, "0")}` : ""}</h1>
            <p>{new Date(sale.createdAt).toLocaleString("pt-BR")} | {sale.status}</p>
          </div>
          <button className="pdv-icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div ref={detailScrollRef} className="pdv-sale-detail-scroll" tabIndex={0}>
          <div className="pdv-payment-summary">
            <Metric title="Subtotal" value={money(sale.subtotal)} />
            <Metric title="Desconto" value={money(sale.discount)} />
            <Metric title="Total final" value={money(sale.total)} />
          </div>
          <div className="pdv-detail-columns">
            <div>
              <h2>Itens</h2>
              {sale.items.map((item) => (
                <article key={item.id}>
                  <strong>{item.productName}</strong>
                  <span>{formatQuantity(item.quantity)} x {money(item.unitPrice)} | {item.categoryName}{item.subtableName ? ` | ${item.subtableName}` : ""}</span>
                  {adjustedItemOriginalTotal(item) !== null && (
                    <small className="pdv-detail-price-adjustment">
                      Original <s>{money(adjustedItemOriginalTotal(item)!)}</s> | Desconto {money(Math.max(0, adjustedItemOriginalTotal(item)! - item.total))} | Final {money(item.total)}
                    </small>
                  )}
                  <b>{money(item.total)}</b>
                </article>
              ))}
            </div>
            <div>
              <h2>Pagamentos</h2>
              {sale.payments.map((payment) => (
                <article key={payment.id}>
                  <strong>{payment.method}</strong>
                  <span>{money(payment.amount)}{payment.received ? ` | Recebido ${money(payment.received)}` : ""}{payment.change ? ` | Troco ${money(payment.change)}` : ""}{payment.description ? ` | ${payment.description}` : ""}</span>
                </article>
              ))}
            </div>
          </div>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" onClick={onClose}>Voltar</button>
          {canCancel && <button className="pdv-danger-button" disabled={sale.status === "Cancelada"} onClick={onCancel}>Cancelar venda</button>}
        </div>
      </section>
    </div>
  );
}

function filterSales(
  sales: PdvSale[],
  filters: { from?: string; to?: string; query?: string; type?: string; payment?: string; status?: string; table?: string; origin?: string }
): PdvSale[] {
  const query = (filters.query || "").trim().toLocaleLowerCase("pt-BR");
  const valueRange = parseSaleValueQuery(query);
  const table = (filters.table || "").replace(/^0+/, "");
  return sales.filter((sale) => {
    const dateKey = localDateInputValue(new Date(sale.createdAt));
    if (filters.from && dateKey < filters.from) {
      return false;
    }
    if (filters.to && dateKey > filters.to) {
      return false;
    }
    if (filters.type && filters.type !== "Todos" && sale.type !== filters.type) {
      return false;
    }
    if (filters.status && filters.status !== "Todos" && sale.status !== filters.status) {
      return false;
    }
    if (filters.payment && filters.payment !== "Todos" && !sale.payments.some((payment) => payment.method === filters.payment)) {
      return false;
    }
    if (table && String(sale.tableNumber || "") !== table) {
      return false;
    }
    if (filters.origin && filters.origin !== "Todos" && (sale.originDevice || "Este computador") !== filters.origin) {
      return false;
    }
    if (!query) {
      return true;
    }
    if (valueRange) {
      return sale.total >= valueRange.min - 0.009 && sale.total <= valueRange.max + 0.009;
    }
    const haystack = [
      sale.type,
      sale.status,
      sale.tableNumber ? String(sale.tableNumber) : "",
      sale.tableNumber ? `mesa ${sale.tableNumber}` : "",
      sale.description || "",
      sale.observations || "",
      ...sale.items.flatMap((item) => [item.productName, item.categoryName, item.subtableName || ""]),
      ...sale.payments.flatMap((payment) => [payment.method, payment.description || ""])
    ].join(" ").toLocaleLowerCase("pt-BR");
    return haystack.includes(query);
  });
}

function parseSaleValueQuery(query: string): { min: number; max: number } | null {
  const normalized = query.replace(/^r\$\s*/i, "").trim();
  const parts = normalized.split(/\s*(?:-|a|ate|até)\s*/i).filter(Boolean);
  if (!parts.length || parts.length > 2 || !parts.every((part) => /^\d+(?:[.,]\d{1,2})?$/.test(part))) {
    return null;
  }
  const values = parts.map((part) => parseBrazilianNumber(part));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function TabButton({ icon: Icon, active, label, onClick }: { icon: typeof ShoppingCart; active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <Icon size={21} /> {label}
    </button>
  );
}

function mergeCartItem(items: PdvCartItem[], incoming: PdvCartItem, stackIdenticalItems = false): PdvCartItem[] {
  // Produtos medidos carregam um total final informado pelo operador. Nunca devem
  // ser agrupados por quantidade, pois isso voltaria a calcular peso x preco/kg.
  if (!stackIdenticalItems || isMeasuredCartItem(incoming)) {
    return [...items, incoming];
  }
  const hasCustomComposition = Boolean(incoming.discount || incoming.note || incoming.subtableName || incoming.complements?.length || incoming.unitPrice !== incoming.baseUnitPrice);
  const existing = items.find((item) =>
    item.productId === incoming.productId &&
    !item.discount &&
    !item.note &&
    !item.subtableName &&
    !item.complements?.length &&
    item.unitPrice === incoming.unitPrice
  );
  if (hasCustomComposition) {
    return [...items, incoming];
  }
  if (!existing) {
    return [...items, incoming];
  }
  return items.map((item) => {
    if (item.id !== existing.id) {
      return item;
    }
    const quantity = roundQuantity(item.quantity + incoming.quantity);
    return {
      ...item,
      quantity,
      total: roundMoney(quantity * item.unitPrice - item.discount)
    };
  });
}

function isMeasuredCartItem(item: PdvCartItem): boolean {
  return /\bg\s*$/i.test(item.measureLabel || "");
}

function expandIndividualUnits(item: PdvCartItem, enabled = false): PdvCartItem[] {
  if (!enabled || !Number.isInteger(item.quantity) || item.quantity <= 1 || item.measureLabel) {
    return [item];
  }
  const unitDiscount = roundMoney(item.discount / item.quantity);
  return Array.from({ length: item.quantity }, () => ({
    ...item,
    id: crypto.randomUUID(),
    quantity: 1,
    paidQuantity: 0,
    discount: unitDiscount,
    total: roundMoney(Math.max(0, item.unitPrice - unitDiscount))
  }));
}

function mergeIncomingItems(current: PdvCartItem[], incoming: PdvCartItem[], stackIdenticalItems = false): PdvCartItem[] {
  return incoming.reduce((items, item) => mergeCartItem(items, item, stackIdenticalItems), current);
}

function moveCartItem(items: PdvCartItem[], id: string, direction: -1 | 1): PdvCartItem[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function moveCartItemNear(items: PdvCartItem[], id: string, referenceIndex: number, after: boolean): PdvCartItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0 || referenceIndex < 0 || referenceIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(index, 1);
  const adjustedReference = index < referenceIndex ? referenceIndex - 1 : referenceIndex;
  next.splice(Math.min(next.length, adjustedReference + (after ? 1 : 0)), 0, item);
  return next;
}

function transferQuantity(item: PdvCartItem, rawValue?: string): number {
  const parsed = parseBrazilianNumber(rawValue || String(item.quantity));
  return roundQuantity(Math.min(item.quantity, Math.max(0.001, parsed || item.quantity)));
}
function splitCartItemForTransfer(item: PdvCartItem, quantity: number, subtableName: string): PdvCartItem {
  const ratio = item.quantity > 0 ? quantity / item.quantity : 1;
  const discount = roundMoney(item.discount * ratio);
  return {
    ...item,
    id: crypto.randomUUID(),
    quantity: roundQuantity(quantity),
    subtableName,
    discount,
    total: isMeasuredCartItem(item)
      ? Math.max(0, roundMoney(item.total * ratio))
      : Math.max(0, roundMoney(quantity * item.unitPrice - discount))
  };
}

function splitAmountIntoPayments(total: number, people: number): PdvPayment[] {
  const safePeople = Math.max(1, Math.floor(people || 1));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / safePeople);
  const remainder = cents - base * safePeople;
  return Array.from({ length: safePeople }, (_, index) => ({
    id: crypto.randomUUID(),
    method: "Nao definido" as const,
    amount: roundMoney((base + (index === safePeople - 1 ? remainder : 0)) / 100)
  }));
}

function subtractCartItemQuantity(items: PdvCartItem[], id: string, quantity: number): PdvCartItem[] {
  return items.flatMap((item) => {
    if (item.id !== id) {
      return [item];
    }
    const nextQuantity = roundQuantity(item.quantity - quantity);
    if (nextQuantity <= 0.0001) {
      return [];
    }
    const ratio = item.quantity > 0 ? nextQuantity / item.quantity : 1;
    const discount = roundMoney(item.discount * ratio);
    return [{
      ...item,
      quantity: nextQuantity,
      discount,
      total: isMeasuredCartItem(item)
        ? Math.max(0, roundMoney(item.total * ratio))
        : Math.max(0, roundMoney(nextQuantity * item.unitPrice - discount))
    }];
  });
}

function updateCartItem(items: PdvCartItem[], id: string, patch: Partial<Pick<PdvCartItem, "quantity" | "discount" | "note" | "unitPrice" | "measureLabel" | "total">>): PdvCartItem[] {
  return items.map((item) => {
    if (item.id !== id) {
      return item;
    }
    const quantity = roundQuantity(patch.quantity ?? item.quantity);
    const discount = Math.max(0, patch.discount ?? item.discount);
    const unitPrice = patch.unitPrice ?? item.unitPrice;
    const measureLabel = patch.measureLabel ?? item.measureLabel;
    const isMeasured = /\bg\s*$/i.test(measureLabel || "");
    return {
      ...item,
      quantity,
      unitPrice,
      discount,
      note: patch.note ?? item.note,
      measureLabel,
      total: patch.total ?? (isMeasured ? item.total : Math.max(0, roundMoney(quantity * unitPrice - discount)))
    };
  });
}

function adjustedItemOriginalTotal(item: PdvCartItem): number | null {
  if (item.discount > 0.009) {
    return roundMoney(item.total + item.discount);
  }
  if (!item.measureLabel && item.baseUnitPrice !== undefined && Math.abs(item.baseUnitPrice - item.unitPrice) > 0.009) {
    return roundMoney(item.quantity * item.baseUnitPrice);
  }
  return null;
}

function parseBrazilianNumber(value: string): number {
  const raw = String(value || "").trim().replace(/[^\d,.-]/g, "");
  if (!raw) {
    return 0;
  }
  if (raw.includes(",")) {
    return Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (raw.includes(".")) {
    const parts = raw.split(".");
    const last = parts.at(-1) || "";
    return Number(parts.length > 2 || last.length === 3 ? raw.replace(/\./g, "") : raw) || 0;
  }
  return Number(raw) || 0;
}


