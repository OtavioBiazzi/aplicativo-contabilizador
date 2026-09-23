import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";

const dataDirectory = await mkdtemp(path.join(tmpdir(), "caixa-concurrent-"));
const store = new PdvStore(dataDirectory);
const item = (id, name, subtable) => ({
  id,
  productId: id,
  productName: name,
  categoryName: "Teste",
  quantity: 1,
  unitPrice: 10,
  discount: 0,
  total: 10,
  subtableName: subtable
});

try {
  await store.initialize();
  await store.openTable(1, 2, "");

  await store.saveTableItems(1, [item("a", "Cafe", "A")], ["A"], []);
  await store.saveTableItems(1, [item("b", "Bolo", "B")], ["B"], []);
  let table = (await store.getSnapshot()).tables.find((entry) => entry.number === 1);
  assert.deepEqual(table.items.map((entry) => entry.id).sort(), ["a", "b"]);
  assert.deepEqual([...table.subtables].sort(), ["A", "B"]);

  await store.saveTableItems(1, [{ ...item("a", "Cafe", "A"), quantity: 2, total: 20 }], ["A"], ["a"]);
  table = (await store.getSnapshot()).tables.find((entry) => entry.number === 1);
  assert.equal(table.items.find((entry) => entry.id === "a").quantity, 2);
  assert.ok(table.items.some((entry) => entry.id === "b"), "item criado pelo outro terminal deve permanecer");

  await store.saveTableItems(1, [], ["A"], ["a"]);
  table = (await store.getSnapshot()).tables.find((entry) => entry.number === 1);
  assert.deepEqual(table.items.map((entry) => entry.id), ["b"], "remocao local nao pode apagar item concorrente");
  console.log("smoke_concurrent_tables: ok");
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
}
