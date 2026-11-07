function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function sheetNameFor(filename: string): string {
  const base = filename.replace(/\.(csv|xlsx)$/i, "").split("-")[0] || "Planilha";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Exporta uma lista da tela. No app desktop sai como .xlsx com a largura das colunas pelo conteudo
 * (nomes de produtos nao ficam cortados); fora dele, cai para CSV.
 */
export async function downloadFinancialCsv(filename: string, headers: string[], rows: unknown[][]): Promise<void> {
  const bridge = (window as unknown as { caixa?: { exportTableXlsx?: (fileName: string, sheetName: string, headers: string[], rows: unknown[][]) => Promise<unknown> } }).caixa;
  if (bridge?.exportTableXlsx) {
    await bridge.exportTableXlsx(filename.replace(/\.csv$/i, ".xlsx"), sheetNameFor(filename), headers, rows);
    return;
  }
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
