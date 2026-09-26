import type { PdvSale } from "./pdvTypes.js";

export function joinSaleLabels(labels: Array<string | undefined>): string {
  const seen = new Set<string>();
  return labels.map((label) => label?.trim() || "").filter((label) => {
    const key = label.toLocaleLowerCase("pt-BR");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" · ");
}

/** Also recovers names from older sales whose description was only Mesa N. */
export function saleHistoryDescription(sale: PdvSale): string {
  const labels = [sale.description || (sale.tableNumber ? `Mesa ${sale.tableNumber}` : "Venda direta")];
  const observation = sale.observations?.trim() || "";
  // Current descriptions store the exact scope name, including dots in names.
  const knownSubtable = labels[0].split(" · ").find((label) =>
    observation.startsWith(`Submesa: ${label}.`) || observation.startsWith(`Submesa cancelada: ${label}.`));
  const legacyPrefix = observation.match(/^Submesa(?: cancelada)?:\s*(.+?)(?:\.\s|\.$|$)/i);
  const subtable = knownSubtable || legacyPrefix?.[1]?.trim();
  const prefix = knownSubtable ? `${observation.startsWith("Submesa cancelada:") ? "Submesa cancelada" : "Submesa"}: ${knownSubtable}.` : legacyPrefix?.[0] || "";
  const identification = prefix ? observation.slice(prefix.length).trim() : observation;
  if (subtable && !labels[0].split(" · ").includes(subtable)) labels.push(subtable);
  for (const payment of sale.payments) {
    const label = payment.description?.trim();
    // Scoped closes used the entire observation as a payment fallback.
    const normalized = label === sale.observations?.trim() ? identification : label;
    if (normalized && !labels.some((value) => value.split(" · ").some((part) => part.toLocaleLowerCase("pt-BR") === normalized.toLocaleLowerCase("pt-BR")))) labels.push(normalized);
  }
  return joinSaleLabels(labels);
}
