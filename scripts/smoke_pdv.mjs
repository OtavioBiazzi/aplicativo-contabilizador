import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { PdvExporter } from "../dist-electron/electron/pdvExporter.js";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";

const root = process.cwd();
const tmp = path.join(root, ".tmp-pdv-smoke");
const dataDir = path.join(tmp, "data");
const exportDir = path.join(tmp, "exports");

rmSync(tmp, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(exportDir, { recursive: true });

const store = new PdvStore(dataDir);
await store.initialize();

const category = await store.saveCategory({ name: "Smoke PDV", active: true, sortOrder: 1 });
const baseProduct = await store.saveProduct({
  name: "Cuscuz smoke",
  categoryId: category.id,
  price: 10,
  unit: "UNID",
  unitMode: "unidade",
  active: true,
  showOnPdv: true,
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
  canBeComplement: true,
  hasComplements: false,
  complementProductIds: [],
  sortOrder: 2
});
await store.saveProduct({ ...baseProduct, complementProductIds: [complement.id] });

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

const snapshot = await store.getSnapshot();
const savedSale = snapshot.recentSales.find((item) => item.id === sale.id);
if (!savedSale || savedSale.items[0].complements?.[0]?.name !== complement.name) {
  throw new Error("Venda com adicional nao foi persistida corretamente.");
}
if (snapshot.recentSales.find((item) => item.id === cancelled.id)?.status !== "Cancelada") {
  throw new Error("Cancelamento nao foi persistido corretamente.");
}

const updatedPaymentSale = await store.updateSalePayments(sale.id, [{ id: crypto.randomUUID(), method: "Pix", amount: 12 }]);
if (updatedPaymentSale.payments[0]?.method !== "Pix" || updatedPaymentSale.payments[0]?.amount !== 12) {
  throw new Error("Alteracao de forma de pagamento nao foi persistida corretamente.");
}

await store.replaceProducts(snapshot.categories, snapshot.products, "smoke.xlsx");
const backupDir = path.join(dataDir, "pdv-backups");
if (!existsSync(backupDir) || !readdirSync(backupDir).some((file) => file.includes("antes-importacao-produtos"))) {
  throw new Error("Backup automatico do SQLite nao foi criado antes da importacao.");
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

rmSync(tmp, { recursive: true, force: true });
console.log("PDV smoke passed");
