import type { PdvPayment, PdvPaymentMethod, PdvSale } from "./pdvTypes.js";
import type { LedgerEntry, PaymentMethod } from "./types.js";
import { formatCurrency } from "./calculations.js";

function pdvPaymentToLegacyMethod(method: PdvPaymentMethod): PaymentMethod {
  if (method === "Nao definido" || method === "Outros" || method === "Conta a receber") {
    return "Nao informado";
  }
  return method;
}

function buildPaymentsDescription(payments: PdvPayment[]): string {
  return payments.length
    ? payments.map((payment) => `${payment.method}: ${formatCurrency(payment.amount)}`).join(" | ")
    : "Pagamento nao definido";
}

export function pdvSaleToLedgerEntry(sale: PdvSale): LedgerEntry {
  // O resumo geral usa a primeira forma apenas como compatibilidade. A divisao
  // real fica em paymentBreakdown e e a fonte dos filtros, relatorios e Excel.
  const paymentMethod = pdvPaymentToLegacyMethod(sale.payments[0]?.method || "Nao definido");
  const paymentsDescription = buildPaymentsDescription(sale.payments);
  const cancelledSubtable = sale.status === "Cancelada"
    ? sale.observations?.match(/(?:^|\s)Submesa cancelada:\s*(.+?)(?:\.|$)/i)?.[1]?.trim() || ""
    : "";
  const closedSubtable = sale.status === "Parcial"
    ? sale.observations?.match(/(?:^|\s)Submesa:\s*(.+?)(?:\.|$)/i)?.[1]?.trim() || ""
    : "";
  const subtableName = cancelledSubtable || closedSubtable;
  const originDevice = !sale.originDevice || sale.originDevice === "Este computador" || sale.originDevice === "PDV local"
    ? "Servidor"
    : sale.originDevice;

  return {
    id: `pdv-${sale.id}`,
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
    type: sale.type === "Mesa" ? "Mesa" : sale.type === "Onibus" ? "Onibus" : "Venda",
    originalValue: sale.subtotal,
    finalValue: sale.total,
    people: 1,
    perPerson: sale.total,
    roundingStep: 0.01,
    roundingDirection: "nearest",
    difference: -Math.abs(sale.discount || 0),
    description: subtableName || sale.description || (sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta"),
    tableNumber: sale.tableNumber ? String(sale.tableNumber) : "",
    busNumber: "",
    paymentMethod,
    paidWith: sale.payments.reduce((total, payment) => total + (payment.received || payment.amount), 0),
    change: sale.payments.reduce((total, payment) => total + (payment.change || 0), 0),
    observations: `${sale.observations ? `${sale.observations} ` : ""}${sale.status === "Parcial" ? "Fechamento parcial de mesa. " : ""}${sale.status === "Cancelada" && !sale.payments.length ? "" : paymentsDescription}`.trim(),
    originDevice,
    status: sale.status === "Cancelada" ? "cancelled" : sale.status === "deleted" ? "deleted" : "active",
    customType: cancelledSubtable ? "Submesa cancelada" : closedSubtable ? "Submesa fechada" : sale.status === "Cancelada" && sale.type === "Mesa" ? "Mesa cancelada" : sale.status === "Parcial" ? "Mesa parcial" : sale.type,
    sourceSaleId: sale.id,
    paymentBreakdown: sale.payments.map((payment) => ({
      method: pdvPaymentToLegacyMethod(payment.method || "Nao definido"),
      amount: payment.amount
    }))
  };
}

export function pdvSalesToLedgerEntries(sales: PdvSale[]): LedgerEntry[] {
  return sales.map(pdvSaleToLedgerEntry);
}
