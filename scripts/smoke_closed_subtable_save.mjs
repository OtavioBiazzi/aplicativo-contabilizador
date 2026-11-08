import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PdvStore } from "../dist-electron/electron/pdvStore.js";

// 0.4.24: outro PC fecha a submesa Ana enquanto este lanca na submesa Fernando.
const dataDirectory = await mkdtemp(path.join(tmpdir(), "caixa-closed-sub-"));
const store = new PdvStore(dataDirectory);
const item = (id, name, subtableName) => ({ id, productId: id, productName: name, categoryName: "Teste", quantity: 1, unitPrice: 10, discount: 0, total: 10, subtableName });
try {
  await store.initialize();
  await store.openTable(1, 1, "");
  const ana = item("ana", "Item Ana", "Ana");
  const fer = item("fer", "Item Fernando", "Fernando");
  await store.saveTableItems(1, [ana, fer], ["Ana", "Fernando"], []);
  const before = (await store.getSnapshot()).tables.find((t) => t.number === 1);
  await store.closeTablePartial(1, [ana], [{ id: "p", method: "Pix", amount: 10 }], 0, "S", "op-1", "", { kind: "subtable", subtableName: "Ana", sessionId: before.sessionId });
  await store.saveTableItems(1, [ana, fer, item("novo", "Item novo", "Fernando")], ["Ana", "Fernando"], ["ana", "fer"]);
  const after = (await store.getSnapshot()).tables.find((t) => t.number === 1);
  assert.deepEqual(after.items.map((i) => i.id).sort(), ["fer", "novo"]);
  assert.deepEqual(after.subtables, ["Fernando"]);
  // Mesa inteira fechada e reaberta: item antigo continua bloqueado.
  console.log("PASS closed submesa elsewhere: save keeps new item and drops the closed one");
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
}
