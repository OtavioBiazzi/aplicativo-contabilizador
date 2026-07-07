import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { PdvExportFilters, PdvSale } from "../src/shared/pdvTypes.js";
import type { ExportStatus } from "../src/shared/types.js";

interface Sheet {
  name: string;
  rows: Record<string, unknown>[];
}

const MONEY_COLUMNS = new Set([
  "Valor",
  "Subtotal",
  "Desconto venda",
  "Desconto itens",
  "Total",
  "Preco base",
  "Preco unitario",
  "Total adicionais",
  "Desconto item",
  "Total item",
  "Recebido",
  "Troco"
]);

export class PdvExporter {
  constructor(private readonly outputDirectory: string) {}

  async exportSales(sales: PdvSale[], filters: PdvExportFilters = {}): Promise<ExportStatus> {
    try {
      await fs.mkdir(this.outputDirectory, { recursive: true });
      const filePath = path.join(this.outputDirectory, `pdv-relatorio-${periodToken(filters)}-${timestampToken()}.xlsx`);
      await writeXlsx(filePath, buildSheets(sales, filters));
      return {
        ok: true,
        filePath,
        pendingCount: 0,
        message: `Relatorio PDV exportado em ${path.basename(filePath)}.`
      };
    } catch (error) {
      return {
        ok: false,
        pendingCount: 1,
        message: error instanceof Error ? error.message : "Nao foi possivel exportar o relatorio PDV."
      };
    }
  }
}

function buildSheets(sales: PdvSale[], filters: PdvExportFilters): Sheet[] {
  const validSales = sales.filter((sale) => sale.status !== "Cancelada");
  const cancelledSales = sales.filter((sale) => sale.status === "Cancelada");
  const itemDiscounts = validSales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => inner + item.discount, 0), 0);
  const saleDiscounts = validSales.reduce((sum, sale) => sum + sale.discount, 0);
  const paymentsTotal = validSales.reduce((sum, sale) => sum + sale.payments.reduce((inner, payment) => inner + payment.amount, 0), 0);
  const summaryRows: Record<string, unknown>[] = [
    { Indicador: "Periodo inicial", Valor: filters.from || "Tudo" },
    { Indicador: "Periodo final", Valor: filters.to || "Tudo" },
    { Indicador: "Tipo", Valor: filters.type || "Todos" },
    { Indicador: "Pagamento", Valor: filters.payment || "Todos" },
    { Indicador: "Mesa", Valor: filters.table || "Todas" },
    { Indicador: "Vendas validas", Valor: validSales.length },
    { Indicador: "Vendas canceladas", Valor: cancelledSales.length },
    { Indicador: "Total vendido", Valor: roundMoney(validSales.reduce((sum, sale) => sum + sale.total, 0)) },
    { Indicador: "Total cancelado", Valor: roundMoney(cancelledSales.reduce((sum, sale) => sum + sale.total, 0)) },
    { Indicador: "Descontos de venda", Valor: roundMoney(saleDiscounts) },
    { Indicador: "Descontos de itens", Valor: roundMoney(itemDiscounts) },
    { Indicador: "Pagamentos registrados", Valor: roundMoney(paymentsTotal) }
  ];
  paymentTotals(validSales).forEach(([method, amount]) => summaryRows.push({ Indicador: `Pagamento - ${method}`, Valor: amount }));

  return [
    { name: "Resumo", rows: summaryRows },
    { name: "Vendas", rows: sales.map(saleRow) },
    { name: "Itens", rows: sales.flatMap(itemRows) },
    { name: "Pagamentos", rows: sales.flatMap(paymentRows) }
  ];
}

function saleRow(sale: PdvSale): Record<string, unknown> {
  const { date, time } = splitDateTime(sale.createdAt);
  return {
    "ID venda": sale.id,
    Data: date,
    Hora: time,
    Tipo: sale.type,
    Mesa: sale.tableNumber || "",
    Status: sale.status,
    Subtotal: roundMoney(sale.subtotal),
    "Desconto venda": roundMoney(sale.discount),
    "Desconto itens": roundMoney(sale.items.reduce((sum, item) => sum + item.discount, 0)),
    Total: roundMoney(sale.total),
    Pagamentos: sale.payments.map((payment) => `${payment.method} ${formatMoney(payment.amount)}`).join(" + "),
    Itens: sale.items.length
  };
}

function itemRows(sale: PdvSale): Record<string, unknown>[] {
  const { date, time } = splitDateTime(sale.createdAt);
  return sale.items.map((item) => {
    const complements = item.complements || [];
    return {
      "ID venda": sale.id,
      Data: date,
      Hora: time,
      Tipo: sale.type,
      Mesa: sale.tableNumber || "",
      "Submesa/comanda": item.subtableName || "",
      "Status venda": sale.status,
      Produto: item.productName,
      Categoria: item.categoryName,
      Qtde: item.quantity,
      Medida: item.measureLabel || "",
      "Preco base": roundMoney(item.baseUnitPrice ?? item.unitPrice),
      "Preco unitario": roundMoney(item.unitPrice),
      "Total adicionais": roundMoney(complements.reduce((sum, complement) => sum + complement.price, 0)),
      "Desconto item": roundMoney(item.discount),
      "Total item": roundMoney(item.total),
      Adicionais: complements.map((complement) => `${complement.name} (${formatMoney(complement.price)})`).join(", "),
      Observacao: item.note || ""
    };
  });
}

function paymentRows(sale: PdvSale): Record<string, unknown>[] {
  const { date, time } = splitDateTime(sale.createdAt);
  return sale.payments.map((payment) => ({
    "ID venda": sale.id,
    Data: date,
    Hora: time,
    Tipo: sale.type,
    Mesa: sale.tableNumber || "",
    "Status venda": sale.status,
    Forma: payment.method,
    Valor: roundMoney(payment.amount),
    Recebido: payment.received ? roundMoney(payment.received) : "",
    Troco: payment.change ? roundMoney(payment.change) : ""
  }));
}

function paymentTotals(sales: PdvSale[]): Array<[string, number]> {
  const totals = new Map<string, number>();
  sales.forEach((sale) => sale.payments.forEach((payment) => totals.set(payment.method, roundMoney((totals.get(payment.method) || 0) + payment.amount))));
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function writeXlsx(filePath: string, sheets: Sheet[]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml(sheets.length));
  zip.folder("_rels")?.file(".rels", rootRelsXml());
  zip.folder("docProps")?.file("core.xml", coreXml());
  zip.folder("xl")?.file("workbook.xml", workbookXml(sheets));
  zip.folder("xl")?.file("styles.xml", stylesXml());
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", workbookRelsXml(sheets.length));
  const worksheets = zip.folder("xl")?.folder("worksheets");
  sheets.forEach((sheet, index) => worksheets?.file(`sheet${index + 1}.xml`, worksheetXml(sheet.rows)));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFileAtomic(filePath, buffer);
}

function worksheetXml(rows: Record<string, unknown>[]): string {
  const columns = rows.length ? Object.keys(rows[0]) : ["Sem dados"];
  const lastColumn = columnName(columns.length);
  const lastRow = Math.max(1, rows.length + 1);
  const cols = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${columnWidthFor(column)}" customWidth="1"/>`).join("");
  const header = `<row r="1" ht="24" customHeight="1">${columns.map((column, index) => cellXml(column, `${columnName(index + 1)}1`, 1)).join("")}</row>`;
  const data = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    return `<row r="${rowNumber}">${columns.map((column, columnIndex) => cellXml(row[column] ?? "", `${columnName(columnIndex + 1)}${rowNumber}`, styleForColumn(column))).join("")}</row>`;
  }).join("");
  return xmlDeclaration(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData>${header}${data}</sheetData>
<autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`);
}

function contentTypesXml(sheetCount: number): string {
  const worksheets = Array.from({ length: sheetCount }, (_item, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return xmlDeclaration(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheets}</Types>`);
}

function rootRelsXml(): string {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
}

function coreXml(): string {
  const now = new Date().toISOString();
  return xmlDeclaration(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Contabilizador Caixa PDV</dc:creator><cp:lastModifiedBy>Contabilizador Caixa PDV</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
}

function workbookXml(sheets: Sheet[]): string {
  return xmlDeclaration(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`);
}

function workbookRelsXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_item, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
}

function stylesXml(): string {
  return xmlDeclaration(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF102A3B"/><name val="Segoe UI"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0565B7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
}

function cellXml(value: unknown, reference: string, styleId = 0): string {
  const style = styleId ? ` s="${styleId}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }
  if (value === "" || value === null || value === undefined) {
    return `<c r="${reference}"${style}/>`;
  }
  return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function styleForColumn(column: string): number {
  return MONEY_COLUMNS.has(column) ? 2 : 0;
}

function columnWidthFor(column: string): number {
  const widths: Record<string, number> = {
    "ID venda": 38,
    Data: 13,
    Hora: 10,
    Produto: 32,
    Categoria: 20,
    Pagamentos: 34,
    Adicionais: 36,
    Observacao: 30
  };
  return widths[column] || Math.max(12, Math.min(24, column.length + 4));
}

async function writeFileAtomic(filePath: string, data: Buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function splitDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: value.slice(0, 10), time: "" };
  }
  return {
    date: new Intl.DateTimeFormat("pt-BR").format(date),
    time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)
  };
}

function periodToken(filters: PdvExportFilters): string {
  const from = sanitizeFilePart(filters.from || "inicio");
  const to = sanitizeFilePart(filters.to || "fim");
  return `${from}-a-${to}`;
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sanitizeFilePart(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function columnName(index: number): string {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlDeclaration(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}
