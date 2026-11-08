/**
 * 0.4.24: mesa avulsa. Um numero reservado fora da faixa normal de mesas (que vai ate 300), sempre
 * presente no mapa ao lado do "+", para anotacoes e submesas que ainda nao tem mesa definida.
 */
export const LOOSE_TABLE_NUMBER = 999;

export function isLooseTable(tableNumber: unknown): boolean {
  return Number(tableNumber) === LOOSE_TABLE_NUMBER;
}

/** "007" para mesas comuns e "S/N" (sem numero, como nos enderecos) para a mesa avulsa: curto como os numeros. */
export function formatTableNumber(tableNumber: unknown): string {
  return isLooseTable(tableNumber) ? "S/N" : String(tableNumber ?? "").padStart(3, "0");
}
