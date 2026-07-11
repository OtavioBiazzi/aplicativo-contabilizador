import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";
import { LocalServer } from "../dist-electron/electron/localServer.js";
import { pdvSalesToLedgerEntries } from "../dist-electron/src/shared/pdvLedger.js";
import { createDefaultSettings } from "../dist-electron/src/shared/defaults.js";

const root = process.cwd();
const tmp = path.join(root, ".tmp-network-smoke");
const dataDir = path.join(tmp, "data");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const pdvStore = new PdvStore(dataDir);
await pdvStore.initialize();
const settings = createDefaultSettings(path.join(tmp, "exports"));
settings.operationMode = "pdv";
settings.server.permissions = {
  view: true,
  create: true,
  manageTables: true,
  manageProducts: true,
  edit: true,
  delete: true,
  viewEntryValues: true,
  viewTotals: true,
  allowClientCustomization: false
};

const integratedEntries = async () => pdvSalesToLedgerEntries((await pdvStore.getSnapshot()).recentSales);
const server = new LocalServer({
  permissions: settings.server.permissions,
  getSettings: async () => settings,
  getEntries: integratedEntries,
  addEntry: async () => { throw new Error("Nao usado neste smoke."); },
  updateEntry: async () => { throw new Error("Nao usado neste smoke."); },
  cancelEntry: async () => { throw new Error("Nao usado neste smoke."); },
  removeEntry: async () => undefined,
  deleteEntry: async () => undefined,
  getPdvSnapshot: () => pdvStore.getSnapshot(),
  savePdvDirectSale: (items, discount, payments, origin, operationId) => pdvStore.saveSale({ type: "Venda direta", items, discount, payments, originDevice: origin, operationId }),
  openPdvTable: (number, people, note) => pdvStore.openTable(number, people, note),
  setPdvTableStatus: (number, status) => pdvStore.setTableStatus(number, status),
  savePdvTableItems: (number, items) => pdvStore.saveTableItems(number, items),
  closePdvTable: (number, payments, discount, origin) => pdvStore.closeTable(number, payments, discount, origin),
  savePdvTablePartial: (number, items, payments, discount, origin) => pdvStore.closeTablePartial(number, items, payments, discount, origin),
  updatePdvProducts: (ids, patch) => pdvStore.updateProducts(ids, patch),
  savePdvCategory: (draft) => pdvStore.saveCategory(draft),
  savePdvProduct: (draft) => pdvStore.saveProduct(draft),
  savePdvSettings: async (patch) => {
    const next = { ...settings, ...patch };
    Object.assign(settings, next);
    return pdvStore.saveSettings(patch);
  },
  importPdvPreset: async () => ({ filePath: "smoke.xlsx", importedProducts: 0, importedCategories: 0, skippedRows: 0 }),
  onRemoteChange: () => undefined,
  onRemotePdvChange: () => undefined
});

await server.start(43991, "smoke-password");
const headers = { "content-type": "application/json", "x-caixa-password": "smoke-password", "x-device-name": "Cliente smoke" };
const readEntries = () => fetch("http://127.0.0.1:43991/api/entries", { headers });
const initial = await (await readEntries()).json();
if (initial.clientPolicy.operationMode !== "pdv") {
  throw new Error("Politica remota nao informou modo PDV.");
}

const category = await pdvStore.saveCategory({ name: "Smoke rede", active: true, favorite: false, sortOrder: 1 });
const product = await pdvStore.saveProduct({
  name: "Produto rede",
  categoryId: category.id,
  price: 12,
  unit: "UNID",
  unitMode: "unidade",
  active: true,
  showOnPdv: true,
  favorite: false,
  canBeComplement: false,
  hasComplements: false,
  complementProductIds: [],
  sortOrder: 1
});
const item = {
  id: crypto.randomUUID(),
  productId: product.id,
  productName: product.name,
  categoryName: category.name,
  quantity: 1,
  baseUnitPrice: 12,
  unitPrice: 12,
  discount: 0,
  total: 12
};

const productUpdate = await fetch("http://127.0.0.1:43991/api/pdv/products", { method: "PATCH", headers, body: JSON.stringify({ ids: [product.id], patch: { favorite: true } }) });
if (productUpdate.status !== 403) throw new Error(`Cliente conseguiu alterar produto controlado pelo servidor: ${await productUpdate.text()}`);
if ((await pdvStore.getSnapshot()).products.find((entry) => entry.id === product.id)?.favorite) {
  throw new Error("Produto foi alterado apesar da protecao de configuracao remota.");
}

const direct = await fetch("http://127.0.0.1:43991/api/pdv/sales/direct", {
  method: "POST",
  headers: { ...headers, "x-idempotency-key": crypto.randomUUID() },
  body: JSON.stringify({ items: [{ ...item, id: crypto.randomUUID() }], discount: 0, payments: [{ id: crypto.randomUUID(), method: "Debito", amount: 12 }] })
});
if (!direct.ok) throw new Error(`Cliente nao conseguiu registrar venda direta no servidor: ${await direct.text()}`);
if (!(await pdvStore.getSnapshot()).recentSales.some((sale) => sale.type === "Venda direta" && sale.originDevice === "Cliente smoke")) {
  throw new Error("Venda direta do cliente nao foi registrada no banco do servidor.");
}

const open = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/open", { method: "POST", headers, body: JSON.stringify({ people: 1 }) });
if (!open.ok) throw new Error(`Cliente nao conseguiu abrir mesa no servidor: ${await open.text()}`);
const save = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/items", { method: "PUT", headers, body: JSON.stringify({ items: [item] }) });
if (!save.ok) throw new Error(`Cliente nao conseguiu salvar item no servidor: ${await save.text()}`);
const close = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/close", { method: "POST", headers, body: JSON.stringify({ payments: [{ id: crypto.randomUUID(), method: "Pix", amount: 12 }] }) });
if (!close.ok) throw new Error(`Cliente nao conseguiu fechar mesa no servidor: ${await close.text()}`);

const after = await (await readEntries()).json();
const sale = after.entries.find((entry) => entry.type === "Mesa");
if (!sale || sale.originDevice !== "Cliente smoke" || sale.paymentBreakdown?.[0]?.method !== "Pix") {
  throw new Error("Venda remota nao entrou no historico integrado com origem/pagamento corretos.");
}

settings.operationMode = "legacy";
const legacyPolicy = await (await readEntries()).json();
if (legacyPolicy.clientPolicy.operationMode !== "legacy") {
  throw new Error("Cliente nao recebeu a troca remota para o modo Classico.");
}

await server.stop();
if (!existsSync(path.join(dataDir, "pdv.sqlite"))) throw new Error("SQLite nao foi preservado.");
rmSync(tmp, { recursive: true, force: true });
console.log("Network smoke passed");
