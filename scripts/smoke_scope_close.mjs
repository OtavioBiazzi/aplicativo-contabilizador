import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";

await mkdir("outputs", { recursive: true });
const directory = await mkdtemp(path.resolve("outputs/scope-close-"));
const store = new PdvStore(directory);
await store.initialize();
const category = await store.saveCategory({ name: "Teste fechamento", sortOrder: 0 });
const product = await store.saveProduct({ name: "Refeição", categoryId: category.id, price: 20, unit: "UNID", unitMode: "unidade", active: true });
const item = (name) => ({ id: crypto.randomUUID(), productId: product.id, productName: product.name, categoryName: category.name, quantity: 1, unitPrice: 20, discount: 0, total: 20, subtableName: name });
const payment = [{ id: crypto.randomUUID(), method: "Debito", amount: 20 }];
const ronaldo = item("Ronaldo"), ana = item("Ana");
await store.openTable(1, 4);
await store.saveTableItems(1, [ronaldo, ana], ["Ronaldo", "Ana"]);
const table = (await store.getSnapshot()).tables.find((row) => row.number === 1);
const scope = { kind: "subtable", subtableName: "Ronaldo", sessionId: table.sessionId };
const results = await Promise.allSettled([
  store.closeTablePartial(1, [ronaldo], payment, 0, "Caixa 1", "close-ronaldo", "", scope),
  store.closeTablePartial(1, [ronaldo], payment, 0, "Caixa 2", "other-operation", "", scope)
]);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "Two cashiers must not close the same account twice");
const sale = results.find((result) => result.status === "fulfilled").value;
assert.equal(sale.status, "Finalizada");
let snapshot = await store.getSnapshot();
assert.equal(snapshot.recentSales.length, 1);
assert.deepEqual(snapshot.tables.find((row) => row.number === 1).subtables, ["Ana"]);
assert.deepEqual(snapshot.tables.find((row) => row.number === 1).items.map((row) => row.id), [ana.id]);
await assert.rejects(store.saveTableItems(1, [ronaldo, ana], ["Ronaldo", "Ana"]), /já foi fechada/);
assert.equal((await store.closeTablePartial(1, [ronaldo], payment, 0, "Caixa 1", "close-ronaldo", "", scope)).id, sale.id);
await assert.rejects(store.closeTablePartial(1, [ronaldo], [{ ...payment[0], amount: 21 }], 0, "Caixa 1", "close-ronaldo", "", scope), /outro pagamento/);

// Reopen from the persisted file to simulate a lost response and process restart.
const reloaded = new PdvStore(directory);
await reloaded.initialize();
assert.equal((await reloaded.closeTablePartial(1, [ronaldo], payment, 0, "Caixa 1", "close-ronaldo", "", scope)).id, sale.id);
const newRonaldo = item("Ronaldo");
await reloaded.saveTableItems(1, [ana, newRonaldo], ["Ana", "Ronaldo"]);
await assert.rejects(reloaded.closeTablePartial(1, [ronaldo], payment, 0, "Caixa 2", "late-old-account", "", scope), /alterada/);
await reloaded.closeTablePartial(1, [newRonaldo], [{ ...payment[0], id: crypto.randomUUID() }], 0, "Caixa 1", "new-ronaldo", "", scope);
const anaScope = { ...scope, subtableName: "Ana" };
await reloaded.closeTablePartial(1, [ana], [{ ...payment[0], id: crypto.randomUUID() }], 0, "Caixa 1", "ana", "", anaScope);
snapshot = await reloaded.getSnapshot();
assert.equal(snapshot.tables.find((row) => row.number === 1).status, "Livre");
assert.equal(snapshot.recentSales.length, 3);
await assert.rejects(reloaded.saveTableItems(1, [ana], ["Ana"]), /já foi fechada/);
await reloaded.openTable(1, 2);
const nextVisit = item("Ronaldo");
await reloaded.saveTableItems(1, [nextVisit], ["Ronaldo"]);
await assert.rejects(reloaded.closeTablePartial(1, [nextVisit], payment, 0, "Caixa 1", "old-session", "", scope), /outro atendimento/);

// Items added on another terminal cannot disappear as part of an outdated close.
const session = (await reloaded.getSnapshot()).tables.find((row) => row.number === 1).sessionId;
const extra = item("Ronaldo");
await reloaded.saveTableItems(1, [nextVisit, extra], ["Ronaldo"]);
await assert.rejects(reloaded.closeTablePartial(1, [nextVisit], payment, 0, "Caixa 1", "missing-item", "", { ...scope, sessionId: session }), /alterada/);
console.log("Scope close smoke passed: simultaneous requests, stale save, retry, restart, reused name, new session and changed scope.");
