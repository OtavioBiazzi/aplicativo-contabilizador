import { useEffect, useMemo, useState } from "react";
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
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Utensils,
  Wallet,
  X
} from "lucide-react";
import type { PdvCartItem, PdvCategory, PdvCategoryDraft, PdvExportFilters, PdvOpenTable, PdvPayment, PdvPaymentMethod, PdvProduct, PdvProductDraft, PdvSale, PdvSnapshot, PdvTableStatus } from "./shared/pdvTypes";

type PdvTab = "sale" | "tables" | "products" | "history" | "reports" | "advanced";
type CheckoutTarget =
  | { kind: "direct"; total: number }
  | { kind: "table"; table: PdvOpenTable; total: number; discount: number; initialPayments?: PdvPayment[] }
  | { kind: "table-partial-items"; table: PdvOpenTable; total: number; items: PdvCartItem[] }
  | { kind: "table-partial-manual"; table: PdvOpenTable; total: number; items: PdvCartItem[] };

const PAYMENT_METHODS: PdvPaymentMethod[] = ["Dinheiro", "Debito", "Credito", "Pix", "Outros", "Nao definido"];
type PendingProduct = { product: PdvProduct; quantity: number; measureLabel?: string };

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

function parseLocalNumber(value: string): number {
  return Number(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function resolveProductQuantity(product: PdvProduct, defaultQuantity: number): { quantity: number; measureLabel?: string } | null {
  if (product.unitMode === "kg") {
    const raw = window.prompt(`Informe o peso em gramas para ${product.name}`, "250");
    if (raw === null) {
      return null;
    }
    const grams = parseLocalNumber(raw);
    if (grams <= 0) {
      window.alert("Informe um peso maior que zero.");
      return null;
    }
    return { quantity: grams / 1000, measureLabel: `${grams} g` };
  }
  if (product.unitMode === "grama") {
    const raw = window.prompt(`Informe a quantidade em gramas para ${product.name}`, "100");
    if (raw === null) {
      return null;
    }
    const grams = parseLocalNumber(raw);
    if (grams <= 0) {
      window.alert("Informe uma quantidade maior que zero.");
      return null;
    }
    return { quantity: grams, measureLabel: `${grams} g` };
  }
  return { quantity: defaultQuantity };
}

export function PdvApp({ embedded = false, initialTab = "sale", hideTopbar = false }: { embedded?: boolean; initialTab?: PdvTab; hideTopbar?: boolean }) {
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
  const [selectedTableItemIds, setSelectedTableItemIds] = useState<string[]>([]);
  const [partialManualValue, setPartialManualValue] = useState("");
  const [currentSubtable, setCurrentSubtable] = useState("");
  const [pendingProduct, setPendingProduct] = useState<PendingProduct | null>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; table: PdvOpenTable } | null>(null);
  const [openingTable, setOpeningTable] = useState<PdvOpenTable | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [tableCloseMenuOpen, setTableCloseMenuOpen] = useState(false);

  const load = async () => {
    setSnapshot(await window.caixa.getPdvSnapshot());
  };

  useEffect(() => {
    load();
    return window.caixa.onPdvChanged(load);
  }, []);

  useEffect(() => {
    setTab(initialTab);
    if (initialTab === "tables") {
      setActiveTable(null);
    }
  }, [initialTab]);

  const products = useMemo(() => {
    const items = snapshot?.products.filter((product) => product.active && product.showOnPdv) || [];
    return items.filter((product) => {
      const categoryMatch = activeCategory === "todos" || product.categoryId === activeCategory;
      const queryMatch = !query.trim() || product.name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
      return categoryMatch && queryMatch;
    });
  }, [activeCategory, query, snapshot?.products]);

  const saleTotal = useMemo(() => roundMoney(cart.reduce((total, item) => total + item.total, 0)), [cart]);
  const saleFinal = Math.max(0, roundMoney(saleTotal - discount));
  const tableTotal = useMemo(() => roundMoney(tableCart.reduce((total, item) => total + item.total, 0)), [tableCart]);

  const addProduct = (product: PdvProduct, direct = false) => {
    const resolvedQuantity = resolveProductQuantity(product, quantity);
    if (!resolvedQuantity) {
      return;
    }
    if (snapshot?.settings.complementsEnabled && (product.complementProductIds || []).length > 0 && !direct) {
      setPendingProduct({ product, ...resolvedQuantity });
      return;
    }
    const item = createCartItem(product, resolvedQuantity.quantity, [], undefined, activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "", resolvedQuantity.measureLabel);
    if (activeTable) {
      setTableCart((current) => mergeCartItem(current, item));
      return;
    }
    setCart((current) => mergeCartItem(current, item));
  };

  const finishDirectSale = () => {
    if (!cart.length) {
      setToast("Adicione ao menos um produto.");
      return;
    }
    setCheckoutTarget({ kind: "direct", total: saleFinal });
  };

  const confirmDirectSale = async (payments: PdvPayment[]) => {
    setBusy(true);
    try {
      await window.caixa.saveDirectSale(cart, discount, payments);
      setCart([]);
      setDiscount(0);
      setCheckoutTarget(null);
      setToast("Venda direta finalizada.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openTable = async (table: PdvOpenTable) => {
    if (table.status === "Livre") {
      setOpeningTable(table);
      return;
    }
    setActiveTable(table);
    setTableCart(table.items);
    setTablePeople(table.people || 1);
    setTableNote(table.note || "");
    setSelectedTableItemIds([]);
    setCurrentSubtable("");
  };

  const confirmOpenTable = async (table: PdvOpenTable, people: number, note: string) => {
    await window.caixa.openPdvTable(table.number, people, note);
    await load();
    const fresh = (await window.caixa.getPdvSnapshot()).tables.find((item) => item.number === table.number);
    if (fresh) {
      setActiveTable(fresh);
      setTableCart(fresh.items);
      setTablePeople(fresh.people || 1);
      setTableNote(fresh.note || "");
      setSelectedTableItemIds([]);
      setCurrentSubtable("");
    }
    setOpeningTable(null);
  };

  const runTableAction = async (action: string, table: PdvOpenTable) => {
    setTableMenu(null);
    if (action === "open") {
      await openTable(table);
      return;
    }
    if (action === "reserve") {
      await window.caixa.setPdvTableStatus(table.number, "Reservada");
      await load();
      return;
    }
    if (action === "free") {
      if (table.items.length && !window.confirm(`A mesa ${table.number} tem itens. Cancelar tudo e liberar?`)) {
        return;
      }
      await window.caixa.savePdvTableItems(table.number, []);
      await window.caixa.setPdvTableStatus(table.number, "Livre");
      await load();
      return;
    }
    if (action === "closing") {
      await window.caixa.setPdvTableStatus(table.number, "Fechamento");
      await load();
      return;
    }
    if (action === "details") {
      window.alert(`Mesa ${String(table.number).padStart(3, "0")}\nStatus: ${table.status}\nAbertura: ${shortTime(table.openedAt) || "-"}\nPessoas: ${table.people || "-"}\nTotal: ${money(table.total)}\nObservacao: ${table.note || "-"}`);
      return;
    }
    if (action === "history") {
      setTab("history");
      return;
    }
    if (action === "cancel" && window.confirm(`Cancelar a mesa ${String(table.number).padStart(3, "0")} e remover itens em aberto?`)) {
      await window.caixa.savePdvTableItems(table.number, []);
      await window.caixa.setPdvTableStatus(table.number, "Livre");
      await load();
    }
  };

  const addConfiguredProduct = (product: PdvProduct, unitPrice: number, complements: PdvCartItem["complements"]) => {
    const resolvedQuantity = pendingProduct?.product.id === product.id ? pendingProduct : { quantity, measureLabel: undefined };
    const item = createCartItem(product, resolvedQuantity.quantity, complements || [], unitPrice, activeTable && snapshot?.settings.subtablesEnabled ? currentSubtable : "", resolvedQuantity.measureLabel);
    if (activeTable) {
      setTableCart((current) => mergeCartItem(current, item));
    } else {
      setCart((current) => mergeCartItem(current, item));
    }
    setPendingProduct(null);
  };

  const saveTable = async () => {
    if (!activeTable) {
      return;
    }
    await window.caixa.openPdvTable(activeTable.number, tablePeople, tableNote);
    await window.caixa.savePdvTableItems(activeTable.number, tableCart);
    setToast(`Mesa ${String(activeTable.number).padStart(3, "0")} salva.`);
    await load();
  };

  const requestCloseTable = () => {
    if (!activeTable || !tableCart.length) {
      return;
    }
    setTableCloseMenuOpen(true);
  };

  const requestPartialByItems = () => {
    if (!activeTable) {
      return;
    }
    const selected = tableCart.filter((item) => selectedTableItemIds.includes(item.id));
    if (!selected.length) {
      setToast("Selecione itens da mesa para fechar parcial.");
      return;
    }
    setCheckoutTarget({ kind: "table-partial-items", table: activeTable, total: roundMoney(selected.reduce((total, item) => total + item.total, 0)), items: selected });
  };

  const requestCloseSubtable = (name: string) => {
    if (!activeTable) {
      return;
    }
    const selected = tableCart.filter((item) => (item.subtableName || "") === name);
    if (!selected.length) {
      setToast("Essa submesa nao tem itens para fechar.");
      return;
    }
    setCheckoutTarget({ kind: "table-partial-items", table: activeTable, total: roundMoney(selected.reduce((total, item) => total + item.total, 0)), items: selected });
  };

  const deleteSubtable = async (name: string) => {
    if (!activeTable || !name) {
      return;
    }
    if (!window.confirm(`Apagar a submesa "${name}" e cancelar seus itens?`)) {
      return;
    }
    const remainingItems = tableCart.filter((item) => (item.subtableName || "") !== name);
    setTableCart(remainingItems);
    setSelectedTableItemIds((current) => current.filter((id) => remainingItems.some((item) => item.id === id)));
    setCurrentSubtable("");
    await window.caixa.savePdvTableItems(activeTable.number, remainingItems);
    setToast(`Submesa ${name} apagada.`);
    await load();
  };

  const deleteAllSubtables = async () => {
    if (!activeTable) {
      return;
    }
    if (!window.confirm("Apagar todas as submesas e cancelar todos os itens delas? A mesa principal sera mantida.")) {
      return;
    }
    const remainingItems = tableCart.filter((item) => !item.subtableName);
    setTableCart(remainingItems);
    setSelectedTableItemIds([]);
    setCurrentSubtable("");
    await window.caixa.savePdvTableItems(activeTable.number, remainingItems);
    setToast("Todas as submesas foram apagadas.");
    await load();
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
    await window.caixa.savePdvTableItems(activeTable.number, movedItems);
    setToast(name ? `Itens movidos para ${name}.` : "Itens movidos para a mesa principal.");
    await load();
  };

  const renameSubtable = async (oldName: string, newName: string) => {
    const nextName = newName.trim();
    if (!activeTable || !oldName || !nextName || oldName === nextName) {
      return;
    }
    if (tableCart.some((item) => (item.subtableName || "") === nextName) && !window.confirm(`Ja existe uma submesa chamada "${nextName}". Juntar os itens nela?`)) {
      return;
    }
    const renamedItems = tableCart.map((item) => (item.subtableName || "") === oldName ? { ...item, subtableName: nextName } : item);
    setTableCart(renamedItems);
    setCurrentSubtable(nextName);
    await window.caixa.savePdvTableItems(activeTable.number, renamedItems);
    setToast(`Submesa ${oldName} renomeada para ${nextName}.`);
    await load();
  };

  const requestPartialByValue = () => {
    if (!activeTable) {
      return;
    }
    const value = parseBrazilianNumber(partialManualValue);
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
    setCheckoutTarget({ kind: "table-partial-manual", table: activeTable, total: manualItem.total, items: [manualItem] });
  };

  const confirmCloseTable = async (payments: PdvPayment[]) => {
    if (!activeTable) {
      return;
    }
    setBusy(true);
    try {
      await window.caixa.savePdvTableItems(activeTable.number, tableCart);
      const tableDiscount = checkoutTarget?.kind === "table" ? checkoutTarget.discount : 0;
      await window.caixa.closePdvTable(activeTable.number, payments, tableDiscount);
      setToast(`Mesa ${String(activeTable.number).padStart(3, "0")} fechada.`);
      setActiveTable(null);
      setTableCart([]);
      setCheckoutTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmPartialTable = async (target: Extract<CheckoutTarget, { kind: "table-partial-items" | "table-partial-manual" }>, payments: PdvPayment[]) => {
    setBusy(true);
    try {
      await window.caixa.savePdvTablePartial(target.table.number, target.items, payments, 0);
      if (target.kind === "table-partial-items") {
        const partialIds = new Set(target.items.map((item) => item.id));
        const remainingItems = tableCart.filter((item) => !partialIds.has(item.id));
        setTableCart(remainingItems);
        setSelectedTableItemIds([]);
        await window.caixa.savePdvTableItems(target.table.number, remainingItems);
      }
      setCheckoutTarget(null);
      setToast(target.kind === "table-partial-items" ? "Parcial por itens registrada." : "Parcial manual registrada.");
      await load();
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
            settings={snapshot.settings}
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
            <div className="pdv-table-grid">
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
                    <small>Pessoas: {table.people || "-"}</small>
                    <b>{table.total ? money(table.total) : "Vr Total:"}</b>
                  </article>
                ))}
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
            subtitle={`Aberta ${shortTime(activeTable.openedAt) || "agora"} | ${activeTable.people || 1} pessoa(s)`}
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
            finishLabel="Salvar mesa"
            onFinish={saveTable}
            tablePeople={tablePeople}
            tableNote={tableNote}
            activeTableNumber={activeTable.number}
            setTablePeople={setTablePeople}
            setTableNote={setTableNote}
            selectedItemIds={selectedTableItemIds}
            setSelectedItemIds={setSelectedTableItemIds}
            settings={snapshot.settings}
            currentSubtable={currentSubtable}
            setCurrentSubtable={setCurrentSubtable}
            onCloseSubtable={requestCloseSubtable}
            onDeleteSubtable={deleteSubtable}
            onDeleteAllSubtables={deleteAllSubtables}
            onMoveSelectedToSubtable={moveSelectedItemsToSubtable}
            onRenameSubtable={renameSubtable}
            extraActions={
              <>
                <button className="pdv-ghost-button" disabled={busy || !tableCart.length} onClick={requestCloseTable}>
                  <Wallet size={18} /> Fechar conta
                </button>
                <button className="pdv-ghost-button" disabled={busy || !tableCart.length} onClick={requestPartialByItems}>
                  <ReceiptText size={18} /> Parcial itens
                </button>
                <input
                  className="pdv-partial-input"
                  value={partialManualValue}
                  onChange={(event) => setPartialManualValue(event.target.value)}
                  placeholder="Valor parcial"
                />
                <button className="pdv-ghost-button" disabled={busy || !tableCart.length} onClick={requestPartialByValue}>
                  <Banknote size={18} /> Parcial valor
                </button>
                <button className="pdv-ghost-button" onClick={() => setActiveTable(null)}>Voltar</button>
              </>
            }
          />
        )}

        {tab === "products" && <ProductsScreen snapshot={snapshot} onImportCose={importCose} onImportFile={importFile} busy={busy} onProductsUpdated={load} />}
        {tab === "history" && <HistoryScreen snapshot={snapshot} onChanged={load} />}
        {tab === "reports" && <ReportsScreen snapshot={snapshot} />}
        {tab === "advanced" && <AdvancedScreen snapshot={snapshot} onImportCose={importCose} onImportFile={importFile} busy={busy} onSettingsUpdated={load} />}
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
          initialPayments={checkoutTarget.kind === "table" ? checkoutTarget.initialPayments || [] : []}
          onCancel={() => setCheckoutTarget(null)}
          onConfirm={(payments) => {
            if (checkoutTarget.kind === "direct") {
              return confirmDirectSale(payments);
            } else if (checkoutTarget.kind === "table") {
              return confirmCloseTable(payments);
            } else {
              return confirmPartialTable(checkoutTarget, payments);
            }
          }}
        />
      )}
      {tableCloseMenuOpen && activeTable && (
        <TableCloseMenu
          table={activeTable}
          subtotal={tableTotal}
          onCancel={() => setTableCloseMenuOpen(false)}
          onPartialItems={() => {
            setTableCloseMenuOpen(false);
            requestPartialByItems();
          }}
          onPartialManual={() => {
            setTableCloseMenuOpen(false);
            requestPartialByValue();
          }}
          onCloseTotal={(total, discount, initialPayments) => {
            setTableCloseMenuOpen(false);
            setCheckoutTarget({ kind: "table", table: activeTable, total, discount, initialPayments });
          }}
        />
      )}
      {pendingProduct && snapshot.settings.complementsEnabled && (
        <ComplementModal
          product={pendingProduct.product}
          quantity={pendingProduct.quantity}
          complements={snapshot.products.filter((product) => pendingProduct.product.complementProductIds.includes(product.id) && product.active && product.canBeComplement)}
          onCancel={() => setPendingProduct(null)}
          onConfirm={addConfiguredProduct}
        />
      )}
      {openingTable && (
        <OpenTableModal
          table={openingTable}
          onCancel={() => setOpeningTable(null)}
          onConfirm={confirmOpenTable}
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
  setCurrentSubtable?: (value: string) => void;
  onCloseSubtable?: (name: string) => void;
  onDeleteSubtable?: (name: string) => void;
  onDeleteAllSubtables?: () => void;
  onMoveSelectedToSubtable?: (name: string) => void;
  onRenameSubtable?: (oldName: string, newName: string) => void;
  extraActions?: React.ReactNode;
}) {
  const subtotal = roundMoney(props.cart.reduce((total, item) => total + item.total, 0));
  const finalTotal = Math.max(0, roundMoney(subtotal - props.discount));
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: PdvCartItem } | null>(null);
  const repeatLastItem = () => {
    const last = props.cart[props.cart.length - 1];
    if (!last) {
      return;
    }
    props.setCart((current) => mergeCartItem(current, { ...last, id: crypto.randomUUID(), quantity: 1, measureLabel: "", total: roundMoney(last.unitPrice) }));
  };
  const runItemAction = async (action: string, item: PdvCartItem) => {
    setItemMenu(null);
    if (action === "quantity") {
      const value = window.prompt("Nova quantidade", String(item.quantity).replace(".", ","));
      if (value !== null) {
        props.setCart((current) => updateCartItem(current, item.id, { quantity: Math.max(0.01, parseBrazilianNumber(value)) }));
      }
    }
    if (action === "discount-value") {
      const value = window.prompt("Desconto em reais", String(item.discount || 0).replace(".", ","));
      if (value !== null) {
        props.setCart((current) => updateCartItem(current, item.id, { discount: Math.max(0, parseBrazilianNumber(value)) }));
      }
    }
    if (action === "discount-percent") {
      const value = window.prompt("Desconto em porcentagem", "10");
      if (value !== null) {
        const percent = Math.max(0, parseBrazilianNumber(value));
        props.setCart((current) => updateCartItem(current, item.id, { discount: roundMoney(item.quantity * item.unitPrice * (percent / 100)) }));
      }
    }
    if (action === "price") {
      const value = window.prompt("Preco unitario apenas neste lancamento", String(item.unitPrice).replace(".", ","));
      if (value !== null) {
        props.setCart((current) => updateCartItem(current, item.id, { unitPrice: Math.max(0, parseBrazilianNumber(value)) }));
      }
    }
    if (action === "note") {
      const value = window.prompt("Observacao do item", item.note || "");
      if (value !== null) {
        props.setCart((current) => updateCartItem(current, item.id, { note: value }));
      }
    }
    if (action === "remove" && window.confirm(`Remover ${item.productName}?`)) {
      props.setCart((current) => current.filter((row) => row.id !== item.id));
      props.setSelectedItemIds?.((current) => current.filter((id) => id !== item.id));
    }
    if (action === "up") {
      props.setCart((current) => moveCartItem(current, item.id, -1));
    }
    if (action === "down") {
      props.setCart((current) => moveCartItem(current, item.id, 1));
    }
    if (action === "before" || action === "after") {
      const value = window.prompt("Numero do item de referencia", "1");
      if (value !== null) {
        props.setCart((current) => moveCartItemNear(current, item.id, Math.max(0, Math.floor(Number(value) || 1) - 1), action === "after"));
      }
    }
    if (action === "transfer-table") {
      const tableValue = window.prompt("Transferir para qual mesa?", "");
      if (!tableValue) {
        return;
      }
      const tableNumber = Math.max(1, Math.floor(Number(tableValue.replace(/\D/g, "")) || 0));
      if (!tableNumber) {
        window.alert("Informe uma mesa valida.");
        return;
      }
      const quantityToTransfer = askTransferQuantity(item);
      if (!quantityToTransfer) {
        return;
      }
      const snapshot = await window.caixa.getPdvSnapshot();
      const target = snapshot.tables.find((table) => table.number === tableNumber);
      if (!target) {
        window.alert("Mesa nao encontrada.");
        return;
      }
      const transferItem = splitCartItemForTransfer(item, quantityToTransfer, "");
      await window.caixa.openPdvTable(tableNumber, target.people || 1, target.note || "");
      await window.caixa.savePdvTableItems(tableNumber, mergeCartItem(target.items, transferItem));
      const nextSource = subtractCartItemQuantity(props.cart, item.id, quantityToTransfer);
      props.setCart(nextSource);
      if (props.activeTableNumber) {
        await window.caixa.savePdvTableItems(props.activeTableNumber, nextSource);
      }
    }
    if (action === "transfer-subtable") {
      const name = window.prompt("Transferir para qual submesa/comanda? Deixe vazio para mesa principal.", item.subtableName || "");
      if (name === null) {
        return;
      }
      const quantityToTransfer = askTransferQuantity(item);
      if (!quantityToTransfer) {
        return;
      }
      const transferItem = splitCartItemForTransfer(item, quantityToTransfer, name.trim());
      const nextSource = mergeCartItem(subtractCartItemQuantity(props.cart, item.id, quantityToTransfer), transferItem);
      props.setCart(nextSource);
      if (props.activeTableNumber) {
        await window.caixa.savePdvTableItems(props.activeTableNumber, nextSource);
      }
    }
  };
  return (
    <section className="pdv-sale-grid">
      <div className="pdv-panel pdv-products-area">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Lancamento rapido</span>
            <h1>{props.title}</h1>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <div className="pdv-quantity-box">
            <span>Qtde</span>
            <button onClick={() => props.setQuantity(Math.max(1, props.quantity - 1))}><Minus size={18} /></button>
            <input type="number" min={1} value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value || 1))} />
            <button onClick={() => props.setQuantity(props.quantity + 1)}><Plus size={18} /></button>
            <button title="Limpar quantidade" onClick={() => props.setQuantity(1)}>Limpar</button>
            <button title="Repetir ultimo produto" disabled={!props.cart.length} onClick={repeatLastItem}>Repetir</button>
          </div>
        </div>

        {props.setTablePeople && props.setTableNote && (
          <div className="pdv-table-details">
            <label>
              <span>Pessoas</span>
              <input type="number" min={1} value={props.tablePeople || 1} onChange={(event) => props.setTablePeople?.(Number(event.target.value || 1))} />
            </label>
            <label>
              <span>Observacao da mesa</span>
              <input value={props.tableNote || ""} onChange={(event) => props.setTableNote?.(event.target.value)} placeholder="Ex.: aniversario, varanda, nome do cliente" />
            </label>
          </div>
        )}

        <div className="pdv-search">
          <Search size={18} />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Pesquisar produto pelo nome" />
        </div>

        <div className="pdv-category-grid">
          <button className={props.activeCategory === "todos" ? "active" : ""} onClick={() => props.setActiveCategory("todos")}>Todos</button>
          {props.snapshot.categories.filter((category) => category.active).map((category) => (
            <button className={props.activeCategory === category.id ? "active" : ""} key={category.id} onClick={() => props.setActiveCategory(category.id)}>
              {category.name}
            </button>
          ))}
        </div>

        <div className="pdv-product-grid">
          {props.products.map((product) => (
            <button key={product.id} onClick={(event) => props.addProduct(product, event.shiftKey)}>
              <strong>{product.name}</strong>
              <span>{money(product.price)}{product.unitMode === "kg" ? "/kg" : product.unitMode === "grama" ? "/g" : ""}</span>
            </button>
          ))}
          {!props.products.length && <div className="pdv-empty">Importe produtos ou ajuste a pesquisa.</div>}
        </div>
      </div>

      <aside className="pdv-panel pdv-cart-area">
        <div className="pdv-cart-head">
          <h2>Carrinho</h2>
          <button
            className="pdv-icon-button"
            onClick={() => {
              if (props.cart.length && window.confirm("Cancelar todos os itens do carrinho?")) {
                props.setCart([]);
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
        {props.settings.subtablesEnabled && props.setCurrentSubtable && (
          <SubtablePicker
            cart={props.cart}
            value={props.currentSubtable || ""}
            onChange={props.setCurrentSubtable}
            onCloseSubtable={props.onCloseSubtable}
            onDeleteSubtable={props.onDeleteSubtable}
            onDeleteAllSubtables={props.onDeleteAllSubtables}
            onMoveSelectedToSubtable={props.onMoveSelectedToSubtable}
            onRenameSubtable={props.onRenameSubtable}
          />
        )}
        <div className="pdv-cart-list">
          {props.cart.map((item, index) => (
            <article
              key={item.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setItemMenu({ x: event.clientX, y: event.clientY, item });
              }}
              onDoubleClick={() => runItemAction("remove", item)}
            >
              {props.setSelectedItemIds && (
                <input
                  className="pdv-item-check"
                  type="checkbox"
                  checked={Boolean(props.selectedItemIds?.includes(item.id))}
                  onChange={(event) =>
                    props.setSelectedItemIds?.((current) =>
                      event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)
                    )
                  }
                />
              )}
              <div>
                <strong>{index + 1}. {item.productName}</strong>
                <span>{item.measureLabel || item.quantity} x {money(item.unitPrice)}{item.subtableName ? ` | ${item.subtableName}` : ""}{item.note ? ` | ${item.note}` : ""}</span>
              </div>
              <b>{money(item.total)}</b>
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
        <label className="pdv-discount">
          <span>Desconto da conta</span>
          <input type="number" min={0} step="0.01" value={props.discount} onChange={(event) => props.setDiscount(Number(event.target.value || 0))} />
        </label>
        <div className="pdv-total-box">
          <span>Valor Total</span>
          <strong>{money(finalTotal)}</strong>
          <small>Subtotal {money(subtotal)}</small>
        </div>
        <div className="pdv-action-row">
          <button
            className="pdv-danger-button"
            onClick={() => {
              if (props.cart.length && window.confirm("Cancelar todos os itens?")) {
                props.setCart([]);
              }
            }}
          >
            Cancelar
          </button>
          <button className="pdv-primary-button" disabled={props.busy || !props.cart.length} onClick={props.onFinish}>
            {props.finishLabel}
          </button>
        </div>
        {props.extraActions && <div className="pdv-extra-actions">{props.extraActions}</div>}
      </aside>
    </section>
  );
}

function PaymentModal({
  total,
  busy,
  initialPayments = [],
  title = "Pagamento",
  confirmLabel = "Finalizar conta",
  onCancel,
  onConfirm
}: {
  total: number;
  busy: boolean;
  initialPayments?: PdvPayment[];
  title?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (payments: PdvPayment[]) => void | Promise<void>;
}) {
  const [payments, setPayments] = useState<PdvPayment[]>(initialPayments);
  const [method, setMethod] = useState<PdvPaymentMethod | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [splitPeople, setSplitPeople] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const remaining = Math.max(0, roundMoney(total - paid));
  const editingAmount = parseBrazilianNumber(paymentAmount || String(remaining || total));
  const editingReceived = method === "Dinheiro" ? parseBrazilianNumber(cashReceived || paymentAmount || String(editingAmount)) : editingAmount;
  const editingChange = method === "Dinheiro" ? Math.max(0, roundMoney(editingReceived - Math.min(editingAmount, remaining || total))) : 0;

  const openPaymentMethod = (selectedMethod: PdvPaymentMethod) => {
    const defaultAmount = String(remaining || total).replace(".", ",");
    setMethod(selectedMethod);
    setPaymentAmount(defaultAmount);
    setCashReceived(selectedMethod === "Dinheiro" ? defaultAmount : "");
  };

  const addPayment = (selectedMethod: PdvPaymentMethod) => {
    const defaultAmount = remaining || total;
    const requestedAmount = Math.min(defaultAmount, parseBrazilianNumber(paymentAmount || String(defaultAmount)));
    const received = selectedMethod === "Dinheiro" ? parseBrazilianNumber(cashReceived || paymentAmount || String(requestedAmount)) : requestedAmount;
    const amount = selectedMethod === "Dinheiro" ? Math.min(requestedAmount, received) : requestedAmount;
    const change = selectedMethod === "Dinheiro" ? Math.max(0, roundMoney(received - amount)) : 0;
    if (amount <= 0) {
      return;
    }
    setPayments((current) => [...current, { id: crypto.randomUUID(), method: selectedMethod, amount: roundMoney(amount), received, change }]);
    setPaymentAmount("");
    setCashReceived("");
    setMethod(null);
  };

  const finish = async () => {
    if (submitting || busy) {
      return;
    }
    if (payments.length > 0 && remaining > 0.009) {
      window.alert("Ainda existe valor restante para fechar a conta.");
      return;
    }
    if (!window.confirm(confirmLabel === "Finalizar conta" ? "Confirmar fechamento da conta?" : "Confirmar alteracao dos pagamentos?")) {
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(payments.length ? payments : [{ id: crypto.randomUUID(), method: "Nao definido", amount: total }]);
    } catch (error) {
      setSubmitting(false);
      throw error;
    }
  };

  const splitEqually = () => {
    setPayments(splitAmountIntoPayments(total, splitPeople));
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal">
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
            <button className={method === item ? "active" : ""} key={item} onClick={() => openPaymentMethod(item)}>
              {item}
            </button>
          ))}
        </div>
        {method && (
          <div className="pdv-payment-inputs pdv-payment-entry">
            <div className="pdv-entry-head">
              <strong>{method}</strong>
              <span>Restante {money(remaining)}</span>
            </div>
            <label>
              <span>Valor do pagamento</span>
              <input autoFocus value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder={String(remaining || total).replace(".", ",")} />
            </label>
            {method === "Dinheiro" && (
              <>
                <label>
                  <span>Valor recebido</span>
                  <input value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder={paymentAmount || String(remaining || total).replace(".", ",")} />
                </label>
                <Metric title="Troco" value={money(editingChange)} />
              </>
            )}
            <div className="pdv-action-row">
              <button className="pdv-ghost-button" onClick={() => setMethod(null)}>Cancelar metodo</button>
              <button className="pdv-primary-button" onClick={() => addPayment(method)}>Adicionar {method}</button>
            </div>
          </div>
        )}
        <div className="pdv-split-box">
          <label>
            <span>Dividir igualmente</span>
            <input type="number" min={1} value={splitPeople} onChange={(event) => setSplitPeople(Number(event.target.value || 1))} />
          </label>
          <button className="pdv-ghost-button" onClick={splitEqually}>Gerar divisao</button>
        </div>
        <div className="pdv-payment-list">
          {payments.map((payment) => (
            <article key={payment.id}>
              <strong>{payment.method}</strong>
              <span>{money(payment.amount)}{payment.change ? ` | Troco ${money(payment.change)}` : ""}</span>
              <button className="pdv-icon-button" onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}>
                <Trash2 size={16} />
              </button>
            </article>
          ))}
          {!payments.length && <p className="pdv-empty">Nenhum pagamento adicionado. Se finalizar assim, entra como Nao definido.</p>}
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-primary-button" disabled={busy || submitting || (payments.length > 0 && remaining > 0.009)} onClick={finish}>
            {busy || submitting ? "Salvando..." : confirmLabel}
          </button>
        </div>
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
        {value && <button className="pdv-ghost-button" onClick={() => {
          const next = window.prompt("Novo nome da submesa", value);
          if (next !== null) {
            onRenameSubtable?.(value, next);
          }
        }}>Renomear submesa</button>}
        {value && <button className="pdv-ghost-button" onClick={() => onCloseSubtable?.(value)}>Fechar submesa</button>}
        {value && <button className="pdv-danger-button" onClick={() => onDeleteSubtable?.(value)}>Apagar submesa</button>}
        {names.length > 0 && <button className="pdv-danger-button" onClick={onDeleteAllSubtables}>Apagar todas submesas</button>}
      </div>
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
  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-complement-modal">
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

function OpenTableModal({ table, onCancel, onConfirm }: { table: PdvOpenTable; onCancel: () => void; onConfirm: (table: PdvOpenTable, people: number, note: string) => void | Promise<void> }) {
  const [people, setPeople] = useState(table.people || 1);
  const [note, setNote] = useState(table.note || "");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm(table, Math.max(1, Math.floor(people || 1)), note.trim());
    } catch (error) {
      setBusy(false);
      throw error;
    }
  };

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-open-table-modal">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Abrir mesa</span>
            <h1>Mesa {String(table.number).padStart(3, "0")}</h1>
            <p>Informe apenas o que for util agora. Da para ajustar depois dentro da mesa.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-editor-grid">
          <label>
            <span>Quantidade de pessoas</span>
            <input autoFocus type="number" min={1} value={people} onChange={(event) => setPeople(Number(event.target.value || 1))} />
          </label>
          <label>
            <span>Observacao discreta</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: Joao, varanda, casal" />
          </label>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-danger-button" onClick={onCancel}>Cancelar</button>
          <button className="pdv-primary-button" disabled={busy} onClick={confirm}>{busy ? "Abrindo..." : "Abrir mesa"}</button>
        </div>
      </section>
    </div>
  );
}

function TableCloseMenu({
  table,
  subtotal,
  onCancel,
  onPartialItems,
  onPartialManual,
  onCloseTotal
}: {
  table: PdvOpenTable;
  subtotal: number;
  onCancel: () => void;
  onPartialItems: () => void;
  onPartialManual: () => void;
  onCloseTotal: (total: number, discount: number, initialPayments?: PdvPayment[]) => void;
}) {
  const [discountValue, setDiscountValue] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [people, setPeople] = useState(Math.max(1, table.people || 1));
  const discount = Math.min(subtotal, roundMoney(parseBrazilianNumber(discountValue) + subtotal * (parseBrazilianNumber(discountPercent) / 100)));
  const total = Math.max(0, roundMoney(subtotal - discount));
  const splitPreview = splitAmountIntoPayments(total, people);

  return (
    <div className="pdv-modal-backdrop">
      <section className="pdv-payment-modal pdv-close-menu">
        <div className="pdv-section-head">
          <div>
            <span className="pdv-eyebrow">Fechar conta</span>
            <h1>Mesa {String(table.number).padStart(3, "0")}</h1>
            <p>Escolha desconto, fechamento parcial ou fechamento total.</p>
          </div>
          <button className="pdv-icon-button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="pdv-payment-summary">
          <Metric title="Total bruto" value={money(subtotal)} />
          <Metric title="Desconto" value={money(discount)} />
          <Metric title="Total final" value={money(total)} />
        </div>
        <div className="pdv-editor-grid">
          <label>
            <span>Desconto em R$</span>
            <input value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0,00" />
          </label>
          <label>
            <span>Desconto em %</span>
            <input value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} placeholder="0" />
          </label>
          <label>
            <span>Dividir por pessoas</span>
            <input type="number" min={1} value={people} onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))} />
          </label>
        </div>
        <div className="pdv-split-preview">
          <strong>Valor sugerido por pessoa</strong>
          <span>{splitPreview.map((payment, index) => `Pessoa ${index + 1}: ${money(payment.amount)}`).join(" | ")}</span>
        </div>
        <div className="pdv-action-row">
          <button className="pdv-ghost-button" onClick={onCancel}>Voltar</button>
          <button className="pdv-ghost-button" onClick={onPartialItems}>Fechar parcial por itens</button>
          <button className="pdv-ghost-button" onClick={onPartialManual}>Fechar parcial por valor</button>
          <button className="pdv-ghost-button" onClick={() => onCloseTotal(total, discount, splitPreview)}>Dividir por pessoas</button>
          <button className="pdv-primary-button" onClick={() => onCloseTotal(total, discount)}>Fechar total</button>
        </div>
      </section>
    </div>
  );
}

function ProductsScreen({ snapshot, onImportCose, onImportFile, busy, onProductsUpdated }: { snapshot: PdvSnapshot; onImportCose: () => void; onImportFile: () => void; busy: boolean; onProductsUpdated: () => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState(snapshot.categories[0]?.id || "");
  const [editingProduct, setEditingProduct] = useState<PdvProduct | "new" | null>(null);
  const [editingCategory, setEditingCategory] = useState<PdvCategory | "new" | null>(null);
  const updateSelected = async (patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean }) => {
    await window.caixa.updatePdvProducts(selectedIds, patch);
    setSelectedIds([]);
    onProductsUpdated();
  };
  const saveProduct = async (draft: PdvProductDraft) => {
    await window.caixa.savePdvProduct(draft);
    setEditingProduct(null);
    onProductsUpdated();
  };
  const saveCategory = async (draft: PdvCategoryDraft) => {
    await window.caixa.savePdvCategory(draft);
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
          <button className="pdv-ghost-button" onClick={() => setEditingCategory("new")}>Nova categoria</button>
          <button className="pdv-ghost-button" onClick={() => setEditingProduct("new")}>Novo produto</button>
          <button className="pdv-ghost-button" disabled={busy} onClick={onImportFile}><FileSpreadsheet size={18} /> Importar arquivo</button>
          <button className="pdv-primary-button" disabled={busy} onClick={onImportCose}><Download size={18} /> Importar Cose Dell Abadia</button>
        </div>
      </div>
      <div className="pdv-category-manager">
        {snapshot.categories.map((category) => (
          <button key={category.id} className={category.active ? "" : "inactive"} onClick={() => setEditingCategory(category)}>
            {category.favorite ? "[Fav] " : ""}{category.name} <small>{category.active ? "ativa" : "oculta"} | {category.favorite ? "favorita | " : ""}ordem {category.sortOrder}</small>
          </button>
        ))}
      </div>
      <div className="pdv-bulk-toolbar">
        <strong>{selectedIds.length} selecionado(s)</strong>
        <select value={targetCategoryId} onChange={(event) => setTargetCategoryId(event.target.value)}>
          {snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ categoryId: targetCategoryId })}>Mover categoria</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ canBeComplement: true })}>Usar como complemento</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ canBeComplement: false })}>Nao complemento</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ hasComplements: true })}>Abrir adicionais</button>
        <button className="pdv-ghost-button" disabled={!selectedIds.length} onClick={() => updateSelected({ hasComplements: false })}>Nao abrir adicionais</button>
      </div>
      <div className="pdv-product-table">
        {snapshot.products.map((product) => (
          <article key={product.id} className={product.active ? "" : "inactive"}>
            <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} />
            <strong>{product.favorite ? "[Fav] " : ""}{product.name}</strong>
            <span>{product.categoryName}</span>
            <span>{product.unit} / {product.unitMode}</span>
            <b>{money(product.price)}</b>
            <small>{product.active ? "Ativo" : "Inativo"} | {product.showOnPdv ? "PDV" : "Oculto"} {product.favorite ? " | Favorito" : ""}{product.canBeComplement ? " | Complemento" : ""}{product.complementProductIds.length ? ` | ${product.complementProductIds.length} adicionais` : ""}</small>
            <button className="pdv-ghost-button" onClick={() => setEditingProduct(product)}>Editar</button>
          </article>
        ))}
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
  const complementOptions = products.filter((item) => item.id !== product?.id && item.canBeComplement);
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
          <label><span>Preco venda</span><input type="number" min={0} step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value || 0) })} /></label>
          <label><span>Unidade</span><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
          <label>
            <span>Tipo de venda</span>
            <select value={draft.unitMode} onChange={(event) => setDraft({ ...draft, unitMode: event.target.value as PdvProductDraft["unitMode"] })}>
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
          <button className="pdv-primary-button" disabled={!draft.name.trim() || !draft.categoryId} onClick={() => onSave(draft)}>Salvar produto</button>
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
  return (
    <div className="pdv-context-menu" style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

function HistoryScreen({ snapshot, onChanged }: { snapshot: PdvSnapshot; onChanged: () => void }) {
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    query: "",
    type: "Todos",
    payment: "Todos",
    status: "Todos",
    table: ""
  });
  const [selectedSale, setSelectedSale] = useState<PdvSale | null>(null);
  const [saleMenu, setSaleMenu] = useState<{ x: number; y: number; sale: PdvSale } | null>(null);
  const [editingPaymentsSale, setEditingPaymentsSale] = useState<PdvSale | null>(null);
  const sales = filterSales(snapshot.recentSales, filters);

  const cancelSale = async (sale: PdvSale) => {
    if (!window.confirm(`Cancelar a venda ${sale.id.slice(0, 8)}? Ela continua no historico como auditoria.`)) {
      return;
    }
    await window.caixa.cancelPdvSale(sale.id);
    setSelectedSale(null);
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
      const status = await window.caixa.exportPdvSales({ from: date, to: date, type: "Todos", payment: "Todos", table: sale.tableNumber ? String(sale.tableNumber) : "" });
      window.alert(status.message || (status.ok ? "Exportacao concluida." : "Nao foi possivel exportar."));
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
          {saleMenu.sale.status !== "Cancelada" && <button onClick={() => runSaleAction("payments", saleMenu.sale)}>Alterar forma de pagamento</button>}
          {saleMenu.sale.status !== "Cancelada" && <button className="danger" onClick={() => runSaleAction("cancel", saleMenu.sale)}>Cancelar/estornar</button>}
        </ContextMenu>
      )}
      {selectedSale && <SaleDetailModal sale={selectedSale} onClose={() => setSelectedSale(null)} onCancel={() => cancelSale(selectedSale)} />}
      {editingPaymentsSale && (
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
  const [filters, setFilters] = useState<PdvExportFilters>({ from: today, to: today, payment: "Todos", type: "Todos", table: "" });
  const [exporting, setExporting] = useState(false);
  const sales = filterSales(snapshot.recentSales, { ...filters, query: "", status: "Todos" }).filter((sale) => sale.status !== "Cancelada");
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
      window.alert(status.ok ? status.message || "Relatorio PDV exportado." : status.message || "Nao foi possivel exportar.");
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
        <label><span>De</span><input type="date" value={filters.from || ""} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label><span>Ate</span><input type="date" value={filters.to || ""} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label><span>Tipo</span><select value={filters.type || "Todos"} onChange={(event) => setFilters({ ...filters, type: event.target.value as PdvExportFilters["type"] })}><option>Todos</option><option>Venda direta</option><option>Mesa</option></select></label>
        <label><span>Pagamento</span><select value={filters.payment || "Todos"} onChange={(event) => setFilters({ ...filters, payment: event.target.value as PdvExportFilters["payment"] })}><option>Todos</option>{PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
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
    </section>
  );
}

function AdvancedScreen({ snapshot, onImportCose, onImportFile, busy, onSettingsUpdated }: { snapshot: PdvSnapshot; onImportCose: () => void; onImportFile: () => void; busy: boolean; onSettingsUpdated: () => void }) {
  const saveSetting = async (patch: Partial<PdvSnapshot["settings"]>) => {
    await window.caixa.savePdvSettings(patch);
    onSettingsUpdated();
  };
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
          <label className="pdv-switch-line">
            <input type="checkbox" checked={snapshot.settings.subtablesEnabled} onChange={(event) => saveSetting({ subtablesEnabled: event.target.checked })} />
            Ativar submesas/contas separadas
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
                <span>{money(payment.amount)}{payment.change ? ` | Troco ${money(payment.change)}` : ""}</span>
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
  filters: { from?: string; to?: string; query?: string; type?: string; payment?: string; status?: string; table?: string }
): PdvSale[] {
  const query = (filters.query || "").trim().toLocaleLowerCase("pt-BR");
  const table = (filters.table || "").replace(/^0+/, "");
  return sales.filter((sale) => {
    const dateKey = sale.createdAt.slice(0, 10);
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
    if (!query) {
      return true;
    }
    const haystack = [
      sale.type,
      sale.status,
      sale.tableNumber ? String(sale.tableNumber) : "",
      ...sale.items.flatMap((item) => [item.productName, item.categoryName, item.subtableName || ""]),
      ...sale.payments.map((payment) => payment.method)
    ].join(" ").toLocaleLowerCase("pt-BR");
    return haystack.includes(query);
  });
}

function TabButton({ icon: Icon, active, label, onClick }: { icon: typeof ShoppingCart; active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <Icon size={21} /> {label}
    </button>
  );
}

function mergeCartItem(items: PdvCartItem[], incoming: PdvCartItem): PdvCartItem[] {
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

function askTransferQuantity(item: PdvCartItem): number | null {
  if (item.quantity <= 1) {
    return item.quantity;
  }
  const value = window.prompt(`Quantidade para transferir de ${item.productName}`, String(item.quantity).replace(".", ","));
  if (value === null) {
    return null;
  }
  const quantity = parseBrazilianNumber(value);
  if (quantity <= 0 || quantity > item.quantity) {
    window.alert("Informe uma quantidade valida para transferir.");
    return null;
  }
  return roundMoney(quantity);
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
  return Number(value.replace(/\./g, "").replace(",", ".")) || 0;
}
