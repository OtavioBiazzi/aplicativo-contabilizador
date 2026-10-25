import type { PdvPayable } from "./pdvTypes.js";

export function payableLabel(account: Pick<PdvPayable, "description" | "supplier" | "documentNumber" | "category">): string {
  return account.description.trim() || account.supplier.trim()
    || (account.documentNumber.trim() ? `Documento ${account.documentNumber.trim()}` : "")
    || account.category.trim() || "Conta a pagar";
}
