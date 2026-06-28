import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { DEFAULT_COLUMNS } from "../src/shared/defaults.js";
import { formatDateTime, roundMoney } from "../src/shared/calculations.js";
import type { AppSettings, ExportStatus, LedgerEntry } from "../src/shared/types.js";

interface ExportState {
  pendingCount: number;
  lastError?: string;
  lastFilePath?: string;
}

const EXPORT_STATE_FILE = "export-state.json";

export class LedgerExporter {
  private readonly statePath: string;

  constructor(private readonly dataDirectory: string) {
    this.statePath = path.join(dataDirectory, EXPORT_STATE_FILE);
  }

  async getStatus(): Promise<ExportStatus> {
    const state = await this.readState();
    return {
      ok: !state.lastError,
      filePath: state.lastFilePath,
      message: state.lastError,
      pendingCount: state.pendingCount
    };
  }

  async export(entries: LedgerEntry[], settings: AppSettings): Promise<ExportStatus> {
    try {
      await fs.mkdir(settings.outputDirectory, { recursive: true });
      const exportTargets = this.buildTargets(entries, settings);
      const writtenFiles: string[] = [];

      for (const target of exportTargets) {
        await this.backupIfNeeded(target.filePath, settings.backupEnabled);
        if (settings.fileFormat === "xlsx") {
          await this.writeXlsx(target.filePath, target.sheets);
        } else {
          await this.writeCsv(target.filePath, target.sheets.flatMap((sheet) => sheet.rows), settings.csvSeparator);
        }
        writtenFiles.push(target.filePath);
      }

      const filePath = writtenFiles.length === 1 ? writtenFiles[0] : settings.outputDirectory;
      const status: ExportStatus = {
        ok: true,
        filePath,
        pendingCount: 0,
        message: "Exportacao sincronizada."
      };
      await this.writeState({ pendingCount: 0, lastFilePath: filePath });
      return status;
    } catch (error) {
      const previous = await this.readState();
      const message =
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar o arquivo. O lancamento ficou salvo localmente.";
      const pendingCount = Math.max(1, previous.pendingCount + 1);
      await this.writeState({
        pendingCount,
        lastError: message,
        lastFilePath: previous.lastFilePath
      });
      return {
        ok: false,
        filePath: previous.lastFilePath,
        pendingCount,
        message
      };
    }
  }

  private buildTargets(entries: LedgerEntry[], settings: AppSettings) {
    const extension = settings.fileFormat;
    const visibleColumns = settings.visibleColumns.length ? settings.visibleColumns : DEFAULT_COLUMNS;

    if (settings.fileStrategy === "byType") {
      const grouped = groupBy(entries, (entry) => sanitizeFilePart(entry.type));
      return Object.entries(grouped).map(([type, rows]) => ({
        filePath: path.join(settings.outputDirectory, `${type}-${formatDateToken(new Date(), settings)}.${extension}`),
        sheets: [{ name: "Lancamentos", rows: rows.map((entry) => toRow(entry, visibleColumns)) }]
      }));
    }

    if (settings.fileStrategy === "monthlyTabs" && settings.fileFormat === "xlsx") {
      const grouped = groupBy(entries, (entry) => formatDateToken(new Date(entry.createdAt), settings));
      const month = new Date().toISOString().slice(0, 7);
      return [
        {
          filePath: path.join(settings.outputDirectory, `caixa-${month}.${extension}`),
          sheets: Object.entries(grouped).map(([date, rows]) => ({
            name: date.slice(0, 31),
            rows: rows.map((entry) => toRow(entry, visibleColumns))
          }))
        }
      ];
    }

    const fileName =
      settings.fileStrategy === "fixedAll"
        ? `caixa-geral.${extension}`
        : `vendas-${formatDateToken(new Date(), settings)}.${extension}`;

    return [
      {
        filePath: path.join(settings.outputDirectory, fileName),
        sheets: [{ name: "Lancamentos", rows: entries.map((entry) => toRow(entry, visibleColumns)) }]
      }
    ];
  }

  private async writeXlsx(filePath: string, sheets: Array<{ name: string; rows: Record<string, unknown>[] }>) {
    const zip = new JSZip();
    const safeSheets = sheets.length ? sheets : [{ name: "Lancamentos", rows: [] }];
    zip.file("[Content_Types].xml", contentTypesXml(safeSheets.length));
    zip.folder("_rels")?.file(".rels", rootRelsXml());
    zip.folder("docProps")?.file("core.xml", coreXml());
    zip.folder("xl")?.file("workbook.xml", workbookXml(safeSheets));
    zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", workbookRelsXml(safeSheets.length));

    const worksheets = zip.folder("xl")?.folder("worksheets");
    safeSheets.forEach((sheet, index) => {
      worksheets?.file(`sheet${index + 1}.xml`, worksheetXml(sheet.rows));
    });

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.writeFile(filePath, buffer);
  }

  private async writeCsv(filePath: string, rows: Record<string, unknown>[], separator: string) {
    const columns = rows.length ? Object.keys(rows[0]) : DEFAULT_COLUMNS;
    const lines = [
      columns.map((column) => escapeCsv(column, separator)).join(separator),
      ...rows.map((row) => columns.map((column) => escapeCsv(row[column], separator)).join(separator))
    ];
    await fs.writeFile(filePath, lines.join("\n"), "utf8");
  }

  private async backupIfNeeded(filePath: string, enabled: boolean) {
    if (!enabled) {
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      return;
    }

    const backupDirectory = path.join(path.dirname(filePath), "backups");
    await fs.mkdir(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `${path.basename(filePath)}.${timestamp}.bak`);
    await fs.copyFile(filePath, backupPath);
  }

  private async readState(): Promise<ExportState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      return JSON.parse(raw) as ExportState;
    } catch {
      return { pendingCount: 0 };
    }
  }

  private async writeState(state: ExportState) {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}

function toRow(entry: LedgerEntry, visibleColumns: string[]) {
  const { date, time } = formatDateTime(entry.createdAt);
  const allColumns: Record<string, unknown> = {
    Data: date,
    Hora: time,
    Tipo: entry.customType || entry.type,
    "Valor original": roundMoney(entry.originalValue),
    "Valor final": roundMoney(entry.finalValue),
    Pessoas: entry.people,
    "Valor por pessoa": roundMoney(entry.perPerson),
    Arredondamento: `${entry.roundingDirection} ${entry.roundingStep}`,
    "Sobra/diferenca": roundMoney(entry.difference),
    Descricao: entry.description,
    Mesa: entry.tableNumber,
    Onibus: entry.busNumber,
    "Forma de pagamento": entry.paymentMethod,
    "Pago com": roundMoney(entry.paidWith),
    Troco: roundMoney(entry.change),
    Observacoes: entry.observations,
    "Dispositivo/origem": entry.originDevice,
    "ID do lancamento": entry.id,
    Status: entry.status
  };

  return visibleColumns.reduce<Record<string, unknown>>((row, column) => {
    row[column] = allColumns[column] ?? "";
    return row;
  }, {});
}

function formatDateToken(date: Date, settings: AppSettings): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (settings.dateFormat === "dd-MM-yyyy") {
    return `${day}-${month}-${year}`;
  }
  if (settings.dateFormat === "yyyyMMdd") {
    return `${year}${month}${day}`;
  }
  return `${year}-${month}-${day}`;
}

function sanitizeFilePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function escapeCsv(value: unknown, separator: string): string {
  const text = String(value ?? "");
  if (text.includes(separator) || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function groupBy<T>(items: T[], selector: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = selector(item) || "geral";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function contentTypesXml(sheetCount: number): string {
  const worksheets = Array.from({ length: sheetCount }, (_item, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return xmlDeclaration(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${worksheets}
</Types>`);
}

function rootRelsXml(): string {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`);
}

function coreXml(): string {
  const now = new Date().toISOString();
  return xmlDeclaration(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Contabilizador Caixa</dc:creator>
<cp:lastModifiedBy>Contabilizador Caixa</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
}

function workbookXml(sheets: Array<{ name: string }>): string {
  const sheetXml = sheets
    .map((sheet, index) => {
      const name = escapeXml((sheet.name || "Lancamentos").slice(0, 31));
      return `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
    })
    .join("");
  return xmlDeclaration(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetXml}</sheets>
</workbook>`);
}

function workbookRelsXml(sheetCount: number): string {
  const relationships = Array.from({ length: sheetCount }, (_item, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join("");
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
}

function worksheetXml(rows: Record<string, unknown>[]): string {
  const columns = rows.length ? Object.keys(rows[0]) : DEFAULT_COLUMNS;
  const allRows = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))];
  const sheetData = allRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((value, columnIndex) => cellXml(value, `${columnName(columnIndex + 1)}${rowNumber}`))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return xmlDeclaration(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetData}</sheetData>
</worksheet>`);
}

function cellXml(value: unknown, reference: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
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
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlDeclaration(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}
