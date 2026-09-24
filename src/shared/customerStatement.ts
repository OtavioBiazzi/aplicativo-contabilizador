import type { PdvReceivable, PdvSale } from "./pdvTypes.js";

export function customerOutstandingAccounts(accounts: PdvReceivable[], selected: PdvReceivable): PdvReceivable[] {
  const name = selected.customerName.trim().toLocaleLowerCase("pt-BR");
  return accounts.filter((account) => {
    const sameCustomer = selected.customerId
      ? account.customerId === selected.customerId
      : !account.customerId && account.customerName.trim().toLocaleLowerCase("pt-BR") === name;
    return sameCustomer && !["Cancelada", "Excluida", "Recebida"].includes(account.status) && account.balance > 0.009;
  }).sort((left, right) => (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31") || left.createdAt.localeCompare(right.createdAt));
}

export function buildCustomerBalanceReceipt(accounts: PdvReceivable[], selected: PdvReceivable): PdvSale {
  const outstanding = customerOutstandingAccounts(accounts, selected);
  const total = Math.round(outstanding.reduce((sum, account) => sum + account.balance, 0) * 100) / 100;
  return {
    id: `saldo-${selected.customerId || selected.id}`,
    createdAt: new Date().toISOString(),
    type: "Venda direta",
    status: "Finalizada",
    receiptPurpose: "customer-balance",
    subtotal: total,
    discount: 0,
    total,
    payments: [],
    items: outstanding.map((account) => ({
      id: account.id,
      productId: account.id,
      productName: `${account.description || account.documentNumber || "Conta a receber"}${account.documentNumber && account.description ? ` · ${account.documentNumber}` : ""}`,
      categoryName: "Contas a receber",
      quantity: 1,
      unitPrice: account.balance,
      discount: 0,
      total: account.balance,
      note: `Vencimento: ${account.dueDate ? account.dueDate.split("-").reverse().join("/") : "sem data"} · Valor original: ${account.originalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Recebido: ${account.receivedAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
    }))
  };
}
