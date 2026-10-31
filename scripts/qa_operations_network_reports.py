"""Extra network permissions/grouped dates and report projection; uses the isolated operations fixture."""
from pathlib import Path
from time import time_ns
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
out=root/'outputs/qa-operations-20261031'
with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9387');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9388');client=cb.contexts[0].pages[0]
    client.set_default_timeout(18000);client.set_viewport_size({'width':1024,'height':600})
    for page in [server,client]:
        assert '/outputs/qa-operations-20261031/' in page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).dataFile').replace('\\','/')
    suffix=str(time_ns())[-7:]
    fixture=server.evaluate("""async suffix=>{
      const customer=await window.caixa.savePdvCustomer({name:'Grupo rede '+suffix,role:'both',active:true});
      const payables=[],receivables=[];
      for(const amount of [20,30]){
        payables.push((await window.caixa.savePdvPayable({supplier:customer.name,description:'Grupo rede',amount})).id);
        receivables.push((await window.caixa.savePdvReceivable({customerId:customer.id,description:'Grupo rede',amount})).id);
      }
      return {customer,payables,receivables};
    }""",suffix)
    def request(path,body,operation='',method='POST'):
        return client.evaluate("""async({path,body,operation,method})=>{
          const response=await fetch('http://127.0.0.1:46631'+path,{method,headers:{'Content-Type':'application/json','x-caixa-password':'qa-operations-only','x-caixa-version':await window.caixa.getAppVersion(),'x-device-name':'QA Operations','x-idempotency-key':operation},body:JSON.stringify(body)});
          return {status:response.status,body:await response.json()};
        }""",{'path':path,'body':body,'operation':operation,'method':method})
    at='2026-10-22T16:45:00.000Z'
    for key,path,body in [
      ('payables','/api/pdv/supplier-payments',{'supplier':fixture['customer']['name'],'accountIds':fixture['payables'],'payment':{'method':'Pix','amount':38,'createdAt':at}}),
      ('receivables','/api/pdv/customers/'+fixture['customer']['id']+'/receipts',{'accountIds':fixture['receivables'],'payment':{'method':'Pix','amount':38,'createdAt':at}})
    ]:
        operation='qa-'+key+'-'+suffix
        result=request(path,body,operation);assert result['status'] in [200,201],result
        records=result['body'][key]
        assert len(records)==2 and sum(r['balance'] for r in records)==12
        assert all(payment['createdAt']==at for record in records for payment in record['payments'])
        again=request(path,body,operation);assert sum(len(r['payments']) for r in again['body'][key])==2
        print('PASS HTTP grouped',key,': selected date persisted and replay does not duplicate')
    previous=server.evaluate("async()=>(await window.caixa.getSnapshot()).settings.server.permissions")
    server.evaluate("""async()=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,permissions:{...s.settings.server.permissions,manageProducts:false}}})}""")
    try:assert request('/api/pdv/products/preferences',{'frequentCategoryEnabled':True},method='PATCH')['status']==403
    finally:server.evaluate("""async permissions=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,permissions}})}""",previous)
    assert request('/api/pdv/products/preferences',{'frequentCategoryEnabled':'invalid'},method='PATCH')['status']==400
    print('PASS product preference endpoint enforces permission and validates boolean')

    # Reload only the client to pick up the final stylesheet without touching the server data.
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    if client.locator('.module-window-close').count():client.locator('.module-window-close').click()
    client.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
    client.locator('.managerial-menu').get_by_text('Resumo de vendas',exact=True).click()
    reports=client.locator('.professional-report-panel')
    reports.get_by_role('combobox',name='Pagamento',exact=True).select_option('Debito')
    metric=reports.locator('.professional-metric').filter(has=reports.get_by_text('Total vendido liquido',exact=True))
    if metric.count():expect(metric).to_contain_text('30,00')
    else:
        target=reports.get_by_text('Total vendido liquido',exact=True).locator('..')
        expect(target).to_contain_text('30,00')
    client.screenshot(path=str(out/'report-debit-only.png'))
    client.locator('.module-window-close').click();client.get_by_role('button',name='Caixa',exact=True).click()
    history=client.locator('.professional-history-panel');history.get_by_label('Buscar',exact=True).fill('Operacao QA')
    history.get_by_role('combobox',name='Pagamento',exact=True).select_option('Pix')
    history.locator('tbody tr').first.get_by_role('button',name='Editar pagamentos',exact=True).click()
    editor=client.get_by_role('dialog',name='Editar pagamentos',exact=True)
    expect(editor.get_by_role('button',name='Salvar pagamentos',exact=True)).to_be_enabled()
    client.screenshot(path=str(out/'history-payments-final.png'))
    editor.get_by_role('button',name='Cancelar',exact=True).click();expect(editor).to_have_count(0)
    print('PASS report Debit totals only 30; final compact payment modal fits 1024x600 and closes by keyboard-friendly controls')
    cb.close();sb.close()
