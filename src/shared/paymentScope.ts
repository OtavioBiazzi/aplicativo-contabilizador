import { roundMoney } from "./calculations.js";
import type { LedgerEntry } from "./types.js";

export function historyPaymentAmount(entry: LedgerEntry, method: string): number {
  if (!method || method === "Todos") return entry.finalValue;
  if (entry.paymentBreakdown?.length) return roundMoney(entry.paymentBreakdown.filter(part => part.method === method).reduce((sum, part) => sum + part.amount, 0));
  return entry.paymentMethod === method ? entry.finalValue : 0;
}

/** Read-only report projection: quantities/prices remain factual, monetary totals are allocated to the selected payment. */
export function scopePaymentAmounts<T extends { total: number; subtotal: number; discount: number; payments: Array<{method: string; amount: number}>; items: Array<{total: number; discount: number}> }>(record: T, method?: string): T {
  if (!method || method === "Todos") return record;
  const payments = record.payments.filter(part => part.method === method);
  const total = roundMoney(payments.reduce((sum, part) => sum + part.amount, 0));
  const ratio = record.total ? total / record.total : 0;
  let remaining = roundMoney(record.items.reduce((sum, item) => sum + item.total, 0) * ratio);
  const items = record.items.map((item, index) => {
    const allocated = index === record.items.length - 1 ? remaining : Math.min(remaining, roundMoney(item.total * ratio));
    remaining = roundMoney(remaining - allocated);
    return {...item, total: allocated, discount: roundMoney(item.discount * ratio)};
  });
  return {...record, total, subtotal: roundMoney(record.subtotal * ratio), discount: roundMoney(record.discount * ratio), payments, items} as T;
}
