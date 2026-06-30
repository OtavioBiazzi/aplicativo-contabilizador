import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { ENTRY_TYPES, PAYMENT_METHODS } from "../src/shared/defaults.js";
import { parseMoney, roundMoney } from "../src/shared/calculations.js";
import type { AppSettings, EntryType, LedgerEntry, PaymentMethod, RoundDirection } from "../src/shared/types.js";

export interface ParsedLedgerImport {
  filePath: string;
  entries: LedgerEntry[];
  totalRows: number;
  parsedRows: number;
  skippedRows: number;
  warnings: string[];
}

type SheetCell = string | number | boolean | null;
type SheetRow = SheetCell[];

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["data", "date", "dia"],
  time: ["hora", "time", "horario"],
  type: ["tipo", "categoria", "modo"],
  valuePaid: ["valor pago", "valor", "preco pago", "preco", "total pago"],
  originalValue: ["valor original", "valor conta", "valor da conta", "conta"],
  finalValue: ["valor final", "total final", "total cobrado"],
  people: ["pessoas", "qtd pessoas", "quantidade pessoas"],
  perPerson: ["valor por pessoa", "por pessoa", "cada pessoa"],
  rounding: ["arredondamento"],
  difference: ["sobra diferenca", "sobra/diferenca", "diferenca", "sobra"],
  description: ["descricao", "descrição", "cliente", "produto", "item"],
  tableNumber: ["mesa", "numero mesa", "n mesa"],
  busNumber: ["onibus", "ônibus", "numero onibus", "numero ônibus", "n onibus"],
  paymentMethod: ["forma de pagamento", "pagamento", "metodo pagamento"],
  paidWith: ["pago com", "recebido", "valor recebido"],
  change: ["troco"],
  observations: ["observacoes", "observações", "obs", "observacao", "observação"],
  originDevice: ["dispositivo origem", "dispositivo/origem", "origem"],
  id: ["id do lancamento", "id lançamento", "id lancamento", "id"],
  status: ["status", "situacao", "situação"]
};

export async function readLedgerImport(filePath: string, settings: AppSettings): Promise<ParsedLedgerImport> {
  const extension = path.extname(filePath).toLowerCase();
  const sheets =
    extension === ".xlsx"
      ? await readXlsx(filePath)
      : extension === ".csv" || extension === ".tsv"
        ? await readDelimitedFile(filePath, extension === ".tsv" ? "\t" : undefined)
        : (() => {
            throw new Error("Formato nao suportado. Use .xlsx, .csv ou .tsv.");
          })();

  const warnings: string[] = [];
  const entries: LedgerEntry[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  for (const sheet of sheets) {
    const headerIndex = findHeaderIndex(sheet.rows);
    if (headerIndex < 0) {
      warnings.push(`Aba ${sheet.name}: cabecalho compativel nao encontrado.`);
      skippedRows += sheet.rows.filter((row) => row.some(hasValue)).length;
      continue;
    }

    const headers = sheet.rows[headerIndex].map((cell) => normalizeHeader(String(cell ?? "")));
    for (const row of sheet.rows.slice(headerIndex + 1)) {
      if (!row.some(hasValue)) {
        continue;
      }
      totalRows += 1;
      const mapped = mapRow(headers, row);
      if (isTotalRow(mapped)) {
        skippedRows += 1;
        continue;
      }

      const entry = rowToEntry(mapped, filePath, settings);
      if (!entry) {
        skippedRows += 1;
        continue;
      }
      entries.push(entry);
    }
  }

  return {
    filePath,
    entries,
    totalRows,
    parsedRows: entries.length,
    skippedRows,
    warnings
  };
}

async function readDelimitedFile(filePath: string, forcedDelimiter?: string): Promise<Array<{ name: string; rows: SheetRow[] }>> {
  const raw = await fs.readFile(filePath, "utf8");
  const text = raw.replace(/^\uFEFF/, "");
  const delimiter = forcedDelimiter || detectDelimiter(text);
  return [{ name: path.basename(filePath), rows: parseDelimited(text, delimiter) }];
}

async function readXlsx(filePath: string): Promise<Array<{ name: string; rows: SheetRow[] }>> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const sharedStrings = await readSharedStrings(zip);
  const sheets = await readWorkbookSheets(zip);

  if (!sheets.length) {
    throw new Error("A planilha nao possui abas legiveis.");
  }

  const output: Array<{ name: string; rows: SheetRow[] }> = [];
  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    if (!file) {
      continue;
    }
    output.push({
      name: sheet.name,
      rows: parseWorksheet(await file.async("string"), sharedStrings)
    });
  }
  return output;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) {
    return [];
  }
  const xml = await file.async("string");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => collectText(match[1]));
}

async function readWorkbookSheets(zip: JSZip): Promise<Array<{ name: string; path: string }>> {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbook) {
    return [];
  }
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = readAttr(match[1], "Id");
      const target = readAttr(match[1], "Target");
      if (id && target) {
        rels.set(id, normalizeXlsxTarget(target));
      }
    }
  }

  return [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match, index) => {
    const attrs = match[1];
    const name = decodeXml(readAttr(attrs, "name") || `Aba ${index + 1}`);
    const relationId = readAttr(attrs, "r:id");
    const target = relationId ? rels.get(relationId) : undefined;
    return {
      name,
      path: target || `xl/worksheets/sheet${index + 1}.xml`
    };
  });
}

function normalizeXlsxTarget(target: string): string {
  const clean = target.replace(/^\/+/, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

function parseWorksheet(xml: string, sharedStrings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowMatches = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)];
  for (const rowMatch of rowMatches) {
    const row: SheetRow = [];
    let sequentialColumn = 0;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const reference = readAttr(attrs, "r");
      const columnIndex = reference ? columnIndexFromReference(reference) : sequentialColumn;
      row[columnIndex] = readCellValue(attrs, cellMatch[2], sharedStrings);
      sequentialColumn = columnIndex + 1;
    }
    rows.push(row.map((cell) => cell ?? ""));
  }
  return rows;
}

function readCellValue(attrs: string, inner: string, sharedStrings: string[]): SheetCell {
  const type = readAttr(attrs, "t");
  if (type === "inlineStr") {
    return collectText(inner);
  }
  const value = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }
  if (type === "b") {
    return value === "1";
  }
  if (!value.trim()) {
    return collectText(inner);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : decodeXml(value);
}

function collectText(xml: string): string {
  const pieces = [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]));
  return pieces.length ? pieces.join("") : decodeXml(xml.replace(/<[^>]+>/g, ""));
}

function readAttr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(":", "\\:");
  const match = attrs.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`));
  return match?.[1];
}

function columnIndexFromReference(reference: string): number {
  const letters = reference.match(/[A-Z]+/i)?.[0].toUpperCase() || "A";
  return [...letters].reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ";";
}

function parseDelimited(text: string, delimiter: string): SheetRow[] {
  const rows: SheetRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function findHeaderIndex(rows: SheetRow[]): number {
  return rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    const matches = Object.values(HEADER_ALIASES).flat().filter((alias) => normalized.includes(normalizeHeader(alias)));
    return matches.length >= 2 || normalized.includes("valor");
  });
}

function mapRow(headers: string[], row: SheetRow): Record<string, SheetCell> {
  const mapped: Record<string, SheetCell> = {};
  headers.forEach((header, index) => {
    if (header) {
      mapped[header] = row[index] ?? "";
    }
  });
  return mapped;
}

function rowToEntry(row: Record<string, SheetCell>, filePath: string, settings: AppSettings): LedgerEntry | null {
  const description = textValue(row, "description");
  const typeRaw = textValue(row, "type");
  const type = normalizeEntryType(typeRaw || description);
  const finalValue = moneyValue(row, "valuePaid") || moneyValue(row, "finalValue") || moneyValue(row, "originalValue");
  const paidWith = moneyValue(row, "paidWith");
  const change = moneyValue(row, "change");

  if (!description && !typeRaw && !finalValue && !paidWith) {
    return null;
  }

  const originalValue = moneyValue(row, "originalValue") || finalValue;
  const people = Math.max(1, Math.floor(numberValue(row, "people") || settings.defaultPeople || 1));
  const perPerson = moneyValue(row, "perPerson") || roundMoney((finalValue || originalValue) / people);
  const difference = moneyValue(row, "difference");
  const paymentMethod = normalizePayment(textValue(row, "paymentMethod"), type, paidWith);
  const createdAt = parseCreatedAt(valueFor(row, "date"), valueFor(row, "time")) || new Date().toISOString();
  const status = normalizeStatus(textValue(row, "status"));
  const tableNumber = textValue(row, "tableNumber") || extractNumber(description, "mesa");
  const busNumber = textValue(row, "busNumber") || extractNumber(description, "onibus");
  const id = textValue(row, "id") || randomUUID();
  const rounding = textValue(row, "rounding");
  const roundingStep = parseMoney(rounding) || settings.defaultRoundingStep;
  const roundingDirection = normalizeRoundingDirection(rounding) || settings.defaultRoundingDirection;
  const customType = typeRaw && normalizeText(typeRaw) !== normalizeText(type) ? typeRaw : undefined;

  return {
    id,
    createdAt,
    updatedAt: createdAt,
    type,
    originalValue: roundMoney(originalValue || finalValue),
    finalValue: roundMoney(finalValue || originalValue),
    people,
    perPerson,
    roundingStep,
    roundingDirection,
    difference,
    description: description || defaultDescription(type, tableNumber, busNumber),
    tableNumber,
    busNumber,
    paymentMethod,
    paidWith: roundMoney(paidWith),
    change: roundMoney(change),
    observations: textValue(row, "observations"),
    originDevice: textValue(row, "originDevice") || `Importado: ${path.basename(filePath)}`,
    status,
    customType,
    splitDetails:
      people > 1
        ? {
            originalValue: roundMoney(originalValue || finalValue),
            people,
            perPersonRaw: roundMoney((originalValue || finalValue) / people),
            roundingStep,
            roundingDirection,
            perPersonRounded: perPerson,
            finalTotal: roundMoney(finalValue || originalValue),
            difference,
            registerDifference: difference !== 0
          }
        : undefined,
    cashDetails:
      paymentMethod === "Dinheiro" || type === "Dinheiro/Troco" || paidWith > 0
        ? {
            accountValue: roundMoney(finalValue || originalValue),
            paidWith: roundMoney(paidWith || finalValue || originalValue),
            change: roundMoney(change),
            breakdown: [],
            unrepresentedCents: 0
          }
        : undefined
  };
}

function valueFor(row: Record<string, SheetCell>, key: keyof typeof HEADER_ALIASES): SheetCell {
  const aliases = HEADER_ALIASES[key].map(normalizeHeader);
  const matchedKey = Object.keys(row).find((header) => aliases.includes(header));
  return matchedKey ? row[matchedKey] : "";
}

function textValue(row: Record<string, SheetCell>, key: keyof typeof HEADER_ALIASES): string {
  const value = valueFor(row, key);
  return String(value ?? "").trim();
}

function numberValue(row: Record<string, SheetCell>, key: keyof typeof HEADER_ALIASES): number {
  const value = valueFor(row, key);
  return typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", ".")) || 0;
}

function moneyValue(row: Record<string, SheetCell>, key: keyof typeof HEADER_ALIASES): number {
  const value = valueFor(row, key);
  return typeof value === "number" ? roundMoney(value) : roundMoney(parseMoney(String(value ?? "")));
}

function isTotalRow(row: Record<string, SheetCell>): boolean {
  const first = normalizeText(String(Object.values(row).find(hasValue) ?? ""));
  return first === "total" || first === "totais";
}

function normalizeEntryType(value: string): EntryType {
  const normalized = normalizeText(value);
  const exact = ENTRY_TYPES.find((type) => normalizeText(type) === normalized);
  if (exact) {
    return exact;
  }
  if (normalized.includes("dinheiro") || normalized.includes("troco")) {
    return "Dinheiro/Troco";
  }
  if (normalized.includes("mesa")) {
    return "Mesa";
  }
  if (normalized.includes("onibus")) {
    return "Onibus";
  }
  if (normalized.includes("divis")) {
    return "Divisao de conta";
  }
  if (normalized.includes("taxa")) {
    return "Taxa";
  }
  if (normalized.includes("extra")) {
    return "Extra";
  }
  if (normalized.includes("cancel") || normalized.includes("estorno")) {
    return "Cancelado/Estorno";
  }
  if (normalized.includes("personal")) {
    return "Personalizado";
  }
  return "Venda";
}

function normalizePayment(value: string, type: EntryType, paidWith: number): PaymentMethod {
  const normalized = normalizeText(value);
  const exact = PAYMENT_METHODS.find((method) => normalizeText(method) === normalized);
  if (exact) {
    return exact;
  }
  if (type === "Dinheiro/Troco" || paidWith > 0 || normalized.includes("dinheiro")) {
    return "Dinheiro";
  }
  if (normalized.includes("pix")) {
    return "Pix";
  }
  if (normalized.includes("deb")) {
    return "Debito";
  }
  if (normalized.includes("cred")) {
    return "Credito";
  }
  if (normalized.includes("voucher")) {
    return "Voucher";
  }
  if (normalized.includes("misto")) {
    return "Misto";
  }
  return "Nao informado";
}

function normalizeStatus(value: string): LedgerEntry["status"] {
  const normalized = normalizeText(value);
  if (normalized.includes("cancel")) {
    return "cancelled";
  }
  if (normalized.includes("lixeira") || normalized.includes("deleted") || normalized.includes("apag")) {
    return "deleted";
  }
  return "active";
}

function normalizeRoundingDirection(value: string): RoundDirection | undefined {
  const normalized = normalizeText(value);
  if (normalized.includes("down") || normalized.includes("baixo")) {
    return "down";
  }
  if (normalized.includes("nearest") || normalized.includes("proxim")) {
    return "nearest";
  }
  if (normalized.includes("up") || normalized.includes("cima")) {
    return "up";
  }
  return undefined;
}

function parseCreatedAt(dateValue: SheetCell, timeValue: SheetCell): string | null {
  const date = parseDate(dateValue);
  if (!date) {
    return null;
  }
  const time = parseTime(timeValue);
  date.setHours(time.hours, time.minutes, time.seconds, 0);
  return date.toISOString();
}

function parseDate(value: SheetCell): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 20000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + Math.floor(value) * 24 * 60 * 60 * 1000);
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
  }
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return new Date(year, Number(br[2]) - 1, Number(br[1]));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTime(value: SheetCell): { hours: number; minutes: number; seconds: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = Math.round((value % 1) * 24 * 60 * 60);
    return {
      hours: Math.floor(seconds / 3600),
      minutes: Math.floor((seconds % 3600) / 60),
      seconds: seconds % 60
    };
  }
  const match = String(value ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return {
    hours: Number(match?.[1] || 0),
    minutes: Number(match?.[2] || 0),
    seconds: Number(match?.[3] || 0)
  };
}

function defaultDescription(type: EntryType, tableNumber: string, busNumber: string): string {
  if (type === "Mesa" && tableNumber) {
    return `Mesa ${tableNumber}`;
  }
  if (type === "Onibus" && busNumber) {
    return `Onibus ${busNumber}`;
  }
  return "Venda";
}

function extractNumber(description: string, kind: "mesa" | "onibus"): string {
  const pattern = kind === "mesa" ? /mesa\s*(\d+)/i : /(?:onibus|ônibus)\s*(\d+)/i;
  return description.match(pattern)?.[1] || "";
}

function hasValue(value: SheetCell): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeHeader(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
