import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { PdvExporter } from "../dist-electron/electron/pdvExporter.js";
import { configureCoseDellAbadiaComplements, normalizeImportedProducts } from "../dist-electron/electron/productImporter.js";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";
import { pdvSaleToLedgerEntry } from "../dist-electron/src/shared/pdvLedger.js";

const root = process.cwd();
const tmp = path.join(root, ".tmp-pdv-smoke");
const dataDir = path.join(tmp, "data");
const exportDir = path.join(tmp, "exports");

rmSync(tmp, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(exportDir, { recursive: true });

const store = new PdvStore(dataDir);
await store.initialize();

const cosePreset = normalizeImportedProducts([
  { name: "CUSCUZ NORDESTINO", categoryName: "CAFE", price: 10, unit: "UNID", active: true, showOnPdv: true },
  { name: "OVO MEXIDO", categoryName: "CAFE", price: 6, unit: "UNID", active: true, showOnPdv: true },
  { name: "MANGA", categoryName: "FRUTAS", price: 11, unit: "UNID", active: true, showOnPdv: true },
  { name: "GATORADE", categoryName: "BEBIDAS", price: 9, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL OVO", categoryName: "CAFE", price: 4, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL QUEIJO", categoryName: "CAFE", price: 4, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL TOMATE", categoryName: "CAFE", price: 3, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL CEBOLA/TOMATE", categoryName: "CAFE", price: 3, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL BACON", categoryName: "CAFE", price: 4, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL MEL", categoryName: "FRUTAS", price: 2, unit: "UNID", active: true, showOnPdv: true },
  { name: "ADICIONAL MEL/GRANOLA", categoryName: "FRUTAS", price: 5, unit: "UNID", active: true, showOnPdv: true }
]);
configureCoseDellAbadiaComplements(cosePreset.products);
const cuscuzPreset = cosePreset.products.find((product) => product.name === "CUSCUZ NORDESTINO");
const eggPreset = cosePreset.products.find((product) => product.name === "OVO MEXIDO");
const gatoradePreset = cosePreset.products.find((product) => product.name === "GATORADE");
if (!cuscuzPreset?.hasComplements || cuscuzPreset.complementProductIds.length !== 5 || eggPreset?.canBeComplement || gatoradePreset?.hasComplements) {
  throw new Error("Preset Cose vinculou adicionais fora das regras esperadas.");
}

const category = await store.saveCategory({ name: "Smoke PDV", active: true, favorite: true, sortOrder: 1 });
const baseProduct = await store.saveProduct({
  name: "Cuscuz smoke",
  categoryId: category.id,
  price: 10,
  unit: "UNID",
  unitMode: "unidade",
  active: true,
  showOnPdv: true,
  favorite: true,
  canBeComplement: false,
  hasComplements: true,
  complementProductIds: [],
  sortOrder: 1
});
const complement = await store.saveProduct({
  name: "Ovo smoke",
  categoryId: category.id,
  price: 2,
  unit: "UNID",
  unitMode: "unidade",
  active: true,
  showOnPdv: true,
  favorite: false,
  canBeComplement: true,
  hasComplements: false,
  complementProductIds: [],
  sortOrder: 2
});
await store.saveProduct({ ...baseProduct, complementProductIds: [complement.id] });
const favoriteSnapshot = await store.getSnapshot();
if (!favoriteSnapshot.categories[0]?.favorite || !favoriteSnapshot.products[0]?.favorite) {
  throw new Error("Favoritos de produto/categoria nao ficaram no topo.");
}
await store.updateProducts([baseProduct.id], { favorite: false, showOnPdv: false });
const bulkSnapshot = await store.getSnapshot();
const bulkProduct = bulkSnapshot.products.find((item) => item.id === baseProduct.id);
if (!bulkProduct || bulkProduct.favorite || bulkProduct.showOnPdv) {
  throw new Error("Atualizacao em massa de favorito/visibilidade nao funcionou.");
}
await store.updateProducts([baseProduct.id], { favorite: true, showOnPdv: true });
const linkedSnapshot = await store.getSnapshot();
if (linkedSnapshot.products.find((product) => product.id === baseProduct.id)?.complementProductIds.join() !== complement.id) {
  throw new Error("Vinculo individual de adicional nao foi preservado.");
}

const sale = await store.saveSale({
  type: "Venda direta",
  items: [{
    id: crypto.randomUUID(),
    productId: baseProduct.id,
    productName: `${baseProduct.name} + ${complement.name}`,
    categoryName: category.name,
    quantity: 1,
    baseUnitPrice: baseProduct.price,
    unitPrice: baseProduct.price + complement.price,
    discount: 0,
    total: baseProduct.price + complement.price,
    complements: [{ productId: complement.id, name: complement.name, price: complement.price }]
  }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Dinheiro", amount: 12, received: 20, change: 8 }]
});
if (!(await store.getSnapshot()).products.some((product) => product.id === baseProduct.id)) {
  throw new Error("Finalizar venda direta removeu indevidamente o catalogo de produtos.");
}
const exactAmountSale = await store.saveSale({
  type: "Venda direta",
  items: [{
    id: crypto.randomUUID(),
    productId: baseProduct.id,
    productName: "Banana valor exato",
    categoryName: category.name,
    quantity: 1,
    baseUnitPrice: 2,
    unitPrice: 2,
    discount: 0,
    total: 2
  }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Pix", amount: 2 }]
});
if (exactAmountSale.total !== 2 || exactAmountSale.payments[0]?.amount !== 2) {
  throw new Error("Venda direta de R$ 2,00 perdeu centavos indevidamente.");
}
const exactMeasuredSale = await store.saveSale({
  type: "Venda direta",
  items: [{
    id: crypto.randomUUID(),
    productId: baseProduct.id,
    productName: "Mamao valor final exato",
    categoryName: category.name,
    quantity: 0.051,
    measureLabel: "51 g",
    baseUnitPrice: 40,
    unitPrice: 40,
    discount: 0,
    total: 2
  }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Pix", amount: 2 }]
});
if (exactMeasuredSale.total !== 2 || exactMeasuredSale.items[0]?.total !== 2) {
  throw new Error("Produto por peso nao preservou o valor final informado de R$ 2,00.");
}

const cancelled = await store.saveSale({
  type: "Mesa",
  tableNumber: 1,
  items: [{
    id: crypto.randomUUID(),
    productId: baseProduct.id,
    productName: "Cancelamento smoke",
    categoryName: category.name,
    quantity: 1,
    baseUnitPrice: 5,
    unitPrice: 5,
    discount: 0,
    total: 5
  }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Pix", amount: 5 }]
});
await store.cancelSale(cancelled.id);

await store.openTable(7, 2, "Smoke mesa");
await store.saveTableItems(7, [{
  id: crypto.randomUUID(),
  productId: baseProduct.id,
  productName: baseProduct.name,
  categoryName: category.name,
  quantity: 2,
  baseUnitPrice: 10,
  unitPrice: 10,
  discount: 0,
  total: 20,
  subtableName: "Cliente 1"
}]);
let tableSeven = (await store.getSnapshot()).tables.find((table) => table.number === 7);
await store.saveTableItems(7, (tableSeven?.items || []).map((item) => ({ ...item, subtableName: item.subtableName === "Cliente 1" ? "Joao" : item.subtableName })));
tableSeven = (await store.getSnapshot()).tables.find((table) => table.number === 7);
if (!tableSeven?.items.some((item) => item.subtableName === "Joao")) {
  throw new Error("Renomeacao/persistencia de submesa nao funcionou como esperado.");
}

await store.openTable(6);
await store.saveTableItems(6, [], ["Cliente sem itens"]);
const emptySubtableSnapshot = await store.getSnapshot();
const tableSix = emptySubtableSnapshot.tables.find((table) => table.number === 6);
if (!tableSix?.subtables?.includes("Cliente sem itens") || tableSix.items.length !== 0) {
  throw new Error("Submesa vazia nao foi preservada ao salvar a mesa.");
}

await store.openTable(9);
const transferItem = {
  id: crypto.randomUUID(),
  productId: baseProduct.id,
  productName: baseProduct.name,
  categoryName: category.name,
  quantity: 3,
  baseUnitPrice: 10,
  unitPrice: 10,
  discount: 0,
  total: 30
};
await store.saveTableItems(9, [transferItem]);
await store.openTable(10);
const transferRemaining = await store.transferTableItems(9, 10, [{ itemId: transferItem.id, quantity: 1, subtableName: "Grupo 1" }]);
const transferSnapshot = await store.getSnapshot();
const transferSource = transferSnapshot.tables.find((table) => table.number === 9);
const transferTarget = transferSnapshot.tables.find((table) => table.number === 10);
if (transferRemaining[0]?.quantity !== 2 || transferSource?.items[0]?.quantity !== 2 || transferTarget?.items[0]?.quantity !== 1 || transferTarget.items[0]?.subtableName !== "Grupo 1") {
  throw new Error("Transferencia atomica parcial entre mesas nao preservou as quantidades.");
}

const partialSource = tableSeven.items[0];
const partialSale = await store.closeTablePartial(7, [{ ...partialSource, quantity: 1, total: 10 }], [{ id: crypto.randomUUID(), method: "Pix", amount: 10 }]);
if (partialSale.status !== "Parcial" || partialSale.total !== 10) {
  throw new Error("Fechamento parcial nao calculou o item selecionado corretamente.");
}
const partialSnapshot = await store.getSnapshot();
const remainingTable = partialSnapshot.tables.find((table) => table.number === 7);
if (!remainingTable?.items.length || remainingTable.items[0].quantity !== 2 || remainingTable.items[0].paidQuantity !== 1 || remainingTable.total !== 10 || remainingTable.status !== "Ocupada") {
  throw new Error("Fechamento parcial nao preservou o item pago e o saldo restante da mesa.");
}
await store.closeTable(7, [{ id: crypto.randomUUID(), method: "Dinheiro", amount: 10, received: 20, change: 10 }]);
if ((await store.getSnapshot()).tables.find((table) => table.number === 7)?.status !== "Livre") {
  throw new Error("Fechamento total depois do parcial nao liberou a mesa.");
}

await store.openTable(8);
await store.saveTableItems(8, [{
  id: crypto.randomUUID(),
  productId: baseProduct.id,
  productName: baseProduct.name,
  categoryName: category.name,
  quantity: 1,
  baseUnitPrice: 10,
  unitPrice: 10,
  discount: 0,
  total: 10
}]);
const operationId = crypto.randomUUID();
const firstClose = await store.closeTable(8, [{ id: crypto.randomUUID(), method: "Pix", amount: 10 }], 0, "smoke", operationId);
const repeatedClose = await store.closeTable(8, [{ id: crypto.randomUUID(), method: "Pix", amount: 10 }], 0, "smoke", operationId);
if (firstClose.id !== repeatedClose.id || store.getSales({}).filter((item) => item.operationId === operationId).length !== 1) {
  throw new Error("Fechamento repetido nao foi protegido por chave de operacao.");
}

const snapshot = await store.getSnapshot();
const savedSale = snapshot.recentSales.find((item) => item.id === sale.id);
if (!savedSale || savedSale.items[0].complements?.[0]?.name !== complement.name) {
  throw new Error("Venda com adicional nao foi persistida corretamente.");
}
if (snapshot.recentSales.find((item) => item.id === cancelled.id)?.status !== "Cancelada") {
  throw new Error("Cancelamento nao foi persistido corretamente.");
}
if (store.getSales({ status: "Cancelada" }).length !== 1 || store.getSales({ status: "Finalizada" }).some((item) => item.id === cancelled.id)) {
  throw new Error("Filtro de status das vendas PDV nao funcionou corretamente.");
}

const updatedPaymentSale = await store.updateSalePayments(sale.id, [{ id: crypto.randomUUID(), method: "Pix", amount: 12, description: "Pessoa smoke" }]);
if (updatedPaymentSale.payments[0]?.method !== "Pix" || updatedPaymentSale.payments[0]?.amount !== 12 || updatedPaymentSale.payments[0]?.description !== "Pessoa smoke") {
  throw new Error("Alteracao de forma de pagamento nao foi persistida corretamente.");
}
const separatedPaymentsEntry = pdvSaleToLedgerEntry({
  ...updatedPaymentSale,
  payments: [
    { id: crypto.randomUUID(), method: "Debito", amount: 7 },
    { id: crypto.randomUUID(), method: "Credito", amount: 5 }
  ]
});
if (
  separatedPaymentsEntry.paymentMethod !== "Debito"
  || separatedPaymentsEntry.paymentBreakdown?.map((item) => item.method).join("|") !== "Debito|Credito"
) {
  throw new Error("Pagamento misto do PDV nao foi separado para historico e relatorios.");
}
try {
  await store.updateSalePayments(sale.id, [{ id: crypto.randomUUID(), method: "Pix", amount: 13 }]);
  throw new Error("Pagamento acima do total foi aceito indevidamente.");
} catch (error) {
  if (!String(error?.message || error).includes("Pagamentos precisam somar")) {
    throw error;
  }
}

const backupBase64 = await store.exportBackupBase64();
await store.saveProduct({ ...baseProduct, name: "Produto alterado temporariamente" });
await store.restoreBackupBase64(backupBase64);
if (!(await store.getSnapshot()).products.some((product) => product.id === baseProduct.id && product.name === baseProduct.name)) {
  throw new Error("Backup SQLite nao restaurou o cadastro original.");
}

await store.replaceProducts(snapshot.categories, snapshot.products, "smoke.xlsx");
const productsAfterFirstImport = (await store.getSnapshot()).products.length;
await store.replaceProducts(snapshot.categories, snapshot.products, "smoke.xlsx");
if ((await store.getSnapshot()).products.length !== productsAfterFirstImport) {
  throw new Error("Reimportacao de produtos duplicou o cadastro.");
}
const backupDir = path.join(dataDir, "pdv-backups");
if (!existsSync(backupDir) || !readdirSync(backupDir).some((file) => file.includes("antes-importacao-produtos"))) {
  throw new Error("Backup automatico do SQLite nao foi criado antes da importacao.");
}
if (!readdirSync(backupDir).some((file) => file.includes("automatico"))) {
  throw new Error("Backup diario automatico do SQLite nao foi criado.");
}

const exportStatus = await new PdvExporter(exportDir).exportSales(store.getSales({}), {});
if (!exportStatus.ok || !exportStatus.filePath) {
  throw new Error(exportStatus.message || "Exportacao PDV falhou.");
}
const zip = await JSZip.loadAsync(readFileSync(exportStatus.filePath));
const workbook = await zip.file("xl/workbook.xml").async("string");
if (!["Resumo", "Vendas", "Itens", "Pagamentos"].every((sheet) => workbook.includes(sheet))) {
  throw new Error("XLSX PDV nao contem as abas esperadas.");
}
const paymentsSheet = await zip.file("xl/worksheets/sheet4.xml").async("string");
if (!paymentsSheet.includes("Pix") || !paymentsSheet.includes("<v>12</v>")) {
  throw new Error("XLSX PDV nao registrou pagamento/recebido/troco como esperado.");
}

const integratedExportStatus = await new PdvExporter(exportDir).exportSales(store.getSales({}), {}, [{
  id: "legacy-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "Venda",
  originalValue: 7,
  finalValue: 7,
  people: 1,
  perPerson: 7,
  roundingStep: 0,
  roundingDirection: "nearest",
  difference: 0,
  description: "Venda antiga smoke",
  tableNumber: "",
  busNumber: "",
  paymentMethod: "Dinheiro",
  paidWith: 10,
  change: 3,
  observations: "",
  originDevice: "smoke",
  status: "active"
}]);
if (!integratedExportStatus.ok || !integratedExportStatus.filePath) {
  throw new Error(integratedExportStatus.message || "Exportacao integrada falhou.");
}
const integratedZip = await JSZip.loadAsync(readFileSync(integratedExportStatus.filePath));
const integratedSalesSheet = await integratedZip.file("xl/worksheets/sheet2.xml").async("string");
if (!integratedSalesSheet.includes("Venda antiga smoke")) {
  throw new Error("Exportacao do PDV nao incluiu o lancamento antigo integrado.");
}

const corruptDir = path.join(tmp, "corrupt");
mkdirSync(corruptDir, { recursive: true });
writeFileSync(path.join(corruptDir, "pdv.sqlite"), "arquivo invalido");
try {
  await new PdvStore(corruptDir).initialize();
  throw new Error("Banco corrompido foi aberto como banco novo.");
} catch (error) {
  if (!String(error?.message || error).includes("backup foi preservado")) {
    throw error;
  }
}
if (!readdirSync(corruptDir).some((file) => file.startsWith("pdv-corrompido-"))) {
  throw new Error("Backup do banco corrompido nao foi preservado.");
}

rmSync(tmp, { recursive: true, force: true });
console.log("PDV smoke passed");
