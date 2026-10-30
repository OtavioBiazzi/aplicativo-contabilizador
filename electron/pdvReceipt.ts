import { BrowserWindow } from "electron";
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
  const { window, paper, heightMm } = await prepareReceiptWindow(sale, settings, customer, receivable, customerName, customerDocumentOverride);
  try {
    // Use the print renderer so PDF and printer keep the same physical text size.
    // A4 paginates naturally instead of shrinking the whole receipt into one image.
    return await window.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: false,
      scale: 1,
      pageSize: settings.receiptPaperWidth === "a4" ? "A4" : { width: paper.widthMm / 25.4, height: heightMm / 25.4 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true
    });
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
  const { window, paper, heightMm } = await prepareReceiptWindow(sale, settings, customer, receivable, customerName, customerDocumentOverride);
  try {
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
          : { width: Math.round(paper.widthMm * 1000), height: Math.round(heightMm * 1000) },
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

async function prepareReceiptWindow(
  sale: PdvSale,
  settings: PdvSettings,
  customer?: PdvCustomer,
  receivable?: PdvReceivable,
  customerName?: string,
  customerDocumentOverride?: string
) {
  const paper = receiptPaper(settings);
  const window = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: paper.viewportWidth,
    height: 240,
    backgroundColor: "#ffffff",
    webPreferences: { sandbox: true }
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildPdvReceiptHtml(sale, settings, customer, receivable, customerName, customerDocumentOverride))}`);
    await window.webContents.executeJavaScript("document.fonts.ready");
    let heightMm = paper.heightMm;
    if (settings.receiptPaperWidth !== "a4") {
      const contentHeight = await window.webContents.executeJavaScript(
        "Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height))"
      ) as number;
      // Measuring the body avoids counting the hidden window's empty viewport.
      // Extremely long rolls paginate rather than exceeding printer page limits.
      heightMm = Math.min(1000, Math.max(60, settings.receiptPaperWidth === "custom" ? paper.heightMm : 0, Math.ceil((contentHeight / 96) * 25.4) + 1));
      await window.webContents.executeJavaScript(`
        (() => {
          const style = document.createElement("style");
          style.textContent = "@page { margin: 0; size: ${paper.widthMm}mm ${heightMm}mm; }";
          document.head.appendChild(style);
        })()
      `);
    }
    return { window, paper, heightMm };
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
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
  const layout = receiptLayout(settings, paper.widthMm);
  const width = `${Math.max(36, paper.widthMm - layout.leftMm - layout.rightMm)}mm`;
  const pageSize = `${paper.widthMm}mm ${paper.heightMm}mm`;
  const printMargins = settings.receiptPaperWidth === "a4" ? `${layout.topMm}mm ${layout.rightMm}mm ${layout.bottomMm}mm ${layout.leftMm}mm` : "0";
  const accentColor = settings.receiptUseColor ? "#0f5f96" : "#111";
  const paidTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalChange = sale.payments.reduce((sum, payment) => sum + (payment.change || 0), 0);
  const pendingTotal = Math.max(0, sale.total - paidTotal);
  const customerBalance = sale.receiptPurpose === "customer-balance";
  const payableAccount = sale.receiptPurpose === "payable-account";
  const referenceDate = (value: string | undefined) => value ? value.split("-").reverse().join("/") : "Sem data";
  const payments = sale.payments.map((payment) => `
    <div class="row"><span>${escapeHtml(payment.method)}${payment.description ? ` - ${escapeHtml(payment.description)}` : ""}</span><b>${money(payment.amount)}</b></div>
    ${payment.received ? `<div class="subrow"><span>Recebido</span><b>${money(payment.received)}</b></div>` : ""}
    ${payment.change ? `<div class="subrow"><span>Troco</span><b>${money(payment.change)}</b></div>` : ""}
  `).join("");
  const receiptItems = settings.receiptGroupIdenticalItems === false ? sale.items : groupPdvReceiptItems(sale.items);
  const items = receiptItems.map((item, index) => `
    <div class="item">
      <div class="row item-main"><span>${String(index + 1).padStart(2, "0")} ${customerBalance ? "" : `${formatQuantity(item.quantity)} `}${escapeHtml(item.productName)}</span><b>${money(item.total)}</b></div>
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
  const receiptStatus = payableAccount ? "RECIBO DE CONTA A PAGAR" : customerBalance ? "RECIBO DE CONTAS A RECEBER" : pendingTotal > 0.009 ? "CONTA EM ABERTO" : "COMPROVANTE DE PAGAMENTO";
  const accountReceipts = receivable?.payments.map((payment) => `
    <div class="item">
      <div class="row"><span>${escapeHtml(payment.method)} - ${new Date(payment.createdAt).toLocaleDateString("pt-BR")}</span><b>${money(payment.amount)}</b></div>
      ${payment.description ? `<small>${escapeHtml(payment.description)}</small>` : ""}
      ${payment.change ? `<small>Recebido ${money(payment.received || payment.amount)} | Troco ${money(payment.change)}</small>` : ""}
    </div>
  `).join("") || "";
  return `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    @page { margin: ${printMargins}; size: ${pageSize}; }
    * { box-sizing: border-box; }
    html, body { overflow-x: hidden; }
    body { width: ${width}; margin: 0; margin-left: ${layout.leftMm}mm; padding: ${layout.topMm}mm 0 ${layout.bottomMm}mm; color: #080808; font: ${layout.fontSize}px/1.25 Arial, sans-serif; }
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
    .row span, .subrow span { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
    .row b, .subrow b { flex: 0 0 auto; white-space: nowrap; }
    .subrow { padding-left: 8px; font-size: 10px; color: #222; }
    .status { margin: 4px 0; padding: 3px; border: 1.5px solid ${accentColor}; color: ${accentColor}; text-align: center; font-size: 12px; font-weight: 900; letter-spacing: .4px; }
    .columns { display: grid; grid-template-columns: 8mm minmax(0, 1fr) 18mm; gap: 3px; font-size: ${Math.min(layout.fontSize, 10)}px; font-weight: 800; border-bottom: 1px solid #111; padding: 3px 4px; }
    .columns span:last-child { text-align: right; }
    .item { padding: 2px 4px; border-bottom: 1px solid #ddd; }
    .item, .row, .subrow, .top, .box { break-inside: avoid; }
    .item-main span { font-weight: 700; }
    small { display: block; padding-left: 13mm; color: #222; }
    .total { color: ${accentColor}; font-size: 15px; font-weight: 900; }
    .footer { margin-top: 12px; text-align: center; font-size: 10px; }
    ${settings.receiptPaperWidth === "a4" ? "@media print { body { width: auto; margin: 0; padding: 0; } }" : ""}
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
      <div class="box-title">${payableAccount ? "CONTA A PAGAR" : customerBalance ? "CONTAS A RECEBER DO CLIENTE" : sale.tableNumber ? `MESA: ${String(sale.tableNumber).padStart(3, "0")}` : escapeHtml(sale.type || "VENDA")}</div>
      <div class="section">
        <div class="row"><span>${customerBalance || payableAccount ? "EMITIDO EM" : `PEDIDO: ${escapeHtml(String(orderNumber).slice(0, 12))}`}</span><b>${new Date(sale.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</b></div>
        ${displayCustomerName ? `<div>${payableAccount ? "FORNECEDOR" : "CLIENTE"}: ${escapeHtml(displayCustomerName)}</div>` : ""}
        ${customerDocument ? `<div>CPF/CNPJ: ${escapeHtml(customerDocument)}</div>` : ""}
        ${payableAccount ? `<div>DOCUMENTO: ${escapeHtml(sale.receiptReference?.documentNumber || "Não informado")}</div><div>EMISSÃO: ${escapeHtml(referenceDate(sale.receiptReference?.issueDate))}</div><div>VENCIMENTO: ${escapeHtml(referenceDate(sale.receiptReference?.dueDate))}</div>` : ""}
      </div>
    </div>
    <div class="columns"><span>${customerBalance ? "Nº" : "QTD"}</span><span>DESCRICAO</span><span>${customerBalance ? "SALDO" : "TOTAL"}</span></div>
    ${items}
    <div class="divider dashed"></div>
    ${customerBalance ? `<div class="row total"><span>TOTAL A RECEBER</span><b>${money(sale.total)}</b></div>` : payableAccount ? `<div class="row total"><span>VALOR DA CONTA</span><b>${money(sale.total)}</b></div>` : `
    <div class="row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>
    <div class="row"><span>${sale.discount < 0 ? "Acrescimo" : "Desconto"}</span><b>${money(Math.abs(sale.discount))}</b></div>
    <div class="row total"><span>Total</span><b>${money(sale.total)}</b></div>`}
    ${customerBalance ? "" : `
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
    ` : ""}`}
    <div class="footer">${escapeHtml(settings.receiptFooter || "Obrigado pela preferencia.")}</div>
  </body></html>`;
}

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function formatQuantity(value: number): string {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
  return rounded.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
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
  if (settings.receiptPaperWidth === "58") return { widthMm: 58, heightMm: 200, viewportWidth: Math.round((58 / 25.4) * 96) };
  const widthMm = settings.receiptPaperWidth === "custom"
    ? Math.max(40, Math.min(300, Number(settings.receiptCustomPaperWidthMm) || 80))
    : 80;
  const heightMm = settings.receiptPaperWidth === "custom"
    ? Math.max(80, Math.min(1000, Number(settings.receiptCustomPaperHeightMm) || 200))
    : 200;
  return { widthMm, heightMm, viewportWidth: Math.max(220, Math.round((widthMm / 25.4) * 96)) };
}

function receiptLayout(settings: PdvSettings, paperWidthMm: number): { leftMm: number; rightMm: number; topMm: number; bottomMm: number; fontSize: number } {
  const isA4 = settings.receiptPaperWidth === "a4";
  const defaultHorizontal = isA4 ? 10 : paperWidthMm >= 80 ? 4 : 2;
  return {
    leftMm: clampSetting(settings.receiptMarginLeftMm, defaultHorizontal, 0, Math.max(0, paperWidthMm - 36)),
    rightMm: clampSetting(settings.receiptMarginRightMm, defaultHorizontal, 0, Math.max(0, paperWidthMm - 36)),
    topMm: clampSetting(settings.receiptMarginTopMm, isA4 ? 8 : 4, 0, 30),
    bottomMm: clampSetting(settings.receiptMarginBottomMm, isA4 ? 12 : 5, 0, 30),
    fontSize: clampSetting(settings.receiptFontSize, 11.5, 9, 16)
  };
}

function clampSetting(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
