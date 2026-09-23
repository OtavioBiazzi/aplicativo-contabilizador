import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";

const workspace = path.resolve(process.cwd());
const tmp = path.resolve(workspace, ".tmp-cash-shift-smoke");
if (path.dirname(tmp) !== workspace) throw new Error("Temporary test directory escaped the workspace.");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const store = new PdvStore(tmp);
await store.initialize();
await store.saveSettings({ cashControlMode: "manual" });

const opened = await store.openCashShift(100, "Smoke", "Operador de teste", "Troco inicial");
if (opened.status !== "Aberto" || opened.expectedAmount !== 100 || opened.responsible !== "Operador de teste" || opened.openingNote !== "Troco inicial") {
  throw new Error("A abertura do caixa nao foi persistida corretamente.");
}

await store.addCashMovement("Suprimento", 20, "Troco adicional", "Smoke");
await store.addCashMovement("Sangria", 5, "Retirada", "Smoke");

await store.saveSale({
  type: "Venda direta",
  items: [{
    id: crypto.randomUUID(),
    productId: "cash-smoke-product",
    productName: "Produto smoke",
    categoryName: "Smoke",
    quantity: 1,
    baseUnitPrice: 30,
    unitPrice: 30,
    discount: 0,
    total: 30
  }],
  discount: 0,
  payments: [{ id: crypto.randomUUID(), method: "Dinheiro", amount: 30, received: 35, change: 5 }]
});

const customer = await store.saveCustomer({ name: "Cliente smoke" });
const receivable = await store.saveReceivable({ customerId: customer.id, description: "Conta smoke", amount: 10 });
if ((await store.getSnapshot()).currentCashShift?.expectedAmount !== 145) {
  throw new Error("O titulo em aberto entrou no dinheiro fisico antes do recebimento.");
}
await store.receiveReceivable(receivable.id, { id: crypto.randomUUID(), receivableId: receivable.id, method: "Dinheiro", amount: 10 });
const payable = await store.savePayable({ description: "Despesa smoke", dueDate: new Date().toISOString().slice(0, 10), amount: 8 });
await store.payPayable(payable.id, { id: crypto.randomUUID(), payableId: payable.id, method: "Dinheiro", amount: 8 });

const running = (await store.getSnapshot()).currentCashShift;
if (!running || running.expectedAmount !== 147 || running.movements.length !== 3) {
  throw new Error(`Saldo esperado do caixa ficou inconsistente: ${running?.expectedAmount}.`);
}

let rejectedDifferenceWithoutNote = false;
try { await store.closeCashShift(145, "Smoke"); } catch { rejectedDifferenceWithoutNote = true; }
if (!rejectedDifferenceWithoutNote) throw new Error("O fechamento com diferenca deveria exigir uma justificativa.");
const closed = await store.closeCashShift(145, "Smoke", "Faltaram R$ 2,00 na contagem");
if (closed.status !== "Fechado" || closed.expectedAmount !== 147 || closed.difference !== -2 || closed.closingNote !== "Faltaram R$ 2,00 na contagem" || closed.closingDevice !== "Smoke") {
  throw new Error("O fechamento do caixa nao calculou a diferenca corretamente.");
}

const finalSnapshot = await store.getSnapshot();
if (finalSnapshot.currentCashShift || finalSnapshot.recentCashShifts[0]?.id !== closed.id) {
  throw new Error("O caixa fechado nao foi movido para o historico.");
}

rmSync(tmp, { recursive: true, force: true });
console.log("smoke_cash_shift: ok");
