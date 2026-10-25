"""Run after qa_payable_optional.py; use an isolated client at 9361."""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9360');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9361');page=cb.contexts[0].pages[0]
    page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.evaluate("""async()=>{
      const pdv=await window.caixa.getPdvSnapshot();if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-payable-refinement/'))throw new Error('Use an isolated QA profile');
      const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46584',password:'qa-optional-only',deviceName:'QA Campos opcionais'}}});
    }""")
    page.reload();page.get_by_text('Entrar como Cliente',exact=True).click()
    page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
    page.locator('.managerial-menu').get_by_text('Contas a pagar',exact=True).click()
    panel=page.locator('.pdv-payable-professional')
    panel.get_by_role('button',name='Novo',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    editor.get_by_label('Valor *',exact=True).fill('35')
    editor.get_by_label('Documento',exact=True).fill('OS-7')
    expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('')
    for kind,title,field,label,name in [('category','Categorias','categoria','Gerenciar categorias','Serviços'),('costCenter','Centros de custo','centro de custo','Gerenciar centros de custo','Cozinha')]:
        editor.get_by_role('button',name=label,exact=True).click()
        modal=page.get_by_role('dialog',name=title,exact=True)
        modal.get_by_label('Nome da categoria' if kind=='category' else 'Nome do centro de custo',exact=True).fill(name)
        modal.get_by_role('button',name='Cadastrar',exact=True).click();modal.wait_for(state='detached')
        assert server.evaluate("async([kind,name])=>(await window.caixa.getPdvSnapshot()).financialLookups.some(x=>x.kind===kind&&x.name===name)",[kind,name])
    editor.get_by_role('button',name='Salvar conta',exact=True).click();editor.wait_for(state='detached')
    saved=server.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.documentNumber==='OS-7')")
    assert saved['description']=='' and saved['dueDate']=='' and saved['category']=='Serviços' and saved['costCenter']=='Cozinha' and saved['preferredPaymentMethod']=='',saved
    panel.locator('tbody tr').filter(has_text='Documento OS-7').click()
    panel.get_by_role('button',name='Pagar',exact=True).click()
    payment=page.get_by_role('dialog',name='Pagar conta',exact=True)
    expect(payment.get_by_role('button',name='Confirmar pagamento',exact=True)).to_be_disabled()
    payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Debito')
    payment.get_by_label('Valor a pagar',exact=True).fill('15')
    payment.get_by_role('button',name='Confirmar pagamento',exact=True).click();payment.wait_for(state='detached')
    saved=server.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.documentNumber==='OS-7')")
    assert saved['balance']==20 and saved['payments'][0]['method']=='Debito',saved
    assert not errors,errors
    print('PASS remote classification creation, optional account fields, explicit payment choice and partial balance')
    cb.close();sb.close()
