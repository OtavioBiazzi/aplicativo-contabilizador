/**
 * Largura de coluna (em caracteres do Excel) pelo maior texto da coluna: o nome do produto
 * nunca fica cortado. Valores em dinheiro contam com o "R$ " e os centavos formatados.
 */
export function autoColumnWidth(column: string, rows: Record<string, unknown>[], money = false, minimum = 8, maximum = 70): number {
  let longest = column.length;
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;
    const text = typeof value === "number" && money
      ? `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : String(value);
    // Quebras de linha: conta a linha mais longa.
    const length = Math.max(...text.split(/\r?\n/).map((line) => line.length));
    if (length > longest) longest = length;
  }
  return Math.max(minimum, Math.min(maximum, Math.ceil(longest * 1.1) + 3));
}
