import { getLocalDateKey } from "./calculations.js";
import type { PdvPayable, PdvPayableDraft, PdvReceivable, PdvReceivableDraft, PdvSale } from "./pdvTypes.js";

/** Copies registration fields only: never settlements, audit events or sale/series identities. */
export function duplicatePayableDraft(account: PdvPayable, id = crypto.randomUUID(), issueDate = getLocalDateKey()): PdvPayableDraft {
  return { id, description: account.description, supplier: account.supplier, category: account.category, costCenter: account.costCenter,
    documentNumber: account.documentNumber, preferredPaymentMethod: account.preferredPaymentMethod || "", paymentAccount: account.paymentAccount,
    tags: [...account.tags], note: account.note, issueDate, dueDate: account.dueDate, amount: account.amount, payments: [] };
}
export function duplicateReceivableDraft(account: PdvReceivable, id = crypto.randomUUID()): PdvReceivableDraft {
  return { id, customerId: account.customerId, description: account.description || "Conta a receber", amount: account.originalAmount,
    dueDate: account.dueDate, category: account.category, costCenter: account.costCenter, documentNumber: account.documentNumber,
    paymentAccount: account.paymentAccount, tags: [...(account.tags || [])], note: account.note };
}
export function buildPayableReceipt(account: PdvPayable): PdvSale {
  return { id: `conta-a-pagar-${account.id}`, createdAt: new Date().toISOString(), type: "Venda direta", status: "Finalizada",
    receiptPurpose: "payable-account", receiptReference: { documentNumber: account.documentNumber, issueDate: account.issueDate, dueDate: account.dueDate },
    subtotal: account.amount, discount: 0, total: account.amount,
    payments: account.payments.map((payment) => ({ id: payment.id, method: payment.method, amount: payment.amount,
      description: [new Date(payment.createdAt).toLocaleDateString("pt-BR"), payment.description].filter(Boolean).join(" · ") })),
    items: [{ id: account.id, productId: account.id, productName: account.description || account.documentNumber || "Conta a pagar", categoryName: "Contas a pagar",
      quantity: 1, unitPrice: account.amount, total: account.amount, discount: 0, note: account.note }] };
}
/** A manual or older receivable may have no sale in the operational snapshot. */
export function buildReceivableAccountReceipt(account: PdvReceivable): PdvSale {
  return { id: account.saleId || `conta-a-receber-${account.id}`, createdAt: account.createdAt, type: "Venda direta", status: "Finalizada",
    subtotal: account.originalAmount, discount: 0, total: account.originalAmount,
    payments: account.payments.map((payment) => ({ id: payment.id, method: payment.method, amount: payment.amount, description: payment.description })),
    items: [{ id: account.id, productId: account.id, productName: account.description || account.documentNumber || "Conta a receber", categoryName: "Contas a receber",
      quantity: 1, unitPrice: account.originalAmount, total: account.originalAmount, discount: 0, note: account.note }] };
}
