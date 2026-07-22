export interface ReceiptPrintTarget {
  id: string;
  label: string;
}

const STORAGE_KEY = "caixa.pdv.receipt-print-destination";

export function readReceiptPrintDestination(targets: ReceiptPrintTarget[]): string {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "local";
    const saved = JSON.parse(raw) as Partial<ReceiptPrintTarget>;
    const exact = targets.find((target) => target.id === saved.id);
    if (exact) return exact.id;
    const sameComputer = targets.find((target) => target.label === saved.label);
    return sameComputer?.id || "local";
  } catch {
    return "local";
  }
}

export function saveReceiptPrintDestination(id: string, targets: ReceiptPrintTarget[]): void {
  const target = targets.find((item) => item.id === id);
  if (!target) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
}
