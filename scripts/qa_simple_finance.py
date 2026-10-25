"""Financial simplification checks; requires an isolated qa-simple-finance Electron profile."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cdp', default='http://127.0.0.1:9355')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1] / 'outputs/qa-simple-finance'
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(12000)
    page.set_viewport_size({'width':1280,'height':720})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.wait_for_function('Boolean(window.caixa)')
    page.evaluate("""async()=>{
      const state=await window.caixa.getPdvSnapshot();
      if(!state.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-simple-finance/')) throw new Error('Use an isolated QA profile');
      if(localStorage.getItem('qa.simple.fixture'))return;
      const app=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...app.settings,notificationsEnabled:false,server:{...app.settings.server,port:46582,password:'qa-simple-only',permissions:{...app.settings.server.permissions,manageTables:true,edit:true,create:true,viewTotals:true},autoConnection:{...app.settings.server.autoConnection,mode:'none'}}});
      const payable=await window.caixa.savePdvPayable({description:'QA Conta existente',supplier:'QA Fornecedor antigo',amount:50,dueDate:new Date().toLocaleDateString('en-CA'),preferredPaymentMethod:'Debito',category:'Categoria antiga',costCenter:'Centro antigo',paymentAccount:'Dado antigo',documentNumber:'DOC-1',tags:['Preservada']});
      const customer=await window.caixa.savePdvCustomer({name:'QA Cliente financeiro',active:true});
      for(const [description,amount] of [['QA Receber A',20],['QA Receber B',30],['QA Quitada',40]]){
        const account=await window.caixa.savePdvReceivable({customerId:customer.id,description,amount});
        if(description==='QA Quitada')await window.caixa.receivePdvReceivable(account.id,{id:crypto.randomUUID(),receivableId:account.id,createdAt:new Date().toISOString(),method:'Pix',amount},crypto.randomUUID());
      }
      localStorage.setItem('qa.simple.fixture','1');
    }""")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    page.locator('.professional-shell').wait_for()

    def close_window():
        page.locator('.module-window-close').click()
        page.locator('.module-window-shell').wait_for(state='detached')
    def open_module(name):
        if page.locator('.module-window-close').count():close_window()
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
        page.locator('.managerial-menu').get_by_text(name,exact=True).click()

    open_module('Contas a pagar')
    panel=page.locator('.pdv-payable-professional')
    expect(panel.locator('.simple-financial-filter-row input')).to_have_count(1)
    expect(panel.locator('.simple-financial-date-row')).to_have_count(0)
    expect(panel.locator('th')).to_have_count(6)
    assert panel.locator('.finance-grid-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
    page.screenshot(path=str(out/'payables.png'))
    panel.get_by_role('button',name='Novo',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('Pix')
    assert not editor.get_by_label('Categoria',exact=True).is_visible()
    assert not editor.get_by_text('Conta/caixa previsto',exact=True).count()
    editor.get_by_label('Descrição *',exact=True).fill('QA Compra nova')
    editor.get_by_role('button',name='Cadastrar',exact=True).click()
    suppliers=page.get_by_role('dialog',name='Fornecedores',exact=True)
    suppliers.get_by_label('Nome do fornecedor',exact=True).fill('QA Distribuidora nova')
    suppliers.get_by_role('button',name='Cadastrar',exact=True).click()
    suppliers.wait_for(state='detached')
    expect(editor.get_by_role('combobox',name='Fornecedor',exact=True).locator('option:checked')).to_have_text('QA Distribuidora nova')
    expect(editor.get_by_label('Descrição *',exact=True)).to_have_value('QA Compra nova')
    editor.get_by_label('Valor *',exact=True).fill('75')
    editor.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Credito')
    page.screenshot(path=str(out/'new-payable.png'))
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    row=panel.locator('tbody tr').filter(has_text='QA Compra nova')
    row.click()
    panel.get_by_role('button',name='Pagar',exact=True).click()
    payment=page.get_by_role('dialog',name='Pagar conta',exact=True)
    expect(payment.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('Credito')
    expect(payment.get_by_label('Valor a pagar',exact=True)).to_have_value('75,00')
    payment.get_by_label('Valor a pagar',exact=True).fill('20')
    page.screenshot(path=str(out/'payment.png'))
    payment.get_by_role('button',name='Confirmar pagamento',exact=True).click()
    payment.wait_for(state='detached')
    account=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.description==='QA Compra nova')")
    assert account['balance']==55 and account['payments'][0]['method']=='Credito',account
    panel.get_by_role('button',name='Fornecedores',exact=True).click()
    suppliers=page.get_by_role('dialog',name='Fornecedores',exact=True)
    suppliers.get_by_role('button',name='Excluir fornecedor QA Distribuidora nova',exact=True).click()
    suppliers.get_by_role('button',name='Excluir',exact=True).click()
    expect(suppliers.locator('.simple-suppliers-list')).not_to_contain_text('QA Distribuidora nova')
    page.screenshot(path=str(out/'suppliers.png'))
    suppliers.get_by_role('button',name='Fechar',exact=True).click()
    expect(panel.locator('tbody')).to_contain_text('QA Compra nova')
    assert page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.description==='QA Compra nova').supplier")=='QA Distribuidora nova'
    print('PASS compact payable list, nested supplier creation, default/planned method, partial payment and supplier removal preserving account')

    panel.locator('tbody tr').filter(has_text='QA Conta existente').click()
    panel.get_by_role('button',name='Alterar',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    editor.get_by_label('Descrição *',exact=True).fill('QA Conta existente editada')
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    old=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.description==='QA Conta existente editada')")
    assert old['category']=='Categoria antiga' and old['paymentAccount']=='Dado antigo' and old['tags']==['Preservada'],old
    print('PASS editing simple form preserves previous metadata')

    open_module('Contas a receber')
    panel=page.locator('.pdv-receivable-professional')
    expect(panel.locator('th')).to_have_count(6)
    assert panel.locator('.finance-grid-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
    panel.locator('.simple-financial-filter-row select').first.select_option('Recebida')
    panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('all')
    expect(panel.locator('.simple-financial-filter-row select').first).to_have_value('Recebida')
    expect(panel.locator('tbody')).to_contain_text('QA Quitada')
    expect(panel.locator('tbody')).not_to_contain_text('QA Receber A')
    panel.get_by_role('button',name='Ver todas em aberto',exact=True).click()
    expect(panel.locator('.simple-financial-filter-row select').first).to_have_value('Pendentes')
    panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('custom')
    expect(panel.locator('.simple-financial-date-row')).to_be_visible()
    panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('all')
    expect(panel.locator('.simple-financial-date-row')).to_have_count(0)
    page.screenshot(path=str(out/'receivables.png'))
    for description in ['QA Receber A','QA Receber B']:
        panel.locator('tbody tr').filter(has_text=description).get_by_role('checkbox').check()
    panel.get_by_role('button',name='Receber selecionadas (2)',exact=True).click()
    payment=page.get_by_role('dialog',name='Receber conta',exact=True)
    expect(payment.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('Pix')
    expect(payment.get_by_label('Valor a receber',exact=True)).to_have_value('50,00')
    payment.get_by_label('Valor a receber',exact=True).fill('38')
    payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Dinheiro')
    payment.get_by_label('Dinheiro entregue pelo cliente',exact=True).fill('50')
    payment.get_by_role('button',name='Confirmar recebimento',exact=True).click()
    payment.wait_for(state='detached')
    accounts=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).receivables.filter(a=>a.description.startsWith('QA Receber '))")
    assert sum(a['balance'] for a in accounts)==12,accounts
    assert sum(p.get('change',0) for a in accounts for p in a['payments'])==12,accounts
    if page.get_by_role('button',name='Entendi',exact=True).count():
        page.get_by_role('button',name='Entendi',exact=True).click()
    print('PASS status/period filters, grouped collection and cash change')
    panel.get_by_role('button',name='Novo',exact=True).click()
    draft=page.locator('.pdv-financial-editor-modal')
    assert not draft.get_by_label('Categoria',exact=True).is_visible()
    page.screenshot(path=str(out/'new-receivable.png'))
    draft.get_by_role('button',name='Cancelar',exact=True).click()
    page.set_viewport_size({'width':1024,'height':600})
    page.screenshot(path=str(out/'receivables-small.png'))
    body=page.locator('.module-window-body').bounding_box()
    footer=panel.locator('.finance-grid-footer').bounding_box()
    assert footer['y']+footer['height']<=body['y']+body['height']+1,(body,footer)
    close_window()
    open_module('Contas a pagar')
    page.screenshot(path=str(out/'payables-small.png'))
    footer=page.locator('.pdv-payable-professional .finance-grid-footer').bounding_box()
    body=page.locator('.module-window-body').bounding_box()
    assert footer['y']+footer['height']<=body['y']+body['height']+1,(body,footer)
    assert not errors,errors
    print('PASS smaller window and no renderer errors')
    browser.close()
