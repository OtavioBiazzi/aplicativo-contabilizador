import type { PdvSale } from "./pdvTypes.js";

export function groupPdvReceiptItems(items: PdvSale["items"]): PdvSale["items"] {
  const grouped = new Map<string, PdvSale["items"][number]>();
  items.forEach((item) => {
    const complements = (item.complements || [])
      .map((value) => `${value.productId}:${normalizeKey(value.name)}:${moneyKey(value.price)}`)
      .sort()
      .join("|");
    const finalUnitPrice = item.quantity > 0 ? moneyKey(item.total / item.quantity) : moneyKey(item.total);
    const key = [
      item.productId,
      normalizeKey(item.productName),
      finalUnitPrice,
      normalizeKey(item.measureLabel),
      normalizeKey(item.note),
      complements
    ].join("::");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...item, complements: item.complements ? [...item.complements] : [] });
      return;
    }
    grouped.set(key, {
      ...current,
      quantity: current.quantity + item.quantity,
      discount: current.discount + item.discount,
      total: current.total + item.total
    });
  });
  return [...grouped.values()];
}

function normalizeKey(value: unknown): string {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function moneyKey(value: number): string {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}
