/* Receipt rendering and print contract checks. Never submits a Windows print job. */
const { app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const baseline = process.argv.includes("--baseline");
const out = path.resolve(__dirname, "../outputs/qa-receipt-checks", baseline ? "before" : "after");
app.commandLine.appendSwitch("user-data-dir", path.join(out, "profile"));
app.on("window-all-closed", () => {});
let activeCase = "";
let rejectPrint = false;
const measured = [];
app.on("browser-window-created", (_event, win) => {
  win.webContents.print = (options, callback) => {
    void win.webContents.executeJavaScript('({viewport:innerWidth,bodyWidth:document.body.getBoundingClientRect().width,height:document.body.getBoundingClientRect().height,footer:document.querySelector(".footer").textContent,items:document.querySelectorAll(".item").length})').then((layout) => {
      measured.push({ name: activeCase, options, layout });
      callback(!rejectPrint, rejectPrint ? "QA printer unavailable" : "");
    });
  };
});
app.whenReady().then(async () => {
  try {
    await fs.mkdir(out, { recursive: true });
    const { PdvStore } = await import("../dist-electron/electron/pdvStore.js");
    const { printPdvReceipt, printPdvReceiptDirect, buildPdvReceiptHtml } = await import("../dist-electron/electron/pdvReceipt.js");
    const store = new PdvStore(path.join(out, "data")); await store.initialize();
    const settings = { ...(await store.getSnapshot()).settings, receiptGroupIdenticalItems: false, receiptFontSize: 12, receiptFooter: "FIM DO RECIBO QA", receiptCopies: 2 };
    const makeSale = (count) => ({
      id: "qa-receipt-" + count, createdAt: "2026-10-30T12:00:00.000Z", type: "Venda direta", status: "Finalizada",
      subtotal: count * 7, discount: 0, total: count * 7,
      payments: [{ id: "qa-pix", method: "Pix", amount: count * 7 }],
      items: Array.from({length: count}, (_, i) => ({
        id: "qa-" + i, productId: "qa-" + i, productName: "Café especial QA " + String(i + 1).padStart(3, "0"),
        categoryName: "Cafés", quantity: 1, unitPrice: 7, total: 7, discount: 0,
        ...(count > 20 ? { note: "Observação do item para conferir quebra de página e legibilidade." } : {})
      }))
    });
    const reports = [];
    for (const [paper, count] of [["58", 2], ["80", 2], ["80", 200], ["custom", 2], ["a4", 2], ["a4", 100]]) {
      activeCase = paper + "-" + count;
      const config = {...settings, receiptPaperWidth: paper, receiptCustomPaperWidthMm: 72, receiptCustomPaperHeightMm: 120};
      const sale = makeSale(count);
      const html = buildPdvReceiptHtml(sale, config, undefined, undefined, "Maria <QA>");
      assert.ok(html.includes("Maria &lt;QA&gt;"));
      const pdf = await printPdvReceipt(sale, config, undefined, undefined, "Maria <QA>");
      await fs.writeFile(path.join(out, activeCase + ".pdf"), pdf);
      const parsed = await PDFDocument.load(pdf);
      const direct = await printPdvReceiptDirect(sale, config, "QA_QUEUE_NO_PAPER", undefined, undefined, "Maria <QA>");
      assert.equal(direct.ok, true); assert.equal(measured.at(-1).options.deviceName, "QA_QUEUE_NO_PAPER");
      assert.equal(measured.at(-1).options.copies, 2);
      reports.push({name: activeCase, pages: parsed.getPageCount(), sizes: parsed.getPages().map(page=>page.getSize()), print: measured.at(-1)});
    }
    activeCase = "printer-error"; rejectPrint = true;
    const failed = await printPdvReceiptDirect(makeSale(2), {...settings, receiptPaperWidth: "80"}, "QA_QUEUE_NO_PAPER");
    assert.equal(failed.ok, false); assert.match(failed.message, /QA printer unavailable/);
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports.map(r=>({name:r.name,pages:r.pages,sizes:r.sizes,viewport:r.print.layout.viewport,bodyHeight:r.print.layout.height,printSize:r.print.options.pageSize})),null,2));
    if (!baseline) {
      assert.ok(reports.find(r=>r.name==="a4-100").pages > 1, "Long A4 receipt must paginate instead of shrinking all items to one page");
      assert.ok(reports.find(r=>r.name==="80-200").pages > 1, "Long thermal receipt must paginate without truncating its final items");
      const narrow = reports.find(r=>r.name==="58-2");
      assert.ok(Math.abs(narrow.print.layout.viewport - 58/25.4*96) < 2, "58mm render uses the same physical scale as printing");
      assert.ok(reports.find(r=>r.name==="80-2").print.options.pageSize.height < 180000, "Short receipt must not reserve an empty 900px page");
      assert.ok(reports.find(r=>r.name==="custom-2").print.options.pageSize.height >= 120000, "Custom paper minimum height respected");
    }
    console.log("PASS receipt documents and simulated print queue, including explicit failure; no physical jobs submitted");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
