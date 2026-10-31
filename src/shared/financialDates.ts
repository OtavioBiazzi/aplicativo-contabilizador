export type FinancialDateField = "emission" | "due";

export function localPaymentDateTime(value = new Date().toISOString()): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function financialPaymentTimestamp(value?: string): string {
  if (value === undefined) return new Date().toISOString();
  const date = new Date(value);
  if (!value.trim() || !Number.isFinite(date.getTime())) throw new Error("Informe uma data e hora de pagamento validas.");
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (day && new Date(Date.UTC(Number(day[1]), Number(day[2])-1, Number(day[3]))).toISOString().slice(0,10) !== value.slice(0,10)) throw new Error("Informe uma data de pagamento valida.");
  return date.toISOString();
}

/** Date-only fields stay date-only; timestamps are compared in the operator's local day. */
export function financialDateKey(value: string | undefined | null): string {
  if (!value) return "";
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const legacy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (legacy) return `${legacy[3]}-${legacy[2]}-${legacy[1]}`;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function inFinancialPeriod(account: { createdAt: string; dueDate?: string; issueDate?: string }, from: string, to: string, field: FinancialDateField): boolean {
  const emission = financialDateKey(account.issueDate) || financialDateKey(account.createdAt);
  const day = field === "due" ? financialDateKey(account.dueDate) || emission : emission;
  return (!from || day >= from) && (!to || day <= to);
}

export function supplierBalanceKey(name: string): string { return name.trim().normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " "); }
