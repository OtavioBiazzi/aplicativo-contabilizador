"""Check optional payable fields and classification lists on an isolated Electron at 9360."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path(__file__).resolve().parents[1]/'outputs/qa-payable-refinement'
out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9360')
    page=browser.contexts[0].pages[0]
    page.set_viewport_size({'width':1280,'height':720})
    page.set_default_timeout(12000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.wait_for_function('Boolean(window.caixa)')
    page.evaluate("""async()=>{
      const pdv=await window.caixa.getPdvSnapshot();
      if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-payable-refinement/'))throw new Error('Use an isolated QA profile');
      if(localStorage.getItem('qa.optional.fixture'))return;
      const app=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...app.settings,notificationsEnabled:false,server:{...app.settings.server,port:46584,password:'qa-optional-only',permissions:{...app.settings.server.permissions,manageTables:true,edit:true,create:true},autoConnection:{...app.settings.server.autoConnection,mode:'none'}}});
      const account=await window.caixa.savePdvPayable({description:'',supplier:'Distribuidora Central',amount:120,dueDate:'',category:'Bebidas',costCenter:'Loja',preferredPaymentMethod:''});
      await window.caixa.payPdvPayable(account.id,{id:crypto.randomUUID(),payableId:account.id,createdAt:new Date().toISOString(),method:'Pix',amount:45},crypto.randomUUID());
      localStorage.setItem('qa.optional.fixture','1');
    }""")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
    page.locator('.managerial-menu').get_by_text('Contas a pagar',exact=True).click()
    panel=page.locator('.pdv-payable-professional')
    panel.locator('tbody tr').filter(has_text='Distribuidora Central').click()
    panel.get_by_role('button',name='Alterar',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('')
    expect(editor.get_by_label('Descrição',exact=True)).to_have_value('')
    expect(editor.get_by_role('combobox',name='Categoria',exact=True)).to_be_visible()
    expect(editor.get_by_role('combobox',name='Centro de custo',exact=True)).to_be_visible()
    expect(editor.get_by_label('Documento',exact=True)).to_be_visible()
    assert editor.get_by_label('Descrição',exact=True).bounding_box()['y']>editor.get_by_role('combobox',name='Categoria',exact=True).bounding_box()['y']
    expect(editor.locator('.payable-balance-summary .remaining strong')).to_contain_text('75,00')
    page.screenshot(path=str(out/'partial-balance.png'))
    editor.get_by_role('button',name='Gerenciar categorias',exact=True).click()
    modal=page.get_by_role('dialog',name='Categorias',exact=True)
    modal.get_by_label('Nome da categoria',exact=True).fill('Energia')
    modal.get_by_role('button',name='Cadastrar',exact=True).click()
    modal.wait_for(state='detached')
    expect(editor.get_by_role('combobox',name='Categoria',exact=True).locator('option:checked')).to_have_text('Energia')
    editor.get_by_role('button',name='Gerenciar centros de custo',exact=True).click()
    modal=page.get_by_role('dialog',name='Centros de custo',exact=True)
    modal.get_by_label('Nome do centro de custo',exact=True).fill('Administrativo')
    modal.get_by_role('button',name='Cadastrar',exact=True).click()
    modal.wait_for(state='detached')
    editor.get_by_label('Documento',exact=True).fill('NF-123')
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    saved=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.supplier==='Distribuidora Central')")
    assert saved['description']=='' and saved['category']=='Energia' and saved['costCenter']=='Administrativo' and saved['balance']==75 and saved['preferredPaymentMethod']=='',saved
    print('PASS optional description/payment/due date, visible classifications/document, live partial balance and classification creation')
    panel.get_by_role('button',name='Novo',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    expect(editor.get_by_role('button',name='Salvar conta',exact=True)).to_be_disabled()
    editor.get_by_label('Valor *',exact=True).fill('30')
    expect(editor.get_by_role('button',name='Salvar conta',exact=True)).to_be_enabled()
    expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('')
    expect(editor.get_by_label('Vencimento',exact=True)).to_have_value('')
    page.screenshot(path=str(out/'new-account.png'))
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    minimal=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.amount===30)")
    assert minimal['description']=='' and minimal['dueDate']=='' and minimal['status']=='Em aberto' and minimal['preferredPaymentMethod']=='',minimal
    panel.locator('tbody tr').filter(has_text='Conta a pagar').click()
    panel.get_by_role('button',name='Pagar',exact=True).click()
    payment=page.get_by_role('dialog',name='Pagar conta',exact=True)
    expect(payment.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('')
    expect(payment.get_by_role('button',name='Confirmar pagamento',exact=True)).to_be_disabled()
    payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Pix')
    payment.get_by_label('Valor a pagar',exact=True).fill('12')
    payment.get_by_role('button',name='Confirmar pagamento',exact=True).click()
    payment.wait_for(state='detached')
    account=page.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.amount===30)")
    assert account['balance']==18 and account['paidAmount']==12,account
    print('PASS amount-only account, explicit payment choice and partial remaining amount')
    page.set_viewport_size({'width':1024,'height':600})
    panel.locator('tbody tr').filter(has_text='Distribuidora Central').click()
    panel.get_by_role('button',name='Alterar',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    footer=editor.locator('.modal-actions').bounding_box()
    assert footer['y']>=0 and footer['y']+footer['height']<=600,footer
    form_box=editor.bounding_box(); window_box=page.locator('.module-window-shell').bounding_box()
    assert form_box['y']>=window_box['y']+7 and form_box['y']+form_box['height']<=window_box['y']+window_box['height']-7,(form_box,window_box)
    page.screenshot(path=str(out/'small-screen.png'))
    assert not errors,errors
    print('PASS smaller window and no renderer errors')
    browser.close()
