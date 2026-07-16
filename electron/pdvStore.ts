import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import type {
  PdvCartItem,
  PdvCategory,
  PdvCategoryDraft,
  PdvExportFilters,
  PdvOpenTable,
  PdvPayment,
  PdvProduct,
  PdvProductDraft,
  PdvProductImportPreview,
  PdvProductImportResult,
  PdvSettings,
  PdvSale,
  PdvSnapshot,
  PdvTableStatus,
  PdvTransferSelection
} from "../src/shared/pdvTypes.js";

const require = createRequire(import.meta.url);
const DEFAULT_PDV_SETTINGS: PdvSettings = {
  tableCount: 47,
  complementsEnabled: true,
  subtablesEnabled: true,
  tablePeopleEnabled: false,
  activePreset: "Cose Dell Abadia",
  gridColumns: 5,
  categoryColumns: 5,
  tableColumns: 9,
  productSortDirection: "az",
  allowOfflineTables: false,
  productCardHeight: 74,
  productFontSize: 14,
  categoryCardHeight: 64,
  tableCardHeight: 96,
  stackIdenticalItems: false,
  partialPaymentDescriptionEnabled: false,
  skipPaymentConfirmation: false,
  individualUnitItems: false,
  groupComplementsWithProduct: true
};
const PDV_BACKUP_DIRECTORY = "pdv-backups";

function normalizeSubtableNames(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function parseSubtableNames(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    return normalizeSubtableNames(JSON.parse(value));
  } catch {
    return [];
  }
}

export class PdvStore {
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;
  private dbFilePath = "";
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {}

  async initialize() {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    this.dbFilePath = path.join(this.dataDirectory, "pdv.sqlite");
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    this.sql = await initSqlJs({ locateFile: () => wasmPath });
    let existingDatabase = false;
    try {
      await fs.access(this.dbFilePath);
      existingDatabase = true;
    } catch {
      existingDatabase = false;
    }
    try {
      if (!existingDatabase) {
        throw new Error("Banco PDV ainda nao existe.");
      }
      this.db = new this.sql.Database(await fs.readFile(this.dbFilePath));
      await this.backupSqlite("antes-migracao");
    } catch (error) {
      if (existingDatabase) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const corruptPath = path.join(this.dataDirectory, `pdv-corrompido-${timestamp}.sqlite.bak`);
        await fs.copyFile(this.dbFilePath, corruptPath).catch(() => undefined);
        throw new Error(`O banco PDV nao pode ser aberto. Um backup foi preservado em ${corruptPath}.`);
      }
      this.db = new this.sql.Database();
    }
    try {
      this.migrate();
    } catch (error) {
      if (existingDatabase) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const corruptPath = path.join(this.dataDirectory, `pdv-corrompido-${timestamp}.sqlite.bak`);
        await fs.copyFile(this.dbFilePath, corruptPath).catch(() => undefined);
        this.db?.close();
        this.db = null;
        throw new Error(`O banco PDV nao pode ser migrado. Um backup foi preservado em ${corruptPath}.`);
      }
      throw error;
    }
    await this.persist();
    await this.backupSqliteDaily("automatico");
  }

  getDataFile() {
    return this.dbFilePath;
  }

  async exportBackupBase64(): Promise<string> {
    return Buffer.from(this.requireDb().export()).toString("base64");
  }

  async restoreBackupBase64(value: string): Promise<void> {
    if (!value) {
      return;
    }
    const bytes = Buffer.from(value, "base64");
    if (!bytes.length || !this.sql) {
      throw new Error("Backup do PDV invalido.");
    }
    await this.backupSqlite("antes-restauracao");
    const previous = this.requireDb();
    const restored = new this.sql.Database(bytes);
    this.db = restored;
    previous.close();
    this.migrate();
    await this.persist();
    await this.backupSqliteDaily("pos-restauracao");
  }

  async getSnapshot(): Promise<PdvSnapshot> {
    return {
      categories: this.getCategories(),
      products: this.getProducts(),
      tables: this.getTables(),
      recentSales: this.getRecentSales(),
      settings: this.getSettings(),
      dataFile: this.dbFilePath
    };
  }

  getSales(filters: PdvExportFilters = {}, limit?: number): PdvSale[] {
    const limitSql = limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : "";
    const sales = selectAll<Omit<PdvSale, "items" | "payments">>(
      this.requireDb(),
      `SELECT id, created_at AS createdAt, type, table_number AS tableNumber, table_session_id AS tableSessionId, COALESCE(status, 'Finalizada') AS status, subtotal, discount, total, description, observations, origin_device AS originDevice, operation_id AS operationId
       FROM sales ORDER BY created_at DESC${limitSql}`
    );
    return sales.map((sale) => this.hydrateSale(sale)).filter((sale) => matchesSaleFilters(sale, filters));
  }

  async saveSettings(patch: Partial<PdvSettings>): Promise<PdvSettings> {
    const next = { ...this.getSettings(), ...patch };
    const db = this.requireDb();
    const statement = db.prepare("INSERT INTO pdv_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    Object.entries(next).forEach(([key, value]) => statement.run([snakeCase(key), String(value)]));
    statement.free();
    await this.persist();
    return next;
  }

  async updateProducts(ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }): Promise<void> {
    if (!ids.length) {
      return;
    }
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        if (patch.categoryId) {
          db.run("UPDATE products SET category_id = ? WHERE id = ?", [patch.categoryId, id]);
        }
        if (typeof patch.canBeComplement === "boolean") {
          db.run("UPDATE products SET can_be_complement = ? WHERE id = ?", [patch.canBeComplement ? 1 : 0, id]);
        }
        if (typeof patch.hasComplements === "boolean") {
          db.run("UPDATE products SET has_complements = ? WHERE id = ?", [patch.hasComplements ? 1 : 0, id]);
        }
        if (typeof patch.showOnPdv === "boolean") {
          db.run("UPDATE products SET show_on_pdv = ? WHERE id = ?", [patch.showOnPdv ? 1 : 0, id]);
        }
        if (typeof patch.favorite === "boolean") {
          db.run("UPDATE products SET favorite = ? WHERE id = ?", [patch.favorite ? 1 : 0, id]);
        }
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
  }

  async saveCategory(draft: PdvCategoryDraft): Promise<PdvCategory> {
    const id = draft.id || slugId("categoria", draft.name);
    const category: PdvCategory = {
      id,
      name: draft.name.trim() || "Sem categoria",
      active: draft.active,
      favorite: draft.favorite,
      sortOrder: Math.floor(draft.sortOrder || 0)
    };
    this.requireDb().run(
      `INSERT INTO categories (id, name, active, favorite, sort_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, active=excluded.active, favorite=excluded.favorite, sort_order=excluded.sort_order`,
      [category.id, category.name, category.active ? 1 : 0, category.favorite ? 1 : 0, category.sortOrder]
    );
    await this.persist();
    return category;
  }

  async saveProduct(draft: PdvProductDraft): Promise<PdvProduct> {
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Informe um preco de venda maior que zero.");
    }
    const categories = this.getCategories();
    const fallbackCategoryId = categories[0]?.id || (await this.saveCategory({ name: "Geral", active: true, favorite: false, sortOrder: 0 })).id;
    const categoryId = categories.some((category) => category.id === draft.categoryId) ? draft.categoryId : fallbackCategoryId;
    const id = draft.id || slugId("produto", draft.name);
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      db.run(
        `INSERT INTO products (id, name, category_id, price, unit, unit_mode, active, show_on_pdv, favorite, can_be_complement, has_complements, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          category_id=excluded.category_id,
          price=excluded.price,
          unit=excluded.unit,
          unit_mode=excluded.unit_mode,
          active=excluded.active,
          show_on_pdv=excluded.show_on_pdv,
          favorite=excluded.favorite,
          can_be_complement=excluded.can_be_complement,
          has_complements=excluded.has_complements,
          sort_order=excluded.sort_order`,
        [
          id,
          draft.name.trim() || "Produto sem nome",
          categoryId,
          roundMoney(price),
          draft.unit.trim() || "UNID",
          normalizeUnitMode(draft.unitMode),
          draft.active ? 1 : 0,
          draft.showOnPdv ? 1 : 0,
          draft.favorite ? 1 : 0,
          draft.canBeComplement ? 1 : 0,
          draft.hasComplements ? 1 : 0,
          Math.floor(draft.sortOrder || 0)
        ]
      );
      db.run("DELETE FROM product_complements WHERE product_id = ?", [id]);
      const complementStatement = db.prepare("INSERT INTO product_complements (product_id, complement_product_id, sort_order) VALUES (?, ?, ?)");
      [...new Set(draft.complementProductIds || [])].filter((complementId) => complementId !== id).forEach((complementId, index) => {
        complementStatement.run([id, complementId, index]);
      });
      complementStatement.free();
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return this.getProducts().find((product) => product.id === id) || this.getProducts()[0];
  }

  async replaceProducts(categories: PdvCategory[], products: PdvProduct[], filePath: string, importSource = ""): Promise<PdvProductImportResult> {
    await this.backupSqlite("antes-importacao-produtos");
    const db = this.requireDb();
    let importedCategories = 0;
    let importedProducts = 0;
    let updatedProducts = 0;
    let removedProducts = 0;
    let skippedManualProducts = 0;
    db.run("BEGIN IMMEDIATE");
    try {
      const existingCategories = selectAll<{ id: string; name: string }>(db, "SELECT id, name FROM categories");
      const existingCategoryByName = new Map(existingCategories.map((category) => [catalogKey(category.name), category.id]));
      const categoryIdMap = new Map<string, string>();
      const normalizedCategories = categories.map((category) => {
        const id = existingCategoryByName.get(catalogKey(category.name)) || category.id;
        categoryIdMap.set(category.id, id);
        return { ...category, id };
      });
      const existingProducts = selectAll<{ id: string; name: string; category_name: string; import_source: string }>(db, "SELECT products.id, products.name, categories.name AS category_name, COALESCE(products.import_source, '') AS import_source FROM products LEFT JOIN categories ON categories.id = products.category_id");
      const existingProductByKey = new Map(existingProducts.map((product) => [catalogKey(`${product.category_name}|${product.name}`), product]));
      const productIdMap = new Map<string, string>();
      const normalizedProducts = products.flatMap((product) => {
        const category = normalizedCategories.find((item) => item.id === categoryIdMap.get(product.categoryId));
        const key = catalogKey(`${category?.name || product.categoryName}|${product.name}`);
        const existing = existingProductByKey.get(key);
        // A reimportacao atualiza somente itens que pertencem a mesma origem.
        // Assim, um produto cadastrado manualmente com o mesmo nome nunca e tomado pelo arquivo.
        if (existing && importSource && existing.import_source !== importSource) {
          skippedManualProducts += 1;
          return [];
        }
        const id = existing?.id || product.id;
        if (existing) updatedProducts += 1;
        productIdMap.set(product.id, id);
        return [{ ...product, id, categoryId: categoryIdMap.get(product.categoryId) || product.categoryId }];
      });
      const categoryStatement = db.prepare("INSERT INTO categories (id, name, active, favorite, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, active=excluded.active, favorite=excluded.favorite, sort_order=excluded.sort_order");
      for (const category of normalizedCategories) {
        categoryStatement.run([category.id, category.name, category.active ? 1 : 0, category.favorite ? 1 : 0, category.sortOrder]);
      }
      categoryStatement.free();

      const productStatement = db.prepare(
        `INSERT INTO products (id, name, category_id, price, unit, unit_mode, active, show_on_pdv, favorite, can_be_complement, has_complements, sort_order, import_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_id=excluded.category_id, price=excluded.price, unit=excluded.unit, unit_mode=excluded.unit_mode, active=excluded.active, show_on_pdv=excluded.show_on_pdv, favorite=excluded.favorite, can_be_complement=excluded.can_be_complement, has_complements=excluded.has_complements, sort_order=excluded.sort_order, import_source=CASE WHEN excluded.import_source <> '' THEN excluded.import_source ELSE products.import_source END`
      );
      for (const product of normalizedProducts) {
        productStatement.run([
          product.id,
          product.name,
          product.categoryId,
          product.price,
          product.unit,
          normalizeUnitMode(product.unitMode),
          product.active ? 1 : 0,
          product.showOnPdv ? 1 : 0,
          product.favorite ? 1 : 0,
          product.canBeComplement ? 1 : 0,
          product.hasComplements ? 1 : 0,
          product.sortOrder,
          importSource
        ]);
      }
      productStatement.free();
      if (importSource) {
        const importedIds = new Set(normalizedProducts.map((product) => product.id));
        const staleIds = existingProducts
          .filter((product) => product.import_source === importSource && !importedIds.has(product.id))
          .map((product) => product.id);
        if (staleIds.length) {
          const placeholders = staleIds.map(() => "?").join(", ");
          db.run(`UPDATE products SET active = 0, show_on_pdv = 0 WHERE id IN (${placeholders})`, staleIds);
          removedProducts = staleIds.length;
        }
      }
      const complementStatement = db.prepare("INSERT INTO product_complements (product_id, complement_product_id, sort_order) VALUES (?, ?, ?)");
      for (const product of normalizedProducts) {
        db.run("DELETE FROM product_complements WHERE product_id = ?", [product.id]);
        (product.complementProductIds || []).forEach((complementId, index) => {
          const mappedComplementId = productIdMap.get(complementId);
          if (mappedComplementId) {
            complementStatement.run([product.id, mappedComplementId, index]);
          }
        });
      }
      complementStatement.free();
      importedCategories = normalizedCategories.length;
      importedProducts = normalizedProducts.length;
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return {
      filePath,
      importedCategories,
      importedProducts,
      skippedRows: skippedManualProducts,
      updatedProducts,
      removedProducts
    };
  }

  previewProductImport(categories: PdvCategory[], products: PdvProduct[], filePath: string, importSource = ""): PdvProductImportPreview {
    const existingProducts = this.getProducts();
    const existingByKey = new Map(existingProducts.map((product) => [catalogKey(`${product.categoryName}|${product.name}`), product]));
    const incomingKeys = new Set(products.map((product) => catalogKey(`${product.categoryName}|${product.name}`)));
    const manualConflicts = importSource
      ? products.filter((product) => {
        const existing = existingByKey.get(catalogKey(`${product.categoryName}|${product.name}`));
        return Boolean(existing && existing.importSource !== importSource);
      }).length
      : 0;
    const addedProducts = products.filter((product) => !existingByKey.has(catalogKey(`${product.categoryName}|${product.name}`))).length;
    const updatedProducts = importSource
      ? products.filter((product) => existingByKey.get(catalogKey(`${product.categoryName}|${product.name}`))?.importSource === importSource).length
      : products.length - addedProducts;
    const removedProducts = importSource
      ? existingProducts.filter((product) => product.importSource === importSource && !incomingKeys.has(catalogKey(`${product.categoryName}|${product.name}`))).length
      : 0;
    return {
      filePath,
      categories: categories.length,
      products: products.length,
      addedProducts,
      updatedProducts,
      removedProducts,
      manualProductsPreserved: existingProducts.filter((product) => product.importSource !== importSource).length,
      manualConflicts,
      ignoredRows: manualConflicts
    };
  }

  async removeImportedProducts(importSource: string): Promise<number> {
    const source = importSource.trim();
    if (!source) return 0;
    await this.backupSqlite("antes-remover-importacao");
    const db = this.requireDb();
    const ids = selectAll<{ id: string }>(db, "SELECT id FROM products WHERE import_source = ?", [source]).map((row) => row.id);
    if (!ids.length) return 0;
    db.run("BEGIN IMMEDIATE");
    try {
      const placeholders = ids.map(() => "?").join(", ");
      db.run(`DELETE FROM product_complements WHERE product_id IN (${placeholders}) OR complement_product_id IN (${placeholders})`, [...ids, ...ids]);
      db.run(`DELETE FROM products WHERE id IN (${placeholders})`, ids);
      db.run("DELETE FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM products)");
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return ids.length;
  }

  async saveSale(input: { type: PdvSale["type"]; tableNumber?: number; status?: PdvSale["status"]; items: PdvCartItem[]; discount: number; payments: PdvPayment[]; originDevice?: string; operationId?: string }): Promise<PdvSale> {
    validateCartItems(input.items);
    if (input.operationId) {
      const existing = this.getSales({}).find((sale) => sale.operationId === input.operationId);
      if (existing) {
        return existing;
      }
    }
    const sale = createSale(input);
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      insertSale(db, sale);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return sale;
  }

  async openTable(tableNumber: number, people = 1, note = ""): Promise<void> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    const safePeople = Number.isFinite(people) ? Math.max(1, Math.floor(people)) : 1;
    const db = this.requireDb();
    const id = randomUUID();
    db.run(
      `INSERT INTO table_sessions (id, table_number, status, opened_at, people, note)
       VALUES (?, ?, 'Ocupada', ?, ?, ?)
       ON CONFLICT(table_number) DO UPDATE SET status='Ocupada', opened_at=COALESCE(opened_at, excluded.opened_at), people=excluded.people, note=excluded.note`,
      [id, tableNumber, new Date().toISOString(), safePeople, String(note || "").trim()]
    );
    await this.persist();
  }

  async setTableStatus(tableNumber: number, status: PdvTableStatus): Promise<void> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    if (!["Livre", "Ocupada", "Fechamento", "Reservada"].includes(status)) {
      throw new Error("Status de mesa invalido.");
    }
    const db = this.requireDb();
    db.run(
      `INSERT INTO table_sessions (id, table_number, status, opened_at, people, note)
       VALUES (?, ?, ?, NULL, 1, '')
       ON CONFLICT(table_number) DO UPDATE SET status=excluded.status`,
      [randomUUID(), tableNumber, status]
    );
    await this.persist();
  }

  async saveTableItems(tableNumber: number, items: PdvCartItem[], subtables?: string[]): Promise<void> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    validateCartItems(items);
    const db = this.requireDb();
    if (!items.length && !subtables?.length) {
      db.run("BEGIN IMMEDIATE");
      try {
        db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
        db.run("DELETE FROM table_sessions WHERE table_number = ? AND status != 'Reservada'", [tableNumber]);
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
      await this.persist();
      return;
    }
    db.run(
      `INSERT INTO table_sessions (id, table_number, status, opened_at, people, note)
       VALUES (?, ?, 'Ocupada', ?, 1, '')
       ON CONFLICT(table_number) DO UPDATE SET
         status=CASE
           WHEN table_sessions.status IN ('Livre', 'Reservada') THEN 'Ocupada'
           ELSE table_sessions.status
         END,
         opened_at=COALESCE(table_sessions.opened_at, excluded.opened_at)`,
      [randomUUID(), tableNumber, new Date().toISOString()]
    );
    if (subtables !== undefined) {
      db.run("UPDATE table_sessions SET subtables_json = ? WHERE table_number = ?", [JSON.stringify(normalizeSubtableNames(subtables)), tableNumber]);
    }
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      const statement = db.prepare(
        `INSERT INTO table_items (id, table_number, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, paid_quantity, subtable_name, note, complements_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      items.forEach((item, index) => {
        statement.run([
          item.id,
          tableNumber,
          item.productId,
          item.productName,
          item.categoryName,
          item.quantity,
          item.measureLabel || "",
          item.unitPrice,
          item.baseUnitPrice ?? item.unitPrice,
          item.discount,
          item.total,
          Math.min(item.quantity, Math.max(0, item.paidQuantity || 0)),
          item.subtableName || "",
          item.note || "",
          JSON.stringify(item.complements || []),
          index
        ]);
      });
      statement.free();
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
  }

  async transferTableItems(sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]): Promise<PdvCartItem[]> {
    sourceTableNumber = this.normalizeTableNumber(sourceTableNumber);
    targetTableNumber = this.normalizeTableNumber(targetTableNumber);
    if (!Array.isArray(selections) || !selections.length) {
      throw new Error("Selecione ao menos um item para transferir.");
    }
    const sourceItems = this.getTableItems(sourceTableNumber);
    const targetItems = targetTableNumber === sourceTableNumber ? sourceItems : this.getTableItems(targetTableNumber);
    const selectedById = new Map(selections.map((selection) => [selection.itemId, selection]));
    const movedItems: PdvCartItem[] = [];
    for (const selection of selections) {
      const source = sourceItems.find((item) => item.id === selection.itemId);
      const quantity = Number(selection.quantity);
      if (!source || !Number.isFinite(quantity) || quantity <= 0 || quantity > unpaidQuantity(source) + 0.009) {
        throw new Error("Quantidade de transferencia invalida.");
      }
      if (sourceTableNumber === targetTableNumber && (selection.subtableName || "") === (source.subtableName || "")) {
        throw new Error("Escolha outra mesa ou outra submesa.");
      }
      const ratio = source.quantity > 0 ? quantity / source.quantity : 1;
      const discount = roundMoney(source.discount * ratio);
      movedItems.push({
        ...source,
        id: randomUUID(),
        quantity: roundMoney(quantity),
        paidQuantity: 0,
        subtableName: String(selection.subtableName || "").trim(),
        discount,
        total: /\bg\s*$/i.test(source.measureLabel || "")
          ? roundMoney(Math.max(0, source.total * ratio))
          : roundMoney(Math.max(0, quantity * source.unitPrice - discount))
      });
    }
    const remainingItems = sourceItems.flatMap((item) => {
      const selection = selectedById.get(item.id);
      if (!selection) {
        return [item];
      }
      const remainingQuantity = roundMoney(item.quantity - selection.quantity);
      if (remainingQuantity <= 0.009) {
        return [];
      }
      const ratio = item.quantity > 0 ? remainingQuantity / item.quantity : 1;
      const discount = roundMoney(item.discount * ratio);
      return [{
        ...item,
        quantity: remainingQuantity,
        discount,
        total: /\bg\s*$/i.test(item.measureLabel || "")
          ? roundMoney(Math.max(0, item.total * ratio))
          : roundMoney(Math.max(0, remainingQuantity * item.unitPrice - discount))
      }];
    });
    const nextTargetItems = targetTableNumber === sourceTableNumber
      ? [...remainingItems, ...movedItems]
      : [...targetItems, ...movedItems];
    validateCartItems(nextTargetItems);
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM table_items WHERE table_number IN (?, ?)", [sourceTableNumber, targetTableNumber]);
      if (sourceTableNumber !== targetTableNumber && remainingItems.length) {
        writeTableItems(db, sourceTableNumber, remainingItems);
      }
      if (nextTargetItems.length) {
        writeTableItems(db, targetTableNumber, nextTargetItems);
        db.run(
          `INSERT INTO table_sessions (id, table_number, status, opened_at, people, note)
           VALUES (?, ?, 'Ocupada', ?, 1, '')
           ON CONFLICT(table_number) DO UPDATE SET status='Ocupada', opened_at=COALESCE(table_sessions.opened_at, excluded.opened_at)`,
          [randomUUID(), targetTableNumber, new Date().toISOString()]
        );
      }
      if (!remainingItems.length && sourceTableNumber !== targetTableNumber) {
        db.run("DELETE FROM table_sessions WHERE table_number = ? AND status != 'Reservada'", [sourceTableNumber]);
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return remainingItems;
  }

  async closeTable(tableNumber: number, payments: PdvPayment[], discount = 0, originDevice = "Este computador", operationId?: string): Promise<PdvSale> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    if (operationId) {
      const existing = this.getSales({}).find((sale) => sale.operationId === operationId);
      if (existing) {
        return existing;
      }
      const mapped = selectAll<{ saleId: string }>(this.requireDb(), "SELECT sale_id AS saleId FROM partial_operations WHERE operation_id = ?", [operationId])[0];
      if (mapped) return this.getSales({}).find((sale) => sale.id === mapped.saleId) || this.getSales({})[0];
    }
    const table = this.getTables().find((item) => item.number === tableNumber);
    const pendingItems = table?.items.flatMap((item) => {
      const quantity = unpaidQuantity(item);
      if (quantity <= 0.009) return [];
      const ratio = item.quantity ? quantity / item.quantity : 1;
      return [{ ...item, quantity, paidQuantity: 0, discount: roundMoney(item.discount * ratio), total: unpaidItemTotal(item) }];
    }) || [];
    if (!table || !pendingItems.length) {
      throw new Error("Mesa sem itens para fechar.");
    }
    const db = this.requireDb();
    const sale = createSale({ type: "Mesa", tableNumber, tableSessionId: table.sessionId, items: pendingItems, discount, payments, originDevice, operationId });
    db.run("BEGIN IMMEDIATE");
    try {
      const existingPartial = table.sessionId ? this.getSales({}).find((item) => item.tableSessionId === table.sessionId && item.status === "Parcial") : undefined;
      if (existingPartial) {
        appendSaleSegment(db, existingPartial, sale, "Finalizada");
        if (operationId) db.run("INSERT OR IGNORE INTO partial_operations (operation_id, sale_id) VALUES (?, ?)", [operationId, existingPartial.id]);
      } else {
        insertSale(db, sale);
      }
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      db.run("DELETE FROM table_sessions WHERE table_number = ?", [tableNumber]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return table.sessionId ? this.getSales({}).find((item) => item.tableSessionId === table.sessionId) || sale : sale;
  }

  async closeTablePartial(tableNumber: number, selectedItems: PdvCartItem[], payments: PdvPayment[], discount = 0, originDevice = "Este computador", operationId?: string, observations = ""): Promise<PdvSale> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    if (operationId) {
      const operation = selectAll<{ saleId: string }>(this.requireDb(), "SELECT sale_id AS saleId FROM partial_operations WHERE operation_id = ?", [operationId])[0];
      if (operation) return this.getSales({}).find((sale) => sale.id === operation.saleId) || this.getSales({})[0];
    }
    const table = this.getTables().find((item) => item.number === tableNumber);
    if (!table || !table.items.length) {
      throw new Error("Mesa sem itens para fechar parcialmente.");
    }
    if (!selectedItems.length) {
      throw new Error("Selecione ao menos um item para o fechamento parcial.");
    }
    validateCartItems(selectedItems);
    const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
    selectedItems.forEach((selected) => {
      const source = table.items.find((item) => item.id === selected.id);
      if (!source && selected.productId !== "manual-partial") {
        throw new Error("O item selecionado nao pertence mais a esta mesa.");
      }
      if (source && selected.quantity > unpaidQuantity(source) + 0.009) {
        throw new Error(`A quantidade selecionada de ${selected.productName} ultrapassa a mesa.`);
      }
    });
    const nextItems = table.items.map((item) => {
      const selected = selectedById.get(item.id);
      if (!selected) {
        return item;
      }
      const paidQuantity = Math.min(item.quantity, (item.paidQuantity || 0) + selected.quantity);
      return { ...item, paidQuantity: item.measureLabel ? roundQuantity(paidQuantity) : roundMoney(paidQuantity) };
    });
    const sale = createSale({ type: "Mesa", tableNumber, tableSessionId: table.sessionId, status: "Parcial", items: selectedItems, discount, payments, originDevice, operationId, observations });
    const existingPartial = table.sessionId ? this.getSales({}).find((item) => item.tableSessionId === table.sessionId && item.status === "Parcial") : undefined;
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      if (existingPartial) {
        appendSaleSegment(db, existingPartial, sale, "Parcial");
      } else {
        insertSale(db, sale);
      }
      if (operationId) db.run("INSERT OR IGNORE INTO partial_operations (operation_id, sale_id) VALUES (?, ?)", [operationId, existingPartial?.id || sale.id]);
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      writeTableItems(db, tableNumber, nextItems);
      // O parcial registra os itens pagos, mas deixa o restante da conta aberto.
      db.run("UPDATE table_sessions SET status = 'Ocupada' WHERE table_number = ?", [tableNumber]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return existingPartial ? this.getSales({}).find((item) => item.id === existingPartial.id) || sale : sale;
  }

  async cancelSale(id: string): Promise<void> {
    const db = this.requireDb();
    if (!selectAll<{ id: string }>(db, "SELECT id FROM sales WHERE id = ?", [id]).length) {
      throw new Error("Venda nao encontrada.");
    }
    db.run("UPDATE sales SET status = 'Cancelada' WHERE id = ?", [id]);
    await this.persist();
  }

  async updateSale(id: string, patch: Record<string, any>): Promise<void> {
    const db = this.requireDb();
    if (!selectAll<{ id: string }>(db, "SELECT id FROM sales WHERE id = ?", [id]).length) {
      throw new Error("Venda nao encontrada.");
    }
    const currentSale = this.getSales().find((sale) => sale.id === id);
    if (!currentSale) {
      throw new Error("Venda nao encontrada.");
    }
    const nextTotal = patch.finalValue === undefined ? currentSale.total : roundMoney(Number(patch.finalValue));
    if (!Number.isFinite(nextTotal) || nextTotal < 0) {
      throw new Error("Total final invalido.");
    }
    const nextPayments = patch.paymentMethod
      ? normalizePaymentsForTotal([{ id: randomUUID(), method: normalizePdvPaymentMethod(patch.paymentMethod), amount: nextTotal, received: nextTotal }], nextTotal)
      : patch.finalValue !== undefined
        ? normalizePaymentsForTotal(currentSale.payments, nextTotal)
        : null;
    let status = patch.status;
    if (status === "cancelled") status = "Cancelada";
    if (status === "active") status = "Finalizada";

    db.run("BEGIN IMMEDIATE");
    try {
      if (status) {
        db.run("UPDATE sales SET status = ? WHERE id = ?", [status, id]);
      }
      if (patch.createdAt) {
        db.run("UPDATE sales SET created_at = ? WHERE id = ?", [patch.createdAt, id]);
      }
      if (patch.finalValue !== undefined) {
        db.run("UPDATE sales SET total = ? WHERE id = ?", [patch.finalValue, id]);
      }
      if (patch.originalValue !== undefined) {
        db.run("UPDATE sales SET subtotal = ? WHERE id = ?", [patch.originalValue, id]);
      }
      if (patch.difference !== undefined) {
        db.run("UPDATE sales SET discount = ? WHERE id = ?", [-patch.difference, id]);
      }
      if (typeof patch.description === "string") {
        db.run("UPDATE sales SET description = ? WHERE id = ?", [patch.description.trim(), id]);
      }
      if (typeof patch.observations === "string") {
        db.run("UPDATE sales SET observations = ? WHERE id = ?", [patch.observations.trim(), id]);
      }
      if (nextPayments) {
        db.run("DELETE FROM sale_payments WHERE sale_id = ?", [id]);
        const statement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
        nextPayments.forEach((payment) => statement.run([payment.id || randomUUID(), id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null, payment.description?.trim() || ""]));
        statement.free();
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
  }

  async deleteSale(id: string): Promise<void> {
    const db = this.requireDb();
    if (!selectAll<{ id: string }>(db, "SELECT id FROM sales WHERE id = ?", [id]).length) {
      throw new Error("Venda nao encontrada.");
    }
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM sales WHERE id = ?", [id]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
  }

  async updateSalePayments(id: string, payments: PdvPayment[]): Promise<PdvSale> {
    const sale = this.getSales().find((item) => item.id === id);
    if (!sale) {
      throw new Error("Venda nao encontrada.");
    }
    if (sale.status === "Cancelada") {
      throw new Error("Venda cancelada nao pode ter pagamento alterado.");
    }
    const normalizedPayments = normalizePaymentsForTotal(payments, sale.total);
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM sale_payments WHERE sale_id = ?", [id]);
      const statement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
      normalizedPayments.forEach((payment) => {
        statement.run([payment.id || randomUUID(), id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null, payment.description?.trim() || ""]);
      });
      statement.free();
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return this.getSales().find((item) => item.id === id) || sale;
  }

  private getCategories(): PdvCategory[] {
    const preferred = ["ARTESANATO", "FORNECEDORES", "PIMENTAS", "BEBIDAS", "DOCES", "EMPORIO", "CAFE", "SUCOS", "FRUTAS"];
    return selectAll<PdvCategory>(
      this.requireDb(),
      "SELECT id, name, active = 1 AS active, favorite = 1 AS favorite, sort_order AS sortOrder FROM categories ORDER BY favorite DESC, sort_order, name"
    ).sort((left, right) => {
      const leftIndex = preferred.indexOf(normalizeText(left.name));
      const rightIndex = preferred.indexOf(normalizeText(right.name));
      const leftOrder = leftIndex >= 0 ? leftIndex : preferred.length + left.sortOrder;
      const rightOrder = rightIndex >= 0 ? rightIndex : preferred.length + right.sortOrder;
      return Number(right.favorite) - Number(left.favorite) || leftOrder - rightOrder || left.name.localeCompare(right.name, "pt-BR");
    });
  }

  private getProducts(): PdvProduct[] {
    const products = selectAll<Omit<PdvProduct, "complementProductIds">>(
      this.requireDb(),
      `SELECT p.id, p.name, p.category_id AS categoryId, c.name AS categoryName, p.price, p.unit,
        COALESCE(p.unit_mode, 'unidade') AS unitMode,
        p.active = 1 AS active, p.show_on_pdv = 1 AS showOnPdv, p.favorite = 1 AS favorite,
       p.can_be_complement = 1 AS canBeComplement, p.has_complements = 1 AS hasComplements,
       p.sort_order AS sortOrder, COALESCE(p.import_source, '') AS importSource
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.favorite DESC, c.sort_order, c.name, p.favorite DESC, p.sort_order, p.name`
    );
    const links = selectAll<{ productId: string; complementProductId: string }>(
      this.requireDb(),
      "SELECT product_id AS productId, complement_product_id AS complementProductId FROM product_complements ORDER BY product_id, sort_order"
    );
    const byProduct = new Map<string, string[]>();
    links.forEach((link) => byProduct.set(link.productId, [...(byProduct.get(link.productId) || []), link.complementProductId]));
    return products.map((product) => ({
      ...product,
      unitMode: normalizeUnitMode(product.unitMode),
      complementProductIds: byProduct.get(product.id) || []
    }));
  }

  private getTables(): PdvOpenTable[] {
    const tableCount = Math.max(1, Math.min(300, this.getSettings().tableCount || DEFAULT_PDV_SETTINGS.tableCount));
    const sessions = selectAll<{ id: string; tableNumber: number; status: PdvTableStatus; openedAt: string | null; people: number; note: string; subtablesJson: string }>(
      this.requireDb(),
      "SELECT id, table_number AS tableNumber, status, opened_at AS openedAt, people, note, subtables_json AS subtablesJson FROM table_sessions"
    );
    const byNumber = new Map(sessions.map((session) => [session.tableNumber, session]));
    return Array.from({ length: tableCount }, (_, index) => {
      const number = index + 1;
      const session = byNumber.get(number);
      const items = this.getTableItems(number);
      const remainingTotal = roundMoney(items.reduce((total, item) => total + unpaidItemTotal(item), 0));
      const visualStatus = items.length
        ? (remainingTotal <= 0.009 || session?.status === "Fechamento" ? "Fechamento" : "Ocupada")
        : session?.status === "Reservada"
          ? "Reservada"
          : "Livre";
      return {
        id: `mesa-${number}`,
        sessionId: session?.id,
        number,
        status: visualStatus,
        openedAt: items.length ? session?.openedAt || null : null,
        people: session?.people || 1,
        note: items.length || session?.status === "Reservada" ? session?.note || "" : "",
        total: remainingTotal,
        items,
        subtables: parseSubtableNames(session?.subtablesJson)
      };
    });
  }

  private getTableItems(tableNumber: number): PdvCartItem[] {
    return selectAll<PdvCartItem>(
      this.requireDb(),
      `SELECT id, product_id AS productId, product_name AS productName, category_name AS categoryName,
        quantity, measure_label AS measureLabel, unit_price AS unitPrice, base_unit_price AS baseUnitPrice, discount, total, paid_quantity AS paidQuantity, subtable_name AS subtableName, note,
        complements_json AS complementsJson
       FROM table_items WHERE table_number = ? ORDER BY sort_order, rowid`,
      [tableNumber]
    ).map(normalizeCartItem);
  }

  private getRecentSales(): PdvSale[] {
    return this.getSales({});
  }

  private hydrateSale(sale: Omit<PdvSale, "items" | "payments">): PdvSale {
    return {
      ...sale,
      items: selectAll<PdvCartItem>(
        this.requireDb(),
        `SELECT id, product_id AS productId, product_name AS productName, category_name AS categoryName,
          quantity, measure_label AS measureLabel, unit_price AS unitPrice, base_unit_price AS baseUnitPrice, discount, total, subtable_name AS subtableName, note,
          complements_json AS complementsJson
         FROM sale_items WHERE sale_id = ? ORDER BY rowid`,
        [sale.id]
      ).map(normalizeCartItem),
      payments: selectAll<PdvPayment>(
        this.requireDb(),
        "SELECT id, method, amount, received, change, description FROM sale_payments WHERE sale_id = ? ORDER BY rowid",
        [sale.id]
      )
    };
  }

  private migrate() {
    const db = this.requireDb();
    db.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        favorite INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        price REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'UNID',
        active INTEGER NOT NULL DEFAULT 1,
        show_on_pdv INTEGER NOT NULL DEFAULT 1,
        favorite INTEGER NOT NULL DEFAULT 0,
        can_be_complement INTEGER NOT NULL DEFAULT 0,
        has_complements INTEGER NOT NULL DEFAULT 0,
        unit_mode TEXT NOT NULL DEFAULT 'unidade',
        sort_order INTEGER NOT NULL DEFAULT 0,
        import_source TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS product_complements (
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        complement_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (product_id, complement_product_id)
      );
      CREATE TABLE IF NOT EXISTS pdv_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS table_sessions (
        id TEXT PRIMARY KEY,
        table_number INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL,
        opened_at TEXT,
        people INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        subtables_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS table_items (
        id TEXT PRIMARY KEY,
        table_number INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        category_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        measure_label TEXT NOT NULL DEFAULT '',
        unit_price REAL NOT NULL,
        base_unit_price REAL,
        discount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        paid_quantity REAL NOT NULL DEFAULT 0,
        subtable_name TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        complements_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        type TEXT NOT NULL,
         table_number INTEGER,
         table_session_id TEXT,
         status TEXT NOT NULL DEFAULT 'Finalizada',
         subtotal REAL NOT NULL,
         discount REAL NOT NULL,
         total REAL NOT NULL,
         description TEXT NOT NULL DEFAULT '',
         observations TEXT NOT NULL DEFAULT '',
         origin_device TEXT NOT NULL DEFAULT 'Este computador',
         operation_id TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        category_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        measure_label TEXT NOT NULL DEFAULT '',
        unit_price REAL NOT NULL,
        base_unit_price REAL,
        discount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        subtable_name TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        complements_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS sale_payments (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method TEXT NOT NULL,
        amount REAL NOT NULL,
        received REAL,
        change REAL,
        description TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS partial_operations (
        operation_id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE
      );
    `);
    addColumnIfMissing(db, "products", "can_be_complement", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "products", "has_complements", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "products", "unit_mode", "TEXT NOT NULL DEFAULT 'unidade'");
    addColumnIfMissing(db, "products", "favorite", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "products", "import_source", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "categories", "favorite", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "table_items", "base_unit_price", "REAL");
    addColumnIfMissing(db, "table_items", "complements_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "table_items", "measure_label", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "table_items", "paid_quantity", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "table_sessions", "subtables_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "sale_items", "base_unit_price", "REAL");
    addColumnIfMissing(db, "sale_items", "complements_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "sale_items", "measure_label", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "status", "TEXT NOT NULL DEFAULT 'Finalizada'");
    addColumnIfMissing(db, "sales", "description", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "observations", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "table_session_id", "TEXT");
    addColumnIfMissing(db, "sales", "origin_device", "TEXT NOT NULL DEFAULT 'Este computador'");
    addColumnIfMissing(db, "sales", "operation_id", "TEXT");
    addColumnIfMissing(db, "sale_payments", "description", "TEXT NOT NULL DEFAULT ''");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_operation_id ON sales(operation_id) WHERE operation_id IS NOT NULL");
    const defaults = this.getSettings();
    const statement = db.prepare("INSERT INTO pdv_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING");
    Object.entries(defaults).forEach(([key, value]) => statement.run([snakeCase(key), String(value)]));
    statement.free();
  }

  private getSettings(): PdvSettings {
    const rows = selectAll<{ key: string; value: string }>(this.requireDb(), "SELECT key, value FROM pdv_settings");
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      tableCount: parseIntegerSetting(map.get("table_count"), DEFAULT_PDV_SETTINGS.tableCount),
      complementsEnabled: parseBooleanSetting(map.get("complements_enabled"), DEFAULT_PDV_SETTINGS.complementsEnabled),
      subtablesEnabled: parseBooleanSetting(map.get("subtables_enabled"), DEFAULT_PDV_SETTINGS.subtablesEnabled),
      tablePeopleEnabled: parseBooleanSetting(map.get("table_people_enabled"), DEFAULT_PDV_SETTINGS.tablePeopleEnabled),
      activePreset: map.get("active_preset") || DEFAULT_PDV_SETTINGS.activePreset,
      gridColumns: Math.max(4, Math.min(10, parseIntegerSetting(map.get("grid_columns"), DEFAULT_PDV_SETTINGS.gridColumns || 5))),
      categoryColumns: Math.max(3, Math.min(10, parseIntegerSetting(map.get("category_columns"), DEFAULT_PDV_SETTINGS.categoryColumns || 5))),
      tableColumns: Math.max(5, Math.min(12, parseIntegerSetting(map.get("table_columns"), DEFAULT_PDV_SETTINGS.tableColumns || 9))),
      productSortDirection: map.get("product_sort_direction") === "za" ? "za" : "az",
      allowOfflineTables: parseBooleanSetting(map.get("allow_offline_tables"), DEFAULT_PDV_SETTINGS.allowOfflineTables || false),
      productCardHeight: Math.max(56, Math.min(110, parseIntegerSetting(map.get("product_card_height"), DEFAULT_PDV_SETTINGS.productCardHeight || 74))),
      productFontSize: Math.max(10, Math.min(20, parseIntegerSetting(map.get("product_font_size"), DEFAULT_PDV_SETTINGS.productFontSize || 14))),
      categoryCardHeight: Math.max(44, Math.min(90, parseIntegerSetting(map.get("category_card_height"), DEFAULT_PDV_SETTINGS.categoryCardHeight || 64))),
      tableCardHeight: Math.max(74, Math.min(130, parseIntegerSetting(map.get("table_card_height"), DEFAULT_PDV_SETTINGS.tableCardHeight || 96))),
      stackIdenticalItems: parseBooleanSetting(map.get("stack_identical_items"), DEFAULT_PDV_SETTINGS.stackIdenticalItems || false),
      partialPaymentDescriptionEnabled: parseBooleanSetting(map.get("partial_payment_description_enabled"), DEFAULT_PDV_SETTINGS.partialPaymentDescriptionEnabled || false),
      skipPaymentConfirmation: parseBooleanSetting(map.get("skip_payment_confirmation"), DEFAULT_PDV_SETTINGS.skipPaymentConfirmation || false),
      individualUnitItems: parseBooleanSetting(map.get("individual_unit_items"), DEFAULT_PDV_SETTINGS.individualUnitItems || false),
      groupComplementsWithProduct: parseBooleanSetting(map.get("group_complements_with_product"), DEFAULT_PDV_SETTINGS.groupComplementsWithProduct ?? true)
    };
  }

  private async persist() {
    const write = this.persistQueue.catch(() => undefined).then(async () => {
      const db = this.requireDb();
      const tempPath = `${this.dbFilePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, Buffer.from(db.export()));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await fs.rename(tempPath, this.dbFilePath);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const canRetry = code === "EPERM" || code === "EACCES" || code === "EBUSY";
          if (!canRetry || attempt === 4) {
            await fs.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 90 * (attempt + 1)));
        }
      }
    });
    this.persistQueue = write;
    await write;
  }

  private async backupSqlite(reason: string): Promise<void> {
    try {
      await fs.access(this.dbFilePath);
    } catch {
      return;
    }
    const directory = path.join(this.dataDirectory, PDV_BACKUP_DIRECTORY);
    await fs.mkdir(directory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(this.dbFilePath, path.join(directory, `pdv-${reason}-${timestamp}.sqlite.bak`));
  }

  private async backupSqliteDaily(reason: string): Promise<void> {
    try {
      await fs.access(this.dbFilePath);
    } catch {
      return;
    }
    const directory = path.join(this.dataDirectory, PDV_BACKUP_DIRECTORY);
    await fs.mkdir(directory, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const target = path.join(directory, `pdv-${reason}-${date}.sqlite.bak`);
    try {
      await fs.access(target);
      return;
    } catch {
      await fs.copyFile(this.dbFilePath, target);
    }
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("Banco PDV ainda nao foi inicializado.");
    }
    return this.db;
  }

  private normalizeTableNumber(value: number): number {
    const tableNumber = Number(value);
    const maxTables = Math.max(1, Math.min(300, this.getSettings().tableCount || DEFAULT_PDV_SETTINGS.tableCount));
    if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > maxTables) {
      throw new Error(`Mesa invalida. Informe um numero entre 1 e ${maxTables}.`);
    }
    return tableNumber;
  }
}

function insertSale(db: Database, sale: PdvSale) {
  db.run("INSERT INTO sales (id, created_at, type, table_number, table_session_id, status, subtotal, discount, total, description, observations, origin_device, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    sale.id,
    sale.createdAt,
    sale.type,
    sale.tableNumber ?? null,
    sale.tableSessionId || null,
    sale.status,
    sale.subtotal,
    sale.discount,
    sale.total,
    sale.description || (sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta"),
    sale.observations || "",
    sale.originDevice || "Este computador",
    sale.operationId || null
  ]);
  const itemStatement = db.prepare(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, subtable_name, note, complements_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sale.items.forEach((item) =>
    itemStatement.run([
      randomUUID(),
      sale.id,
      item.productId,
      item.productName,
      item.categoryName,
      item.quantity,
      item.measureLabel || "",
      item.unitPrice,
      item.baseUnitPrice ?? item.unitPrice,
      item.discount,
      item.total,
      item.subtableName || "",
      item.note || "",
      JSON.stringify(item.complements || [])
    ])
  );
  itemStatement.free();

  const paymentStatement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
  sale.payments.forEach((payment) =>
    paymentStatement.run([payment.id, sale.id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null, payment.description?.trim() || ""])
  );
  paymentStatement.free();
}

function appendSaleSegment(db: Database, existing: PdvSale, segment: PdvSale, status: PdvSale["status"]) {
  db.run(
    "UPDATE sales SET status = ?, subtotal = ?, discount = ?, total = ?, observations = ? WHERE id = ?",
    [status, roundMoney(existing.subtotal + segment.subtotal), roundMoney(existing.discount + segment.discount), roundMoney(existing.total + segment.total), [existing.observations, segment.observations].filter(Boolean).join(" | "), existing.id]
  );
  const merged = { ...segment, id: existing.id };
  const itemStatement = db.prepare(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, subtable_name, note, complements_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  merged.items.forEach((item) => itemStatement.run([randomUUID(), existing.id, item.productId, item.productName, item.categoryName, item.quantity, item.measureLabel || "", item.unitPrice, item.baseUnitPrice ?? item.unitPrice, item.discount, item.total, item.subtableName || "", item.note || "", JSON.stringify(item.complements || [])]));
  itemStatement.free();
  const paymentStatement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
  merged.payments.forEach((payment) => paymentStatement.run([payment.id, existing.id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null, payment.description?.trim() || ""]));
  paymentStatement.free();
}

function writeTableItems(db: Database, tableNumber: number, items: PdvCartItem[]) {
  const statement = db.prepare(
    `INSERT INTO table_items (id, table_number, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, paid_quantity, subtable_name, note, complements_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((item, index) => {
    statement.run([
      item.id,
      tableNumber,
      item.productId,
      item.productName,
      item.categoryName,
      item.quantity,
      item.measureLabel || "",
      item.unitPrice,
      item.baseUnitPrice ?? item.unitPrice,
      item.discount,
      item.total,
      Math.min(item.quantity, Math.max(0, item.paidQuantity || 0)),
      item.subtableName || "",
      item.note || "",
      JSON.stringify(item.complements || []),
      index
    ]);
  });
  statement.free();
}

function createSale(input: { type: PdvSale["type"]; tableNumber?: number; tableSessionId?: string; status?: PdvSale["status"]; items: PdvCartItem[]; discount: number; payments: PdvPayment[]; originDevice?: string; operationId?: string; observations?: string }): PdvSale {
  const subtotal = roundMoney(input.items.reduce((total, item) => total + item.total, 0));
  const discount = Math.min(subtotal, roundMoney(Math.max(0, input.discount)));
  const total = Math.max(0, roundMoney(subtotal - discount));
  const payments = normalizePaymentsForTotal(input.payments, total);
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    type: input.type,
    tableNumber: input.tableNumber,
    tableSessionId: input.tableSessionId,
    status: input.status || "Finalizada",
    subtotal,
    discount,
    total,
    description: input.tableNumber ? `Mesa ${input.tableNumber}` : input.type === "Onibus" ? "Venda de onibus" : "Venda direta",
    observations: input.observations?.trim() || "",
    originDevice: input.originDevice || "Este computador",
    operationId: input.operationId,
    payments,
    items: input.items
  };
}

function validateCartItems(items: PdvCartItem[]) {
  if (!Array.isArray(items)) {
    throw new Error("Lista de itens invalida.");
  }
  items.forEach((item) => {
    if (!item || !item.id || !item.productName) {
      throw new Error("Item de produto invalido.");
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100000) {
      throw new Error(`Quantidade invalida para ${item.productName}.`);
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.total) || item.total < 0) {
      throw new Error(`Preco invalido para ${item.productName}.`);
    }
    if (!Number.isFinite(item.discount) || item.discount < 0) {
      throw new Error(`Desconto invalido para ${item.productName}.`);
    }
    if (item.paidQuantity !== undefined && (!Number.isFinite(item.paidQuantity) || item.paidQuantity < 0 || item.paidQuantity > item.quantity + 0.009)) {
      throw new Error(`Estado de pagamento invalido para ${item.productName}.`);
    }
    // Produtos por peso podem receber um valor final digitado pelo operador.
    // Nesse caso, o peso serve para consulta e nao deve recalcular o total.
    if (!item.measureLabel) {
      const expectedTotal = roundMoney(Math.max(0, item.quantity * item.unitPrice - item.discount));
      if (Math.abs(roundMoney(item.total) - expectedTotal) > 0.01) {
        throw new Error(`Total invalido para ${item.productName}.`);
      }
    }
  });
}

function unpaidQuantity(item: PdvCartItem): number {
  const remaining = Math.max(0, item.quantity - Math.min(item.quantity, Math.max(0, item.paidQuantity || 0)));
  return item.measureLabel ? roundQuantity(remaining) : roundMoney(remaining);
}

function unpaidItemTotal(item: PdvCartItem): number {
  if (!item.quantity) return 0;
  const paid = Math.min(item.quantity, Math.max(0, item.paidQuantity || 0));
  if (paid <= 0.000001) return roundMoney(item.total);
  const remaining = unpaidQuantity(item);
  if (remaining <= 0.000001) return 0;
  return roundMoney(item.total * (remaining / item.quantity));
}

function normalizePaymentsForTotal(payments: PdvPayment[], total: number): PdvPayment[] {
  const normalized = payments.length
    ? payments.map((payment) => {
        const amount = roundMoney(Number(payment.amount));
        const received = payment.received === undefined ? undefined : roundMoney(Number(payment.received));
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error(`Valor de pagamento invalido em ${payment.method || "metodo"}.`);
        }
        if (received !== undefined && (!Number.isFinite(received) || received < 0)) {
          throw new Error("Valor recebido invalido.");
        }
        if (payment.method === "Dinheiro" && received !== undefined && received < amount - 0.01) {
          throw new Error("O valor recebido em dinheiro nao pode ser menor que o pagamento.");
        }
        return {
          ...payment,
          id: payment.id || randomUUID(),
          amount,
          received,
          change: payment.method === "Dinheiro" && received !== undefined ? roundMoney(Math.max(0, received - amount)) : 0
        };
      })
    : [{ id: randomUUID(), method: "Nao definido" as const, amount: roundMoney(total) }];
  const sum = roundMoney(normalized.reduce((value, payment) => value + payment.amount, 0));
  if (Math.abs(sum - roundMoney(total)) > 0.01) {
    throw new Error("Pagamentos precisam somar o total final da venda.");
  }
  return normalized;
}

function normalizePdvPaymentMethod(value: unknown): PdvPayment["method"] {
  const normalized = String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  if (normalized.includes("dinheiro")) return "Dinheiro";
  if (normalized.includes("debito")) return "Debito";
  if (normalized.includes("credito")) return "Credito";
  if (normalized.includes("pix")) return "Pix";
  if (!normalized || normalized.includes("nao informado") || normalized.includes("nao definido")) return "Nao definido";
  return "Outros";
}

function selectAll<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows: T[] = [];
  while (statement.step()) {
    rows.push(statement.getAsObject() as T);
  }
  statement.free();
  return rows;
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string) {
  const columns = selectAll<{ name: string }>(db, `PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function normalizeCartItem(row: PdvCartItem & { complementsJson?: string }): PdvCartItem {
  const { complementsJson, ...item } = row;
  return {
    ...item,
    paidQuantity: Math.min(Number(item.quantity) || 0, Math.max(0, Number(item.paidQuantity) || 0)),
    complements: parseComplements(complementsJson)
  };
}

function normalizeUnitMode(value?: string): "unidade" | "kg" | "grama" {
  if (value === "kg" || value === "grama") {
    return value;
  }
  return "unidade";
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
}

function catalogKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function parseComplements(raw?: string) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugId(prefix: string, name: string): string {
  const slug = (name || prefix)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return `${prefix}-${slug || randomUUID()}-${randomUUID().slice(0, 8)}`;
}

function matchesSaleFilters(sale: PdvSale, filters: PdvExportFilters): boolean {
  const date = new Date(sale.createdAt);
  const dateKey = Number.isNaN(date.getTime())
    ? sale.createdAt.slice(0, 10)
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const table = (filters.table || "").replace(/^0+/, "");
  if (filters.from && dateKey < filters.from) {
    return false;
  }
  if (filters.to && dateKey > filters.to) {
    return false;
  }
  if (filters.type && filters.type !== "Todos" && sale.type !== filters.type) {
    return false;
  }
  if (filters.payment && filters.payment !== "Todos" && !sale.payments.some((payment) => payment.method === filters.payment)) {
    return false;
  }
  if (filters.status && filters.status !== "Todos" && sale.status !== filters.status) {
    return false;
  }
  if (table && String(sale.tableNumber || "") !== table) {
    return false;
  }
  return true;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
}

function parseIntegerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

