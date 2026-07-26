import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
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
  printReceipts: true,
  allowClientCustomization: false
};
let remotePrintRequests = 0;
let serverStateChanges = 0;
let resolveNextServerStateChange = null;

const integratedEntries = async () => pdvSalesToLedgerEntries((await pdvStore.getSnapshot()).recentSales);
const server = new LocalServer({
  appVersion: "0.3.40",
  permissions: settings.server.permissions,
  getSettings: async () => settings,
  saveSettings: async (next) => {
    Object.assign(settings, next);
    return settings;
  },
  getEntries: integratedEntries,
  addEntry: async () => { throw new Error("Nao usado neste smoke."); },
  updateEntry: async () => { throw new Error("Nao usado neste smoke."); },
  cancelEntry: async () => { throw new Error("Nao usado neste smoke."); },
  removeEntry: async () => undefined,
  deleteEntry: async () => undefined,
  getPdvSnapshot: (salesLimit) => pdvStore.getSnapshot(salesLimit),
  savePdvDirectSale: (items, discount, payments, origin, operationId) => pdvStore.saveSale({ type: "Venda direta", items, discount, payments, originDevice: origin, operationId }),
  openPdvTable: (number, people, note) => pdvStore.openTable(number, people, note),
  setPdvTableStatus: (number, status) => pdvStore.setTableStatus(number, status),
  savePdvTableItems: (number, items, subtables) => pdvStore.saveTableItems(number, items, subtables),
  transferPdvTableItems: (sourceTableNumber, targetTableNumber, selections) => pdvStore.transferTableItems(sourceTableNumber, targetTableNumber, selections),
  closePdvTable: (number, payments, discount, origin, operationId) => pdvStore.closeTable(number, payments, discount, origin, operationId),
  savePdvTablePartial: (number, items, payments, discount, origin, operationId, observations) => pdvStore.closeTablePartial(number, items, payments, discount, origin, operationId, observations),
  updatePdvProducts: (ids, patch) => pdvStore.updateProducts(ids, patch),
  savePdvCategory: (draft) => pdvStore.saveCategory(draft),
  savePdvProduct: (draft) => pdvStore.saveProduct(draft),
  savePdvCustomer: (draft) => pdvStore.saveCustomer(draft),
  receivePdvReceivable: (id, payment, origin, operationId) => pdvStore.receiveReceivable(id, payment, origin, operationId),
  updatePdvReceivable: (id, patch) => pdvStore.updateReceivable(id, patch),
  cancelPdvReceivable: (id) => pdvStore.cancelReceivable(id),
  savePdvPayable: (draft) => pdvStore.savePayable(draft),
  payPdvPayable: (id, payment, origin, operationId) => pdvStore.payPayable(id, payment, origin, operationId),
  cancelPdvPayable: (id) => pdvStore.cancelPayable(id),
  printPdvReceipt: async ({ sale }) => {
    remotePrintRequests += 1;
    return { ok: Boolean(sale?.id), message: "Impressao smoke recebida." };
  },
  savePdvSettings: async (patch) => {
    const next = { ...settings, ...patch };
    Object.assign(settings, next);
    return pdvStore.saveSettings(patch);
  },
  importPdvPreset: async () => ({ filePath: "smoke.xlsx", importedProducts: 0, importedCategories: 0, skippedRows: 0 }),
  onRemoteChange: () => undefined,
  onRemoteSettingsChange: () => undefined,
  onRemotePdvChange: () => undefined,
  onServerStateChange: () => {
    serverStateChanges += 1;
    resolveNextServerStateChange?.();
    resolveNextServerStateChange = null;
  }
});

await server.start(43991, "smoke-password");
const versionResponse = await fetch("http://127.0.0.1:43991/api/version");
const versionPayload = await versionResponse.json();
if (!versionResponse.ok || versionPayload.appVersion !== "0.3.40") {
  throw new Error("Servidor nao publicou a versao do protocolo remoto.");
}
const incompatibleResponse = await fetch("http://127.0.0.1:43991/api/entries", {
  headers: { "x-caixa-password": "smoke-password", "x-caixa-version": "0.3.39" }
});
if (incompatibleResponse.status !== 426 || (await incompatibleResponse.json()).code !== "VERSION_MISMATCH") {
  throw new Error("Servidor aceitou cliente com versao diferente.");
}
const printClientSocket = new WebSocket("ws://127.0.0.1:43991/sync?password=smoke-password&device=Impressora%20smoke&version=0.3.40");
const printClientConnected = new Promise((resolve) => printClientSocket.once("message", resolve));
await new Promise((resolve, reject) => {
  printClientSocket.once("open", resolve);
  printClientSocket.once("error", reject);
});
await printClientConnected;
const printClient = server.getState().devices.find((device) => device.name === "Impressora smoke");
if (!printClient || serverStateChanges < 1) {
  throw new Error("Servidor nao identificou o cliente imediatamente ao conectar.");
}
const headers = { "content-type": "application/json", "x-caixa-password": "smoke-password", "x-device-name": "Cliente smoke", "x-caixa-version": "0.3.40" };
const readEntries = () => fetch("http://127.0.0.1:43991/api/entries", { headers });
const initial = await (await readEntries()).json();
if (initial.clientPolicy.operationMode !== "pdv") {
  throw new Error("Politica remota nao informou modo PDV.");
}

const blockedSettings = await fetch("http://127.0.0.1:43991/api/settings", {
  method: "PATCH",
  headers,
  body: JSON.stringify({ defaultPeople: 4 })
});
if (blockedSettings.status !== 403) throw new Error("Cliente alterou configuracoes sem permissao.");

settings.server.permissions.allowClientCustomization = true;
server.setPermissions(settings.server.permissions);
const allowedSettings = await fetch("http://127.0.0.1:43991/api/settings", {
  method: "PATCH",
  headers,
  body: JSON.stringify({ defaultPeople: 4, outputDirectory: "nao-deve-alterar" })
});
if (!allowedSettings.ok || settings.defaultPeople !== 4 || settings.outputDirectory === "nao-deve-alterar") {
  throw new Error(`Configuracoes remotas nao foram filtradas e salvas corretamente: ${await allowedSettings.text()}`);
}
const allowedPdvSettings = await fetch("http://127.0.0.1:43991/api/pdv/settings", {
  method: "PATCH",
  headers,
  body: JSON.stringify({ receiptPaperWidth: "80", receiptFooter: "Smoke remoto" })
});
if (!allowedPdvSettings.ok || (await pdvStore.getSnapshot()).settings.receiptFooter !== "Smoke remoto") {
  throw new Error(`Ajustes de impressao do cliente nao chegaram ao servidor: ${await allowedPdvSettings.text()}`);
}

const category = await pdvStore.saveCategory({ name: "Smoke rede", active: true, favorite: false, sortOrder: 1 });
const product = await pdvStore.saveProduct({
  name: "Produto rede",
  categoryId: category.id,
  price: 12,
  costPrice: 5,
  unit: "UNID",
  unitMode: "unidade",
  active: true,
  showOnPdv: true,
  favorite: false,
  canBeComplement: false,
  hasComplements: false,
  complementProductIds: [],
  sortOrder: 1,
  trackStock: true,
  stockQuantity: 5,
  minimumStock: 2,
  sku: "REDE-001",
  barcode: "7890000000001",
  supplier: "Fornecedor rede",
  description: "Produto detalhado sincronizado"
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
const directSale = (await pdvStore.getSnapshot()).recentSales.find((sale) => sale.type === "Venda direta" && sale.originDevice === "Cliente smoke");
if (!directSale) {
  throw new Error("Venda direta do cliente nao foi registrada no banco do servidor.");
}
const productAfterRemoteSale = (await pdvStore.getSnapshot()).products.find((entry) => entry.id === product.id);
if (productAfterRemoteSale?.stockQuantity !== 4 || productAfterRemoteSale.costPrice !== 5 || productAfterRemoteSale.sku !== "REDE-001") {
  throw new Error("Cadastro detalhado ou baixa de estoque nao foram sincronizados pelo servidor.");
}
const printOnServer = await fetch("http://127.0.0.1:43991/api/pdv/print-receipt", {
  method: "POST",
  headers,
  body: JSON.stringify({ sale: directSale })
});
if (!printOnServer.ok || remotePrintRequests !== 1) {
  throw new Error(`Cliente nao conseguiu solicitar impressao no servidor: ${await printOnServer.text()}`);
}
const serverReceiptSettings = (await pdvStore.getSnapshot()).settings;
const remoteReceiptJob = new Promise((resolve) => printClientSocket.once("message", (raw) => resolve(JSON.parse(String(raw)))));
const remotePrintResult = server.requestReceiptPrint(printClient.id, {
  jobId: crypto.randomUUID(),
  sale: directSale,
  receiptSettings: serverReceiptSettings
});
const remotePrintPayload = await remoteReceiptJob;
if (!remotePrintResult.ok || remotePrintPayload.type !== "receipt-print-request" || remotePrintPayload.receiptSettings?.receiptFooter !== serverReceiptSettings.receiptFooter) {
  throw new Error("Impressao no cliente nao recebeu as configuracoes de identidade do servidor.");
}

const customerResponse = await fetch("http://127.0.0.1:43991/api/pdv/customers", {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "Cliente remoto conta", phone: "11999990000", active: true })
});
if (!customerResponse.ok) throw new Error(`Cliente nao conseguiu cadastrar cliente no servidor: ${await customerResponse.text()}`);
const remoteCustomer = (await customerResponse.json()).customer;
const accountSaleResponse = await fetch("http://127.0.0.1:43991/api/pdv/sales/direct", {
  method: "POST",
  headers: { ...headers, "x-idempotency-key": crypto.randomUUID() },
  body: JSON.stringify({
    items: [{ ...item, id: crypto.randomUUID(), baseUnitPrice: 20, unitPrice: 20, total: 20 }],
    discount: 0,
    payments: [{
      id: crypto.randomUUID(),
      method: "Conta a receber",
      amount: 20,
      customerId: remoteCustomer.id,
      customerName: remoteCustomer.name,
      dueDate: "2099-12-31"
    }]
  })
});
if (!accountSaleResponse.ok) throw new Error(`Cliente nao conseguiu criar conta a receber no servidor: ${await accountSaleResponse.text()}`);
const remoteReceivable = (await pdvStore.getSnapshot()).receivables.find((entry) => entry.customerId === remoteCustomer.id);
if (!remoteReceivable || remoteReceivable.balance !== 20) throw new Error("Conta a receber remota nao apareceu no snapshot do servidor.");
const remoteReceiptResponse = await fetch(`http://127.0.0.1:43991/api/pdv/receivables/${remoteReceivable.id}/payments`, {
  method: "POST",
  headers: { ...headers, "x-idempotency-key": crypto.randomUUID() },
  body: JSON.stringify({
    payment: {
      id: crypto.randomUUID(),
      receivableId: remoteReceivable.id,
      createdAt: new Date().toISOString(),
      method: "Pix",
      amount: 20,
      description: "Recebido no cliente"
    }
  })
});
if (!remoteReceiptResponse.ok) throw new Error(`Cliente nao conseguiu receber conta no servidor: ${await remoteReceiptResponse.text()}`);
if ((await pdvStore.getSnapshot()).receivables.find((entry) => entry.id === remoteReceivable.id)?.status !== "Recebida") {
  throw new Error("Recebimento remoto nao quitou a conta no servidor.");
}
const reopenReceivableResponse = await fetch(`http://127.0.0.1:43991/api/pdv/receivables/${remoteReceivable.id}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ payments: [] })
});
if (!reopenReceivableResponse.ok) throw new Error(`Cliente nao conseguiu remover recebimento no servidor: ${await reopenReceivableResponse.text()}`);
const reopenedRemoteReceivable = (await reopenReceivableResponse.json()).receivable;
if (reopenedRemoteReceivable.status !== "Em aberto" || reopenedRemoteReceivable.receivedAmount !== 0 || reopenedRemoteReceivable.balance !== 20) {
  throw new Error("Remocao remota do recebimento nao reabriu a pendencia.");
}
const persistedReopenedReceivable = (await pdvStore.getSnapshot()).receivables.find((entry) => entry.id === remoteReceivable.id);
if (persistedReopenedReceivable?.status !== "Em aberto" || persistedReopenedReceivable.payments.length !== 0) {
  throw new Error("Pendencia reaberta remotamente nao permaneceu consistente no snapshot do servidor.");
}

const remotePayableResponse = await fetch("http://127.0.0.1:43991/api/pdv/payables", {
  method: "POST",
  headers,
  body: JSON.stringify({
    description: "Energia smoke rede",
    supplier: "Companhia regional",
    category: "Energia",
    documentNumber: "FAT-2048",
    dueDate: "2030-08-15",
    amount: 125.4,
    note: "Conta criada pelo cliente remoto"
  })
});
if (!remotePayableResponse.ok) throw new Error(`Cliente nao criou conta a pagar no servidor: ${await remotePayableResponse.text()}`);
const remotePayable = (await remotePayableResponse.json()).payable;
const payableOperationId = crypto.randomUUID();
const remotePayablePayment = {
  id: crypto.randomUUID(),
  payableId: remotePayable.id,
  createdAt: new Date().toISOString(),
  method: "Pix",
  amount: 45.4,
  description: "Parcial smoke"
};
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await fetch(`http://127.0.0.1:43991/api/pdv/payables/${remotePayable.id}/payments`, {
    method: "POST",
    headers: { ...headers, "x-idempotency-key": payableOperationId },
    body: JSON.stringify({ payment: remotePayablePayment })
  });
  if (!response.ok) throw new Error(`Pagamento remoto da conta a pagar falhou: ${await response.text()}`);
}
const persistedRemotePayable = (await pdvStore.getSnapshot()).payables.find((entry) => entry.id === remotePayable.id);
if (!persistedRemotePayable || persistedRemotePayable.status !== "Parcialmente paga" || persistedRemotePayable.balance !== 80 || persistedRemotePayable.payments.length !== 1) {
  throw new Error("Conta a pagar remota nao preservou pagamento parcial idempotente.");
}
const forbiddenPayableCancel = await fetch(`http://127.0.0.1:43991/api/pdv/payables/${remotePayable.id}/cancel`, { method: "POST", headers });
if (forbiddenPayableCancel.ok) throw new Error("Conta a pagar com pagamento foi cancelada indevidamente.");

const open = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/open", { method: "POST", headers, body: JSON.stringify({ people: 1 }) });
if (!open.ok) throw new Error(`Cliente nao conseguiu abrir mesa no servidor: ${await open.text()}`);
const remoteSubtableItem = { ...item, quantity: 2, total: 24, subtableName: "Cliente remoto" };
const save = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/items", {
  method: "PUT",
  headers,
  body: JSON.stringify({ items: [remoteSubtableItem], subtables: ["Cliente remoto", "Submesa vazia"] })
});
if (!save.ok) throw new Error(`Cliente nao conseguiu salvar item no servidor: ${await save.text()}`);
const savedTable = (await pdvStore.getSnapshot()).tables.find((table) => table.number === 7);
if (!savedTable?.subtables?.includes("Cliente remoto") || !savedTable.subtables.includes("Submesa vazia") || savedTable.items[0]?.subtableName !== "Cliente remoto") {
  throw new Error("Cliente nao preservou submesas ao salvar a mesa no servidor.");
}
const partialOperation = crypto.randomUUID();
const partial = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/partial", {
  method: "POST",
  headers: { ...headers, "x-idempotency-key": partialOperation },
  body: JSON.stringify({ items: [{ ...remoteSubtableItem, quantity: 1, total: 12 }], payments: [{ id: crypto.randomUUID(), method: "Debito", amount: 12 }], observations: "Pessoa 1" })
});
if (!partial.ok) throw new Error(`Cliente nao conseguiu registrar parcial no servidor: ${await partial.text()}`);
const partialTable = (await pdvStore.getSnapshot()).tables.find((table) => table.number === 7);
if (partialTable?.items[0]?.paidQuantity !== 1 || partialTable.total !== 12) throw new Error("Servidor nao refletiu o saldo parcial da mesa para o cliente.");

const close = await fetch("http://127.0.0.1:43991/api/pdv/tables/7/close", { method: "POST", headers: { ...headers, "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ payments: [{ id: crypto.randomUUID(), method: "Pix", amount: 12 }] }) });
if (!close.ok) throw new Error(`Cliente nao conseguiu fechar mesa no servidor: ${await close.text()}`);

const after = await (await readEntries()).json();
const tableSales = after.entries.filter((entry) => entry.type === "Mesa");
if (tableSales.length !== 2 || tableSales.reduce((sum, entry) => sum + entry.finalValue, 0) !== 24 || !tableSales.every((entry) => entry.originDevice === "Cliente smoke") || !tableSales.some((entry) => entry.observations?.includes("Pessoa 1") && entry.paymentBreakdown?.some((payment) => payment.method === "Debito")) || !tableSales.some((entry) => entry.paymentBreakdown?.some((payment) => payment.method === "Pix"))) {
  throw new Error(`Fechamentos remotos nao ficaram individualizados com origem/pagamento corretos: ${JSON.stringify(tableSales)}`);
}
const incrementalSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot?salesLimit=1", { headers })).json();
if (incrementalSnapshot.recentSales.length !== 1) {
  throw new Error("Snapshot operacional remoto ignorou o limite de vendas recentes.");
}

for (const tableNumber of [21, 22, 23]) {
  const opened = await fetch(`http://127.0.0.1:43991/api/pdv/tables/${tableNumber}/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ people: 1 })
  });
  if (!opened.ok) throw new Error(`Nao foi possivel abrir a mesa remota ${tableNumber} para o teste de sincronizacao.`);
}
const transferSourceItem = { ...item, id: crypto.randomUUID(), quantity: 3, total: 36, subtableName: "Origem" };
const transferSave = await fetch("http://127.0.0.1:43991/api/pdv/tables/21/items", {
  method: "PUT",
  headers,
  body: JSON.stringify({ items: [transferSourceItem], subtables: ["Origem"] })
});
if (!transferSave.ok) throw new Error(`Produto remoto desapareceu ao preparar transferencia: ${await transferSave.text()}`);
const remoteTransfer = await fetch("http://127.0.0.1:43991/api/pdv/tables/21/transfer", {
  method: "POST",
  headers,
  body: JSON.stringify({
    targetTableNumber: 22,
    selections: [{ itemId: transferSourceItem.id, quantity: 1, subtableName: "Destino" }]
  })
});
if (!remoteTransfer.ok) throw new Error(`Transferencia remota falhou: ${await remoteTransfer.text()}`);
const remoteTransferBody = await remoteTransfer.json();
const transferNetworkSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const networkSource = transferNetworkSnapshot.tables.find((table) => table.number === 21);
const networkTarget = transferNetworkSnapshot.tables.find((table) => table.number === 22);
if (
  remoteTransferBody.items[0]?.quantity !== 2
  || networkSource?.items[0]?.quantity !== 2
  || networkTarget?.items[0]?.quantity !== 1
  || networkTarget?.items[0]?.subtableName !== "Destino"
) {
  throw new Error("Transferencia remota nao permaneceu consistente no snapshot completo.");
}

const rapidFirstItem = { ...item, id: crypto.randomUUID(), productName: "Produto rapido 1" };
const rapidSecondItem = { ...item, id: crypto.randomUUID(), productName: "Produto rapido 2" };
for (const items of [[rapidFirstItem], [rapidFirstItem, rapidSecondItem]]) {
  const rapidSave = await fetch("http://127.0.0.1:43991/api/pdv/tables/23/items", {
    method: "PUT",
    headers,
    body: JSON.stringify({ items, subtables: [] })
  });
  if (!rapidSave.ok) throw new Error(`Salvamento remoto rapido falhou: ${await rapidSave.text()}`);
}
const rapidSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const rapidTable = rapidSnapshot.tables.find((table) => table.number === 23);
if (rapidTable?.items.length !== 2 || !rapidTable.items.some((row) => row.id === rapidSecondItem.id)) {
  throw new Error("O ultimo produto de uma sequencia rapida sumiu depois da sincronizacao completa.");
}

settings.operationMode = "legacy";
const legacyPolicy = await (await readEntries()).json();
if (legacyPolicy.clientPolicy.operationMode !== "legacy") {
  throw new Error("Cliente nao recebeu a troca remota para o modo Classico.");
}

const printClientClosed = new Promise((resolve) => printClientSocket.once("close", resolve));
const serverSawPrintClientClose = new Promise((resolve) => { resolveNextServerStateChange = resolve; });
printClientSocket.close();
await Promise.all([printClientClosed, serverSawPrintClientClose]);
if (server.getState().devices.some((device) => device.id === printClient.id) || serverStateChanges < 2) {
  throw new Error("Servidor nao atualizou a lista depois que o cliente desconectou.");
}

// Uma reconexao nao pode depender apenas dos eventos perdidos enquanto o
// servidor estava fora. O cliente abre um novo socket e baixa um snapshot
// completo, incluindo mesas, submesas, produtos e Historico.
await server.stop();
await pdvStore.openTable(24, 2, "Criada durante a desconexao");
const reconnectItem = {
  ...item,
  id: crypto.randomUUID(),
  productName: "Produto criado offline",
  subtableName: "Submesa reconectada"
};
await pdvStore.saveTableItems(24, [reconnectItem], ["Submesa reconectada"]);
const reconnectSale = await pdvStore.saveSale({
  type: "Venda direta",
  items: [{ ...reconnectItem, id: crypto.randomUUID(), subtableName: "" }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Dinheiro", amount: reconnectItem.total }],
  originDevice: "Servidor durante desconexao",
  operationId: crypto.randomUUID()
});

await server.start(43991, "smoke-password");
const reconnectSocket = new WebSocket("ws://127.0.0.1:43991/sync?password=smoke-password&device=Cliente%20reconectado&version=0.3.40");
const reconnectInitialMessage = new Promise((resolve) => reconnectSocket.once("message", resolve));
await new Promise((resolve, reject) => {
  reconnectSocket.once("open", resolve);
  reconnectSocket.once("error", reject);
});
await reconnectInitialMessage;

const snapshotAfterReconnectResponse = await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers });
if (!snapshotAfterReconnectResponse.ok) {
  throw new Error(`Cliente nao conseguiu baixar snapshot ao reconectar: ${await snapshotAfterReconnectResponse.text()}`);
}
const snapshotAfterReconnect = await snapshotAfterReconnectResponse.json();
const reconnectedTable = snapshotAfterReconnect.tables.find((table) => table.number === 24);
if (
  reconnectedTable?.items[0]?.id !== reconnectItem.id
  || reconnectedTable?.items[0]?.subtableName !== "Submesa reconectada"
  || !reconnectedTable?.subtables?.includes("Submesa reconectada")
  || !snapshotAfterReconnect.recentSales.some((sale) => sale.id === reconnectSale.id)
) {
  throw new Error("A sincronizacao completa apos reconectar nao restaurou mesa, submesa, produto e Historico.");
}

await new Promise((resolve) => {
  reconnectSocket.once("close", resolve);
  reconnectSocket.close();
});
await server.stop();
if (!existsSync(path.join(dataDir, "pdv.sqlite"))) throw new Error("SQLite nao foi preservado.");
rmSync(tmp, { recursive: true, force: true });
console.log("Network smoke passed");
