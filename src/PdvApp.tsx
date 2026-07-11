import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  Banknote,
  Check,
  ClipboardList,
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
import type { PdvCartItem, PdvCategory, PdvCategoryDraft, PdvExportFilters, PdvOpenTable, PdvPayment, PdvPaymentMethod, PdvProduct, PdvProductDraft, PdvProductImportResult, PdvSale, PdvSettings, PdvSnapshot, PdvTableStatus, PdvTransferSelection } from "./shared/pdvTypes";
import type { RoundDirection } from "./shared/types";
import { calculateSplit } from "./shared/calculations";

type PdvTab = "sale" | "tables" | "products" | "history" | "reports" | "advanced";
type PdvRemoteSession = { baseUrl: string; password: string; deviceName: string; roundingStep?: number; roundingDirection?: RoundDirection };
type PendingRemoteTable = { tableNumber: number; people: number; note: string; items: PdvCartItem[]; subtables?: string[]; updatedAt: string };
type PdvClientVisualSettings = Pick<PdvSettings, "gridColumns" | "categoryColumns" | "tableColumns" | "productCardHeight" | "categoryCardHeight" | "tableCardHeight">;
type CheckoutTarget =
  | { kind: "direct"; total: number; items?: PdvCartItem[]; manual?: boolean }
  | { kind: "table"; table: PdvOpenTable; total: number; discount: number; initialPayments?: PdvPayment[] }
  | { kind: "table-partial-items"; table: PdvOpenTable; total: number; items: PdvCartItem[] }
  | { kind: "table-partial-manual"; table: PdvOpenTable; total: number; items: PdvCartItem[] };

const PAYMENT_METHODS: PdvPaymentMethod[] = ["Dinheiro", "Debito", "Credito", "Pix", "Outros", "Nao definido"];
const CLIENT_VISUAL_SETTINGS_KEY = "caixa.pdv.client-visual-settings";
type PendingProduct = { product: PdvProduct; quantity: number; measureLabel?: string; unitPrice?: number };
type PendingMeasureProduct = { product: PdvProduct; direct: boolean };

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function readClientVisualSettings(): Partial<PdvClientVisualSettings> {
  try {
    const value = JSON.parse(window.localStorage.getItem(CLIENT_VISUAL_SETTINGS_KEY) || "{}") as Partial<PdvClientVisualSettings>;
    const fields: Array<keyof PdvClientVisualSettings> = ["gridColumns", "categoryColumns", "tableColumns", "productCardHeight", "categoryCardHeight", "tableCardHeight"];
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

function unpaidQuantity(item: PdvCartItem): number {
  return roundMoney(Math.max(0, item.quantity - Math.min(item.quantity, Math.max(0, item.paidQuantity || 0))));
}

function unpaidItemTotal(item: PdvCartItem): number {
  return item.quantity ? roundMoney(item.total * (unpaidQuantity(item) / item.quantity)) : 0;
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

function createCartItem(product: PdvProduct, quantity: number, complements: PdvCartItem["complements"] = [], customUnitPrice?: number, subtableName = "", measureLabel = ""): PdvCartItem {
  const safeQuantity = Math.max(0.01, quantity || 1);
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
    total: roundMoney(unitPrice * safeQuantity),
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
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${data?.error || "Nao foi possivel sincronizar com o servidor."} (HTTP ${response.status})`);
  }
  return data as T;
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
  onDirectCartChange
}: {
  embedded?: boolean;
  initialTab?: PdvTab;
  hideTopbar?: boolean;
  remoteSession?: PdvRemoteSession | null;
  reloadToken?: number;
  roundingStep?: number;
  roundingDirection?: RoundDirection;
  toastDuration?: number;
  onDirectCartChange?: (hasItems: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<PdvSnapshot | null>(null);
  const [tab, setTab] = useState<PdvTab>(initialTab);
  const [activeCategory, setActiveCategory] = useState("todos");
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<PdvCartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [tableFilter, setTableFilter] = useState<PdvTableStatus | "Todas">("Todas");
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
  const [tableCloseMenuOpen, setTableCloseMenuOpen] = useState(false);
  const [partialItemsModalOpen, setPartialItemsModalOpen] = useState(false);
  const [partialValueModalOpen, setPartialValueModalOpen] = useState(false);
  const [quickValueModalOpen, setQuickValueModalOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [tableSaveState, setTableSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [remoteOfflineBlocked, setRemoteOfflineBlocked] = useState(false);
  const [clientVisualSettings, setClientVisualSettings] = useState<Partial<PdvClientVisualSettings>>(readClientVisualSettings);
  const tableAutosaveTimer = useRef<number | null>(null);
  const lastProductLaunch = useRef<{ productId: string; at: number } | null>(null);
  const isRemoteClient = Boolean(remoteSession);
  const remoteTablesActive = Boolean(remoteSession && tab === "tables");
  const remotePdvActive = Boolean(remoteSession);

  const getPdvSnapshot = () => remotePdvActive && remoteSession
    ? remotePdvRequest<PdvSnapshot>(remoteSession, "/api/pdv/snapshot")
    : window.caixa.getPdvSnapshot();
  const openPdvTable = (tableNumber: number, people?: number, note?: string) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/open`, { method: "POST", body: JSON.stringify({ people, note }) }).then(() => undefined)
    : window.caixa.openPdvTable(tableNumber, people, note);
  const setPdvTableStatus = (tableNumber: number, status: PdvTableStatus) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/status`, { method: "PATCH", body: JSON.stringify({ status }) }).then(() => undefined)
    : window.caixa.setPdvTableStatus(tableNumber, status);
  const savePdvTableItems = async (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => {
    if (!remoteTablesActive || !remoteSession) {
      await window.caixa.savePdvTableItems(tableNumber, items, subtables);
      return;
    }
    try {
      const send = () => remotePdvRequest<{ ok: boolean }>(remoteSession, `/api/pdv/tables/${tableNumber}/items`, { method: "PUT", body: JSON.stringify({ items, subtables }) });
      try {
        await send();
      } catch (firstError) {
        const message = firstError instanceof Error ? firstError.message : "";
        if (/HTTP 4\d\d/.test(message)) throw firstError;
        await wait(350);
        await send();
      }
      clearQueuedRemoteTable(tableNumber);
    } catch (error) {
      const current = snapshot?.tables.find((table) => table.number === tableNumber);
      if (snapshot?.settings.allowOfflineTables) {
        queueRemoteTable(tableNumber, current?.people || 1, current?.note || "", items, subtables);
      } else {
        setRemoteOfflineBlocked(true);
      }
      throw error;
    }
  };
  const transferPdvTableItems = (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ ok: boolean; items: PdvCartItem[] }>(remoteSession, `/api/pdv/tables/${sourceTableNumber}/transfer`, { method: "POST", body: JSON.stringify({ targetTableNumber, selections }) }).then((result) => result.items)
    : window.caixa.transferPdvTableItems(sourceTableNumber, targetTableNumber, selections);
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
  }, [remoteSession?.baseUrl, remoteTablesActive, reloadToken]);
  const closePdvTable = (tableNumber: number, payments: PdvPayment[], closeDiscount?: number) => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, `/api/pdv/tables/${tableNumber}/close`, { method: "POST", headers: { "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ payments, discount: closeDiscount }) }).then((result) => result.sale)
    : window.caixa.closePdvTable(tableNumber, payments, closeDiscount, crypto.randomUUID());
  const saveDirectPdvSale = (items: PdvCartItem[], directDiscount: number, payments: PdvPayment[]) => remotePdvActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, "/api/pdv/sales/direct", { method: "POST", headers: { "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ items, discount: directDiscount, payments }) }).then((result) => result.sale)
    : window.caixa.saveDirectSale(items, directDiscount, payments);
  const savePdvTablePartial = (tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], partialDiscount?: number, observations = "") => remoteTablesActive && remoteSession
    ? remotePdvRequest<{ sale: PdvSale }>(remoteSession, `/api/pdv/tables/${tableNumber}/partial`, { method: "POST", headers: { "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ items, payments, discount: partialDiscount, observations }) }).then((result) => result.sale)
    : window.caixa.savePdvTablePartial(tableNumber, items, payments, partialDiscount, crypto.randomUUID(), observations);
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
  const savePdvSettings = (patch: Partial<PdvSettings>) => isRemoteClient
    ? clientConfigurationBlocked() as Promise<PdvSettings>
    : window.caixa.savePdvSettings(patch);
  const importPdvPreset = () => isRemoteClient ? clientConfigurationBlocked() as Promise<PdvProductImportResult> : window.caixa.importCoseProducts();
  const removePdvPreset = () => isRemoteClient ? clientConfigurationBlocked() as Promise<number> : window.caixa.removeCoseProducts();

  const load = async () => {
    const next = await getPdvSnapshot();
    setSnapshot(next);
    setRemoteOfflineBlocked(false);
    return next;
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
  };

  useEffect(() => {
    load();
    return window.caixa.onPdvChanged(load);
  }, [remoteSession?.baseUrl, remotePdvActive, reloadToken]);

  useEffect(() => {
    if (!remotePdvActive || !remoteSession) {
      return;
    }
    let disposed = false;
    let loading = false;
    const refreshRemoteSnapshot = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        await load();
      } catch {
        if (!disposed) setRemoteOfflineBlocked(true);
      } finally {
        loading = false;
      }
    };
    const timer = window.setInterval(refreshRemoteSnapshot, 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [remotePdvActive, remoteSession?.baseUrl]);

  useEffect(() => {
    if (!remoteSession || !activeTable || !snapshot || checkoutTarget || tableCloseMenuOpen || tableSaveState === "saving" || remoteOfflineBlocked) {
      return;
    }
    applyFreshOpenTable(snapshot, activeTable.number);
  }, [remoteSession?.baseUrl, snapshot?.tables, activeTable?.number, checkoutTarget, tableCloseMenuOpen, tableSaveState, remoteOfflineBlocked]);

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
    if (tableAutosaveTimer.current !== null) {
      window.clearTimeout(tableAutosaveTimer.current);
    }
    setTableSaveState("saving");
    tableAutosaveTimer.current = window.setTimeout(() => {
      tableAutosaveTimer.current = null;
      void (async () => {
        try {
          await openPdvTable(activeTable.number, tablePeople, tableNote);
          await savePdvTableItems(activeTable.number, tableCart, subtableNames);
          setTableSaveState("saved");
          await load();
        } catch (error) {
          if (remoteTablesActive) {
            if (snapshot?.settings.allowOfflineTables) {
              queueRemoteTable(activeTable.number, tablePeople, tableNote, tableCart, subtableNames);
            } else {
              setRemoteOfflineBlocked(true);
              const savedTable = snapshot?.tables.find((table) => table.number === activeTable.number);
              if (savedTable) {
                setTableCart(savedTable.items);
                setSubtableNames(savedTable.subtables || []);
              }
            }
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
    return items.filter((product) => {
      const categoryMatch = activeCategory === "todos" || product.categoryId === activeCategory;
      const queryMatch = !query.trim() || product.name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
      return categoryMatch && queryMatch;
    }).sort((left, right) => direction * left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
  }, [activeCategory, query, snapshot?.products]);

  const saleTotal = useMemo(() => roundMoney(cart.reduce((total, item) => total + item.total, 0)), [cart]);
  const saleFinal = Math.max(0, roundMoney(saleTotal - discount));
  const tableTotal = useMemo(() => roundMoney(tableCart.reduce((total, item) => total + unpaidItemTotal(item), 0)), [tableCart]);

  const addProduct = (product: PdvProduct, direct = false, bypassReopen = false) => {
    if (activeTable && isRemoteClient && remoteOfflineBlocked && !snapshot?.settings.allowOfflineTables) {
      setToast("Cliente sem conexao com o servidor. A mesa esta bloqueada para evitar perda de dados.");
      return;
    }
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

  const addResolvedProduct = (product: PdvProduct, resolvedQuantity: { quantity: number; measureLabel?: string; unitPrice?: number }, direct = false) => {
    const now = Date.now();
    const previousLaunch = lastProductLaunch.current;
    if (previousLaunch?.productId === product.id && now - previousLaunch.at < 140) {
      return;
    }
    lastProductLaunch.current = { productId: product.id, at: now };
    const availableComplements = snapshot ? complementsForProduct(product, snapshot.products) : [];
    if (snapshot?.settings.complementsEnabled && !direct && (product.hasComplements || product.complementProductIds.length > 0) && availableComplements.length > 0) {
      setPendingProduct({ product, ...resolvedQuantity });
      return;
    }
    const item = createCartItem(product, resolvedQuantity.quantity, [], resolvedQuantity.unitPrice, activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "", resolvedQuantity.measureLabel);
    const items = expandIndividualUnits(item, Boolean(snapshot?.settings.individualUnitItems));
    if (activeTable) {
      setTableCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
      setQuery("");
      setQuantity(1);
      return;
    }
    setCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
    setQuery("");
    setQuantity(1);
  };

  const finishDirectSale = () => {
    if (!cart.length) {
      setToast("Adicione ao menos um produto.");
      return;
    }
    setCheckoutTarget({ kind: "direct", total: saleFinal });
  };

  const confirmDirectSale = async (payments: PdvPayment[], items = cart) => {
    setBusy(true);
    try {
      await saveDirectPdvSale(items, discount, payments);
      setCart([]);
      setDiscount(0);
      setCheckoutTarget(null);
      setToast("Venda direta finalizada.");
      await load();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Nao foi possivel finalizar a venda.");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const openTable = async (table: PdvOpenTable) => {
    try {
      if (table.status === "Livre") {
        await openPdvTable(table.number, 1, "");
        const fresh = (await getPdvSnapshot()).tables.find((item) => item.number === table.number);
        const opened = fresh || { ...table, status: "Ocupada" as PdvTableStatus, openedAt: new Date().toISOString(), people: 1, note: "", items: [] };
        setActiveTable(opened);
        setTableCart(opened.items);
        setTablePeople(opened.people || 1);
        setTableNote(opened.note || "");
        setSubtableNames(opened.subtables || []);
        setTableSaveState("idle");
        setSelectedTableItemIds([]);
        setCurrentSubtable("");
        return;
      }
      setActiveTable(table);
      setTableCart(table.items);
      setTablePeople(table.people || 1);
      setTableNote(table.note || "");
      setSubtableNames(table.subtables || []);
      setTableSaveState("idle");
      setSelectedTableItemIds([]);
      setCurrentSubtable("");
    } catch (error) {
      setTableSaveState("error");
      setToast(error instanceof Error ? error.message : "Nao foi possivel abrir a mesa no servidor.");
    }
  };

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
        message: "A mesa sera liberada e todos os itens ainda nao fechados serao removidos.",
        action: async () => {
          await savePdvTableItems(table.number, []);
          await setPdvTableStatus(table.number, "Livre");
          await load();
        }
      });
    }
  };

  const addConfiguredProduct = (product: PdvProduct, unitPrice: number, complements: PdvCartItem["complements"]) => {
    const resolvedQuantity = pendingProduct?.product.id === product.id ? pendingProduct : { quantity, measureLabel: undefined };
    const subtableName = activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "";
    const grouped = snapshot?.settings.groupComplementsWithProduct ?? true;
    const mainItem = createCartItem(product, resolvedQuantity.quantity, grouped ? complements || [] : [], unitPrice ?? pendingProduct?.unitPrice, subtableName, resolvedQuantity.measureLabel);
    const separateComplements = !grouped
      ? (complements || []).map((complement) => ({
          id: crypto.randomUUID(), productId: complement.productId, productName: complement.name, categoryName: "Adicionais", quantity: resolvedQuantity.quantity,
          measureLabel: resolvedQuantity.measureLabel, unitPrice: complement.price, baseUnitPrice: complement.price, discount: 0,
          total: roundMoney(resolvedQuantity.quantity * complement.price), subtableName, note: `Adicional de ${product.name}`, complements: []
        } satisfies PdvCartItem))
      : [];
    const items = [mainItem, ...separateComplements].flatMap((item) => expandIndividualUnits(item, Boolean(snapshot?.settings.individualUnitItems)));
    if (activeTable) {
      setTableCart((current) => mergeIncomingItems(current, items, snapshot?.settings.stackIdenticalItems));
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
      await openPdvTable(activeTable.number, tablePeople, tableNote);
      await savePdvTableItems(activeTable.number, tableCart, subtableNames);
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
    try {
      await openPdvTable(activeTable.number, tablePeople, tableNote);
      await savePdvTableItems(activeTable.number, tableCart, subtableNames);
    } catch (error) {
      if (remoteTablesActive) {
        queueRemoteTable(activeTable.number, tablePeople, tableNote, tableCart, subtableNames);
      }
      throw error;
    }
    setTableSaveState("saved");
    await load();
    return true;
  };

  const requestCloseTable = async () => {
    if (!activeTable || tableTotal <= 0.009) {
      return;
    }
    await persistTableBeforeAction();
    await setPdvTableStatus(activeTable.number, "Fechamento");
    setActiveTable((current) => current ? { ...current, status: "Fechamento" } : current);
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
    setCheckoutTarget({ kind: "table-partial-items", table: activeTable, total: roundMoney(selected.reduce((total, item) => total + item.total, 0)), items: selected });
  };

  const requestCloseSubtable = async (name: string) => {
    if (!activeTable) {
      return;
    }
    const selected = tableCart.filter((item) => (item.subtableName || "") === name && unpaidQuantity(item) > 0.009).map((item) => ({ ...item, quantity: unpaidQuantity(item), paidQuantity: 0, total: unpaidItemTotal(item) }));
    if (!selected.length) {
      setToast("Essa submesa nao tem itens para fechar.");
      return;
    }
    await persistTableBeforeAction();
    setCheckoutTarget({ kind: "table-partial-items", table: activeTable, total: roundMoney(selected.reduce((total, item) => total + item.total, 0)), items: selected });
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
        setCurrentSubtable("");
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
    setCheckoutTarget({ kind: "table-partial-manual", table: activeTable, total: manualItem.total, items: [manualItem] });
  };

  const confirmCloseTable = async (payments: PdvPayment[]) => {
    if (!activeTable) {
      return;
    }
    setBusy(true);
    try {
      await savePdvTableItems(activeTable.number, tableCart, subtableNames);
      const tableDiscount = checkoutTarget?.kind === "table" ? checkoutTarget.discount : 0;
      await closePdvTable(activeTable.number, payments, tableDiscount);
      setToast(`Mesa ${String(activeTable.number).padStart(3, "0")} fechada.`);
      setActiveTable(null);
      setTableCart([]);
      setCheckoutTarget(null);
    } finally {
      setBusy(false);
    }
    await load();
  };

  const confirmPartialTable = async (target: Extract<CheckoutTarget, { kind: "table-partial-items" | "table-partial-manual" }>, payments: PdvPayment[], observations = "") => {
    setBusy(true);
    try {
      await savePdvTablePartial(target.table.number, target.items, payments, 0, observations);
      if (target.kind === "table-partial-items") {
        const selectedById = new Map(target.items.map((item) => [item.id, item.quantity]));
        setTableCart((current) => current.map((item) => selectedById.has(item.id) ? { ...item, paidQuantity: roundMoney(Math.min(item.quantity, (item.paidQuantity || 0) + (selectedById.get(item.id) || 0))) } : item));
        setPartialSelectedItemIds([]);
      }
      setCheckoutTarget(null);
      setToast(target.kind === "table-partial-items" ? "Parcial por itens registrada." : "Parcial manual registrada.");
      const refreshed = await load();
      applyFreshOpenTable(refreshed, target.table.number);
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

  const importFile = async () => {
    setBusy(true);
    try {
      const result = await window.caixa.importPdvProductsFile();
      if (result) {
        setToast(`${result.importedProducts} produtos importados.`);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="pdv-loading">Carregando PDV local...</div>;
  }

  const visibleSettings = isRemoteClient ? { ...snapshot.settings, ...clientVisualSettings } : snapshot.settings;

  return (
    <div className={`pdv-shell ${embedded ? "embedded" : ""} ${hideTopbar ? "no-topbar" : ""}`}>
      {!hideTopbar && (
        <aside className="pdv-topbar">
          <div className="pdv-brand">
            <img src="/cda-icon.png" alt="" />
            <div>
              <strong>Contabilizador PDV</strong>
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
            query={query}
            quantity={quantity}
            cart={cart}
            discount={discount}
            busy={busy}
            setActiveCategory={setActiveCategory}
            setQuery={setQuery}
            setQuantity={setQuantity}
            addProduct={addProduct}
            setCart={setCart}
            setDiscount={setDiscount}
            finishLabel="Receber e finalizar"
            onFinish={finishDirectSale}
            settings={visibleSettings}
          />
        )}

        {tab === "tables" && !activeTable && (
          <section className="pdv-panel pdv-tables-screen">
            <div className="pdv-section-head">
              <div>
                <span className="pdv-eyebrow">Mapa de mesas</span>
                <h1>Mesas</h1>
              </div>
              <div className="pdv-filter-row">
                {(["Todas", "Livre", "Ocupada", "Fechamento", "Reservada"] as const).map((status) => (
                  <button className={tableFilter === status ? "active" : ""} key={status} onClick={() => setTableFilter(status)}>
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
              {snapshot.tables
                .filter((table) => tableFilter === "Todas" || table.status === tableFilter)
                .map((table) => (
                  <article
                    className={`pdv-table-card ${table.status.toLowerCase()} ${table.items.some((item) => item.subtableName) ? "has-subtables" : ""} ${table.items.some((item) => item.subtableName) && table.items.some((item) => !item.subtableName) ? "mixed-subtables" : ""}`}
                    key={table.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTable(table)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTableMenu({ x: event.clientX, y: event.clientY, table });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTable(table);
                      }
                    }}
                  >
                    <strong>{String(table.number).padStart(3, "0")}</strong>
                    <span>{table.status}</span>
                    <small>Abertura: {shortTime(table.openedAt) || "-"}</small>
                    {snapshot.settings.tablePeopleEnabled && <small>Pessoas: {table.people || "-"}</small>}
                    {table.note && <small className="pdv-table-note" title={table.note}>Obs.: {table.note}</small>}
                    <b>{table.total ? money(table.total) : "Vr Total:"}</b>
                  </article>
                ))}
              <button className="pdv-table-card pdv-quick-value-card" type="button" onClick={() => setQuickValueModalOpen(true)}>
                <strong>+</strong>
                <span>Avulso</span>
                <small>Registrar valor sem produto</small>
              </button>
            </div>
            {tableMenu && (
              <ContextMenu x={tableMenu.x} y={tableMenu.y} onClose={() => setTableMenu(null)}>
                <button onClick={() => runTableAction("open", tableMenu.table)}>Abrir mesa</button>
                <button onClick={() => runTableAction("reserve", tableMenu.table)}>Reservar mesa</button>
                <button onClick={() => runTableAction("free", tableMenu.table)}>Cancelar reserva/liberar</button>
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
            subtitle={`Aberta ${shortTime(activeTable.openedAt) || "agora"}${snapshot.settings.tablePeopleEnabled ? ` | ${activeTable.people || 1} pessoa(s)` : ""} | ${tableSaveState === "saving" ? "salvando..." : tableSaveState === "saved" ? "salvo" : tableSaveState === "error" ? "erro ao salvar" : "autosave ativo"}`}
            snapshot={snapshot}
            products={products}
            activeCategory={activeCategory}
            query={query}
            quantity={quantity}
            cart={tableCart}
            discount={0}
            busy={busy}
            setActiveCategory={setActiveCategory}
            setQuery={setQuery}
            setQuantity={setQuantity}
            addProduct={addProduct}
            setCart={setTableCart}
            setDiscount={() => undefined}
            finishLabel="Fechar conta"
            onFinish={requestCloseTable}
            tablePeople={tablePeople}
            tableNote={tableNote}
            activeTableNumber={activeTable.number}
            setTablePeople={setTablePeople}
            setTableNote={setTableNote}
            selectedItemIds={selectedTableItemIds}
            setSelectedItemIds={setSelectedTableItemIds}
            settings={visibleSettings}
            currentSubtable={currentSubtable}
            subtableNames={subtableNames}
            setSubtableNames={setSubtableNames}
            setCurrentSubtable={setCurrentSubtable}
            onCloseSubtable={requestCloseSubtable}
            onDeleteSubtable={deleteSubtable}
            onDeleteAllSubtables={deleteAllSubtables}
            onMoveSelectedToSubtable={moveSelectedItemsToSubtable}
            onRenameSubtable={renameSubtable}
            onOpenTransferredTable={async (tableNumber) => {
              const refreshed = await load();
              applyFreshOpenTable(refreshed, tableNumber);
            }}
            openPdvTable={openPdvTable}
            savePdvTableItems={savePdvTableItems}
            transferPdvTableItems={transferPdvTableItems}
          />
        )}

        {tab === "products" && <ProductsScreen snapshot={snapshot} readOnly={isRemoteClient} onImportCose={importPdvPreset} onRemoveCose={removePdvPreset} onImportFile={importFile} busy={busy} onProductsUpdated={load} updatePdvProducts={updatePdvProducts} savePdvCategory={savePdvCategory} savePdvProduct={savePdvProduct} />}
        {tab === "history" && <HistoryScreen snapshot={snapshot} readOnly={isRemoteClient} onChanged={load} />}
        {tab === "reports" && <ReportsScreen snapshot={snapshot} />}
        {tab === "advanced" && <AdvancedScreen snapshot={snapshot} readOnly={isRemoteClient} clientVisualSettings={clientVisualSettings} onClientVisualSettingsChange={saveClientVisualSettings} onImportCose={importPdvPreset} onImportFile={importFile} busy={busy} onSettingsUpdated={load} savePdvSettings={savePdvSettings} />}
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
          title={checkoutTarget.kind === "direct" && checkoutTarget.manual ? "Receber valor avulso" : "Pagamento"}
          initialPayments={checkoutTarget.kind === "table" ? checkoutTarget.initialPayments || [] : []}
          showDescription={Boolean(checkoutTarget.kind !== "direct" && checkoutTarget.kind !== "table" && snapshot.settings.partialPaymentDescriptionEnabled)}
          onCancel={() => {
            if (checkoutTarget.kind === "table-partial-items") {
              // Restaurar seleÃ§Ã£o anterior ao voltar do pagamento
              setPartialSelectedItemIds(checkoutTarget.items.map((i) => i.id));
              setCheckoutTarget(null);
              setPartialItemsModalOpen(true);
            } else {
              setCheckoutTarget(null);
            }
          }}
          onConfirm={(payments, observations) => {
            if (checkoutTarget.kind === "direct") {
              return confirmDirectSale(payments, checkoutTarget.items || cart);
            } else if (checkoutTarget.kind === "table") {
              return confirmCloseTable(payments);
            } else {
              return confirmPartialTable(checkoutTarget, payments, observations);
            }
          }}
        />
      )}
      {tableCloseMenuOpen && activeTable && (
        <TableCloseMenu
          table={activeTable}
          subtotal={tableTotal}
          roundingStep={remoteSession?.roundingStep ?? roundingStep}
          roundingDirection={remoteSession?.roundingDirection ?? roundingDirection}
          onCancel={() => {
            setTableCloseMenuOpen(false);
            void setPdvTableStatus(activeTable.number, "Ocupada");
            setActiveTable((current) => current ? { ...current, status: "Ocupada" } : current);
          }}
          onPartialItems={() => {
            setTableCloseMenuOpen(false);
            setPartialItemsModalOpen(true);
          }}
          onCloseTotal={(total, discount, initialPayments) => {
            setTableCloseMenuOpen(false);
            setCheckoutTarget({ kind: "table", table: activeTable, total, discount, initialPayments });
          }}
        />
      )}
      {partialItemsModalOpen && activeTable && (
        <PartialItemsModal
          table={activeTable}
          cart={tableCart}
          defaultSelectedIds={partialSelectedItemIds}
          onSelectedIdsChange={setPartialSelectedItemIds}
          onResetPaidItems={resetPaidItemStates}
          onCancel={() => setPartialItemsModalOpen(false)}
          onConfirm={(items) => {
            setPartialItemsModalOpen(false);
            requestPartialByItems(items);
          }}
        />
      )}
      {partialValueModalOpen && activeTable && (
        <PartialValueModal
          table={activeTable}
          maxValue={tableTotal}
          onCancel={() => setPartialValueModalOpen(false)}
          onConfirm={(value) => requestPartialByValue(value)}
        />
      )}
      {quickValueModalOpen && (
        <QuickValueModal
          onCancel={() => setQuickValueModalOpen(false)}
          onConfirm={(item) => {
            setQuickValueModalOpen(false);
            setCheckoutTarget({ kind: "direct", total: item.total, items: [item], manual: true });
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
    </div>
  );
}

function PdvSaleScreen(props: {
  title: string;
  subtitle?: string;
  snapshot: PdvSnapshot;
  products: PdvProduct[];
  activeCategory: string;
  query: string;
  quantity: number;
  cart: PdvCartItem[];
  discount: number;
  busy: boolean;
  finishLabel: string;
  setActiveCategory: (value: string) => void;
  setQuery: (value: string) => void;
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
  currentSubtable?: string;
  subtableNames?: string[];
  setCurrentSubtable?: (value: string) => void;
  setSubtableNames?: (value: string[] | ((current: string[]) => string[])) => void;
  onCloseSubtable?: (name: string) => void;
  onDeleteSubtable?: (name: string) => void;
  onDeleteAllSubtables?: () => void;
  onMoveSelectedToSubtable?: (name: string) => void;
  onRenameSubtable?: (oldName: string, newName: string) => void;
  onOpenTransferredTable?: (tableNumber: number) => void | Promise<void>;
  openPdvTable?: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  savePdvTableItems?: (tableNumber: number, items: PdvCartItem[], subtables?: string[]) => Promise<void>;
  transferPdvTableItems?: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
}) {
  const subtotal = roundMoney(props.cart.reduce((total, item) => total + (props.activeTableNumber ? unpaidItemTotal(item) : item.total), 0));
  const finalTotal = Math.max(0, roundMoney(subtotal - props.discount));
  const cartListRef = useRef<HTMLDivElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: PdvCartItem } | null>(null);
  const [transferItem, setTransferItem] = useState<PdvCartItem | null>(null);
  const [transferListOpen, setTransferListOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{ item: PdvCartItem; mode: "quantity" | "discount" | "price" | "note" } | null>(null);
  const [movingItem, setMovingItem] = useState<{ item: PdvCartItem; after: boolean } | null>(null);
  const [removeRequest, setRemoveRequest] = useState<PdvCartItem | null>(null);
  const [cancelTableRequest, setCancelTableRequest] = useState(false);
  const [subtableManagerOpen, setSubtableManagerOpen] = useState(false);
  const [directDiscountOpen, setDirectDiscountOpen] = useState(false);
  const [cartDensity, setCartDensity] = useState<"compact" | "normal" | "comfortable">(() => {
    const saved = window.localStorage.getItem("caixa.pdv.cart-density");
    return saved === "compact" || saved === "comfortable" ? saved : "normal";
  });
  const activeItemId = props.selectedItemIds?.[0] || props.cart.at(-1)?.id || "";
  const activeItem = props.cart.find((item) => item.id === activeItemId) || props.cart.at(-1) || null;
  const subtableNames = [...new Set([...(props.subtableNames || []), ...props.cart.map((item) => item.subtableName || "").filter(Boolean)])];

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (itemMenu) { event.preventDefault(); setItemMenu(null); return; }
      if (transferItem) { event.preventDefault(); setTransferItem(null); return; }
      if (transferListOpen) { event.preventDefault(); setTransferListOpen(false); return; }
      if (editingItem) { event.preventDefault(); setEditingItem(null); return; }
      if (movingItem) { event.preventDefault(); setMovingItem(null); return; }
      if (directDiscountOpen) { event.preventDefault(); setDirectDiscountOpen(false); return; }
      if (subtableManagerOpen) { event.preventDefault(); setSubtableManagerOpen(false); }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [itemMenu, transferItem, transferListOpen, editingItem, movingItem, directDiscountOpen, subtableManagerOpen]);

  useEffect(() => {
    window.localStorage.setItem("caixa.pdv.cart-density", cartDensity);
  }, [cartDensity]);

  useEffect(() => {
    if (!props.setSelectedItemIds || !props.cart.length) {
      return;
    }
    const selectedId = props.selectedItemIds?.[0];
    const stillExists = selectedId && props.cart.some((item) => item.id === selectedId);
    if (!stillExists || selectedId !== props.cart.at(-1)?.id) {
      props.setSelectedItemIds([props.cart[props.cart.length - 1].id]);
    }
  }, [props.cart.length, props.cart.at(-1)?.id]);

  useEffect(() => {
    if (!activeItemId || !cartListRef.current) return;
    const item = cartListRef.current.querySelector<HTMLElement>(`[data-cart-item-id="${activeItemId}"]`);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeItemId, props.cart.length]);

  const selectCartItemByDirection = (direction: -1 | 1) => {
    if (!props.setSelectedItemIds || !props.cart.length) {
      return;
    }
    const currentId = activeItemId || props.cart[props.cart.length - 1].id;
    const currentIndex = Math.max(0, props.cart.findIndex((item) => item.id === currentId));
    const nextIndex = Math.max(0, Math.min(props.cart.length - 1, currentIndex + direction));
    props.setSelectedItemIds([props.cart[nextIndex].id]);
  };

  const repeatLastItem = () => {
    const last = props.cart[props.cart.length - 1];
    if (!last) {
      return;
    }
    props.setCart((current) => mergeCartItem(current, { ...last, id: crypto.randomUUID(), quantity: 1, measureLabel: "", total: roundMoney(last.unitPrice) }, props.snapshot.settings.stackIdenticalItems));
  };
  const runItemAction = async (action: string, item: PdvCartItem) => {
    setItemMenu(null);
    if (action === "quantity") {
      setEditingItem({ item, mode: "quantity" });
    }
    if (action === "discount-value") {
      setEditingItem({ item, mode: "discount" });
    }
    if (action === "discount-percent") {
      setEditingItem({ item, mode: "discount" });
    }
    if (action === "price") {
      setEditingItem({ item, mode: "price" });
    }
    if (action === "note") {
      setEditingItem({ item, mode: "note" });
    }
    if (action === "remove") {
      setRemoveRequest(item);
    }
    if (action === "up") {
      props.setCart((current) => moveCartItem(current, item.id, -1));
    }
    if (action === "down") {
      props.setCart((current) => moveCartItem(current, item.id, 1));
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
    <section className={`pdv-sale-grid ${props.activeTableNumber ? "pdv-table-open-grid" : ""}`}>
      <div className="pdv-panel pdv-products-area">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Lancamento rapido</span>
            <h1>{props.title}</h1>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <div className={`pdv-quantity-box ${props.activeTableNumber && props.settings.subtablesEnabled ? "has-subtable" : ""}`}>
            <span>Qtde</span>
            <button onClick={() => props.setQuantity(Math.max(1, props.quantity - 1))}><Minus size={18} /></button>
            <input type="number" min={1} value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value || 1))} />
            <button onClick={() => props.setQuantity(props.quantity + 1)}><Plus size={18} /></button>
            <button title="Limpar quantidade" onClick={() => props.setQuantity(1)}>Limpar</button>
            <button title="Repetir ultimo produto" disabled={!props.cart.length} onClick={repeatLastItem}>Repetir</button>
            {props.activeTableNumber && props.settings.subtablesEnabled && (
              <button className="pdv-subtable-trigger" type="button" onClick={() => setSubtableManagerOpen(true)}>
                Submesa: {props.currentSubtable || "Principal"}
              </button>
            )}
          </div>
        </div>

        <div className="pdv-search">
          <Search size={18} />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Pesquisar produto pelo nome" />
        </div>

        <div
          className="pdv-category-grid"
          style={{
            "--pdv-category-cols": props.snapshot.settings.categoryColumns || 5,
            "--pdv-category-card-height": `${props.snapshot.settings.categoryCardHeight || 64}px`
          } as React.CSSProperties}
        >
          <button className={props.activeCategory === "todos" ? "active" : ""} onClick={() => props.setActiveCategory("todos")}>Todos</button>
          {props.snapshot.categories.filter((category) => category.active).map((category) => (
            <button className={props.activeCategory === category.id ? "active" : ""} key={category.id} onClick={() => props.setActiveCategory(category.id)}>
              {category.name}
            </button>
          ))}
        </div>
        <div
          className="pdv-product-grid"
          style={{
            "--pdv-grid-cols": props.snapshot.settings.gridColumns || 5,
            "--pdv-product-card-height": `${props.snapshot.settings.productCardHeight || 74}px`
          } as React.CSSProperties}
        >
          {props.products.map((product) => (
            <button key={product.id} onClick={(event) => props.addProduct(product, event.shiftKey)}>
              <strong>{product.name}</strong>
              <span>{props.activeCategory === "todos" ? `${product.categoryName} | ` : ""}{money(product.price)}{product.unitMode === "kg" ? "/kg" : product.unitMode === "grama" ? "/g" : ""}</span>
            </button>
          ))}
          {!props.products.length && <div className="pdv-empty">Importe produtos ou ajuste a pesquisa.</div>}
        </div>
      </div>

      <aside className={`pdv-panel pdv-cart-area cart-${cartDensity}`}>
        <div className="pdv-cart-head">
          <h2>Carrinho</h2>
          <div className="pdv-cart-density" aria-label="Tamanho dos itens do carrinho">
            <button type="button" title="Diminuir itens do carrinho" aria-label="Diminuir itens do carrinho" disabled={cartDensity === "compact"} onClick={() => setCartDensity((current) => current === "comfortable" ? "normal" : "compact")}><Minus size={15} /></button>
            <button type="button" title="Aumentar itens do carrinho" aria-label="Aumentar itens do carrinho" disabled={cartDensity === "comfortable"} onClick={() => setCartDensity((current) => current === "compact" ? "normal" : "comfortable")}><Plus size={15} /></button>
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
          {props.cart.map((item, index) => (
            <article
              key={item.id}
              data-cart-item-id={item.id}
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
                <span>{item.measureLabel || item.quantity} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}{item.note ? ` | ${item.note}` : ""}{unpaidQuantity(item) <= 0.009 ? " | Pago" : item.paidQuantity ? ` | Restam ${unpaidQuantity(item)}` : ""}</span>
              </div>
              <b>{money(props.activeTableNumber ? unpaidItemTotal(item) : item.total)}</b>
            </article>
          ))}
          {!props.cart.length && <div className="pdv-empty">Nenhum produto lancado.</div>}
        </div>
        {itemMenu && (
          <ContextMenu x={itemMenu.x} y={itemMenu.y} onClose={() => setItemMenu(null)}>
            <button onClick={() => runItemAction("quantity", itemMenu.item)}>Alterar quantidade</button>
            <button onClick={() => runItemAction("discount-value", itemMenu.item)}>Desconto em R$</button>
            <button onClick={() => runItemAction("discount-percent", itemMenu.item)}>Desconto em %</button>
            <button onClick={() => runItemAction("price", itemMenu.item)}>Alterar preco neste lancamento</button>
            <button onClick={() => runItemAction("note", itemMenu.item)}>Adicionar observacao</button>
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
                const selected = props.cart.find((row) => row.id === props.selectedItemIds?.[0]) || props.cart[props.cart.length - 1];
                if (selected) {
                  setEditingItem({ item: selected, mode: "note" });
                }
              }}
              disabled={!props.cart.length}
            >
              Observacao
            </button>
            <button
              className="pdv-ghost-button"
              disabled={!props.cart.length}
              onClick={() => setTransferListOpen(true)}
            >
              Transferir
            </button>
          </div>
        )}
        {!props.activeTableNumber && (
<div className="pdv-action-row">
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
            <button className="pdv-primary-button" disabled={props.busy || !props.cart.some((item) => unpaidQuantity(item) > 0.009)} onClick={props.onFinish}>
              Fechar conta
            </button>
          </div>
        )}
        {transferListOpen && props.activeTableNumber && (
          <TransferListModal
            cart={props.cart}
            tables={props.snapshot.tables}
            sourceTableNumber={props.activeTableNumber}
            openPdvTable={props.openPdvTable}
            savePdvTableItems={props.savePdvTableItems}
            transferPdvTableItems={props.transferPdvTableItems}
            onCancel={() => setTransferListOpen(false)}
            onTransferred={(nextSource, targetTableNumber) => {
              props.setCart(nextSource);
              props.setSelectedItemIds?.(nextSource.at(-1) ? [nextSource.at(-1)!.id] : []);
              setTransferListOpen(false);
              void props.onOpenTransferredTable?.(targetTableNumber);
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
              props.setSubtableNames?.((current) => current.includes(name) ? current : [...current, name]);
              setSubtableManagerOpen(false);
            }}
            onRename={props.onRenameSubtable}
            onDelete={props.onDeleteSubtable}
            onCloseSubtable={props.onCloseSubtable}
            onDeleteAll={props.onDeleteAllSubtables}
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
            onTransferred={(nextSource, targetTableNumber) => {
              props.setCart(nextSource);
              props.setSelectedItemIds?.([]);
              setTransferItem(null);
              void props.onOpenTransferredTable?.(targetTableNumber);
            }}
          />
        )}
        {editingItem && (
          <ItemEditModal
            item={editingItem.item}
            mode={editingItem.mode}
            onCancel={() => setEditingItem(null)}
            onConfirm={(patch) => {
              props.setCart((current) => updateCartItem(current, editingItem.item.id, patch));
              setEditingItem(null);
            }}
          />
        )}
        {removeRequest && (
          <PdvConfirmModal
            title="Remover produto da conta?"
            message={`${removeRequest.productName} sera removido desta conta.`}
            onCancel={() => setRemoveRequest(null)}
            onConfirm={() => {
              const fallback = props.cart.filter((row) => row.id !== removeRequest.id).at(-1);
              props.setCart((current) => current.filter((row) => row.id !== removeRequest.id));
              props.setSelectedItemIds?.(fallback ? [fallback.id] : []);
              setRemoveRequest(null);
            }}
          />
        )}
        {cancelTableRequest && (
          <CancelItemsModal
            isTable={Boolean(props.activeTableNumber)}
            cart={props.cart}
            onCancel={() => setCancelTableRequest(false)}
            onClear={() => {
              props.setCart([]);
              props.setSelectedItemIds?.([]);
              setCancelTableRequest(false);
            }}
            onRemove={(item) => {
              const fallback = props.cart.filter((row) => row.id !== item.id).at(-1);
              props.setCart((current) => current.filter((row) => row.id !== item.id));
              props.setSelectedItemIds?.(fallback ? [fallback.id] : []);
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
              props.setCart((current) => moveCartItemNear(current, movingItem.item.id, referenceIndex, movingItem.after));
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
  onDeleteAll
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
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-subtable-manager-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Mesa dividida</span>
            <h1>Submesas</h1>
            <p>Escolha a conta que vai receber os proximos produtos.</p>
          </div>
          <button className="pdv-icon-button" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pdv-subtable-create">
          <input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} placeholder="Nome da nova submesa" />
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
                {onCloseSubtable && <button type="button" className="pdv-ghost-button" onClick={() => { onCloseSubtable(name); onClose(); }}>Fechar</button>}
                {onDelete && <button type="button" className="pdv-danger-button" onClick={() => { onDelete(name); onClose(); }}>Apagar</button>}
              </div>
              {renameTarget === name && (
                <div className="pdv-subtable-rename">
                  <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
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

function PaymentModal({
  total,
  busy,
  initialPayments = [],
  showDescription = false,
  title = "Pagamento",
  confirmLabel = "Finalizar conta",
  onCancel,
  onConfirm
}: {
  total: number;
  busy: boolean;
  initialPayments?: PdvPayment[];
  showDescription?: boolean;
  title?: string;
  confirmLabel?: string;
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
    if (submitting || busy) {
      return;
    }
    if (payments.length > 0 && remaining > 0.009) {
      setNotice("Ainda existe valor restante para fechar a conta.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setSubmitting(true);
    try {
      const resolvedPayments = payments.length ? payments : [{ id: crypto.randomUUID(), method: "Nao definido" as const, amount: total }];
      await onConfirm(resolvedPayments.map((payment) => ({ ...payment, description: observations.trim() || payment.description })), observations);
    } catch (error) {
      setSubmitting(false);
      throw error;
    }
  };

  const handleReceiveKeyDown = (event: React.KeyboardEvent) => {
    const paymentShortcut: Record<string, PdvPaymentMethod> = {
      F1: "Dinheiro",
      F2: "Debito",
      F3: "Credito",
      F4: "Pix",
      F5: "Outros",
      F6: "Nao definido"
    };
    if (!paymentEntryMethod && paymentShortcut[event.key]) {
      event.preventDefault();
      openPaymentMethod(paymentShortcut[event.key]);
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
      if (!submitting && !busy && !(payments.length > 0 && remaining > 0.009)) {
        event.preventDefault();
        void finish();
      }
    }
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-receive-modal" onKeyDown={handleReceiveKeyDown} tabIndex={-1}>
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
          {PAYMENT_METHODS.map((item) => (
            <button key={item} disabled={remaining <= 0.009} onClick={() => openPaymentMethod(item)}>
              {item}
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
          {!payments.length && <p className="pdv-empty">Nenhum pagamento adicionado. Se finalizar assim, entra como Nao definido.</p>}
        </div>
        {showDescription && (
          <label className="pdv-payment-description">
            <span>Descricao opcional do pagamento parcial</span>
            <input value={observations} maxLength={120} onChange={(event) => setObservations(event.target.value)} placeholder="Ex.: Pessoa 1 ou Joao" />
          </label>
        )}
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-primary-button" disabled={busy || submitting || (payments.length > 0 && remaining > 0.009)} onClick={finish}>
            {busy || submitting ? "Salvando..." : confirmLabel}
          </button>
        </div>
        {paymentEntryMethod && (
          <PaymentAmountModal
            key={`${paymentEntryMethod}-${remaining}`}
            method={paymentEntryMethod}
            remaining={roundMoney(remaining + (editingPayment?.amount || 0))}
            initialPayment={editingPayment || undefined}
            onCancel={() => { setPaymentEntryMethod(null); setEditingPayment(null); }}
            onConfirm={addPayment}
          />
        )}
        {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
        {confirming && (
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

function PaymentAmountModal({
  method,
  remaining,
  initialPayment,
  onCancel,
  onConfirm
}: {
  method: PdvPaymentMethod;
  remaining: number;
  initialPayment?: PdvPayment;
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
    setAmountTouched(true);
    setAmountText(next);
    if (method === "Dinheiro" && !receivedTouched) {
      setReceivedText(next);
    }
  };

  const updateReceived = (value: string) => {
    const next = normalizeNumericText(value);
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

  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-payment-amount-modal" onKeyDown={handleKeyDown} tabIndex={-1}>
        <div className="pdv-window-title">
          <strong>Informar pagamento</strong>
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
                  <span>Valor recebido do cliente</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    value={receivedText}
                    onFocus={() => setActiveField("received")}
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
                  onFocus={() => setActiveField("amount")}
                  onChange={(event) => updateAmount(event.target.value)}
                />
              </label>
            )}

            <div className="pdv-calculated-price">
              <span>{method === "Dinheiro" ? "Troco" : "Valor registrado"}</span>
              <strong>{method === "Dinheiro" ? money(change) : money(amount)}</strong>
              <small>{method === "Dinheiro" ? `${money(amount)} registrado na conta` : "Nao pode ultrapassar o restante"}</small>
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

function QuickValueModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (item: PdvCartItem) => void }) {
  const [valueText, setValueText] = useState("");
  const [mode, setMode] = useState("Venda avulsa");
  const [description, setDescription] = useState("Venda avulsa");
  const value = Math.max(0, parseBrazilianNumber(valueText));
  const confirm = () => {
    if (value <= 0) return;
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
      note: `${mode} pelo mapa de mesas`
    });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") { event.preventDefault(); confirm(); }
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
            <select value={mode} onChange={(event) => { const nextMode = event.target.value; setMode(nextMode); setDescription((current) => current === mode ? nextMode : current); }}>
              <option>Venda avulsa</option>
              <option>Onibus</option>
              <option>Ajuste de valor</option>
            </select>
          </label>
          <label><span>Descricao</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Onibus ou ajuste" /></label>
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
            <input autoFocus value={valueText} onChange={(event) => setValueText(event.target.value)} />
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
  onCancel,
  onConfirm
}: {
  item: PdvCartItem;
  mode: "quantity" | "discount" | "price" | "note";
  onCancel: () => void;
  onConfirm: (patch: Partial<Pick<PdvCartItem, "quantity" | "discount" | "note" | "unitPrice">>) => void;
}) {
  const [quantityText, setQuantityText] = useState(String(item.quantity).replace(".", ","));
  const [discountValueText, setDiscountValueText] = useState(String(item.discount || 0).replace(".", ","));
  const [discountPercentText, setDiscountPercentText] = useState("");
  const [priceText, setPriceText] = useState(String(item.unitPrice).replace(".", ","));
  const [note, setNote] = useState(item.note || "");
  const gross = roundMoney(item.quantity * item.unitPrice);
  const discountByValue = Math.max(0, parseBrazilianNumber(discountValueText));
  const discountByPercent = roundMoney(gross * (Math.max(0, parseBrazilianNumber(discountPercentText)) / 100));
  const previewDiscount = Math.min(gross, roundMoney(discountByValue + discountByPercent));
  const previewTotal = Math.max(0, roundMoney(gross - previewDiscount));

  const confirm = () => {
    if (mode === "quantity") {
      onConfirm({ quantity: Math.max(0.01, parseBrazilianNumber(quantityText)) });
      return;
    }
    if (mode === "discount") {
      onConfirm({ discount: previewDiscount });
      return;
    }
    if (mode === "price") {
      onConfirm({ unitPrice: Math.max(0, parseBrazilianNumber(priceText)) });
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
                <input autoFocus inputMode="decimal" value={discountValueText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDiscountValueText(event.target.value)} />
              </label>
              <label>
                <span>Desconto em %</span>
                <input inputMode="decimal" value={discountPercentText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDiscountPercentText(event.target.value)} placeholder="0" />
              </label>
            </>
          )}
          {mode === "price" && (
            <label>
              <span>Preco apenas neste lancamento</span>
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
          <Metric title="Quantidade" value={String(item.quantity).replace(".", ",")} />
          <Metric title="Unitario" value={money(item.unitPrice)} />
          <Metric title="Total final" value={money(mode === "discount" ? previewTotal : item.total)} />
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
  onCancel,
  onTransferred
}: {
  cart: PdvCartItem[];
  tables: PdvOpenTable[];
  sourceTableNumber: number;
  openPdvTable?: (tableNumber: number, people?: number, note?: string) => Promise<void>;
  savePdvTableItems?: (tableNumber: number, items: PdvCartItem[]) => Promise<void>;
  transferPdvTableItems?: (sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]) => Promise<PdvCartItem[]>;
  onCancel: () => void;
  onTransferred: (nextSource: PdvCartItem[], targetTableNumber: number) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(cart.map((item) => [item.id, String(unpaidQuantity(item)).replace(".", ",")])));
  const [targetTableNumber, setTargetTableNumber] = useState(sourceTableNumber);
  const [targetSubtable, setTargetSubtable] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedItems = cart.filter((item) => selectedIds.includes(item.id));
  const selectedTotal = roundMoney(selectedItems.reduce((total, item) => total + transferQuantity(item, quantities[item.id]) * item.unitPrice, 0));
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
    if (targetTableNumber === sourceTableNumber && !targetSubtable.trim()) {
      setNotice("Escolha outra mesa ou informe uma submesa destino.");
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
      onTransferred(nextSource, targetTableNumber);
    } catch (error) {
      setBusy(false);
      throw error;
    }
  };

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
            <select value={targetTableNumber} onChange={(event) => setTargetTableNumber(Number(event.target.value))}>
              {tables.map((table) => (
                <option key={table.number} value={table.number}>Mesa {String(table.number).padStart(3, "0")} - {table.status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Submesa destino</span>
            <input list="pdv-transfer-list-subtables" value={targetSubtable} onChange={(event) => setTargetSubtable(event.target.value)} placeholder="Vazio = mesa principal" />
            <datalist id="pdv-transfer-list-subtables">
              {existingSubtables.map((name) => <option key={name} value={name} />)}
            </datalist>
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
              <small>{item.measureLabel || item.quantity} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}</small>
              <label className="pdv-transfer-qty" onClick={(event) => event.stopPropagation()}>
                Qtde
                <input value={quantities[item.id] ?? String(item.quantity).replace(".", ",")} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
              </label>
              <strong>{money(roundMoney(transferQuantity(item, quantities[item.id]) * item.unitPrice))}</strong>
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
  defaultSelectedIds,
  onSelectedIdsChange,
  onResetPaidItems,
  onCancel,
  onConfirm
}: {
  table: PdvOpenTable;
  cart: PdvCartItem[];
  defaultSelectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onResetPaidItems: (ids?: string[], selectAfter?: boolean) => void;
  onCancel: () => void;
  onConfirm: (items: PdvCartItem[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultSelectedIds.filter((id) => cart.some((item) => item.id === id && unpaidQuantity(item) > 0.009)));
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(cart.map((item) => [item.id, String(item.quantity).replace(".", ",")])));

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel]);
  
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
      total: roundMoney(Math.max(0, item.unitPrice * q - item.discount * ratio)),
      paidQuantity: 0
    };
  });
  
  const selectedTotal = roundMoney(selectedItems.reduce((total, item) => total + item.total, 0));
  const remainingTotal = roundMoney(cart.reduce((total, item) => total + unpaidItemTotal(item), 0) - selectedTotal);
  
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
          <Metric title="Itens escolhidos" value={String(selectedItems.length)} />
        </div>
        <div className="pdv-transfer-list">
          {cart.map((item, index) => {
            const isSelected = selectedIds.includes(item.id);
            const remainingQuantity = unpaidQuantity(item);
            const isPaid = remainingQuantity <= 0.009;
            const qVal = quantities[item.id] ?? String(remainingQuantity).replace(".", ",");
            const parsedQ = parseBrazilianNumber(qVal);
            const currentItemTotal = isSelected ? roundMoney(parsedQ * item.unitPrice) : unpaidItemTotal(item);
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
                <small>{item.measureLabel || item.quantity} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}{isPaid ? " | Pago" : item.paidQuantity ? ` | Restam ${remainingQuantity}` : ""}</small>
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
          <button className="pdv-primary-button" disabled={!selectedItems.length} onClick={() => onConfirm(selectedItems)}>Fechar parcial</button>
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
  onTransferred: (nextSource: PdvCartItem[], targetTableNumber: number) => void;
}) {
  const [targetTableNumber, setTargetTableNumber] = useState(sourceTableNumber);
  const [targetSubtable, setTargetSubtable] = useState(item.subtableName || "");
  const [quantityText, setQuantityText] = useState(String(item.quantity).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const targetTable = tables.find((table) => table.number === targetTableNumber);
  const existingSubtables = [...new Set([...(targetTable?.subtables || []), ...(targetTable?.items.map((row) => row.subtableName || "").filter(Boolean) || [])])];
  const quantity = Math.min(item.quantity, Math.max(0.01, parseBrazilianNumber(quantityText)));

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
      onTransferred(nextSource, targetTableNumber);
    } catch (error) {
      setBusy(false);
      throw error;
    }
  };

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
            <select value={targetTableNumber} onChange={(event) => setTargetTableNumber(Number(event.target.value))}>
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
            <input list="pdv-transfer-subtables" value={targetSubtable} onChange={(event) => setTargetSubtable(event.target.value)} placeholder="Vazio = mesa principal" />
            <datalist id="pdv-transfer-subtables">
              {existingSubtables.map((name) => <option key={name} value={name} />)}
            </datalist>
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
  onConfirm: (resolved: { quantity: number; measureLabel?: string; unitPrice?: number }) => void;
}) {
  const isKg = product.unitMode === "kg";
  const isGram = product.unitMode === "grama";
  const [activeField, setActiveField] = useState<"quantity" | "value">(isKg ? "value" : "quantity");
  const [quantityText, setQuantityText] = useState(isKg ? "1000" : String(defaultQuantity || 1).replace(".", ","));
  const [valueText, setValueText] = useState(isKg ? money(roundMoney(product.price * 1.0)).replace("R$", "").trim() : String(product.price || 0).replace(".", ","));
  const [notice, setNotice] = useState("");
  const rawQuantity = Math.max(0, parseBrazilianNumber(quantityText));
  const typedValue = Math.max(0, parseBrazilianNumber(valueText));
  const saleQuantity = isKg
    ? (activeField === "value" && product.price > 0 ? typedValue / product.price : rawQuantity / 1000)
    : isGram
      ? rawQuantity
      : rawQuantity;
  const finalPrice = isKg ? roundMoney(saleQuantity * product.price) : roundMoney(typedValue * Math.max(0, saleQuantity));
  const unitPrice = isKg || isGram ? product.price : typedValue;
  const shownGrams = isKg ? roundMoney(saleQuantity * 1000) : rawQuantity;
  const unitLabel = isKg ? "g" : product.unit || "UNID";
  const append = (value: string) => {
    if (activeField === "value") {
      setValueText((current) => (current === "0" ? value : `${current}${value}`));
      return;
    }
    setQuantityText((current) => (current === "0" ? value : `${current}${value}`));
  };
  const erase = () => {
    if (activeField === "value") {
      setValueText((current) => current.slice(0, -1) || "0");
      return;
    }
    setQuantityText((current) => current.slice(0, -1) || "0");
  };
  const onQuantityChange = (value: string) => {
    setActiveField("quantity");
    setQuantityText(value);
    if (isKg) {
      const grams = Math.max(0, parseBrazilianNumber(value));
      setValueText(String(roundMoney((grams / 1000) * product.price)).replace(".", ","));
    }
  };
  const onValueChange = (value: string) => {
    setActiveField("value");
    setValueText(value);
    if (isKg && product.price > 0) {
      const total = Math.max(0, parseBrazilianNumber(value));
      setQuantityText(String(roundMoney((total / product.price) * 1000)).replace(".", ","));
    }
  };
  const confirm = () => {
    if (saleQuantity <= 0 || finalPrice <= 0) {
      setNotice("Informe quantidade e valor maiores que zero.");
      return;
    }
    onConfirm({
      quantity: saleQuantity,
      measureLabel: `${isKg ? shownGrams : rawQuantity} ${unitLabel}`,
      unitPrice
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

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-quantity-modal" tabIndex={-1} autoFocus onKeyDown={handleKeyDown}>
        <div className="pdv-window-title">
          <strong>Informe a Quantidade</strong>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-quantity-product">{product.name}</div>
        <div className="pdv-quantity-body">
          <div className="pdv-question-mark">?</div>
          <div className="pdv-quantity-fields">
            <label>
              <span>{isKg ? "Peso em gramas" : "Informe a Quantidade"} <b>{unitLabel}</b></span>
              <div className="pdv-inline-stepper">
                <input autoFocus={!isKg} inputMode="decimal" value={quantityText} onFocus={(event) => { setActiveField("quantity"); event.currentTarget.select(); }} onChange={(event) => onQuantityChange(event.target.value)} />
                <button onClick={() => onQuantityChange(String(Math.max(0, rawQuantity - 1)).replace(".", ","))}>-</button>
                <button onClick={() => onQuantityChange(String(rawQuantity + 1).replace(".", ","))}>+</button>
              </div>
            </label>
            <label>
              <span>{isKg ? "Valor final desejado" : "Valor unitario"}</span>
              <input autoFocus={isKg} inputMode="decimal" value={valueText} onFocus={(event) => { setActiveField("value"); event.currentTarget.select(); }} onChange={(event) => onValueChange(event.target.value)} />
            </label>
            {isKg && <p className="pdv-helper-note">Edite o peso para calcular o valor, ou edite o valor para calcular o peso automaticamente.</p>}
            <div className="pdv-calculated-price">
              <span>Final do item</span>
              <strong>{money(finalPrice)}</strong>
              <small>{isKg ? `${shownGrams} g a ${money(product.price)}/kg` : `${money(unitPrice)} por ${product.unit || product.unitMode}`}</small>
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
      <section className="pdv-modal pdv-direct-discount-modal" tabIndex={-1} autoFocus onKeyDown={handleKeyDown}>
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
  roundingStep: configuredRoundingStep,
  roundingDirection: configuredRoundingDirection,
  onCancel,
  onPartialItems,
  onCloseTotal
}: {
  table: PdvOpenTable;
  subtotal: number;
  roundingStep?: number;
  roundingDirection?: RoundDirection;
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

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-close-menu" tabIndex={-1} autoFocus onKeyDown={handleKeyDown}>
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechar conta</span>
            <h1>Mesa {String(table.number).padStart(3, "0")}</h1>
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
            <input value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0,00" />
          </label>
          <label>
            <span>Desconto em %</span>
            <input value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} placeholder="0" />
          </label>
        </div>
        <div className="pdv-close-split">
          <div>
            <strong>Dividir por pessoas</strong>
            <span>Aproximacao: {String(roundingStep).replace(".", ",")} / {roundingDirection}</span>
          </div>
          <div className="pdv-inline-stepper">
            <input type="number" min={1} value={people} onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))} />
            <button onClick={() => setPeople((current) => Math.max(1, current - 1))}>-</button>
            <button onClick={() => setPeople((current) => current + 1)}>+</button>
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

function ProductsScreen({ snapshot, readOnly = false, onImportCose, onRemoveCose, onImportFile, busy, onProductsUpdated, updatePdvProducts, savePdvCategory, savePdvProduct }: { snapshot: PdvSnapshot; readOnly?: boolean; onImportCose: () => void; onRemoveCose: () => Promise<number>; onImportFile: () => void; busy: boolean; onProductsUpdated: () => void; updatePdvProducts: (ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => Promise<void>; savePdvCategory: (draft: PdvCategoryDraft) => Promise<PdvCategory>; savePdvProduct: (draft: PdvProductDraft) => Promise<PdvProduct> }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState(snapshot.categories[0]?.id || "");
  const [filterCategoryId, setFilterCategoryId] = useState("todos");
  const [productQuery, setProductQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<PdvProduct | "new" | null>(null);
  const [editingCategory, setEditingCategory] = useState<PdvCategory | "new" | null>(null);
  const [removeCoseConfirm, setRemoveCoseConfirm] = useState(false);
  const filteredProducts = snapshot.products.filter((product) => {
    const categoryMatch = filterCategoryId === "todos" || product.categoryId === filterCategoryId;
    const queryMatch = !productQuery.trim() || product.name.toLocaleLowerCase("pt-BR").includes(productQuery.trim().toLocaleLowerCase("pt-BR"));
    return categoryMatch && queryMatch;
  });
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
  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Cadastro simples</span>
          <h1>Produtos e categorias</h1>
          <p>{snapshot.products.length} produtos em {snapshot.categories.length} categorias.</p>
        </div>
        <div className="pdv-action-row">
          {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditingCategory("new")}>Nova categoria</button>}
          {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditingProduct("new")}>Novo produto</button>}
          {!readOnly && <button className="pdv-ghost-button" disabled={busy} onClick={onImportFile}><FileSpreadsheet size={18} /> Importar arquivo</button>}
          {!readOnly && <button className="pdv-primary-button" disabled={busy} onClick={onImportCose}><Download size={18} /> Importar Cose Dell Abadia</button>}
          {!readOnly && <button className="pdv-danger-button" disabled={busy || !snapshot.products.some((product) => product.importSource === "Cose Dell Abadia")} onClick={() => setRemoveCoseConfirm(true)}>Remover importacao Cose</button>}
        </div>
      </div>
      <div className="pdv-category-manager">
        {snapshot.categories.map((category) => (
          <button key={category.id} className={category.active ? "" : "inactive"} disabled={readOnly} onClick={() => setEditingCategory(category)}>
            {category.favorite ? "[Fav] " : ""}{category.name} <small>{category.active ? "ativa" : "oculta"} | {category.favorite ? "favorita | " : ""}ordem {category.sortOrder}</small>
          </button>
        ))}
      </div>
      {!readOnly && <div className="pdv-bulk-toolbar">
        <strong>{selectedIds.length} selecionado(s)</strong>
        <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Pesquisar produto" />
        <select value={filterCategoryId} onChange={(event) => setFilterCategoryId(event.target.value)}>
          <option value="todos">Todas categorias</option>
          {snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={targetCategoryId} onChange={(event) => setTargetCategoryId(event.target.value)}>
          {snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="pdv-ghost-button" disabled={!filteredProducts.length} onClick={() => setSelectedIds(filteredProducts.map((product) => product.id))}>Selecionar visiveis</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Limpar selecao</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ categoryId: targetCategoryId })}>Mover categoria</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ canBeComplement: true })}>Usar como complemento</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ canBeComplement: false })}>Nao complemento</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ hasComplements: true })}>Abrir adicionais</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ hasComplements: false })}>Nao abrir adicionais</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ favorite: true })}>Favoritar</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ favorite: false })}>Tirar favorito</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ showOnPdv: true })}>Exibir no PDV</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ showOnPdv: false })}>Ocultar do PDV</button>
      </div>}
      <div className="pdv-product-table">
        {filteredProducts.map((product) => (
          <article key={product.id} className={product.active ? "" : "inactive"}>
            {!readOnly && <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} />}
            <strong>{product.favorite ? "[Fav] " : ""}{product.name}</strong>
            <span>{product.categoryName}</span>
            <span>{product.unitMode === "kg" ? "Kg" : product.unitMode === "grama" ? "Grama" : "Unidade"}</span>
            <b>{money(product.price)}</b>
            <small>{product.active ? "Ativo" : "Inativo"} | {product.showOnPdv ? "PDV" : "Oculto"} {product.favorite ? " | Favorito" : ""}{product.canBeComplement ? " | Complemento" : ""}{product.complementProductIds.length ? ` | ${product.complementProductIds.length} adicionais` : ""}{product.importSource ? ` | ${product.importSource}` : ""}</small>
            {!readOnly && <button className="pdv-ghost-button" onClick={() => setEditingProduct(product)}>Editar</button>}
          </article>
        ))}
        {!filteredProducts.length && <div className="pdv-empty">Nenhum produto encontrado nesse filtro.</div>}
      </div>
      {editingProduct && (
        <ProductEditorModal
          product={editingProduct === "new" ? null : editingProduct}
          categories={snapshot.categories}
          products={snapshot.products}
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
    </section>
  );
}

function ProductEditorModal({ product, categories, products, onCancel, onSave }: { product: PdvProduct | null; categories: PdvCategory[]; products: PdvProduct[]; onCancel: () => void; onSave: (draft: PdvProductDraft) => void }) {
  const [draft, setDraft] = useState<PdvProductDraft>({
    id: product?.id,
    name: product?.name || "",
    categoryId: product?.categoryId || categories[0]?.id || "",
    price: product?.price || 0,
    unit: product?.unit || "UNID",
    unitMode: product?.unitMode || "unidade",
    active: product?.active ?? true,
    showOnPdv: product?.showOnPdv ?? true,
    favorite: product?.favorite ?? false,
    canBeComplement: product?.canBeComplement ?? false,
    hasComplements: product?.hasComplements ?? false,
    complementProductIds: product?.complementProductIds || [],
    sortOrder: product?.sortOrder || 0
  });
  const [priceText, setPriceText] = useState(product ? String(product.price).replace(".", ",") : "");
  const complementOptions = products.filter((item) => item.id !== product?.id && item.canBeComplement);
  const saveDraft = () => onSave({ ...draft, price: roundMoney(parseBrazilianNumber(priceText || String(draft.price))) });
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-editor-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Cadastro</span>
            <h1>{product ? "Editar produto" : "Novo produto"}</h1>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label><span>Nome</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label><span>Categoria</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label><span>Preco venda</span><input inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} placeholder="Ex.: 4,50" /></label>
          <label>
            <span>Tipo de venda</span>
            <select value={draft.unitMode} onChange={(event) => {
              const unitMode = event.target.value as PdvProductDraft["unitMode"];
              setDraft({ ...draft, unitMode, unit: unitMode === "kg" ? "KG" : unitMode === "grama" ? "G" : "UNID" });
            }}>
              <option value="unidade">Unidade</option>
              <option value="kg">Kg</option>
              <option value="grama">Grama</option>
            </select>
          </label>
          <label><span>Ordem</span><input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value || 0) })} /></label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Ativo</label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.showOnPdv} onChange={(event) => setDraft({ ...draft, showOnPdv: event.target.checked })} /> Exibir no PDV</label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.favorite} onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })} /> Favorito no topo</label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.canBeComplement} onChange={(event) => setDraft({ ...draft, canBeComplement: event.target.checked })} /> Pode ser adicional</label>
          <label className="pdv-switch-line"><input type="checkbox" checked={draft.hasComplements} onChange={(event) => setDraft({ ...draft, hasComplements: event.target.checked })} /> Abre tela de adicionais</label>
        </div>
        <div className="pdv-complement-config">
          <strong>Adicionais permitidos neste produto</strong>
          <small>Somente produtos marcados como "Pode ser adicional" aparecem aqui.</small>
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
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={!draft.name.trim() || !draft.categoryId} onClick={saveDraft}>Salvar produto</button>
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
          <label><span>Ordem</span><input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value || 0) })} /></label>
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
  onCancel,
  onClear,
  onRemove
}: {
  isTable: boolean;
  cart: PdvCartItem[];
  onCancel: () => void;
  onClear: () => void;
  onRemove: (item: PdvCartItem) => void;
}) {
  const [selectedId, setSelectedId] = useState(cart[0]?.id || "");
  const selected = cart.find((item) => item.id === selectedId) || null;
  return (
    <div className="pdv-modal-backdrop pdv-nested-backdrop">
      <section className="pdv-payment-modal pdv-confirm-modal pdv-cancel-items-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Cancelar</span>
            <h1>{isTable ? "O que deseja cancelar?" : "Limpar carrinho?"}</h1>
            <p>{isTable ? "Cancele a mesa inteira ou remova somente um item da conta." : "Todos os itens do carrinho serao removidos."}</p>
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
          <button className="pdv-primary-button" onClick={onClear}>{isTable ? "Cancelar mesa inteira" : "Limpar carrinho"}</button>
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
  onConfirm
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
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
          <button className="pdv-primary-button" onClick={onConfirm}><Check size={16} /> Confirmar</button>
        </div>
      </section>
    </div>
  );
}

function HistoryScreen({ snapshot, readOnly = false, onChanged }: { snapshot: PdvSnapshot; readOnly?: boolean; onChanged: () => void }) {
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    query: "",
    type: "Todos",
    payment: "Todos",
    status: "Todos",
    table: "",
    origin: "Todos"
  });
  const [selectedSale, setSelectedSale] = useState<PdvSale | null>(null);
  const [saleMenu, setSaleMenu] = useState<{ x: number; y: number; sale: PdvSale } | null>(null);
  const [editingPaymentsSale, setEditingPaymentsSale] = useState<PdvSale | null>(null);
  const [cancelRequest, setCancelRequest] = useState<PdvSale | null>(null);
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
    if (action === "cancel" && sale.status !== "Cancelada") {
      await cancelSale(sale);
    }
    if (action === "payments" && sale.status !== "Cancelada") {
      setEditingPaymentsSale(sale);
    }
  };

  const updateSalePayments = async (sale: PdvSale, payments: PdvPayment[]) => {
    await window.caixa.updatePdvSalePayments(sale.id, payments);
    setEditingPaymentsSale(null);
    setSelectedSale(null);
    onChanged();
  };

  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Auditoria</span>
          <h1>Historico detalhado</h1>
        </div>
      </div>
      <div className="pdv-history-filters">
        <label><span>De</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label><span>Ate</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label><span>Busca</span><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Produto, mesa, pagamento..." /></label>
        <label><span>Tipo</span><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option>Todos</option><option>Venda direta</option><option>Mesa</option></select></label>
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
            <span>{sale.payments.map((payment) => `${payment.method}: ${money(payment.amount)}`).join(" + ")}</span>
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
          {!readOnly && saleMenu.sale.status !== "Cancelada" && <button onClick={() => runSaleAction("payments", saleMenu.sale)}>Alterar forma de pagamento</button>}
          {!readOnly && saleMenu.sale.status !== "Cancelada" && <button className="danger" onClick={() => runSaleAction("cancel", saleMenu.sale)}>Cancelar/estornar</button>}
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
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
      {!readOnly && editingPaymentsSale && (
        <PaymentModal
          total={editingPaymentsSale.total}
          busy={false}
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
  const today = localDateInputValue();
  const [filters, setFilters] = useState<PdvExportFilters>({ from: today, to: today, payment: "Todos", type: "Todos", status: "Finalizada", table: "" });
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const sales = filterSales(snapshot.recentSales, { ...filters, query: "" });
  const total = sales.reduce((sum, sale) => sum + sale.total, 0);
  const byPayment = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byHour = new Map<string, number>();
  const discounts = sales.reduce((sum, sale) => sum + sale.discount + sale.items.reduce((itemSum, item) => itemSum + item.discount, 0), 0);
  sales.forEach((sale) => {
    sale.payments.forEach((payment) => byPayment.set(payment.method, (byPayment.get(payment.method) || 0) + payment.amount));
    sale.items.forEach((item) => {
      byProduct.set(item.productName, (byProduct.get(item.productName) || 0) + item.quantity);
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
        <label><span>Tipo</span><select value={filters.type || "Todos"} onChange={(event) => setFilters({ ...filters, type: event.target.value as PdvExportFilters["type"] })}><option>Todos</option><option>Venda direta</option><option>Mesa</option></select></label>
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
        <Metric title="Parciais" value={String(sales.filter((sale) => sale.status === "Parcial").length)} />
      </div>
      <div className="pdv-report-columns">
        <ReportList title="Por pagamento" rows={[...byPayment.entries()]} format={money} />
        <ReportList title="Produtos mais vendidos" rows={[...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)} format={(value) => `${value} un.`} />
        <ReportList title="Categorias" rows={[...byCategory.entries()].sort((a, b) => b[1] - a[1])} format={money} />
        <ReportList title="Horarios de pico" rows={[...byHour.entries()].sort((a, b) => a[0].localeCompare(b[0]))} format={money} />
      </div>
      {notice && <PdvNoticeModal message={notice} onClose={() => setNotice("")} />}
    </section>
  );
}

function ClientVisualSettingsScreen({ snapshot, settings, onChange }: { snapshot: PdvSnapshot; settings: Partial<PdvClientVisualSettings>; onChange: (patch: Partial<PdvClientVisualSettings>) => void }) {
  const visible = { ...snapshot.settings, ...settings };
  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Cliente conectado</span>
          <h1>Ajustes deste computador</h1>
          <p>As regras do PDV acompanham o servidor. Aqui voce altera somente o tamanho e a distribuicao visual desta tela.</p>
        </div>
      </div>
      <div className="pdv-advanced-grid">
        <article>
          <LayoutGrid size={22} />
          <strong>Grade e tamanho local</strong>
          <label className="pdv-setting-line">
            <span>Produtos por linha</span>
            <select value={visible.gridColumns || 5} onChange={(event) => onChange({ gridColumns: Number(event.target.value) })}>
              {[4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} produtos por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Categorias por linha</span>
            <select value={visible.categoryColumns || 5} onChange={(event) => onChange({ categoryColumns: Number(event.target.value) })}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} categorias por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Mesas por linha</span>
            <select value={visible.tableColumns || 9} onChange={(event) => onChange({ tableColumns: Number(event.target.value) })}>
              {[5, 6, 7, 8, 9, 10, 11, 12].map((value) => <option key={value} value={value}>{value} mesas por linha</option>)}
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Altura dos produtos</span>
            <input type="number" min={56} max={110} value={visible.productCardHeight || 74} onChange={(event) => onChange({ productCardHeight: Number(event.target.value || 74) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das categorias</span>
            <input type="number" min={44} max={90} value={visible.categoryCardHeight || 64} onChange={(event) => onChange({ categoryCardHeight: Number(event.target.value || 64) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das mesas</span>
            <input type="number" min={74} max={130} value={visible.tableCardHeight || 96} onChange={(event) => onChange({ tableCardHeight: Number(event.target.value || 96) })} />
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

function AdvancedScreen({ snapshot, readOnly = false, clientVisualSettings = {}, onClientVisualSettingsChange, onImportCose, onImportFile, busy, onSettingsUpdated, savePdvSettings }: { snapshot: PdvSnapshot; readOnly?: boolean; clientVisualSettings?: Partial<PdvClientVisualSettings>; onClientVisualSettingsChange?: (patch: Partial<PdvClientVisualSettings>) => void; onImportCose: () => void; onImportFile: () => void; busy: boolean; onSettingsUpdated: () => void; savePdvSettings: (patch: Partial<PdvSettings>) => Promise<PdvSettings> }) {
  const saveSetting = async (patch: Partial<PdvSnapshot["settings"]>) => {
    await savePdvSettings(patch);
    onSettingsUpdated();
  };
  if (readOnly) {
    return <ClientVisualSettingsScreen snapshot={snapshot} settings={clientVisualSettings} onChange={(patch) => onClientVisualSettingsChange?.(patch)} />;
  }
  return (
    <section className="pdv-panel">
      <div className="pdv-section-head">
        <div>
          <span className="pdv-eyebrow">Base nova</span>
          <h1>Avancado</h1>
          <p>Banco principal do PDV: {snapshot.dataFile}</p>
        </div>
      </div>
      <div className="pdv-advanced-grid">
        <article>
          <Settings size={22} />
          <strong>Preset Cose Dell Abadia</strong>
          <span>Perfil nativo do app para mesas, complementos e importacao de produtos da Cose Dell Abadia.</span>
          <small>Preset ativo: {snapshot.settings.activePreset}</small>
        </article>
        <article>
          <Utensils size={22} />
          <strong>Mesas e submesas</strong>
          <label className="pdv-setting-line">
            <span>Quantidade de mesas</span>
            <input type="number" min={1} max={300} value={snapshot.settings.tableCount} onChange={(event) => saveSetting({ tableCount: Number(event.target.value || 47) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Grid de produtos</span>
            <select value={snapshot.settings.gridColumns || 5} onChange={(event) => saveSetting({ gridColumns: Number(event.target.value) })}>
              <option value={4}>4 produtos por linha</option>
              <option value={5}>5 produtos por linha</option>
              <option value={6}>6 produtos por linha</option>
              <option value={7}>7 produtos por linha</option>
              <option value={8}>8 produtos por linha</option>
              <option value={9}>9 produtos por linha</option>
              <option value={10}>10 produtos por linha</option>
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Grid de categorias</span>
            <select value={snapshot.settings.categoryColumns || 5} onChange={(event) => saveSetting({ categoryColumns: Number(event.target.value) })}>
              <option value={3}>3 categorias por linha</option>
              <option value={4}>4 categorias por linha</option>
              <option value={5}>5 categorias por linha</option>
              <option value={6}>6 categorias por linha</option>
              <option value={7}>7 categorias por linha</option>
              <option value={8}>8 categorias por linha</option>
              <option value={9}>9 categorias por linha</option>
              <option value={10}>10 categorias por linha</option>
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Ordem dos produtos</span>
            <select value={snapshot.settings.productSortDirection || "az"} onChange={(event) => saveSetting({ productSortDirection: event.target.value as "az" | "za" })}>
              <option value="az">A a Z</option>
              <option value="za">Z a A</option>
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Grid de mesas</span>
            <select value={snapshot.settings.tableColumns || 9} onChange={(event) => saveSetting({ tableColumns: Number(event.target.value) })}>
              <option value={5}>5 mesas por linha</option>
              <option value={6}>6 mesas por linha</option>
              <option value={7}>7 mesas por linha</option>
              <option value={8}>8 mesas por linha</option>
              <option value={9}>9 mesas por linha</option>
              <option value={10}>10 mesas por linha</option>
              <option value={11}>11 mesas por linha</option>
              <option value={12}>12 mesas por linha</option>
            </select>
          </label>
          <label className="pdv-setting-line">
            <span>Altura dos produtos</span>
            <input type="number" min={56} max={110} value={snapshot.settings.productCardHeight || 74} onChange={(event) => saveSetting({ productCardHeight: Number(event.target.value || 74) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das categorias</span>
            <input type="number" min={44} max={90} value={snapshot.settings.categoryCardHeight || 64} onChange={(event) => saveSetting({ categoryCardHeight: Number(event.target.value || 64) })} />
          </label>
          <label className="pdv-setting-line">
            <span>Altura das mesas</span>
            <input type="number" min={74} max={130} value={snapshot.settings.tableCardHeight || 96} onChange={(event) => saveSetting({ tableCardHeight: Number(event.target.value || 96) })} />
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(snapshot.settings.stackIdenticalItems)} onChange={(event) => saveSetting({ stackIdenticalItems: event.target.checked })} />
            Juntar produtos iguais no carrinho
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(snapshot.settings.individualUnitItems)} onChange={(event) => saveSetting({ individualUnitItems: event.target.checked })} />
            Exibir cada unidade individualmente
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={snapshot.settings.subtablesEnabled} onChange={(event) => saveSetting({ subtablesEnabled: event.target.checked })} />
            Ativar submesas/contas separadas
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={snapshot.settings.tablePeopleEnabled} onChange={(event) => saveSetting({ tablePeopleEnabled: event.target.checked })} />
            Perguntar quantidade de pessoas ao abrir mesa
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(snapshot.settings.allowOfflineTables)} onChange={(event) => saveSetting({ allowOfflineTables: event.target.checked })} />
            Permitir mesas offline no cliente
          </label>
        </article>
        <article>
          <Plus size={22} />
          <strong>Complementos e adicionais</strong>
          <span>Quando ativo, produtos configurados podem abrir tela de adicionais. Shift+clique lanca direto.</span>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={snapshot.settings.complementsEnabled} onChange={(event) => saveSetting({ complementsEnabled: event.target.checked })} />
            Ativar complementos
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={snapshot.settings.groupComplementsWithProduct ?? true} onChange={(event) => saveSetting({ groupComplementsWithProduct: event.target.checked })} />
            Mostrar adicionais junto ao produto principal
          </label>
          <label className="pdv-switch-line">
            <input type="checkbox" checked={Boolean(snapshot.settings.partialPaymentDescriptionEnabled)} onChange={(event) => saveSetting({ partialPaymentDescriptionEnabled: event.target.checked })} />
            Solicitar descricao nos pagamentos parciais
          </label>
        </article>
        <article>
          <Banknote size={22} />
          <strong>Excel agora e importacao/exportacao</strong>
          <span>Produtos e vendas ficam no SQLite. Relatorios e exportacoes do PDV saem a partir deste banco.</span>
          <button className="pdv-ghost-button" type="button" onClick={() => window.caixa.openOutputDirectory()}>Abrir pasta dos Excel</button>
        </article>
        <article>
          <FileSpreadsheet size={22} />
          <strong>Importar produtos</strong>
          <span>Usa DESCRICAO, GRUPO, PRECO_VENDA, UNIDADE, ATIVO e EXIBE_PDV.</span>
          <button className="pdv-primary-button" disabled={busy} onClick={onImportCose}>Importar Cose Dell Abadia</button>
          <button className="pdv-ghost-button" disabled={busy} onClick={onImportFile}>Escolher outro XLSX</button>
        </article>
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

function SaleDetailModal({ sale, onClose, onCancel }: { sale: PdvSale; onClose: () => void; onCancel: () => void }) {
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-sale-detail-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Detalhes da venda</span>
            <h1>{sale.type}{sale.tableNumber ? ` ${String(sale.tableNumber).padStart(3, "0")}` : ""}</h1>
            <p>{new Date(sale.createdAt).toLocaleString("pt-BR")} | {sale.status}</p>
          </div>
          <button className="pdv-icon-button" onClick={onClose}><X size={18} /></button>
        </div>
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
                <span>{item.quantity} x {money(item.unitPrice)} | {item.categoryName}{item.subtableName ? ` | ${item.subtableName}` : ""}</span>
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
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" onClick={onClose}>Voltar</button>
          <button className="pdv-danger-button" disabled={sale.status === "Cancelada"} onClick={onCancel}>Cancelar venda</button>
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
  if (!stackIdenticalItems) {
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
    const quantity = roundMoney(item.quantity + incoming.quantity);
    return {
      ...item,
      quantity,
      total: roundMoney(quantity * item.unitPrice - item.discount)
    };
  });
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
  return Math.min(item.quantity, Math.max(0.01, parsed || item.quantity));
}
function splitCartItemForTransfer(item: PdvCartItem, quantity: number, subtableName: string): PdvCartItem {
  const ratio = item.quantity > 0 ? quantity / item.quantity : 1;
  const discount = roundMoney(item.discount * ratio);
  return {
    ...item,
    id: crypto.randomUUID(),
    quantity,
    subtableName,
    discount,
    total: Math.max(0, roundMoney(quantity * item.unitPrice - discount))
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
    const nextQuantity = roundMoney(item.quantity - quantity);
    if (nextQuantity <= 0.0001) {
      return [];
    }
    const ratio = item.quantity > 0 ? nextQuantity / item.quantity : 1;
    const discount = roundMoney(item.discount * ratio);
    return [{
      ...item,
      quantity: nextQuantity,
      discount,
      total: Math.max(0, roundMoney(nextQuantity * item.unitPrice - discount))
    }];
  });
}

function updateCartItem(items: PdvCartItem[], id: string, patch: Partial<Pick<PdvCartItem, "quantity" | "discount" | "note" | "unitPrice">>): PdvCartItem[] {
  return items.map((item) => {
    if (item.id !== id) {
      return item;
    }
    const quantity = patch.quantity ?? item.quantity;
    const discount = Math.max(0, patch.discount ?? item.discount);
    const unitPrice = patch.unitPrice ?? item.unitPrice;
    return {
      ...item,
      quantity,
      unitPrice,
      discount,
      note: patch.note ?? item.note,
      total: Math.max(0, roundMoney(quantity * unitPrice - discount))
    };
  });
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


