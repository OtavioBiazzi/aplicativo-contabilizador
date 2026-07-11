import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import type { PdvCategory, PdvProduct } from "../src/shared/pdvTypes.js";

interface ParsedProductRow {
  name: string;
  categoryName: string;
  price: number;
  unit: string;
  active: boolean;
  showOnPdv: boolean;
}

export async function readPdvProductsFromXlsx(filePath: string): Promise<ParsedProductRow[]> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relationshipXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relationshipXml) {
    throw new Error("Arquivo XLSX invalido.");
  }

  const sheetRelId = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const sheetTarget = sheetRelId ? relationshipTarget(relationshipXml, sheetRelId) : "worksheets/sheet1.xml";
  const sheetPath = `xl/${sheetTarget.replace(/^\/?xl\//, "")}`;
  const sheetXml = await zip.file(sheetPath)?.async("string");
  if (!sheetXml) {
    throw new Error("Nao foi possivel localizar a primeira aba da planilha.");
  }

  const sharedStrings = await readSharedStrings(zip);
  const rows = parseRows(sheetXml, sharedStrings);
  const header = rows[0] || [];
  const indexes = {
    name: findHeader(header, "DESCRICAO"),
    category: findHeader(header, "GRUPO"),
    price: findHeader(header, "PRECO_VENDA"),
    unit: findHeader(header, "UNIDADE"),
    active: findHeader(header, "ATIVO"),
    showOnPdv: findHeader(header, "EXIBE_PDV")
  };

  if (indexes.name < 0 || indexes.category < 0 || indexes.price < 0) {
    throw new Error("A planilha precisa ter DESCRICAO, GRUPO e PRECO_VENDA.");
  }

  return rows.slice(1).flatMap((row) => {
    const name = cleanText(row[indexes.name]);
    const price = parseNumber(row[indexes.price]);
    if (!name || price <= 0) {
      return [];
    }
    return [{
      name,
      categoryName: cleanText(row[indexes.category]) || "Sem categoria",
      price,
      unit: indexes.unit >= 0 ? cleanText(row[indexes.unit]) || "UNID" : "UNID",
      active: indexes.active < 0 || cleanText(row[indexes.active]).toUpperCase() !== "N",
      showOnPdv: indexes.showOnPdv < 0 || cleanText(row[indexes.showOnPdv]).toUpperCase() !== "N"
    }];
  });
}

export function normalizeImportedProducts(rows: ParsedProductRow[]): { categories: PdvCategory[]; products: PdvProduct[]; skippedRows: number } {
  const categoryByName = new Map<string, PdvCategory>();
  const products: PdvProduct[] = [];
  const seenProducts = new Set<string>();
  const categoryOrder = ["TODOS", "ARTESANATO", "FORNECEDORES", "PIMENTAS", "BEBIDAS", "DOCES", "EMPORIO", "CAFE", "SUCOS", "FRUTAS"];

  rows
    .sort((left, right) =>
      left.categoryName.localeCompare(right.categoryName, "pt-BR", { numeric: true }) ||
      left.name.localeCompare(right.name, "pt-BR", { numeric: true })
    )
    .forEach((row) => {
      const categoryKey = row.categoryName.toLocaleLowerCase("pt-BR");
      let category = categoryByName.get(categoryKey);
      if (!category) {
        category = {
          id: stableImportId("category", categoryKey),
          name: row.categoryName,
          active: true,
          favorite: false,
          sortOrder: categoryOrderIndex(row.categoryName, categoryOrder, categoryByName.size)
        };
        categoryByName.set(categoryKey, category);
      }

      const productKey = `${categoryKey}|${row.name.toLocaleLowerCase("pt-BR")}`;
      if (seenProducts.has(productKey)) {
        return;
      }
      seenProducts.add(productKey);
      products.push({
        id: stableImportId("product", productKey),
        name: row.name,
        categoryId: category.id,
        categoryName: category.name,
        price: roundMoney(row.price),
        unit: row.unit,
        unitMode: inferUnitMode(row.unit),
        active: row.active,
        showOnPdv: row.showOnPdv,
        favorite: false,
        canBeComplement: isLikelyComplement(row.name),
        hasComplements: isLikelyComplementHost(row.name),
        complementProductIds: [],
        sortOrder: products.length
      });
    });

  return {
    categories: [...categoryByName.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "pt-BR")),
    products,
    skippedRows: Math.max(0, rows.length - products.length)
  };
}

/** Aplica os vinculos prontos da planilha Cose sem liberar adicionais aleatorios. */
export function configureCoseDellAbadiaComplements(products: PdvProduct[]): void {
  const productByName = new Map(products.map((product) => [normalizeForMatch(product.name), product]));
  const addonIds = (names: string[]) => names
    .map((name) => productByName.get(normalizeForMatch(name))?.id)
    .filter((id): id is string => Boolean(id));
  const savory = addonIds(["ADICIONAL OVO", "ADICIONAL QUEIJO", "ADICIONAL TOMATE", "ADICIONAL CEBOLA/TOMATE", "ADICIONAL BACON"]);
  const fruit = addonIds(["ADICIONAL MEL", "ADICIONAL MEL/GRANOLA"]);
  const cappuccino = addonIds(["ADICIONAL CAPPUCINO(PÓ)"]);

  products.forEach((product) => {
    product.canBeComplement = normalizeForMatch(product.name).startsWith("ADICIONAL ");
    product.hasComplements = false;
    product.complementProductIds = [];

    const name = normalizeForMatch(product.name);
    if (/\bCUSCUZ\b/.test(name)) {
      product.complementProductIds = savory;
    } else if (/\bOVO MEXIDO\b|\bPAO\b|\bMISTO\b|\bTAPIOCA\b|\bOMELETE\b|\bSANDUICHE\b|\bX TUDO\b|\bX-TUDO\b/.test(name)) {
      product.complementProductIds = savory;
    } else if (/\bMAMAO\b|\bMANGA\b/.test(name)) {
      product.complementProductIds = fruit;
    } else if (/\bCAFE\b/.test(name)) {
      product.complementProductIds = cappuccino;
    }
    product.hasComplements = product.complementProductIds.length > 0;
  });
}

function categoryOrderIndex(name: string, order: string[], fallback: number): number {
  const normalized = normalizeForMatch(name);
  const index = order.findIndex((item) => normalizeForMatch(item) === normalized);
  return index >= 0 ? index : order.length + fallback;
}

function relationshipTarget(xml: string, id: string): string {
  const regex = new RegExp(`<Relationship[^>]*Id="${escapeRegex(id)}"[^>]*Target="([^"]+)"`, "i");
  return xml.match(regex)?.[1] || "worksheets/sheet1.xml";
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join("")
  );
}

function parseRows(xml: string, sharedStrings: string[]): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const column = columnIndex(attrs.match(/r="([A-Z]+)\d+"/)?.[1] || "A");
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
      const isShared = /\bt="s"/.test(attrs);
      cells[column] = isShared ? sharedStrings[Number(raw)] || "" : decodeXml(raw);
    }
    return cells;
  });
}

function findHeader(header: string[], name: string): number {
  return header.findIndex((value) => cleanText(value).toUpperCase() === name);
}

function columnIndex(column: string): number {
  return column.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const raw = cleanText(value).replace(/[^\d,.-]/g, "");
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = raw.split(".");
    const last = parts.at(-1) || "";
    normalized = parts.length > 2 || last.length === 3
      ? raw.replace(/\./g, "")
      : raw;
  }
  return Number(normalized) || 0;
}

function isLikelyComplement(name: string): boolean {
  const normalized = normalizeForMatch(name);
  return normalized.startsWith("ADICIONAL ");
}

function isLikelyComplementHost(name: string): boolean {
  const normalized = normalizeForMatch(name);
  return /\b(CUSCUZ|OVO MEXIDO|TAPIOCA|PAO|SANDUICHE|MISTO|OMELETE|X TUDO|X-TUDO)\b/.test(normalized);
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Os IDs estaveis permitem reimportar a mesma planilha sem criar uma segunda
// copia do produto ou da categoria no SQLite.
function stableImportId(kind: "category" | "product", value: string): string {
  const hash = createHash("sha256").update(`cose-dell-abadia:${kind}:${value}`).digest("hex");
  return `${kind}-${hash.slice(0, 24)}`;
}

function inferUnitMode(unit: string): PdvProduct["unitMode"] {
  const normalized = unit.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (normalized === "KG" || normalized.includes("KILO")) {
    return "kg";
  }
  if (normalized === "G" || normalized === "GR" || normalized.includes("GRAMA")) {
    return "grama";
  }
  return "unidade";
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
