import type { LedgerEntry } from "./types.js";
import type { PdvSale, PdvReceivable, PdvCustomer } from "./pdvTypes.js";

export function historyDescription(entry: LedgerEntry, sale?: PdvSale, receivables: PdvReceivable[] = [], customers: PdvCustomer[] = []): string {
  const names = [...new Set([
    ...(sale?.payments.map((payment) => payment.customerName || customers.find((customer) => customer.id === payment.customerId)?.name || "") || []),
    ...receivables.filter((account) => account.saleId === entry.sourceSaleId).map((account) => account.customerName)
  ].map((name) => name.trim()).filter(Boolean))];
  const description = entry.description.trim();
  return [description, ...names.filter((name) => !description.toLocaleLowerCase("pt-BR").includes(name.toLocaleLowerCase("pt-BR")))].filter(Boolean).join(" · ");
}
