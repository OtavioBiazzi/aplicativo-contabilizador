import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { formatCurrency, parseMoney, roundMoney } from "../shared/calculations";
import type { PdvCustomer, PdvCustomerDraft, PdvPayment } from "../shared/pdvTypes";
import { FINANCIAL_PAYMENT_METHODS, paymentMethodLabel } from "./SimpleFinancialControls";
import { KeyboardSelect } from "./KeyboardSelect";
import { adaptAutomaticDescription } from "../shared/automaticDescription";

export function HistoryPaymentsEditor({total, initialPayments, customers, busy, onSaveCustomer, onCancel, onConfirm}: {
  total: number; initialPayments: PdvPayment[]; customers: PdvCustomer[]; busy: boolean;
  onSaveCustomer: (draft: PdvCustomerDraft) => Promise<PdvCustomer>;
  onCancel: () => void; onConfirm: (payments: PdvPayment[]) => Promise<void>;
}) {
  const [rows,setRows]=useState(()=>initialPayments.map(payment=>({...payment, text:String(payment.amount).replace(".",","), cash:payment.received === undefined ? "" : String(payment.received).replace(".",",")})));
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  const [creating,setCreating]=useState<string|null>(null),[name,setName]=useState(""),[created,setCreated]=useState<PdvCustomer[]>([]);
  const availableCustomers=[...new Map([...customers,...created].map(customer=>[customer.id,customer])).values()];
  const normalized=rows.map(({text,cash,...payment})=>{
    const amount=roundMoney(parseMoney(text)),received=payment.method === "Dinheiro" ? cash.trim() ? roundMoney(parseMoney(cash)) : amount : undefined;
    return {...payment,amount,received,change:received === undefined ? undefined : roundMoney(Math.max(0,received-amount))};
  });
  const paid=roundMoney(normalized.reduce((sum,payment)=>sum+payment.amount,0));
  const valid=(normalized.length>0 || total<.009) && Math.abs(total-paid)<.009 && normalized.every(p=>p.amount>0 && p.method!=="Nao definido" && (p.method!=="Dinheiro" || p.received!>=p.amount) && (p.method!=="Conta a receber" || Boolean(p.customerId)));
  const change=(id:string,patch:Partial<typeof rows[number]>)=>setRows(current=>current.map(p=>p.id===id?{...p,...patch}:p));
  const save=async()=>{if(!valid||busy||saving)return;setSaving(true);setError("");try{await onConfirm(normalized);}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar os pagamentos.");}finally{setSaving(false);}};
  return createPortal(<div className="modal-backdrop history-payment-backdrop" role="dialog" aria-modal="true" aria-label="Editar pagamentos">
    <form className="simple-history-payments" onSubmit={event=>{event.preventDefault();void save();}} onKeyDown={event=>{if(event.key==="Escape"&&!busy&&!saving){event.preventDefault();event.stopPropagation();onCancel();}}}>
      <header><h2>Editar pagamentos</h2><button type="button" tabIndex={-1} aria-label="Fechar pagamentos" disabled={busy||saving} onClick={onCancel}><X size={17}/></button></header>
      <fieldset className="simple-history-payments-body" disabled={busy||saving}>
        <div className="history-payment-totals"><span>Total da conta<strong>{formatCurrency(total)}</strong></span><span>Pagamentos<strong>{formatCurrency(paid)}</strong></span><span>Diferença<strong>{formatCurrency(roundMoney(total-paid))}</strong></span></div>
        {rows.map((payment,index)=><section className="simple-history-payment-row" key={payment.id} aria-label={`Pagamento ${index+1}`}>
          <label><span>Forma de pagamento</span><KeyboardSelect value={payment.method} onChange={event=>change(payment.id,{method:event.target.value as PdvPayment["method"],description:adaptAutomaticDescription(payment.description||"",{method:payment.method},{method:event.target.value})})}><option value="Nao definido">Selecione…</option>{[...FINANCIAL_PAYMENT_METHODS,"Conta a receber"].map(method=><option key={method} value={method}>{paymentMethodLabel(method)}</option>)}</KeyboardSelect></label>
          <label><span>Valor</span><input autoFocus={index===0} inputMode="decimal" value={payment.text} onFocus={event=>event.target.select()} onChange={event=>change(payment.id,{text:event.target.value})}/></label>
          <button type="button" className="icon-button" aria-label={`Remover pagamento ${index+1}`} onClick={()=>setRows(current=>current.filter(p=>p.id!==payment.id))}><Trash2 size={16}/></button>
          {payment.method==="Dinheiro"&&<label><span>Dinheiro recebido</span><input inputMode="decimal" value={payment.cash} placeholder={payment.text} onChange={event=>change(payment.id,{cash:event.target.value})}/><small>Troco: {formatCurrency(normalized[index].change||0)}</small></label>}
          {payment.method==="Conta a receber"&&<div className="financial-customer-picker"><label><span>Cliente</span><KeyboardSelect value={payment.customerId||""} onChange={event=>{const customer=availableCustomers.find(c=>c.id===event.target.value);change(payment.id,{customerId:customer?.id,customerName:customer?.name});}}><option value="">Selecione…</option>{availableCustomers.filter(c=>(c.active&&c.role!=="supplier")||c.id===payment.customerId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</KeyboardSelect></label><button type="button" className="lookup-manage-button" tabIndex={-1} title="Novo cliente (F2)" aria-label="Novo cliente" onClick={()=>{setCreating(payment.id);setName("");}}><Plus size={15}/></button></div>}
          <label className="history-payment-identification"><span>Identificação / observação</span><input value={payment.description||""} onChange={event=>change(payment.id,{description:event.target.value})}/></label>
        </section>)}
        {creating&&<div className="history-inline-customer"><label><span>Nome do novo cliente</span><input autoFocus value={name} onChange={event=>setName(event.target.value)}/></label><button type="button" disabled={!name.trim()||saving} onClick={async()=>{setSaving(true);try{const c=await onSaveCustomer({name:name.trim(),active:true,role:"customer"});setCreated(current=>[...current,c]);change(creating,{customerId:c.id,customerName:c.name});setCreating(null);}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível criar o cliente.");}finally{setSaving(false);}}}>Cadastrar</button><button type="button" onClick={()=>setCreating(null)}>Cancelar</button></div>}
        <button type="button" className="ghost-button" disabled={busy||saving} onClick={()=>setRows(current=>[...current,{id:crypto.randomUUID(),method:"Nao definido",amount:Math.max(0,total-paid),text:String(Math.max(0,total-paid)).replace(".",","),cash:""}])}><Plus size={15}/> Adicionar pagamento</button>
        {!valid&&<p className="settings-note">A soma dos pagamentos deve ser igual ao total da conta. Confira a forma e o valor de cada parte.</p>}
        {error&&<p className="pdv-inline-warning" role="alert">{error}</p>}
      </fieldset>
      <footer><button type="button" onClick={onCancel} disabled={busy||saving}>Cancelar</button><button type="submit" className="primary-button" disabled={!valid||busy||saving}>{busy||saving?"Salvando…":"Salvar pagamentos"}</button></footer>
    </form>
  </div>,document.getElementById("root")||document.body);
}
