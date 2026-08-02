import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";
import { LocalServer } from "../dist-electron/electron/localServer.js";
import { pdvSalesToLedgerEntries } from "../dist-electron/src/shared/pdvLedger.js";
import { createDefaultSettings } from "../dist-electron/src/shared/defaults.js";

const root = process.cwd();
const appVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
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
  appVersion,
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
  transferPdvTableItems: (sourceTableNumber, targetTableNumber, selections, operationId) => pdvStore.transferTableItems(sourceTableNumber, targetTableNumber, selections, operationId),
  appendPdvTableItems: (targetTableNumber, items, targetSubtable) => pdvStore.appendTableItems(targetTableNumber, items, targetSubtable),
  closePdvTable: (number, payments, discount, origin, operationId) => pdvStore.closeTable(number, payments, discount, origin, operationId),
  savePdvTablePartial: (number, items, payments, discount, origin, operationId, observations) => pdvStore.closeTablePartial(number, items, payments, discount, origin, operationId, observations),
  updatePdvProducts: (ids, patch) => pdvStore.updateProducts(ids, patch),
  savePdvCategory: (draft) => pdvStore.saveCategory(draft),
  savePdvProduct: (draft) => pdvStore.saveProduct(draft),
  savePdvCustomer: (draft) => pdvStore.saveCustomer(draft),
  savePdvReceivable: (draft) => pdvStore.saveReceivable(draft),
  receivePdvReceivable: (id, payment, origin, operationId) => pdvStore.receiveReceivable(id, payment, origin, operationId),
  updatePdvReceivable: (id, patch) => pdvStore.updateReceivable(id, patch),
  cancelPdvReceivable: (id) => pdvStore.cancelReceivable(id),
  deletePdvReceivable: (id) => pdvStore.deleteReceivable(id),
  savePdvPayable: (draft) => pdvStore.savePayable(draft),
  payPdvPayable: (id, payment, origin, operationId) => pdvStore.payPayable(id, payment, origin, operationId),
  cancelPdvPayable: (id) => pdvStore.cancelPayable(id),
  deletePdvPayable: (id) => pdvStore.deletePayable(id),
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
if (!versionResponse.ok || versionPayload.appVersion !== appVersion) {
  throw new Error("Servidor nao publicou a versao do protocolo remoto.");
}
const incompatibleResponse = await fetch("http://127.0.0.1:43991/api/entries", {
  headers: { "x-caixa-password": "smoke-password", "x-caixa-version": "0.3.40" }
});
if (incompatibleResponse.status !== 426 || (await incompatibleResponse.json()).code !== "VERSION_MISMATCH") {
  throw new Error("Servidor aceitou cliente com versao diferente.");
}
const printClientSocket = new WebSocket(`ws://127.0.0.1:43991/sync?password=smoke-password&device=Impressora%20smoke&version=${encodeURIComponent(appVersion)}`);
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
const headers = { "content-type": "application/json", "x-caixa-password": "smoke-password", "x-device-name": "Cliente smoke", "x-caixa-version": appVersion };
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
const manualReceivableId = crypto.randomUUID();
const manualReceivableDraft = {
  id: manualReceivableId,
  customerId: remoteCustomer.id,
  description: "Cobranca manual smoke",
  dueDate: "2099-11-30",
  amount: 88.5,
  category: "Encomendas",
  costCenter: "Balcao",
  documentNumber: "MANUAL-01",
  paymentAccount: "Caixa principal",
  tags: ["manual", "rede"],
  note: "Criada sem venda do PDV"
};
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await fetch("http://127.0.0.1:43991/api/pdv/receivables", { method: "POST", headers, body: JSON.stringify(manualReceivableDraft) });
  if (!response.ok) throw new Error(`Cliente nao conseguiu criar conta a receber manual: ${await response.text()}`);
}
const manualSnapshot = await pdvStore.getSnapshot();
const manualReceivable = manualSnapshot.receivables.find((entry) => entry.id === manualReceivableId);
if (!manualReceivable || manualReceivable.balance !== 88.5 || manualReceivable.category !== "Encomendas"
  || !manualReceivable.events.some((event) => event.action === "Criacao")
  || manualSnapshot.receivables.filter((entry) => entry.id === manualReceivableId).length !== 1
  || manualSnapshot.recentSales.some((sale) => sale.id === manualReceivable.saleId)) {
  throw new Error("Conta a receber manual nao foi persistida de forma profissional e idempotente.");
}
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
const remoteReceivable = (await pdvStore.getSnapshot()).receivables.find((entry) => entry.customerId === remoteCustomer.id && entry.id !== manualReceivableId);
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
  body: JSON.stringify({ payments: [], description: "Encomenda smoke", category: "Vendas", costCenter: "Balcao", documentNumber: "REC-01", paymentAccount: "Caixa", tags: ["cliente", "teste"] })
});
if (!reopenReceivableResponse.ok) throw new Error(`Cliente nao conseguiu remover recebimento no servidor: ${await reopenReceivableResponse.text()}`);
const reopenedRemoteReceivable = (await reopenReceivableResponse.json()).receivable;
if (reopenedRemoteReceivable.status !== "Em aberto" || reopenedRemoteReceivable.receivedAmount !== 0 || reopenedRemoteReceivable.balance !== 20
  || reopenedRemoteReceivable.category !== "Vendas" || reopenedRemoteReceivable.costCenter !== "Balcao"
  || !reopenedRemoteReceivable.tags.includes("teste") || !reopenedRemoteReceivable.events.some((event) => event.action === "Edicao")) {
  throw new Error("Remocao remota do recebimento nao reabriu a pendencia.");
}
const persistedReopenedReceivable = (await pdvStore.getSnapshot()).receivables.find((entry) => entry.id === remoteReceivable.id);
if (persistedReopenedReceivable?.status !== "Em aberto" || persistedReopenedReceivable.payments.length !== 0) {
  throw new Error("Pendencia reaberta remotamente nao permaneceu consistente no snapshot do servidor.");
}
const deleteReceivableResponse = await fetch(`http://127.0.0.1:43991/api/pdv/receivables/${remoteReceivable.id}`, { method: "DELETE", headers });
if (!deleteReceivableResponse.ok || (await pdvStore.getSnapshot()).receivables.find((entry) => entry.id === remoteReceivable.id)?.status !== "Excluida") {
  throw new Error("Conta a receber excluida nao permaneceu no historico com o status correto.");
}

const payableDraftId = crypto.randomUUID();
const payableDraft = {
  id: payableDraftId,
  description: "Energia smoke rede",
  supplier: "Companhia regional",
  category: "Energia",
  costCenter: "Loja principal",
  documentNumber: "FAT-2048",
  paymentAccount: "Banco smoke",
  tags: ["fixa", "rede"],
  issueDate: "2030-08-01",
  dueDate: "2030-08-15",
  amount: 125.4,
  note: "Conta criada pelo cliente remoto"
};
let remotePayable;
for (let attempt = 0; attempt < 2; attempt += 1) {
  const remotePayableResponse = await fetch("http://127.0.0.1:43991/api/pdv/payables", {
    method: "POST",
    headers,
    body: JSON.stringify(payableDraft)
  });
  if (!remotePayableResponse.ok) throw new Error(`Cliente nao criou conta a pagar no servidor: ${await remotePayableResponse.text()}`);
  remotePayable = (await remotePayableResponse.json()).payable;
}
if ((await pdvStore.getSnapshot()).payables.filter((entry) => entry.id === payableDraftId).length !== 1) {
  throw new Error("Reenvio de cadastro apos perda da resposta duplicou a conta a pagar.");
}
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
if (!persistedRemotePayable || persistedRemotePayable.status !== "Parcialmente paga" || persistedRemotePayable.balance !== 80 || persistedRemotePayable.payments.length !== 1
  || persistedRemotePayable.costCenter !== "Loja principal" || persistedRemotePayable.paymentAccount !== "Banco smoke"
  || !persistedRemotePayable.tags.includes("rede") || !persistedRemotePayable.events.some((event) => event.action === "Pagamento")) {
  throw new Error("Conta a pagar remota nao preservou pagamento parcial idempotente.");
}
const forbiddenPayableCancel = await fetch(`http://127.0.0.1:43991/api/pdv/payables/${remotePayable.id}/cancel`, { method: "POST", headers });
if (forbiddenPayableCancel.ok) throw new Error("Conta a pagar com pagamento foi cancelada indevidamente.");
const deletePayableResponse = await fetch(`http://127.0.0.1:43991/api/pdv/payables/${remotePayable.id}`, { method: "DELETE", headers });
if (!deletePayableResponse.ok || (await pdvStore.getSnapshot()).payables.find((entry) => entry.id === remotePayable.id)?.status !== "Excluida") {
  throw new Error("Conta a pagar excluida nao permaneceu no historico com o status correto.");
}

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

const directTransferItem = { ...item, id: crypto.randomUUID(), productName: "Venda direta transferida", total: 12 };
const directTransfer = await fetch("http://127.0.0.1:43991/api/pdv/tables/22/append", {
  method: "POST",
  headers,
  body: JSON.stringify({ items: [directTransferItem], targetSubtable: "Destino" })
});
if (!directTransfer.ok) throw new Error(`Venda direta nao foi transferida para mesa: ${await directTransfer.text()}`);
const directTransferSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const directTransferTarget = directTransferSnapshot.tables.find((table) => table.number === 22);
if (directTransferTarget?.items.length !== 2 || !directTransferTarget.items.some((row) => row.productName === "Venda direta transferida" && row.subtableName === "Destino")) {
  throw new Error("Transferir venda direta substituiu os produtos que ja estavam na mesa destino.");
}

// Regressao: ao mover entre submesas da mesma mesa, o endpoint retornava apenas
// o restante da origem. O autosave do cliente gravava esse retorno parcial e
// substituia os itens que ja existiam no destino.
const localDestinationItem = { ...item, id: crypto.randomUUID(), productName: "Ja estava no destino", subtableName: "Destino local" };
const sameTableSeed = await fetch("http://127.0.0.1:43991/api/pdv/tables/21/items", {
  method: "PUT",
  headers,
  body: JSON.stringify({ items: [networkSource.items[0], localDestinationItem], subtables: ["Origem", "Destino local"] })
});
if (!sameTableSeed.ok) throw new Error(`Nao foi possivel preparar transferencia interna: ${await sameTableSeed.text()}`);
const sameTableTransfer = await fetch("http://127.0.0.1:43991/api/pdv/tables/21/transfer", {
  method: "POST",
  headers,
  body: JSON.stringify({
    targetTableNumber: 21,
    selections: [{ itemId: networkSource.items[0].id, quantity: 1, subtableName: "Destino local" }]
  })
});
if (!sameTableTransfer.ok) throw new Error(`Transferencia entre submesas falhou: ${await sameTableTransfer.text()}`);
const sameTableBody = await sameTableTransfer.json();
const sameTableSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const sameTable = sameTableSnapshot.tables.find((table) => table.number === 21);
if (
  sameTableBody.items.length !== 3
  || sameTable?.items.length !== 3
  || !sameTable.items.some((row) => row.id === localDestinationItem.id)
  || sameTable.items.filter((row) => row.subtableName === "Destino local").length !== 2
) {
  throw new Error(`Transferencia interna substituiu itens existentes na submesa destino: ${JSON.stringify({ returned: sameTableBody.items, persisted: sameTable?.items })}`);
}

const subtableToMain = await fetch("http://127.0.0.1:43991/api/pdv/tables/21/transfer", {
  method: "POST",
  headers,
  body: JSON.stringify({
    targetTableNumber: 21,
    selections: [{ itemId: networkSource.items[0].id, quantity: 1 }]
  })
});
if (!subtableToMain.ok) throw new Error(`Transferencia da submesa para a mesa principal falhou: ${await subtableToMain.text()}`);
const subtableToMainBody = await subtableToMain.json();
const subtableToMainSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const tableWithMainTransfer = subtableToMainSnapshot.tables.find((table) => table.number === 21);
if (
  subtableToMainBody.items.length !== 3
  || tableWithMainTransfer?.items.length !== 3
  || tableWithMainTransfer.items.filter((row) => !row.subtableName).length !== 1
  || tableWithMainTransfer.items.some((row) => row.id === networkSource.items[0].id && row.subtableName === "Origem")
  || tableWithMainTransfer.subtables?.includes("Origem")
) {
  throw new Error("Transferencia da submesa para a mesa principal nao foi persistida corretamente.");
}

const multiAccountA = { ...item, id: crypto.randomUUID(), productName: "Conta A", subtableName: "Submesa A" };
const multiAccountB = { ...item, id: crypto.randomUUID(), productName: "Conta B", subtableName: "Submesa B" };
const multiTargetExisting = { ...item, id: crypto.randomUUID(), productName: "Produto existente", subtableName: "Unificada" };
for (const [tableNumber, items, subtables] of [
  [25, [multiAccountA, multiAccountB], ["Submesa A", "Submesa B"]],
  [26, [multiTargetExisting], ["Unificada"]]
]) {
  const seeded = await fetch(`http://127.0.0.1:43991/api/pdv/tables/${tableNumber}/items`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ items, subtables })
  });
  if (!seeded.ok) throw new Error(`Nao foi possivel preparar transferencia multipla: ${await seeded.text()}`);
}
const multiAccountTransfer = await fetch("http://127.0.0.1:43991/api/pdv/tables/25/transfer", {
  method: "POST",
  headers,
  body: JSON.stringify({
    targetTableNumber: 26,
    selections: [
      { itemId: multiAccountA.id, quantity: multiAccountA.quantity, subtableName: "Unificada" },
      { itemId: multiAccountB.id, quantity: multiAccountB.quantity, subtableName: "Unificada" }
    ]
  })
});
if (!multiAccountTransfer.ok) throw new Error(`Transferencia multipla de submesas falhou: ${await multiAccountTransfer.text()}`);
const multiAccountSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const multiAccountSource = multiAccountSnapshot.tables.find((table) => table.number === 25);
const multiAccountTarget = multiAccountSnapshot.tables.find((table) => table.number === 26);
if (
  multiAccountSource?.items.length
  || multiAccountSource?.subtables?.length
  || multiAccountTarget?.items.length !== 3
  || !multiAccountTarget.items.some((row) => row.id === multiTargetExisting.id)
  || multiAccountTarget.items.filter((row) => row.subtableName === "Unificada").length !== 3
) {
  throw new Error("Transferencia de varias submesas nao mesclou corretamente no destino.");
}

// Transferir contas sem escolher uma submesa unica deve preservar cada nome no
// destino. Repetir a mesma requisicao simula uma resposta perdida na rede e nao
// pode duplicar os produtos.
const preservedTestItem = { ...item, id: crypto.randomUUID(), productName: "Item da submesa Teste", subtableName: "Teste" };
const preservedFamilyItem = { ...item, id: crypto.randomUUID(), productName: "Item da submesa Familia", subtableName: "Familia" };
const preservedExistingItem = { ...item, id: crypto.randomUUID(), productName: "Item existente em Teste", subtableName: "Teste" };
for (const [tableNumber, items, subtables] of [
  [27, [preservedTestItem, preservedFamilyItem], ["Teste", "Familia"]],
  [28, [preservedExistingItem], ["Teste"]]
]) {
  const seeded = await fetch(`http://127.0.0.1:43991/api/pdv/tables/${tableNumber}/items`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ items, subtables })
  });
  if (!seeded.ok) throw new Error(`Nao foi possivel preparar preservacao de submesas: ${await seeded.text()}`);
}
const preservedTransferOperation = crypto.randomUUID();
const preservedTransferRequest = () => fetch("http://127.0.0.1:43991/api/pdv/tables/27/transfer", {
  method: "POST",
  headers: { ...headers, "x-idempotency-key": preservedTransferOperation },
  body: JSON.stringify({
    targetTableNumber: 28,
    selections: [
      { itemId: preservedTestItem.id, quantity: preservedTestItem.quantity, subtableName: "Teste" },
      { itemId: preservedFamilyItem.id, quantity: preservedFamilyItem.quantity, subtableName: "Familia" }
    ]
  })
});
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await preservedTransferRequest();
  if (!response.ok) throw new Error(`Transferencia idempotente de submesas falhou: ${await response.text()}`);
}
const preservedSnapshot = await (await fetch("http://127.0.0.1:43991/api/pdv/snapshot", { headers })).json();
const preservedSource = preservedSnapshot.tables.find((table) => table.number === 27);
const preservedTarget = preservedSnapshot.tables.find((table) => table.number === 28);
if (
  preservedSource?.items.length
  || preservedSource?.subtables?.length
  || preservedTarget?.items.length !== 3
  || preservedTarget.items.filter((row) => row.subtableName === "Teste").length !== 2
  || preservedTarget.items.filter((row) => row.subtableName === "Familia").length !== 1
  || !preservedTarget.subtables?.includes("Teste")
  || !preservedTarget.subtables?.includes("Familia")
) {
  throw new Error("Transferencia remota nao preservou e mesclou os nomes das submesas sem duplicar itens.");
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
const reconnectPayable = await pdvStore.savePayable({
  id: crypto.randomUUID(),
  description: "Conta criada enquanto cliente estava desconectado",
  supplier: "Fornecedor reconexao",
  category: "Teste de rede",
  costCenter: "Servidor",
  paymentAccount: "Caixa principal",
  tags: ["reconexao"],
  issueDate: "2030-08-01",
  dueDate: "2030-08-20",
  amount: 77,
  note: "Precisa aparecer no snapshot integral"
});

await server.start(43991, "smoke-password");
const reconnectSocket = new WebSocket(`ws://127.0.0.1:43991/sync?password=smoke-password&device=Cliente%20reconectado&version=${encodeURIComponent(appVersion)}`);
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
  || !snapshotAfterReconnect.payables.some((payable) => payable.id === reconnectPayable.id && payable.tags.includes("reconexao"))
) {
  throw new Error("A sincronizacao completa apos reconectar nao restaurou mesas, Historico e dados financeiros.");
}

await new Promise((resolve) => {
  reconnectSocket.once("close", resolve);
  reconnectSocket.close();
});
await server.stop();
if (!existsSync(path.join(dataDir, "pdv.sqlite"))) throw new Error("SQLite nao foi preservado.");
rmSync(tmp, { recursive: true, force: true });
console.log("Network smoke passed");
