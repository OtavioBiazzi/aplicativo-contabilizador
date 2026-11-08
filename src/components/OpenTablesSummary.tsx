import { useEffect, useMemo } from "react";
import { Utensils, X } from "lucide-react";
import { formatCurrency, roundMoney } from "../shared/calculations";
import type { PdvOpenTable } from "../shared/pdvTypes";
import { formatTableNumber } from "../shared/tableLabel";

/**
 * 0.4.24: quantos lancamentos (fechamentos) ainda faltam. Cada submesa conta como 1 e a parte principal da
 * mesa (itens sem submesa) conta como mais 1. Submesas criadas e ainda vazias tambem contam: vao virar conta.
 */
export function pendingLaunches(table: PdvOpenTable): number {
  const unpaid = table.items.filter((item) => item.quantity - (item.paidQuantity || 0) > 0.009);
  const subtables = new Set([...(table.subtables || []), ...unpaid.map((item) => item.subtableName || "").filter(Boolean)]);
  const main = unpaid.some((item) => !item.subtableName) ? 1 : 0;
  return subtables.size + main;
}

export function OpenTablesSummary({ tables, todayTotal, todayCount, hideTotals = false, onClose }: { tables: PdvOpenTable[]; todayTotal: number; todayCount?: number; hideTotals?: boolean; onClose: () => void }) {
  // table.total já representa o saldo não pago, inclusive em fechamentos parciais.
  const pending = useMemo(() => tables.filter((table) => table.total > 0.009).sort((a, b) => a.number - b.number), [tables]);
  const total = roundMoney(pending.reduce((sum, table) => sum + table.total, 0));
  const launchesLeft = useMemo(() => tables.reduce((sum, table) => sum + pendingLaunches(table), 0), [tables]);
  const launchesDone = Math.max(0, todayCount || 0);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [onClose]);
  return <div className="open-tables-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="open-tables-summary" role="dialog" aria-modal="true" aria-labelledby="open-tables-title">
      <header><span><Utensils size={18} /><h2 id="open-tables-title">Mesas em aberto</h2></span><button type="button" autoFocus aria-label="Fechar resumo das mesas" onClick={onClose}><X size={18} /></button></header>
      <div className="open-tables-total"><span>Saldo que ainda falta fechar</span><strong>{formatCurrency(total)}</strong><small>{pending.length} mesa(s) com saldo · principal e submesas incluídas</small></div>
      {/* Realizado e previsao seguem a mesma privacidade do Total do dia; o saldo pendente continua visivel. */}
      <div className="open-tables-projection"><div><span>Realizado hoje</span><strong className={hideTotals ? "private-value" : ""}>{hideTotals ? "Privado" : formatCurrency(todayTotal)}</strong></div><div><span>Previsão do total</span><strong className={hideTotals ? "private-value" : ""}>{hideTotals ? "Privado" : formatCurrency(roundMoney(todayTotal + total))}</strong></div></div>
      <div className="open-tables-launches" aria-label="Previsão de lançamentos"><div><span>Lançamentos feitos hoje</span><strong>{launchesDone}</strong></div><div><span>Faltam lançar</span><strong>{launchesLeft}</strong></div><div><span>Previsão de lançamentos</span><strong>{launchesDone + launchesLeft}</strong></div></div>
      <p className="open-tables-explanation">{hideTotals ? "Realizado e previsão ocultos pela privacidade. Desative a privacidade no Total do dia para ver. " : ""}Previsão com os lançamentos atuais. Valores já pagos ficam fora desta soma. Descontos, novos produtos e cancelamentos podem alterar o resultado. Nos lançamentos, cada submesa conta como 1 e a parte principal da mesa como mais 1.</p>
      <div className="open-tables-list"><table><thead><tr><th>Mesa / identificação</th><th>Situação</th><th>Pessoas</th><th>Lançamentos</th><th>Saldo em aberto</th></tr></thead><tbody>{pending.map((table) => <tr key={table.id}><td><strong>Mesa {formatTableNumber(table.number)}</strong>{table.note && <small>{table.note}</small>}</td><td>{table.status}</td><td>{table.people || "—"}</td><td>{pendingLaunches(table) || "—"}</td><td>{formatCurrency(table.total)}</td></tr>)}</tbody></table>{!pending.length && <p className="help-empty">Nenhuma mesa com saldo em aberto.</p>}</div>
      <footer><button type="button" onClick={onClose}>Fechar</button></footer>
    </section>
  </div>;
}
