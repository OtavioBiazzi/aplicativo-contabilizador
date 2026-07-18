import { getLocalDateKey, roundMoney } from "./calculations.js";
import type { PdvCartItem, PdvPayment, PdvSale } from "./pdvTypes.js";
import type { LedgerEntry } from "./types.js";

export type ReportRecordStatus = "active" | "cancelled" | "deleted";

export interface ReportRecord {
  id: string;
  createdAt: string;
  type: string;
  status: ReportRecordStatus;
  subtotal: number;
  discount: number;
  total: number;
  tableNumber: string;
  originDevice: string;
  description: string;
  observations: string;
  payments: Array<{
    method: string;
    amount: number;
    received: number;
    change: number;
    description: string;
  }>;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    categoryName: string;
    quantity: number;
    measureLabel: string;
    unitPrice: number;
    discount: number;
    total: number;
    subtableName: string;
    note: string;
    complements: Array<{ productId: string; name: string; price: number }>;
  }>;
  source: "pdv" | "legacy";
}

export interface ReportFilters {
  from?: string;
  to?: string;
  type?: string;
  payment?: string;
  status?: string;
  table?: string;
  origin?: string;
  product?: string;
  category?: string;
  query?: string;
}

export interface ReportProductSummary {
  key: string;
  productId: string;
  name: string;
  category: string;
  quantity: number;
  launches: number;
  revenue: number;
  discounts: number;
  averagePrice: number;
}

export interface ReportCategorySummary {
  name: string;
  quantity: number;
  revenue: number;
  products: number;
}

export interface ReportDataset {
  records: ReportRecord[];
  activeRecords: ReportRecord[];
  total: number;
  count: number;
  average: number;
  biggestSale: number;
  discounts: number;
  receivedInCash: number;
  change: number;
  byPayment: Array<[string, number]>;
  byType: Array<[string, number]>;
  byOrigin: Array<[string, number]>;
  byTable: Array<[string, number]>;
  byHour: Array<[string, number]>;
  byWeekday: Array<[string, number]>;
  daily: Array<{ dateKey: string; total: number; count: number }>;
  products: ReportProductSummary[];
  complements: Array<[string, number]>;
  complementRevenue: Array<[string, number]>;
  categories: ReportCategorySummary[];
  cancelledCount: number;
  cancelledTotal: number;
  deletedCount: number;
  partialCount: number;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

export function createReportRecords(entries: LedgerEntry[], pdvSales: PdvSale[]): ReportRecord[] {
  const pdvRecords = pdvSales.map(pdvSaleToReportRecord);
  const pdvIds = new Set(pdvSales.map((sale) => sale.id));
  const legacyRecords = entries
    .filter((entry) => !entry.sourceSaleId || !pdvIds.has(entry.sourceSaleId))
    .map(ledgerEntryToReportRecord);
  return [...pdvRecords, ...legacyRecords].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function filterReportRecords(records: ReportRecord[], filters: ReportFilters): ReportRecord[] {
  const query = String(filters.query || "").trim().toLocaleLowerCase("pt-BR");
  const table = String(filters.table || "").replace(/^0+/, "");
  return records.filter((record) => {
    const dateKey = getLocalDateKey(record.createdAt);
    if (filters.from && dateKey < filters.from) return false;
    if (filters.to && dateKey > filters.to) return false;
    if (filters.type && filters.type !== "Todos" && record.type !== filters.type) return false;
    if (filters.status && filters.status !== "Todos" && record.status !== filters.status) return false;
    if (filters.payment && filters.payment !== "Todos" && !record.payments.some((payment) => payment.method === filters.payment)) return false;
    if (table && record.tableNumber.replace(/^0+/, "") !== table) return false;
    if (filters.origin && filters.origin !== "Todos" && record.originDevice !== filters.origin) return false;
    if (filters.product && filters.product !== "Todos" && !record.items.some((item) => item.productName === filters.product)) return false;
    if (filters.category && filters.category !== "Todos" && !record.items.some((item) => item.categoryName === filters.category)) return false;
    if (!query) return true;
    const haystack = [
      record.type,
      record.status,
      record.tableNumber ? `mesa ${record.tableNumber}` : "",
      record.description,
      record.observations,
      record.originDevice,
      ...record.items.flatMap((item) => [item.productName, item.categoryName, item.subtableName, item.note]),
      ...record.payments.flatMap((payment) => [payment.method, payment.description])
    ].join(" ").toLocaleLowerCase("pt-BR");
    return haystack.includes(query);
  });
}

export function buildReportDataset(records: ReportRecord[]): ReportDataset {
  const activeRecords = records.filter((record) => record.status === "active");
  const cancelledRecords = records.filter((record) => record.status === "cancelled");
  const byPayment = new Map<string, number>();
  const byType = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  const byTable = new Map<string, number>();
  const byHour = new Map<string, number>();
  const byWeekday = new Map<string, number>();
  const daily = new Map<string, { total: number; count: number }>();
  const products = new Map<string, Omit<ReportProductSummary, "averagePrice">>();
  const categories = new Map<string, { quantity: number; revenue: number; products: Set<string> }>();
  const complements = new Map<string, number>();
  const complementRevenue = new Map<string, number>();
  let receivedInCash = 0;
  let change = 0;
  let discounts = 0;

  activeRecords.forEach((record) => {
    increment(byType, record.type || "Sem tipo", record.total);
    increment(byOrigin, record.originDevice || "Sem origem", record.total);
    if (record.tableNumber) increment(byTable, `Mesa ${record.tableNumber}`, record.total);
    const date = new Date(record.createdAt);
    const hour = Number.isNaN(date.getTime()) ? "--:--" : `${String(date.getHours()).padStart(2, "0")}:00`;
    increment(byHour, hour, record.total);
    const weekday = Number.isNaN(date.getTime()) ? "Sem data" : WEEKDAYS[date.getDay()];
    increment(byWeekday, weekday, record.total);
    const dateKey = getLocalDateKey(record.createdAt);
    const currentDay = daily.get(dateKey) || { total: 0, count: 0 };
    currentDay.total = roundMoney(currentDay.total + record.total);
    currentDay.count += 1;
    daily.set(dateKey, currentDay);
    discounts = roundMoney(discounts + record.discount + record.items.reduce((sum, item) => sum + item.discount, 0));

    record.payments.forEach((payment) => {
      increment(byPayment, payment.method || "Nao definido", payment.amount);
      if (payment.method === "Dinheiro") {
        receivedInCash = roundMoney(receivedInCash + (payment.received || payment.amount));
        change = roundMoney(change + payment.change);
      }
    });

    record.items.forEach((item) => {
      const key = item.productId && item.productId !== "legacy" ? item.productId : `${item.categoryName}::${item.productName}`;
      const current = products.get(key) || {
        key,
        productId: item.productId,
        name: item.productName || "Produto sem nome",
        category: item.categoryName || "Sem categoria",
        quantity: 0,
        launches: 0,
        revenue: 0,
        discounts: 0
      };
      current.quantity = roundMoney(current.quantity + item.quantity);
      current.launches += 1;
      current.revenue = roundMoney(current.revenue + item.total);
      current.discounts = roundMoney(current.discounts + item.discount);
      products.set(key, current);

      const categoryName = item.categoryName || "Sem categoria";
      const category = categories.get(categoryName) || { quantity: 0, revenue: 0, products: new Set<string>() };
      category.quantity = roundMoney(category.quantity + item.quantity);
      category.revenue = roundMoney(category.revenue + item.total);
      category.products.add(key);
      categories.set(categoryName, category);

      item.complements.forEach((complement) => {
        increment(complements, complement.name, item.quantity);
        increment(complementRevenue, complement.name, complement.price * item.quantity);
      });
    });
  });

  const total = roundMoney(activeRecords.reduce((sum, record) => sum + record.total, 0));
  return {
    records,
    activeRecords,
    total,
    count: activeRecords.length,
    average: activeRecords.length ? roundMoney(total / activeRecords.length) : 0,
    biggestSale: roundMoney(Math.max(0, ...activeRecords.map((record) => record.total))),
    discounts,
    receivedInCash,
    change,
    byPayment: sortedTotals(byPayment),
    byType: sortedTotals(byType),
    byOrigin: sortedTotals(byOrigin),
    byTable: sortedTotals(byTable),
    byHour: [...byHour.entries()].sort((left, right) => left[0].localeCompare(right[0])),
    byWeekday: WEEKDAYS.map((weekday) => [weekday, roundMoney(byWeekday.get(weekday) || 0)] as [string, number]),
    daily: [...daily.entries()].map(([dateKey, value]) => ({ dateKey, ...value })).sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
    products: [...products.values()]
      .map((product) => ({ ...product, averagePrice: product.quantity ? roundMoney(product.revenue / product.quantity) : 0 }))
      .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue || left.name.localeCompare(right.name, "pt-BR")),
    complements: sortedTotals(complements),
    complementRevenue: sortedTotals(complementRevenue),
    categories: [...categories.entries()]
      .map(([name, category]) => ({ name, quantity: category.quantity, revenue: category.revenue, products: category.products.size }))
      .sort((left, right) => right.revenue - left.revenue || left.name.localeCompare(right.name, "pt-BR")),
    cancelledCount: cancelledRecords.length,
    cancelledTotal: roundMoney(cancelledRecords.reduce((sum, record) => sum + record.total, 0)),
    deletedCount: records.filter((record) => record.status === "deleted").length,
    partialCount: activeRecords.filter((record) => record.type === "Mesa parcial").length
  };
}

function pdvSaleToReportRecord(sale: PdvSale): ReportRecord {
  return {
    id: sale.id,
    createdAt: sale.createdAt,
    type: sale.status === "Parcial" ? "Mesa parcial" : sale.type,
    status: sale.status === "Cancelada" ? "cancelled" : sale.status === "deleted" ? "deleted" : "active",
    subtotal: roundMoney(sale.subtotal),
    discount: roundMoney(sale.discount),
    total: roundMoney(sale.total),
    tableNumber: sale.tableNumber ? String(sale.tableNumber) : "",
    originDevice: sale.originDevice || "PDV local",
    description: sale.description || (sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta"),
    observations: sale.observations || "",
    payments: sale.payments.map(reportPayment),
    items: sale.items.map(reportItem),
    source: "pdv"
  };
}

function ledgerEntryToReportRecord(entry: LedgerEntry): ReportRecord {
  const payments = entry.paymentBreakdown?.length
    ? entry.paymentBreakdown.map((payment, index) => ({
        method: payment.method || "Nao informado",
        amount: roundMoney(payment.amount),
        received: index === 0 ? roundMoney(entry.paidWith || payment.amount) : roundMoney(payment.amount),
        change: index === 0 ? roundMoney(entry.change || 0) : 0,
        description: ""
      }))
    : [{
        method: entry.paymentMethod || "Nao informado",
        amount: roundMoney(entry.finalValue),
        received: roundMoney(entry.paidWith || entry.finalValue),
        change: roundMoney(entry.change || 0),
        description: ""
      }];
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    type: entry.customType || entry.type,
    status: entry.status,
    subtotal: roundMoney(entry.originalValue),
    discount: roundMoney(Math.max(0, entry.originalValue - entry.finalValue)),
    total: roundMoney(entry.finalValue),
    tableNumber: entry.tableNumber || "",
    originDevice: entry.originDevice || "Este computador",
    description: entry.description || "Lancamento antigo",
    observations: entry.observations || "",
    payments,
    items: [{
      id: `legacy-${entry.id}`,
      productId: "legacy",
      productName: entry.description || "Lancamento antigo",
      categoryName: "Historico antigo",
      quantity: 1,
      measureLabel: "",
      unitPrice: roundMoney(entry.finalValue),
      discount: 0,
      total: roundMoney(entry.finalValue),
      subtableName: "",
      note: entry.observations || "",
      complements: []
    }],
    source: "legacy"
  };
}

function reportPayment(payment: PdvPayment) {
  return {
    method: payment.method || "Nao definido",
    amount: roundMoney(payment.amount),
    received: roundMoney(payment.received || payment.amount),
    change: roundMoney(payment.change || 0),
    description: payment.description || ""
  };
}

function reportItem(item: PdvCartItem): ReportRecord["items"][number] {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    categoryName: item.categoryName,
    quantity: roundMoney(item.quantity),
    measureLabel: item.measureLabel || "",
    unitPrice: roundMoney(item.unitPrice),
    discount: roundMoney(item.discount),
    total: roundMoney(item.total),
    subtableName: item.subtableName || "",
    note: item.note || "",
    complements: (item.complements || []).map((complement) => ({
      productId: complement.productId,
      name: complement.name,
      price: roundMoney(complement.price)
    }))
  };
}

function increment(map: Map<string, number>, key: string, amount: number) {
  map.set(key, roundMoney((map.get(key) || 0) + amount));
}

function sortedTotals(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"));
}
