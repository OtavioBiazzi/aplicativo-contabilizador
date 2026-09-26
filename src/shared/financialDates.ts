export type FinancialDateField = "emission" | "due";

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
