import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { FinancialPaymentMethod, PdvPayable, PdvPayableDraft, PdvPayablePayment, PdvSupplier } from "../shared/pdvTypes";
import { formatCurrency, getLocalDateKey, parseMoney, roundMoney } from "../shared/calculations";
import { FINANCIAL_PAYMENT_METHODS, paymentMethodLabel, SuppliersModal } from "./SimpleFinancialControls";

export function PayableEditorModal({ payable, initialSupplier, categories, supplierRegistry, onSaveSupplier, onDeleteSupplier, busy, onCancel, onSave }: {
  payable: PdvPayable | null; initialSupplier?: string; categories: string[]; supplierRegistry: PdvSupplier[];
  onSaveSupplier: (draft: PdvSupplier) => Promise<PdvSupplier>; onDeleteSupplier: (id: string) => Promise<void>;
  busy: boolean; onCancel: () => void; onSave: (draft: PdvPayableDraft) => void;
}) {
  const [draft, setDraft] = useState<PdvPayableDraft>(() => ({
    id: payable?.id || crypto.randomUUID(), description: payable?.description || "", supplier: payable?.supplier || initialSupplier || "",
    category: payable?.category || "", costCenter: payable?.costCenter || "", documentNumber: payable?.documentNumber || "", paymentAccount: payable?.paymentAccount || "",
    preferredPaymentMethod: payable?.preferredPaymentMethod || "Pix", tags: payable?.tags || [], issueDate: payable?.issueDate || getLocalDateKey(),
    seriesId: payable?.seriesId, installmentNumber: payable?.installmentNumber, installmentCount: payable?.installmentCount || 1,
    recurrenceIntervalMonths: 0, recurrenceCount: 2, dueDate: payable?.dueDate || getLocalDateKey(), amount: payable?.amount || 0, note: payable?.note || ""
  }));
  const [amountText, setAmountText] = useState(payable ? payable.amount.toFixed(2).replace(".", ",") : "");
  const [payments, setPayments] = useState<PdvPayablePayment[]>(() => payable?.payments.map((payment) => ({ ...payment })) || []);
  const [managingSuppliers, setManagingSuppliers] = useState(false);
  const amount = roundMoney(parseMoney(amountText));
  const paid = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const balance = roundMoney(Math.max(0, amount - paid));
  const paymentsValid = paid <= amount + .009 && payments.every((payment) => Number.isFinite(Number(payment.amount)) && payment.amount > 0);
  const supplierNames = [...new Set([...supplierRegistry.map((item) => item.name), draft.supplier || ""].filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const updatePayment = (id: string, patch: Partial<PdvPayablePayment>) => setPayments((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const valid = Boolean(draft.description.trim() && draft.dueDate && amount > 0 && paymentsValid);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={payable ? "Editar conta a pagar" : "Nova conta a pagar"}>
    <form className="modal payable-editor-modal simple-payable-editor" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) onSave({ ...draft, amount, payments }); }}>
      <div className="modal-head"><strong>{payable ? "Editar conta a pagar" : "Nova conta a pagar"}</strong><button type="button" className="icon-button" disabled={busy} aria-label="Fechar cadastro da conta" onClick={onCancel}><X size={18} /></button></div>
      <div className="payable-editor-body">
        <div className="payable-form-grid">
          <label className="wide"><span>Descrição *</span><input autoFocus value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ex.: Compra de bebidas" /></label>
          <div className="wide financial-customer-picker"><label><span>Fornecedor</span><select value={draft.supplier || ""} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })}><option value="">Sem fornecedor</option>{supplierNames.map((name) => <option key={name}>{name}</option>)}</select></label><button type="button" className="ghost-button" onClick={() => setManagingSuppliers(true)}><Plus size={14} /> Cadastrar</button></div>
          <label><span>{!payable && (draft.installmentCount || 1) > 1 ? "Valor total *" : "Valor *"}</span><input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="0,00" /></label>
          <label><span>Forma de pagamento</span><select value={draft.preferredPaymentMethod} onChange={(event) => setDraft({ ...draft, preferredPaymentMethod: event.target.value as FinancialPaymentMethod })}>{FINANCIAL_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabel(method)}</option>)}</select></label>
          <label><span>Emissão</span><input type="date" value={draft.issueDate} onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })} /></label>
          <label><span>Vencimento *</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
          <label className="wide"><span>Observação</span><textarea rows={2} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Opcional" /></label>
        </div>
        <details className="simple-extra-options"><summary>Mais opções</summary><div className="payable-form-grid">
          <label><span>Documento</span><input value={draft.documentNumber} onChange={(event) => setDraft({ ...draft, documentNumber: event.target.value })} /></label>
          <label><span>Categoria</span><input list="payable-categories" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /><datalist id="payable-categories">{categories.map((name) => <option key={name}>{name}</option>)}</datalist></label>
          <label><span>Centro de custo</span><input value={draft.costCenter} onChange={(event) => setDraft({ ...draft, costCenter: event.target.value })} /></label>
          <label><span>Tags</span><input value={(draft.tags || []).join(", ")} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
          {!payable && <><label><span>Parcelas</span><input type="number" min={1} max={60} value={draft.installmentCount} onChange={(event) => setDraft({ ...draft, installmentCount: Math.max(1, Math.min(60, Math.floor(Number(event.target.value) || 1))) })} /></label>
          {(draft.installmentCount || 1) === 1 && <label><span>Repetir conta</span><select value={draft.recurrenceIntervalMonths} onChange={(event) => setDraft({ ...draft, recurrenceIntervalMonths: Number(event.target.value) })}><option value={0}>Não repetir</option><option value={1}>Mensal</option><option value={2}>Bimestral</option><option value={3}>Trimestral</option><option value={6}>Semestral</option><option value={12}>Anual</option></select></label>}
          {(draft.installmentCount || 1) === 1 && (draft.recurrenceIntervalMonths || 0) > 0 && <label><span>Quantidade de contas</span><input type="number" min={2} max={60} value={draft.recurrenceCount} onChange={(event) => setDraft({ ...draft, recurrenceCount: Math.max(2, Math.min(60, Math.floor(Number(event.target.value) || 2))) })} /></label>}</>}
        </div></details>
        {!payable && (draft.installmentCount || 1) > 1 && <p className="simple-series-notice">O valor total será dividido em {draft.installmentCount} parcelas mensais.</p>}
        {!payable && (draft.installmentCount || 1) === 1 && (draft.recurrenceIntervalMonths || 0) > 0 && <p className="simple-series-notice">Serão criadas {draft.recurrenceCount} contas de {formatCurrency(amount)} cada.</p>}
        {payable && <details className="simple-extra-options"><summary>Pagamentos registrados ({payments.length})</summary><section className="payable-editor-payments">
          <div className="payable-editor-section-head"><strong>Pago: {formatCurrency(paid)} · Saldo: {formatCurrency(balance)}</strong><button type="button" className="ghost-button" disabled={balance <= .009} onClick={() => setPayments((current) => [...current, { id: crypto.randomUUID(), payableId: payable.id, createdAt: new Date().toISOString(), method: draft.preferredPaymentMethod || "Pix", amount: balance }])}><Plus size={14} /> Adicionar</button></div>
          {payments.map((payment) => <div className="payable-editor-payment-row" key={payment.id}>
            <label><span>Data</span><input type="date" value={payment.createdAt.slice(0, 10)} onChange={(event) => updatePayment(payment.id, { createdAt: `${event.target.value}T12:00:00.000Z` })} /></label>
            <label><span>Forma</span><select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PdvPayablePayment["method"] })}>{[...FINANCIAL_PAYMENT_METHODS, "Nao definido"].map((method) => <option key={method} value={method}>{paymentMethodLabel(method)}</option>)}</select></label>
            <label><span>Valor</span><input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => updatePayment(payment.id, { amount: Number(event.target.value) })} /></label>
            <label><span>Observação</span><input value={payment.description || ""} onChange={(event) => updatePayment(payment.id, { description: event.target.value })} /></label>
            <button type="button" className="icon-button" title="Remover pagamento" onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}><Trash2 size={15} /></button>
          </div>)}
        </section></details>}
        {!paymentsValid && <p className="pdv-inline-warning">Confira os pagamentos: o total pago não pode ultrapassar o valor da conta.</p>}
      </div>
      <div className="modal-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || !valid}>{busy ? "Salvando…" : "Salvar conta"}</button></div>
    </form>
    {managingSuppliers && <SuppliersModal suppliers={supplierRegistry} readOnly={false} onSave={onSaveSupplier} onDelete={onDeleteSupplier} onClose={() => setManagingSuppliers(false)} onCreated={(supplier) => { setDraft((current) => ({ ...current, supplier: supplier.name })); setManagingSuppliers(false); }} />}
  </div>;
}
