"""Exercise inline finance records and grouped settlements using isolated CDP 9367."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
out=Path(__file__).resolve().parents[1]/'outputs/qa-ledger-layout'
out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9367')
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(15000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.wait_for_function('Boolean(window.caixa)')
    page.evaluate("""async()=>{
      const snap=await window.caixa.getPdvSnapshot();
      if(!snap.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-layout/'))throw Error('Isolated fixture required');
      if(localStorage.getItem('qa.ledger.seed'))return;
      const s=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,server:{...s.settings.server,port:46607,autoConnection:{...s.settings.server.autoConnection,mode:'none'}}});
      const supplier=await window.caixa.savePdvSupplier({id:crypto.randomUUID(),name:'Café Central'});
      const customer=await window.caixa.savePdvCustomer({name:'Maria Oliveira',active:true});
      for(let i=1;i<=28;i++){
        await window.caixa.savePdvPayable({supplier:supplier.name,description:'Café torrado '+i,documentNumber:'NF-'+i,amount:120,dueDate:'',preferredPaymentMethod:'Pix'});
        if(i<=3)await window.caixa.savePdvReceivable({customerId:customer.id,description:'Consumo '+i,amount:40});
      }
      localStorage.setItem('qa.ledger.seed','1');
    }""")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    page.locator('.professional-shell').wait_for()
    def open_module(title):
        if page.locator('.module-window-close').count():
            page.locator('.module-window-close').click()
            page.locator('.module-window-shell').wait_for(state='detached')
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
        page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    def bounds(panel):
        result=panel.evaluate("""e=>{
          const editor=e.querySelector('.financial-inline-editor');
          const footer=editor.querySelector('.modal-actions,.pdv-action-row').getBoundingClientRect();
          const r=e.getBoundingClientRect();
          return {width:e.clientWidth,scroll:e.scrollWidth,footerBottom:footer.bottom,bottom:r.bottom,footerTop:footer.top};
        }""")
        assert result['scroll']<=result['width']+1,result
        assert result['footerBottom']<=result['bottom']+1 and result['footerTop']>0,result
    for title,selector,group,verb in [('Contas a pagar','.pdv-payable-professional','Por fornecedor','Pagar'),('Contas a receber','.pdv-receivable-professional','Por cliente','Receber')]:
        open_module(title);panel=page.locator(selector)
        for width,height in [(1280,720),(1024,600)]:
            page.set_viewport_size({'width':width,'height':height})
            expect(panel.locator('tbody tr').first).to_be_visible()
            panel.locator('tbody tr').first.click()
            toolbar=panel.locator('.finance-command-bar').bounding_box()
            page.screenshot(path=str(out/f'{verb}-pesquisa-{width}.png'))
            panel.get_by_role('tab',name='Registro',exact=False).click()
            editor=panel.locator('.financial-inline-editor')
            expect(editor).to_be_visible()
            expect(panel.locator('.simple-financial-filters')).to_be_hidden()
            assert panel.locator('.finance-command-bar').bounding_box()==toolbar
            bounds(panel)
            page.screenshot(path=str(out/f'{verb}-registro-{width}.png'))
            editor.get_by_role('button',name='Cancelar' if verb=='Pagar' else 'Voltar',exact=True).click()
            expect(panel.locator('.simple-financial-filters')).to_be_visible()
        page.set_viewport_size({'width':1280,'height':720})
        # Create using Registro, then alter in-place and persist.
        panel.get_by_role('button',name='Novo',exact=True).click()
        editor=panel.locator('.financial-inline-editor')
        editor.get_by_label('Valor *',exact=True).fill('55')
        if verb=='Receber':
            editor.get_by_role('combobox',name='Cliente *',exact=True).select_option(label='Maria Oliveira')
            editor.get_by_label('Descricao *',exact=True).fill('Conta teste inline')
        else:
            expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('')
            editor.get_by_role('button',name='Gerenciar fornecedores',exact=True).click()
            dialog=page.get_by_role('dialog',name='Fornecedores',exact=True)
            expect(dialog).to_be_visible()
            dialog.get_by_role('button',name='Fechar',exact=True).click()
            editor.get_by_label('Descrição',exact=True).fill('Conta teste inline')
        editor.get_by_role('button',name='Salvar conta',exact=True).click()
        expect(editor).to_have_count(0)
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        panel.get_by_role('button',name='Alterar',exact=True).click()
        editor=panel.locator('.financial-inline-editor')
        editor.get_by_label('Descrição' if verb=='Pagar' else 'Descricao',exact=True).fill('Conta alterada inline')
        editor.get_by_role('button',name='Salvar conta' if verb=='Pagar' else 'Salvar alteracoes',exact=True).click()
        expect(editor).to_have_count(0)
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        key='payables' if verb=='Pagar' else 'receivables'
        assert page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].some(a=>a.description==='Conta alterada inline')",key)
        panel.get_by_role('tab',name=group,exact=True).click()
        expect(panel.get_by_label('Período das contas',exact=True)).to_be_disabled()
        panel.locator('tbody tr').first.click()
        panel.get_by_role('button',name=verb,exact=True).click()
        payment=page.get_by_role('dialog',name=verb+' conta',exact=True)
        payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Pix')
        payment.get_by_label('Valor a pagar' if verb=='Pagar' else 'Valor a receber',exact=True).fill('15')
        before=page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].reduce((s,a)=>s+a.balance,0)",key)
        payment.get_by_role('button',name='Confirmar pagamento' if verb=='Pagar' else 'Confirmar recebimento',exact=True).click()
        payment.wait_for(state='detached')
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        after=page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].reduce((s,a)=>s+a.balance,0)",key)
        assert round(before-after,2)==15,(before,after)
        print('PASS',title,': inline create/edit/cancel, 1024/1280 bounds, nested registration and grouped settlement')
    assert not errors,errors
    browser.close()
