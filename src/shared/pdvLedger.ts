import type { PdvPaymentMethod, PdvSale } from "./pdvTypes.js";
import type { LedgerEntry, PaymentMethod } from "./types.js";
import { formatCurrency } from "./calculations.js";

function pdvPaymentToLegacyMethod(method: PdvPaymentMethod): PaymentMethod {
  if (method === "Nao definido" || method === "Outros") {
    return "Nao informado";
  }
  return method;
}

export function pdvSaleToLedgerEntry(sale: PdvSale): LedgerEntry {
  const paymentMethod = sale.payments.length > 1
    ? "Misto"
    : pdvPaymentToLegacyMethod(sale.payments[0]?.method || "Nao definido");
  const itemNames = sale.items.map((item) => {
    const quantity = item.measureLabel || (item.quantity !== 1 ? `x${String(item.quantity).replace(".", ",")}` : "");
    const complements = item.complements?.length ? ` (${item.complements.map((complement) => complement.name).join(" + ")})` : "";
    return `${item.productName}${complements}${quantity ? ` ${quantity}` : ""}`;
  }).join(", ");
  const paymentsDescription = sale.payments.length
    ? sale.payments.map((payment) => `${payment.method}: ${formatCurrency(payment.amount)}`).join(" | ")
    : "Pagamento nao definido";
  const tableLabel = sale.tableNumber ? `Mesa ${String(sale.tableNumber).padStart(3, "0")}` : "Venda direta";

  return {
    id: `pdv-${sale.id}`,
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
    type: sale.type === "Mesa" ? "Mesa" : "Venda",
    originalValue: sale.subtotal,
    finalValue: sale.total,
    people: 1,
    perPerson: sale.total,
    roundingStep: 0.01,
    roundingDirection: "nearest",
    difference: -Math.abs(sale.discount || 0),
    description: sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta",
    tableNumber: sale.tableNumber ? String(sale.tableNumber) : "",
    busNumber: "",
    paymentMethod,
    paidWith: sale.payments.reduce((total, payment) => total + (payment.received || payment.amount), 0),
    change: sale.payments.reduce((total, payment) => total + (payment.change || 0), 0),
    observations: `${sale.status === "Parcial" ? "Fechamento parcial de mesa. " : ""}${paymentsDescription}`,
    originDevice: "PDV local",
    status: sale.status === "Cancelada" ? "cancelled" : sale.status === "deleted" ? "deleted" : "active",
    customType: sale.status === "Parcial" ? "Mesa parcial" : sale.type
  };
}

export function pdvSalesToLedgerEntries(sales: PdvSale[]): LedgerEntry[] {
  return sales.map(pdvSaleToLedgerEntry);
}
