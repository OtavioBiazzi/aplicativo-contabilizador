import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, ArrowUpDown } from "lucide-react";

export type FinancialColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  required?: boolean;
};

/** Shared, keyboard accessible ledger. Preferences belong to this terminal only. */
export function FinancialGrid<T extends { id: string }>({ id, rows, columns, selectedId, onSelect, onOpen, totals, defaultHidden = [] }: {
  id: string; rows: T[]; columns: FinancialColumn<T>[]; selectedId?: string;
  onSelect: (row: T) => void; onOpen: (row: T) => void; totals: ReactNode;
  defaultHidden?: string[];
}) {
  const [preferences, setPreferences] = useState<{ hidden: string[]; compact: boolean; simpleDefaultsApplied: boolean }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`caixa.financeiro.${id}`) || "{}");
      const hidden = Array.isArray(saved.hidden) ? saved.hidden : [];
      return { hidden: saved.simpleDefaultsApplied || hidden.length ? hidden : defaultHidden, compact: saved.compact !== false, simpleDefaultsApplied: Boolean(saved.simpleDefaultsApplied || defaultHidden.length) };
    } catch { return { hidden: defaultHidden, compact: true, simpleDefaultsApplied: defaultHidden.length > 0 }; }
  });
  const [sort, setSort] = useState({ key: "", descending: false });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [options, setOptions] = useState(false);
  const ordered = useMemo(() => {
    const column = columns.find((item) => item.key === sort.key);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const left = column.value(a), right = column.value(b);
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "pt-BR", { numeric: true });
      return sort.descending ? -comparison : comparison;
    });
  }, [rows, columns, sort]);
  const rowIdentity = rows.map((row) => row.id).join("|");
  useEffect(() => { setPage(0); }, [rowIdentity, size, sort]);
  useEffect(() => {
    try { localStorage.setItem(`caixa.financeiro.${id}`, JSON.stringify(preferences)); } catch { /* Storage may be unavailable. */ }
  }, [id, preferences]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.min(page, pages - 1);
  const shown = ordered.slice(currentPage * size, (currentPage + 1) * size);
  const visibleColumns = columns.filter((column) => column.required || !preferences.hidden.includes(column.key));
  return <div className={`finance-grid ${preferences.compact ? "is-compact" : ""} ${defaultHidden.length ? "is-simple" : ""}`}>
    <div className="finance-grid-caption"><span>{rows.length} registro(s) encontrados <small>• Selecione uma linha para usar os comandos</small></span>
      <div className="finance-grid-options"><button type="button" aria-expanded={options} onClick={() => setOptions(!options)}><Columns3 size={15} /> Visualização <ChevronDown size={13} /></button>
        {options && <div className="finance-column-menu" onKeyDown={(event) => { if (event.key === "Escape") setOptions(false); }}>
          <strong>Personalizar esta tabela</strong>
          <label><input type="checkbox" checked={preferences.compact} onChange={(event) => setPreferences({ ...preferences, compact: event.target.checked })} /> Linhas compactas</label>
          {columns.filter((column) => !column.required).map((column) => <label key={column.key}><input type="checkbox" checked={!preferences.hidden.includes(column.key)} onChange={(event) => setPreferences({ ...preferences, hidden: event.target.checked ? preferences.hidden.filter((key) => key !== column.key) : [...preferences.hidden, column.key] })} /> {column.label}</label>)}
          <button onClick={() => setOptions(false)}>Concluir</button>
        </div>}
      </div>
    </div>
    <div className="finance-grid-scroll"><table><thead><tr>{visibleColumns.map((column) => <th key={column.key} className={column.numeric ? "number" : ""} aria-sort={sort.key === column.key ? sort.descending ? "descending" : "ascending" : "none"}><button onClick={() => setSort({ key: column.key, descending: sort.key === column.key && !sort.descending })}>{column.label}<ArrowUpDown size={12} /></button></th>)}</tr></thead>
      <tbody>{shown.map((row) => <tr key={row.id} tabIndex={0} aria-selected={selectedId === row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => onSelect(row)} onDoubleClick={() => onOpen(row)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); onOpen(row); }
        if (event.key === " ") { event.preventDefault(); onSelect(row); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); const next = event.key === "ArrowDown" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
          (next as HTMLElement | null)?.focus();
        }
      }}>{visibleColumns.map((column) => <td key={column.key} className={column.numeric ? "number" : ""}>{column.render ? column.render(row) : column.value(row)}</td>)}</tr>)}</tbody>
    </table>{!rows.length && <div className="finance-grid-empty"><strong>Nenhum registro encontrado</strong><span>Altere a pesquisa ou os filtros para consultar outras contas.</span></div>}</div>
    <div className="finance-grid-footer"><div className="finance-grid-totals">{totals}</div><div className="finance-pagination"><label>Linhas <select aria-label="Linhas por página" value={size} onChange={(event) => setSize(Number(event.target.value))}>{[25, 50, 100].map((count) => <option key={count}>{count}</option>)}</select></label><button aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pages}</span><button aria-label="Próxima página" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></div>
  </div>;
}

export function FinancialStatus({ value }: { value: string }) {
  return <span className={`financial-status status-${value.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-")}`}>{value}</span>;
}
