import type { LedgerEntry } from "./types.js";
import type { PdvSale, PdvReceivable, PdvCustomer } from "./pdvTypes.js";
import { saleHistoryDescription } from "./saleDescription.js";

export function createHistoryDescriptionLookup(receivables: PdvReceivable[], customers: PdvCustomer[]) {
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const accountsBySale = new Map<string, PdvReceivable[]>();
  for (const account of receivables) {
    if (!account.saleId) continue;
    const accounts = accountsBySale.get(account.saleId) || [];
    accounts.push(account);
    accountsBySale.set(account.saleId, accounts);
  }
  return (entry: LedgerEntry, sale?: PdvSale) => describe(entry, sale,
    entry.sourceSaleId ? accountsBySale.get(entry.sourceSaleId) || [] : [], customerNames);
}

export function historyDescription(entry: LedgerEntry, sale?: PdvSale, receivables: PdvReceivable[] = [], customers: PdvCustomer[] = []): string {
  return describe(entry, sale, entry.sourceSaleId ? receivables.filter((account) => account.saleId === entry.sourceSaleId) : [],
    new Map(customers.map((customer) => [customer.id, customer.name])));
}

function describe(entry: LedgerEntry, sale: PdvSale | undefined, accounts: PdvReceivable[], customerNames: Map<string, string>): string {
  const names = [...new Set([
    ...(sale?.payments.map((payment) => payment.customerName || customerNames.get(payment.customerId || "") || "") || []),
    ...accounts.map((account) => account.customerName)
  ].map((name) => name.trim()).filter(Boolean))];
  const description = sale ? saleHistoryDescription({ ...sale, description: entry.description }) : entry.description.trim();
  return [description, ...names.filter((name) => !description.toLocaleLowerCase("pt-BR").includes(name.toLocaleLowerCase("pt-BR")))].filter(Boolean).join(" · ");
}
