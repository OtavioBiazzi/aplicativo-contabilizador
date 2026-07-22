import { BrowserWindow } from "electron";
import { PDFDocument } from "pdf-lib";
import type { PdvCustomer, PdvReceivable, PdvSale, PdvSettings } from "../src/shared/pdvTypes.js";
import { groupPdvReceiptItems } from "../src/shared/pdvReceipt.js";

export async function printPdvReceipt(
  sale: PdvSale,
  settings: PdvSettings,
  customer?: PdvCustomer,
  receivable?: PdvReceivable,
  customerName?: string,
  customerDocumentOverride?: string
): Promise<Buffer> {
  const paper = receiptPaper(settings);
  const window = new BrowserWindow({
    show: false,
    width: paper.viewportWidth,
    height: 900,
    webPreferences: { sandbox: true }
  });
  try {
    const html = buildPdvReceiptHtml(sale, settings, customer, receivable, customerName, customerDocumentOverride);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const contentHeight = await window.webContents.executeJavaScript(
      "document.fonts.ready.then(() => Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 420)))"
    ) as number;
    const viewportWidth = paper.viewportWidth;
    const viewportHeight = Math.max(420, Math.min(20000, contentHeight + 8));
    window.setContentSize(viewportWidth, viewportHeight);
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: viewportWidth, height: viewportHeight });
    const pdf = await PDFDocument.create();
    const png = await pdf.embedPng(image.toPNG());
    if (settings.receiptPaperWidth === "a4") {
      const page = pdf.addPage([595.28, 841.89]);
      const maxWidth = 535;
      const maxHeight = 782;
      const scale = Math.min(maxWidth / png.width, maxHeight / png.height);
      const width = png.width * scale;
      const height = png.height * scale;
      page.drawImage(png, { x: (595.28 - width) / 2, y: 841.89 - height - 30, width, height });
    } else {
      const pageWidth = paper.widthMm * 2.83465;
      const dynamicHeight = pageWidth * (png.height / png.width);
      const configuredHeight = settings.receiptPaperWidth === "custom" ? paper.heightMm * 2.83465 : 0;
      const pageHeight = Math.max(120, configuredHeight, dynamicHeight);
      const page = pdf.addPage([pageWidth, pageHeight]);
      const imageHeight = Math.min(pageHeight, dynamicHeight);
      page.drawImage(png, { x: 0, y: pageHeight - imageHeight, width: pageWidth, height: imageHeight });
    }
    return Buffer.from(await pdf.save());
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function printPdvReceiptDirect(
  sale: PdvSale,
  settings: PdvSettings,
  printerName: string,
  customer?: PdvCustomer,
  receivable?: PdvReceivable,
  customerName?: string,
  customerDocumentOverride?: string
): Promise<{ ok: boolean; message: string }> {
  const paper = receiptPaper(settings);
  const window = new BrowserWindow({
    show: false,
    width: paper.viewportWidth,
    height: 900,
    webPreferences: { sandbox: true }
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildPdvReceiptHtml(sale, settings, customer, receivable, customerName, customerDocumentOverride))}`);
    let directHeightMm = paper.heightMm;
    if (settings.receiptPaperWidth !== "a4") {
      const contentHeight = await window.webContents.executeJavaScript(
        "document.fonts.ready.then(() => Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 240)))"
      ) as number;
      directHeightMm = Math.max(60, Math.ceil((contentHeight / 96) * 25.4 + 4));
      window.setContentSize(paper.viewportWidth, Math.max(240, contentHeight + 8));
      await window.webContents.executeJavaScript(`
        (() => {
          const style = document.createElement("style");
          style.textContent = "@page { margin: 0; size: ${paper.widthMm}mm ${directHeightMm}mm; }";
          document.head.appendChild(style);
        })()
      `);
    }
    return await new Promise((resolve) => {
      window.webContents.print({
        silent: true,
        deviceName: printerName,
        printBackground: true,
        color: Boolean(settings.receiptUseColor),
        landscape: false,
        scaleFactor: 100,
        pageSize: settings.receiptPaperWidth === "a4"
          ? "A4"
          : { width: Math.round(paper.widthMm * 1000), height: Math.round(directHeightMm * 1000) },
        copies: Math.max(1, Math.min(5, settings.receiptCopies || 1)),
        margins: { marginType: "none" }
      }, (success, reason) => resolve({
        ok: success,
        message: success ? "Recibo enviado para a impressora." : reason || "A impressora nao aceitou o documento."
      }));
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export function buildPdvReceiptHtml(
  sale: PdvSale,
  settings: PdvSettings,
  customer?: PdvCustomer,
  receivable?: PdvReceivable,
  customerName?: string,
  customerDocumentOverride?: string
): string {
  const paper = receiptPaper(settings);
  const width = settings.receiptPaperWidth === "a4" ? "190mm" : `${Math.max(36, paper.widthMm - 3)}mm`;
  const pageSize = `${paper.widthMm}mm ${paper.heightMm}mm`;
  const accentColor = settings.receiptUseColor ? "#0f5f96" : "#111";
  const paidTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalChange = sale.payments.reduce((sum, payment) => sum + (payment.change || 0), 0);
  const pendingTotal = Math.max(0, sale.total - paidTotal);
  const payments = sale.payments.map((payment) => `
    <div class="row"><span>${escapeHtml(payment.method)}${payment.description ? ` - ${escapeHtml(payment.description)}` : ""}</span><b>${money(payment.amount)}</b></div>
    ${payment.received ? `<div class="subrow"><span>Recebido</span><b>${money(payment.received)}</b></div>` : ""}
    ${payment.change ? `<div class="subrow"><span>Troco</span><b>${money(payment.change)}</b></div>` : ""}
  `).join("");
  const receiptItems = settings.receiptGroupIdenticalItems === false ? sale.items : groupPdvReceiptItems(sale.items);
  const items = receiptItems.map((item, index) => `
    <div class="item">
      <div class="row item-main"><span>${String(index + 1).padStart(2, "0")} ${formatQuantity(item.quantity)} ${escapeHtml(item.productName)}</span><b>${money(item.total)}</b></div>
      ${item.complements?.length ? `<small>+ ${escapeHtml(item.complements.map((value) => value.name).join(", "))}</small>` : ""}
      ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
    </div>
  `).join("");
  const businessLines = [
    settings.receiptBusinessAddress,
    settings.receiptBusinessDocument ? `CNPJ/CPF: ${settings.receiptBusinessDocument}` : "",
    settings.receiptBusinessStateRegistration ? `IE: ${settings.receiptBusinessStateRegistration}` : "",
    settings.receiptBusinessPhone ? `Fone: ${settings.receiptBusinessPhone}` : ""
  ].filter(Boolean);
  const displayCustomerName = customerName || customer?.name || "";
  const customerDocument = customerDocumentOverride || customer?.document || "";
  const orderNumber = sale.operationId || sale.id;
  const receiptStatus = pendingTotal > 0.009 ? "CONTA EM ABERTO" : "COMPROVANTE DE PAGAMENTO";
  const accountReceipts = receivable?.payments.map((payment) => `
    <div class="item">
      <div class="row"><span>${escapeHtml(payment.method)} - ${new Date(payment.createdAt).toLocaleDateString("pt-BR")}</span><b>${money(payment.amount)}</b></div>
      ${payment.description ? `<small>${escapeHtml(payment.description)}</small>` : ""}
      ${payment.change ? `<small>Recebido ${money(payment.received || payment.amount)} | Troco ${money(payment.change)}</small>` : ""}
    </div>
  `).join("") || "";
  return `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: ${pageSize}; }
    * { box-sizing: border-box; }
    body { width: ${width}; margin: 0 auto; padding: 3mm 2.4mm 5mm; color: #080808; font: 11.5px/1.25 Arial, sans-serif; }
    h1, p { margin: 0; text-align: center; }
    h1 { font-size: 15px; line-height: 1.05; text-transform: uppercase; }
    h2 { margin: 5px 0 2px; font-size: 11px; text-transform: uppercase; }
    .top { display: grid; grid-template-columns: ${settings.receiptShowLogo !== false && settings.receiptLogoDataUrl ? "15mm minmax(0, 1fr)" : "1fr"}; gap: 1.5mm; align-items: start; }
    .top-text { text-align: ${settings.receiptShowLogo !== false && settings.receiptLogoDataUrl ? "left" : "center"}; }
    .top-text p, .top-text h1 { text-align: inherit; }
    .logo { display: block; width: 14mm; max-height: 13mm; margin-top: 1mm; object-fit: contain; object-position: left top; filter: ${settings.receiptUseColor ? "none" : "grayscale(1)"}; }
    .box { border: 1px solid #111; margin: 4px 0; }
    .box-title { padding: 3px 4px; border-bottom: 1px solid #111; font-weight: 800; text-transform: uppercase; }
    .section { padding: 3px 4px; }
    .divider { border-top: 1px solid #111; margin: 5px 0; }
    .dashed { border-top-style: dashed; }
    .row, .subrow { display: flex; justify-content: space-between; gap: 8px; }
    .row span, .subrow span { min-width: 0; overflow-wrap: anywhere; }
    .subrow { padding-left: 8px; font-size: 10px; color: #222; }
    .status { margin: 4px 0; padding: 3px; border: 1.5px solid ${accentColor}; color: ${accentColor}; text-align: center; font-size: 12px; font-weight: 900; letter-spacing: .4px; }
    .columns { display: grid; grid-template-columns: 10mm minmax(0, 1fr) 18mm; gap: 3px; font-weight: 800; border-bottom: 1px solid #111; padding: 3px 4px; }
    .item { padding: 2px 4px; border-bottom: 1px solid #ddd; }
    .item-main span { font-weight: 700; }
    small { display: block; padding-left: 13mm; color: #222; }
    .total { color: ${accentColor}; font-size: 15px; font-weight: 900; }
    .footer { margin-top: 12px; text-align: center; font-size: 10px; }
  </style></head><body>
    <div class="top">
      ${settings.receiptShowLogo !== false && settings.receiptLogoDataUrl ? `<img class="logo" src="${escapeHtml(settings.receiptLogoDataUrl)}" alt="Logotipo">` : ""}
      <div class="top-text">
        <h1>${escapeHtml(!settings.receiptBusinessName || settings.receiptBusinessName.trim().toLocaleLowerCase("pt-BR") === "contabilizador caixa" ? "RECIBO" : settings.receiptBusinessName)}</h1>
        ${businessLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
    </div>
    <div class="status">${receiptStatus}</div>
    <div class="box">
      <div class="box-title">${sale.tableNumber ? `MESA: ${String(sale.tableNumber).padStart(3, "0")}` : escapeHtml(sale.type || "VENDA")}</div>
      <div class="section">
        <div class="row"><span>PEDIDO: ${escapeHtml(String(orderNumber).slice(0, 12))}</span><b>${new Date(sale.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</b></div>
        ${displayCustomerName ? `<div>CLIENTE: ${escapeHtml(displayCustomerName)}</div>` : ""}
        ${customerDocument ? `<div>CPF/CNPJ: ${escapeHtml(customerDocument)}</div>` : ""}
      </div>
    </div>
    <div class="columns"><span>QTD</span><span>DESCRICAO</span><span>TOTAL</span></div>
    ${items}
    <div class="divider dashed"></div>
    <div class="row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>
    <div class="row"><span>Desconto</span><b>${money(sale.discount)}</b></div>
    <div class="row total"><span>Total</span><b>${money(sale.total)}</b></div>
    <div class="divider"></div>
    <div class="row"><span>Total pago</span><b>${money(paidTotal)}</b></div>
    ${totalChange > 0 ? `<div class="row"><span>Troco</span><b>${money(totalChange)}</b></div>` : ""}
    <div class="row"><span>Total a pagar</span><b>${money(pendingTotal)}</b></div>
    <h2>Pagamentos</h2>
    ${payments || "<small>Nenhum pagamento registrado.</small>"}
    ${receivable ? `
      <div class="divider"></div>
      <h2>Recebimentos da conta</h2>
      ${accountReceipts || "<small>Nenhum recebimento registrado.</small>"}
      <div class="row"><span>Total recebido</span><b>${money(receivable.receivedAmount)}</b></div>
      <div class="row"><span>Saldo a receber</span><b>${money(receivable.balance)}</b></div>
      ${receivable.dueDate ? `<div class="row"><span>Vencimento</span><b>${escapeHtml(receivable.dueDate.split("-").reverse().join("/"))}</b></div>` : ""}
    ` : ""}
    <div class="footer">${escapeHtml(settings.receiptFooter || "Obrigado pela preferencia.")}</div>
  </body></html>`;
}

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character] || character));
}

function receiptPaper(settings: PdvSettings): { widthMm: number; heightMm: number; viewportWidth: number } {
  if (settings.receiptPaperWidth === "a4") return { widthMm: 210, heightMm: 297, viewportWidth: 794 };
  if (settings.receiptPaperWidth === "58") return { widthMm: 58, heightMm: 200, viewportWidth: 330 };
  const widthMm = settings.receiptPaperWidth === "custom"
    ? Math.max(40, Math.min(300, Number(settings.receiptCustomPaperWidthMm) || 80))
    : 80;
  const heightMm = settings.receiptPaperWidth === "custom"
    ? Math.max(80, Math.min(1000, Number(settings.receiptCustomPaperHeightMm) || 200))
    : 200;
  return { widthMm, heightMm, viewportWidth: Math.max(220, Math.round((widthMm / 25.4) * 96)) };
}
