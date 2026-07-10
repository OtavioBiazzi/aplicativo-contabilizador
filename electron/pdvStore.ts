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
  PdvProductImportResult,
  PdvSettings,
  PdvSale,
  PdvSnapshot,
  PdvTableStatus
} from "../src/shared/pdvTypes.js";

const require = createRequire(import.meta.url);
const DEFAULT_PDV_SETTINGS: PdvSettings = {
  tableCount: 47,
  complementsEnabled: true,
  subtablesEnabled: true,
  tablePeopleEnabled: false,
  activePreset: "Cose Dell Abadia",
  gridColumns: 5
};
const PDV_BACKUP_DIRECTORY = "pdv-backups";

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
      `SELECT id, created_at AS createdAt, type, table_number AS tableNumber, COALESCE(status, 'Finalizada') AS status, subtotal, discount, total, description, observations, origin_device AS originDevice, operation_id AS operationId
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
          roundMoney(draft.price),
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

  async replaceProducts(categories: PdvCategory[], products: PdvProduct[], filePath: string): Promise<PdvProductImportResult> {
    await this.backupSqlite("antes-importacao-produtos");
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM product_complements");
      db.run("DELETE FROM products");
      db.run("DELETE FROM categories");
      const categoryStatement = db.prepare("INSERT INTO categories (id, name, active, favorite, sort_order) VALUES (?, ?, ?, ?, ?)");
      for (const category of categories) {
        categoryStatement.run([category.id, category.name, category.active ? 1 : 0, category.favorite ? 1 : 0, category.sortOrder]);
      }
      categoryStatement.free();

      const productStatement = db.prepare(
        "INSERT INTO products (id, name, category_id, price, unit, unit_mode, active, show_on_pdv, favorite, can_be_complement, has_complements, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const product of products) {
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
          product.sortOrder
        ]);
      }
      productStatement.free();
      const complementStatement = db.prepare("INSERT INTO product_complements (product_id, complement_product_id, sort_order) VALUES (?, ?, ?)");
      for (const product of products) {
        (product.complementProductIds || []).forEach((complementId, index) => {
          complementStatement.run([product.id, complementId, index]);
        });
      }
      complementStatement.free();
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return {
      filePath,
      importedCategories: categories.length,
      importedProducts: products.length,
      skippedRows: 0
    };
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
    const id = `mesa-${tableNumber}`;
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
      [`mesa-${tableNumber}`, tableNumber, status]
    );
    await this.persist();
  }

  async saveTableItems(tableNumber: number, items: PdvCartItem[]): Promise<void> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    validateCartItems(items);
    const db = this.requireDb();
    if (!items.length) {
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
      [`mesa-${tableNumber}`, tableNumber, new Date().toISOString()]
    );
    db.run("BEGIN IMMEDIATE");
    try {
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      const statement = db.prepare(
        `INSERT INTO table_items (id, table_number, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, subtable_name, note, complements_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  async closeTable(tableNumber: number, payments: PdvPayment[], discount = 0, originDevice = "Este computador", operationId?: string): Promise<PdvSale> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    if (operationId) {
      const existing = this.getSales({}).find((sale) => sale.operationId === operationId);
      if (existing) {
        return existing;
      }
    }
    const table = this.getTables().find((item) => item.number === tableNumber);
    if (!table || !table.items.length) {
      throw new Error("Mesa sem itens para fechar.");
    }
    const db = this.requireDb();
    const sale = createSale({ type: "Mesa", tableNumber, items: table.items, discount, payments, originDevice, operationId });
    db.run("BEGIN IMMEDIATE");
    try {
      insertSale(db, sale);
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      db.run("DELETE FROM table_sessions WHERE table_number = ?", [tableNumber]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return sale;
  }

  async closeTablePartial(tableNumber: number, selectedItems: PdvCartItem[], payments: PdvPayment[], discount = 0, originDevice = "Este computador", operationId?: string): Promise<PdvSale> {
    tableNumber = this.normalizeTableNumber(tableNumber);
    if (operationId) {
      const existing = this.getSales({}).find((sale) => sale.operationId === operationId);
      if (existing) {
        return existing;
      }
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
      if (source && selected.quantity > source.quantity + 0.009) {
        throw new Error(`A quantidade selecionada de ${selected.productName} ultrapassa a mesa.`);
      }
    });
    const remainingItems = table.items.flatMap((item) => {
      const selected = selectedById.get(item.id);
      if (!selected) {
        return [item];
      }
      const remainingQuantity = roundMoney(Math.max(0, item.quantity - selected.quantity));
      if (remainingQuantity <= 0.009) {
        return [];
      }
      const unitTotal = item.quantity > 0 ? item.total / item.quantity : item.unitPrice;
      return [{ ...item, quantity: remainingQuantity, total: roundMoney(unitTotal * remainingQuantity) }];
    });
    const sale = createSale({ type: "Mesa", tableNumber, status: "Parcial", items: selectedItems, discount, payments, originDevice, operationId });
    const db = this.requireDb();
    db.run("BEGIN IMMEDIATE");
    try {
      insertSale(db, sale);
      db.run("DELETE FROM table_items WHERE table_number = ?", [tableNumber]);
      if (remainingItems.length) {
        writeTableItems(db, tableNumber, remainingItems);
      } else {
        db.run("DELETE FROM table_sessions WHERE table_number = ?", [tableNumber]);
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    await this.persist();
    return sale;
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
      if (patch.paymentMethod) {
        db.run("DELETE FROM sale_payments WHERE sale_id = ?", [id]);
        const amt = patch.finalValue ?? (selectAll<{ total: number }>(db, "SELECT total FROM sales WHERE id = ?", [id])[0]?.total || 0);
        db.run("INSERT INTO sale_payments (id, sale_id, method, amount, received, change) VALUES (?, ?, ?, ?, ?, ?)",
          [randomUUID(), id, patch.paymentMethod, amt, amt, 0]);
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
      const statement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change) VALUES (?, ?, ?, ?, ?, ?)");
      normalizedPayments.forEach((payment) => {
        statement.run([payment.id || randomUUID(), id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null]);
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
        p.sort_order AS sortOrder
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
    const sessions = selectAll<{ tableNumber: number; status: PdvTableStatus; openedAt: string | null; people: number; note: string }>(
      this.requireDb(),
      "SELECT table_number AS tableNumber, status, opened_at AS openedAt, people, note FROM table_sessions"
    );
    const byNumber = new Map(sessions.map((session) => [session.tableNumber, session]));
    return Array.from({ length: tableCount }, (_, index) => {
      const number = index + 1;
      const session = byNumber.get(number);
      const items = this.getTableItems(number);
      const visualStatus = items.length
        ? (session?.status === "Fechamento" ? "Fechamento" : "Ocupada")
        : session?.status === "Reservada"
          ? "Reservada"
          : "Livre";
      return {
        id: `mesa-${number}`,
        number,
        status: visualStatus,
        openedAt: items.length ? session?.openedAt || null : null,
        people: session?.people || 1,
        note: items.length || session?.status === "Reservada" ? session?.note || "" : "",
        total: roundMoney(items.reduce((total, item) => total + item.total, 0)),
        items
      };
    });
  }

  private getTableItems(tableNumber: number): PdvCartItem[] {
    return selectAll<PdvCartItem>(
      this.requireDb(),
      `SELECT id, product_id AS productId, product_name AS productName, category_name AS categoryName,
        quantity, measure_label AS measureLabel, unit_price AS unitPrice, base_unit_price AS baseUnitPrice, discount, total, subtable_name AS subtableName, note,
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
        "SELECT id, method, amount, received, change FROM sale_payments WHERE sale_id = ? ORDER BY rowid",
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
        sort_order INTEGER NOT NULL DEFAULT 0
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
        note TEXT NOT NULL DEFAULT ''
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
        change REAL
      );
    `);
    addColumnIfMissing(db, "products", "can_be_complement", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "products", "has_complements", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "products", "unit_mode", "TEXT NOT NULL DEFAULT 'unidade'");
    addColumnIfMissing(db, "products", "favorite", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "categories", "favorite", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "table_items", "base_unit_price", "REAL");
    addColumnIfMissing(db, "table_items", "complements_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "table_items", "measure_label", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sale_items", "base_unit_price", "REAL");
    addColumnIfMissing(db, "sale_items", "complements_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "sale_items", "measure_label", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "status", "TEXT NOT NULL DEFAULT 'Finalizada'");
    addColumnIfMissing(db, "sales", "description", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "observations", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "sales", "origin_device", "TEXT NOT NULL DEFAULT 'Este computador'");
    addColumnIfMissing(db, "sales", "operation_id", "TEXT");
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
      gridColumns: Math.max(4, Math.min(7, parseIntegerSetting(map.get("grid_columns"), DEFAULT_PDV_SETTINGS.gridColumns || 5)))
    };
  }

  private async persist() {
    const write = this.persistQueue.catch(() => undefined).then(async () => {
      const db = this.requireDb();
      const tempPath = `${this.dbFilePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, Buffer.from(db.export()));
      try {
        await fs.rename(tempPath, this.dbFilePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
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
  db.run("INSERT INTO sales (id, created_at, type, table_number, status, subtotal, discount, total, description, observations, origin_device, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    sale.id,
    sale.createdAt,
    sale.type,
    sale.tableNumber ?? null,
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

  const paymentStatement = db.prepare("INSERT INTO sale_payments (id, sale_id, method, amount, received, change) VALUES (?, ?, ?, ?, ?, ?)");
  sale.payments.forEach((payment) =>
    paymentStatement.run([payment.id, sale.id, payment.method, payment.amount, payment.received ?? null, payment.change ?? null])
  );
  paymentStatement.free();
}

function writeTableItems(db: Database, tableNumber: number, items: PdvCartItem[]) {
  const statement = db.prepare(
    `INSERT INTO table_items (id, table_number, product_id, product_name, category_name, quantity, measure_label, unit_price, base_unit_price, discount, total, subtable_name, note, complements_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      item.subtableName || "",
      item.note || "",
      JSON.stringify(item.complements || []),
      index
    ]);
  });
  statement.free();
}

function createSale(input: { type: PdvSale["type"]; tableNumber?: number; status?: PdvSale["status"]; items: PdvCartItem[]; discount: number; payments: PdvPayment[]; originDevice?: string; operationId?: string }): PdvSale {
  const subtotal = roundMoney(input.items.reduce((total, item) => total + item.total, 0));
  const total = Math.max(0, roundMoney(subtotal - input.discount));
  const payments = normalizePaymentsForTotal(input.payments, total);
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    type: input.type,
    tableNumber: input.tableNumber,
    status: input.status || "Finalizada",
    subtotal,
    discount: roundMoney(input.discount),
    total,
    description: input.tableNumber ? `Mesa ${input.tableNumber}` : "Venda direta",
    observations: "",
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
  });
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
  const dateKey = sale.createdAt.slice(0, 10);
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

