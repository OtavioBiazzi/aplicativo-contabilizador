import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PdvStore } from '../dist-electron/electron/pdvStore.js';
import { DeferredTask } from '../dist-electron/electron/deferredTask.js';
import { LedgerExporter } from '../dist-electron/electron/exporter.js';
import { pdvSaleToLedgerEntry } from '../dist-electron/src/shared/pdvLedger.js';
import { createHistoryDescriptionLookup } from '../dist-electron/src/shared/historyDescription.js';

const store = new PdvStore(await mkdtemp(path.join(os.tmpdir(), 'caixa-history-')));
await store.initialize();
const item = (subtableName = '') => ({ id: crypto.randomUUID(), productId: 'qa', productName: 'Cafe', categoryName: 'Cafe', quantity: 1, unitPrice: 10, discount: 0, total: 10, subtableName });
const payment = (description) => [{ id: crypto.randomUUID(), method: 'Pix', amount: 10, description }];
await store.openTable(16, 1, 'Temporaria 1');
await store.saveTableItems(16, [item()]);
const full = await store.closeTable(16, payment('Joao'), 0, 'Cliente', 'full-name');
assert.equal(full.description, 'Temporaria 1');
assert.equal(pdvSaleToLedgerEntry(full).description, 'Temporaria 1 · Joao');
await store.openTable(16, 1, 'Temporaria 2');
const ana = item('Ana'), main = item();
await store.saveTableItems(16, [main, ana], ['Ana']);
const sessionId = store.getTable(16).sessionId;
const scoped = await store.closeTablePartial(16, [ana], payment('Identificacao do fechamento'), 0, 'Cliente', 'scope-name', 'Submesa: Ana. Identificacao do fechamento', { kind: 'subtable', subtableName: 'Ana', sessionId });
assert.equal(scoped.description, 'Temporaria 2 · Ana');
assert.equal(pdvSaleToLedgerEntry(scoped).description, 'Temporaria 2 · Ana · Identificacao do fechamento');
assert.equal(store.getTable(16).items.length, 1);
const legacy = { ...scoped, description: 'Mesa 16' };
assert.equal(pdvSaleToLedgerEntry(legacy).description, 'Mesa 16 · Ana · Identificacao do fechamento');
assert.equal(pdvSaleToLedgerEntry({ ...legacy, payments: payment(legacy.observations) }).description, 'Mesa 16 · Ana · Identificacao do fechamento');
assert.equal(pdvSaleToLedgerEntry({ ...scoped, description:'Temporaria 2 · Dr. Ana', observations:'Submesa: Dr. Ana.', payments:payment('Submesa: Dr. Ana.') }).description, 'Temporaria 2 · Dr. Ana');
const cancelled = await store.cancelTable(16, 'Cliente');
assert.equal(pdvSaleToLedgerEntry(cancelled).description, 'Temporaria 2');
assert.equal(store.getTable(16).status, 'Livre');
const lookup = createHistoryDescriptionLookup([{ saleId: full.id, customerName: 'Maria' }], []);
assert.equal(lookup(pdvSaleToLedgerEntry(full), full), 'Temporaria 1 · Joao · Maria');
assert.equal(lookup({ ...pdvSaleToLedgerEntry(full), sourceSaleId: undefined }), 'Temporaria 1 · Joao');

// A slow derived export must not delay scheduling a committed mutation. Multiple
// requests coalesce; a mutation during export causes a follow-up; quit flushes it.
let count = 0, release;
const blocked = new Promise(resolve => { release = resolve; });
const deferred = new DeferredTask(async () => { count++; if (count === 1) await blocked; }, 10000);
for (let i = 0; i < 20; i++) deferred.schedule();
assert.equal(count, 0);
const flushing = deferred.flush();
await Promise.resolve();
assert.equal(count, 1);
deferred.schedule();
release();
await flushing;
assert.equal(count, 2);

const exporter = new LedgerExporter(os.tmpdir());
let activeExports = 0, maximumExports = 0;
exporter.exportNow = async (entries) => {
  activeExports++; maximumExports = Math.max(maximumExports, activeExports);
  await new Promise(resolve => setTimeout(resolve, 5));
  activeExports--;
  if (entries[0] === 'fail') throw new Error('test export failure');
  return { ok:true, pendingCount:0 };
};
const exports = await Promise.allSettled([exporter.export(['fail'], {}), exporter.export(['next'], {}), exporter.export(['last'], {})]);
assert.equal(maximumExports, 1);
assert.equal(exports.filter(result => result.status === 'fulfilled').length, 2);
await deferred.flush();
assert.equal(count, 2);

// Large isolated fixture: compare complete ledger equivalence and measure the
// products avoided by operational /entries reads (not an end-to-end LAN claim).
const db = store.requireDb();
db.run('BEGIN');
const now = new Date().toISOString();
for (let sale = 0; sale < 1500; sale++) {
  const id = `stress-${sale}`;
  db.run("INSERT INTO sales(id,created_at,type,subtotal,discount,total,description) VALUES (?,?,'Venda direta',100,0,100,'Teste')", [id, now]);
  db.run("INSERT INTO sale_payments(id,sale_id,method,amount) VALUES (?,?,'Dinheiro',100)", [`pay-${sale}`, id]);
  for (let product = 0; product < 10; product++) db.run("INSERT INTO sale_items(id,sale_id,product_id,product_name,category_name,quantity,unit_price,discount,total) VALUES (?,?,'qa','Cafe','Cafe',1,10,0,10)", [`item-${sale}-${product}`,id]);
}
db.run('COMMIT');
const before = performance.now();
const complete = store.getSales().map(pdvSaleToLedgerEntry);
const fullMs = performance.now() - before;
const after = performance.now();
const lightweight = store.getSalesForLedger().map(pdvSaleToLedgerEntry);
const lightMs = performance.now() - after;
assert.deepEqual(lightweight, complete);
await store.openCashShift(50);
const cashSale = await store.saveSale({ type:'Venda direta', items:[item()], discount:0, payments:[{ id:crypto.randomUUID(),method:'Dinheiro',amount:10,received:20,change:10 }] });
const expected = 50 + store.getSales().filter(s => s.status !== 'Cancelada' && s.createdAt >= store.getCurrentCashShift().openedAt).flatMap(s => s.payments).filter(p => p.method === 'Dinheiro').reduce((sum,p) => sum+p.amount,0);
assert.equal(store.getCurrentCashShift().expectedAmount, expected);
await store.cancelSale(cashSale.id);
assert.equal(store.getCurrentCashShift().expectedAmount, expected - 10);
console.log(JSON.stringify({ names:'passed', cancellation:'passed', deferredExport:'passed', ledgerEquality:'passed', fixtureSales:1500, fixtureProducts:15000, fullLedgerMs:Math.round(fullMs), lightweightLedgerMs:Math.round(lightMs) }));
