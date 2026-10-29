import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { formatCurrency, getLocalDateKey, parseMoney, roundMoney } from "../shared/calculations";
import type { FinancialDateField } from "../shared/financialDates";
import type { FinancialPaymentMethod, PdvPayment, PdvSupplier } from "../shared/pdvTypes";

export const FINANCIAL_PAYMENT_METHODS: FinancialPaymentMethod[] = ["Pix", "Dinheiro", "Debito", "Credito", "Outros"];
export const paymentMethodLabel = (method: string) => ({ Debito: "Cartão de débito", Credito: "Cartão de crédito" }[method] || method);

export function SimpleFinancialFilters({ query, onQuery, placeholder, from, to, onPeriod, dateField, onDateField, status, onStatus, statuses, grouped = false, pendingNotice, settlement }: {
  settlement: { pendingStatus: string; paidStatus: string; pendingLabel: string; paidLabel: string };
  query: string; onQuery: (value: string) => void; placeholder: string; from: string; to: string; onPeriod: (from: string, to: string) => void;
  dateField: FinancialDateField; onDateField: (value: FinancialDateField) => void; status: string; onStatus: (value: string) => void; statuses: string[]; grouped?: boolean; pendingNotice?: { count: number; onShowAll: () => void };
}) {
  const today = getLocalDateKey();
  const start = `${today.slice(0, 7)}-01`;
  const end = getLocalDateKey(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  const period = !from && !to ? "all" : from === start && to === end ? "month" : from === today && to === today ? "today" : "custom";
  const operational = status === "Operacionais";
  const pendingChecked = grouped || operational || [settlement.pendingStatus, "Em aberto", "Vencidas", "Vencida", "Parcialmente recebida"].includes(status);
  const paidChecked = !grouped && (operational || status === settlement.paidStatus);
  const updateChecks = (pending: boolean, paid: boolean) => onStatus(pending && paid ? "Operacionais" : pending ? settlement.pendingStatus : paid ? settlement.paidStatus : "Nenhuma");
  return <div className="simple-financial-filters">
    <div className="simple-financial-filter-row">
      <label className="financial-date-field"><span>Data de</span><select aria-label="Data de" disabled={grouped} value={dateField} onChange={(event) => onDateField(event.target.value as FinancialDateField)}><option value="emission">Emissão</option><option value="due">Vencimento</option></select></label>
      <label className="financial-date-from"><span>De</span><input type="date" disabled={grouped} value={grouped ? "" : from} onChange={(event) => onPeriod(event.target.value, to)} /></label>
      <label className="financial-date-to"><span>Até</span><input type="date" disabled={grouped} value={grouped ? "" : to} onChange={(event) => onPeriod(from, event.target.value)} /></label>
      <label className="simple-financial-search"><span>Pesquisar</span><input aria-label="Buscar" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} /></label>
      <fieldset className="financial-settlement-filter" disabled={grouped}><legend>Exibir</legend><div>
        <details className="financial-state-options"><summary aria-label="Mais filtros" title="Período e outras situações">Mais filtros</summary><div>
          <label><span>Situação</span><select aria-label="Situação das contas" value={status} onChange={(event) => onStatus(event.target.value)}><option value="Operacionais">Em aberto e quitadas</option><option value="Nenhuma">Nenhuma selecionada</option>{statuses.map((value) => <option key={value} value={value}>{{ Historico: "Histórico", Excluida: "Excluída", Excluidas: "Excluídas" }[value] || value}</option>)}</select></label>

      <label><span>Período</span><select aria-label="Período das contas" disabled={grouped} value={grouped ? "all" : period} onChange={(event) => {
        const value = event.target.value;
        if (value === "all") onPeriod("", "");
        if (value === "month") onPeriod(start, end);
        if (value === "today") onPeriod(today, today);
      }}><option value="month">Este mês</option><option value="today">Hoje</option><option value="all">Todo o período</option><option value="custom" disabled>Personalizado</option></select></label>
        </div></details>
        <label><input type="checkbox" checked={pendingChecked} onChange={(event) => updateChecks(event.target.checked, paidChecked)} />{settlement.pendingLabel}</label>
        <label><input type="checkbox" checked={paidChecked} onChange={(event) => updateChecks(pendingChecked, event.target.checked)} />{settlement.paidLabel}</label>

      </div></fieldset>

    </div>
    {!grouped && pendingNotice && pendingNotice.count > 0 && <div className="financial-search-heading"><button type="button" aria-label="Ver todas em aberto" onClick={pendingNotice.onShowAll}>Ver todas em aberto ({pendingNotice.count} fora do filtro)</button></div>}
  </div>;
}

export function SimpleCollectionModal({ mode, title, balance, defaultMethod = "", busy = false, onCancel, onConfirm }: {
  mode: "payable" | "receivable"; title: string; balance: number; defaultMethod?: FinancialPaymentMethod | ""; busy?: boolean;
  onCancel: () => void; onConfirm: (payment: PdvPayment) => void | Promise<void>;
}) {
  const [method, setMethod] = useState<FinancialPaymentMethod | "">(defaultMethod);
  const [amount, setAmount] = useState(balance.toFixed(2).replace(".", ","));
  const [received, setReceived] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = roundMoney(parseMoney(amount));
  const cash = mode === "receivable" && method === "Dinheiro";
  const handed = received.trim() ? roundMoney(parseMoney(received)) : value;
  const valid = Boolean(method) && value > 0 && value <= balance + .009 && (!cash || handed + .009 >= value);
  const confirm = async () => {
    if (!valid || !method || busy || saving) return;
    setSaving(true); setError("");
    try { await onConfirm({ id: crypto.randomUUID(), method, amount: value, ...(cash ? { received: handed, change: roundMoney(Math.max(0, handed - value)) } : {}), description: description.trim() || undefined }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o pagamento."); }
    finally { setSaving(false); }
  };
  return <div className="pdv-modal-backdrop pdv-nested-backdrop" role="dialog" aria-modal="true" aria-label={mode === "payable" ? "Pagar conta" : "Receber conta"}>
    <form className="simple-collection-modal" onSubmit={(event) => { event.preventDefault(); void confirm(); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
      <header><div><h2>{mode === "payable" ? "Pagar conta" : "Receber conta"}</h2><span>{title}</span></div><button type="button" aria-label="Fechar pagamento" onClick={onCancel} disabled={busy || saving}><X size={17} /></button></header>
      <div className="simple-collection-body"><div className="financial-outstanding"><span>{mode === "payable" ? "Falta pagar" : "Falta receber"}</span><strong>{formatCurrency(balance)}</strong></div>
        <div className="simple-collection-fields"><label><span>Forma de pagamento</span><select value={method} onChange={(event) => setMethod(event.target.value as FinancialPaymentMethod | "")}><option value="">Selecione…</option>{FINANCIAL_PAYMENT_METHODS.map((value) => <option key={value} value={value}>{paymentMethodLabel(value)}</option>)}</select></label><label><span>Valor {mode === "payable" ? "a pagar" : "a receber"}</span><input autoFocus inputMode="decimal" value={amount} onFocus={(event) => event.target.select()} onChange={(event) => setAmount(event.target.value)} /></label></div>
        {cash && <label><span>Dinheiro entregue pelo cliente</span><input aria-label="Dinheiro entregue pelo cliente" inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} placeholder={amount} /><small>Troco: {formatCurrency(Math.max(0, handed - value))}</small></label>}
        <details className="simple-extra-options"><summary>Adicionar observação</summary><label><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Opcional" /></label></details>
        {error && <p className="pdv-inline-warning" role="alert">{error}</p>}
      </div>
      <footer><button type="button" onClick={onCancel} disabled={busy || saving}>Cancelar</button><button type="submit" className="primary-button" disabled={!valid || busy || saving}>{busy || saving ? "Registrando…" : mode === "payable" ? "Confirmar pagamento" : "Confirmar recebimento"}</button></footer>
    </form>
  </div>;
}

export function SuppliersModal({ suppliers, readOnly, onSave, onDelete, onClose, onCreated, heading = "Fornecedores", recordLabel = "fornecedor", placeholder = "Ex.: Distribuidora de bebidas" }: {
  suppliers: PdvSupplier[]; readOnly: boolean; onSave: (draft: PdvSupplier) => Promise<PdvSupplier>; onDelete: (id: string) => Promise<void>; onClose: () => void; onCreated?: (supplier: PdvSupplier) => void;
  heading?: string; recordLabel?: string; placeholder?: string;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => { if (busy || !name.trim()) return; setBusy(true); setError(""); try { const supplier = await onSave({ id: crypto.randomUUID(), name: name.trim() }); setName(""); onCreated?.(supplier); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar."); } finally { setBusy(false); } };
  const visible = suppliers.filter((supplier) => supplier.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <div className="pdv-modal-backdrop pdv-nested-backdrop" role="dialog" aria-modal="true" aria-label={heading}><section className="simple-suppliers-modal">
    <header><h2>{heading}</h2><button type="button" aria-label={`Fechar ${heading.toLocaleLowerCase("pt-BR")}`} disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="simple-suppliers-body">{!readOnly && <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label><span>Nome {recordLabel === "categoria" ? "da" : "do"} {recordLabel}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={placeholder} /></label><button type="submit" disabled={busy || !name.trim()}><Plus size={15} /> Cadastrar</button></form>}
      <label><span>Buscar {recordLabel}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome" /></label>
      <div className="simple-suppliers-list">{visible.map((supplier) => <article key={supplier.id}><strong>{supplier.name}</strong>{!readOnly && (removing === supplier.id ? <span><small>Remover cadastro? As contas serão mantidas.</small><button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onDelete(supplier.id); setRemoving(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir."); } finally { setBusy(false); } }}>Excluir</button><button disabled={busy} onClick={() => setRemoving(null)}>Voltar</button></span> : <button type="button" title={`Excluir ${recordLabel} ${supplier.name}`} aria-label={`Excluir ${recordLabel} ${supplier.name}`} onClick={() => setRemoving(supplier.id)}><Trash2 size={15} /></button>)}</article>)}{!visible.length && <p>Nenhum cadastro encontrado.</p>}</div>
      {error && <p role="alert">{error}</p>}
    </div><footer><button type="button" disabled={busy} onClick={onClose}>Fechar</button></footer>
  </section></div>;
}
