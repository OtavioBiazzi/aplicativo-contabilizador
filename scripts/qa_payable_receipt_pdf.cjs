const { app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const out = path.resolve(__dirname, "../outputs/qa-ledger-actions/pdf");
app.commandLine.appendSwitch("user-data-dir", path.join(out, "profile"));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    const { PdvStore } = await import("../dist-electron/electron/pdvStore.js");
    const { buildPayableReceipt, duplicatePayableDraft, duplicateReceivableDraft } = await import("../dist-electron/src/shared/financialAccountActions.js");
    const { printPdvReceipt, buildPdvReceiptHtml } = await import("../dist-electron/electron/pdvReceipt.js");
    const { PDFDocument } = require("pdf-lib");
    await fs.mkdir(out, { recursive: true });
    const store = new PdvStore(path.join(out, "data")); await store.initialize();
    const source = await store.savePayable({ description: "Café torrado & alimentos", supplier: "Fornecedor <QA>", documentNumber: "NF-QA", amount: 120, dueDate: "2026-11-20" });
    const paid = await store.payPayable(source.id, { id: crypto.randomUUID(), payableId: source.id, createdAt: new Date().toISOString(), method: "Pix", amount: 40 });
    const copied = await store.savePayable(duplicatePayableDraft(paid));
    assert.notEqual(copied.id, paid.id); assert.equal(copied.balance, 120); assert.equal(copied.payments.length, 0);
    const customer = await store.saveCustomer({ name: "Maria PDF QA", active: true });
    const account = await store.saveReceivable({ customerId: customer.id, description: "Encomenda QA", amount: 60 });
    const received = await store.receiveReceivable(account.id, { id: crypto.randomUUID(), receivableId: account.id, createdAt: new Date().toISOString(), method: "Pix", amount: 15 });
    const copy = await store.saveReceivable(duplicateReceivableDraft(received));
    assert.notEqual(copy.saleId, received.saleId); assert.equal(copy.balance, 60); assert.equal(copy.payments.length, 0);
    const sale = buildPayableReceipt(paid);
    for (const paper of ["80", "a4"]) {
      const settings = { ...(await store.getSnapshot()).settings, receiptPaperWidth: paper };
      const html = buildPdvReceiptHtml(sale, settings, undefined, undefined, paid.supplier);
      assert.ok(html.includes("RECIBO DE CONTA A PAGAR")); assert.ok(html.includes("FORNECEDOR: Fornecedor &lt;QA&gt;")); assert.ok(html.includes("NF-QA"));
      assert.ok(html.includes("80,00")); assert.ok(html.includes("40,00")); assert.ok(!html.includes("CLIENTE:"));
      const pdf = await printPdvReceipt(sale, settings, undefined, undefined, paid.supplier);
      assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
      await fs.writeFile(path.join(out, `recibo-conta-a-pagar-${paper}.pdf`), pdf);
    }
    console.log("PASS duplicates preserve source settlements; payable receipt exports valid 80mm/A4 PDFs with supplier, document, paid and remaining amounts");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
