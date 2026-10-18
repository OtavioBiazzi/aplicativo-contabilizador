import { useEffect, useMemo } from "react";
import { ArrowUpRight, Utensils, X } from "lucide-react";
import { formatCurrency, roundMoney } from "../shared/calculations";
import type { PdvOpenTable } from "../shared/pdvTypes";

export function OpenTablesSummary({ tables, onClose, onOpenTables }: { tables: PdvOpenTable[]; onClose: () => void; onOpenTables: () => void }) {
  // table.total já representa o saldo não pago, inclusive em fechamentos parciais.
  const pending = useMemo(() => tables.filter((table) => table.total > 0.009).sort((a, b) => a.number - b.number), [tables]);
  const total = roundMoney(pending.reduce((sum, table) => sum + table.total, 0));
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [onClose]);
  return <div className="open-tables-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="open-tables-summary" role="dialog" aria-modal="true" aria-labelledby="open-tables-title">
      <header><span><Utensils size={18} /><h2 id="open-tables-title">Mesas em aberto</h2></span><button type="button" autoFocus aria-label="Fechar resumo das mesas" onClick={onClose}><X size={18} /></button></header>
      <div className="open-tables-total"><span>Saldo que ainda falta fechar</span><strong>{formatCurrency(total)}</strong><small>{pending.length} mesa(s) com saldo · principal e submesas incluídas</small></div>
      <p className="open-tables-explanation">Previsão com os lançamentos atuais. Valores já pagos ficam fora desta soma. Descontos, novos produtos e cancelamentos podem alterar o resultado.</p>
      <div className="open-tables-list"><table><thead><tr><th>Mesa / identificação</th><th>Situação</th><th>Pessoas</th><th>Saldo em aberto</th></tr></thead><tbody>{pending.map((table) => <tr key={table.id}><td><strong>Mesa {String(table.number).padStart(3, "0")}</strong>{table.note && <small>{table.note}</small>}</td><td>{table.status}</td><td>{table.people || "—"}</td><td>{formatCurrency(table.total)}</td></tr>)}</tbody></table>{!pending.length && <p className="help-empty">Nenhuma mesa com saldo em aberto.</p>}</div>
      <footer><button type="button" onClick={onOpenTables}>Ir para Mesas <ArrowUpRight size={15} /></button><button type="button" onClick={onClose}>Fechar</button></footer>
    </section>
  </div>;
}
