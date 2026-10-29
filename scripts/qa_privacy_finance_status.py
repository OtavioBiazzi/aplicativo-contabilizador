"""Independent privacy activation with server definitions; status checkboxes and table history."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
out=Path(__file__).resolve().parents[1]/'outputs/qa-ledger-layout'
with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9367');server=sb.contexts[0].pages[0];server.set_default_timeout(15000)
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9368');client=cb.contexts[0].pages[0];client.set_default_timeout(20000)
    errors=[]
    for page in [server,client]:page.on('pageerror',lambda e:errors.append(str(e)))
    server.evaluate("""async()=>{
      const pdv=await window.caixa.getPdvSnapshot(); if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-layout/'))throw Error('Isolated data required');
      const s=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,privacy:{hideHeaderTotal:false,hideReportTotals:false},server:{...s.settings.server,port:46607,password:'qa-privacy-only',permissions:{...s.settings.server.permissions,manageProducts:true,manageTables:true,edit:true,viewTotals:true,viewEntryValues:true,allowClientCustomization:false}}});
      if(!localStorage.getItem('qa.privacy.seed')){
        await window.caixa.addEntry({type:'Mesa',value:17,description:'Privacidade QA',tableNumber:'1',people:1,paymentMethod:'Pix'});
        const paid=await window.caixa.savePdvPayable({description:'Conta quitada QA',amount:25});
        await window.caixa.payPdvPayable(paid.id,{id:crypto.randomUUID(),payableId:paid.id,createdAt:new Date().toISOString(),method:'Pix',amount:25},crypto.randomUUID());
        const cancel=await window.caixa.savePdvPayable({description:'Conta cancelada QA',amount:25});await window.caixa.cancelPdvPayable(cancel.id);
        localStorage.setItem('qa.privacy.seed','1');
      }
    }""")
    server.evaluate("""async()=>{
      const snap=await window.caixa.getPdvSnapshot();
      if(!snap.receivables.some(r=>r.description==='Recebida QA')){
        const c=snap.customers.find(c=>c.name==='Maria Oliveira');
        const a=await window.caixa.savePdvReceivable({customerId:c.id,description:'Recebida QA',amount:20});
        await window.caixa.receivePdvReceivable(a.id,{id:crypto.randomUUID(),receivableId:a.id,createdAt:new Date().toISOString(),method:'Pix',amount:20},crypto.randomUUID());
      }
    }""")
    server.reload()
    if server.get_by_text('Entrar como Servidor',exact=True).count():server.get_by_text('Entrar como Servidor',exact=True).click()
    def open_module(page,title):
        if page.locator('.module-window-close').count():page.locator('.module-window-close').click();page.locator('.module-window-shell').wait_for(state='detached')
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    open_module(server,'Contas a pagar');panel=server.locator('.pdv-payable-professional')
    pending=panel.get_by_role('checkbox',name='A pagar',exact=True);paid=panel.get_by_role('checkbox',name='Pagas',exact=True)
    expect(pending).to_be_checked();expect(paid).not_to_be_checked()
    paid.check();expect(panel.locator('tbody')).to_contain_text('Conta quitada QA');expect(panel.locator('tbody')).not_to_contain_text('Conta cancelada QA')
    pending.uncheck();expect(panel.locator('tbody tr')).to_have_count(server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).payables.filter(a=>a.status==='Paga').length"))
    paid.uncheck();expect(panel.locator('tbody tr')).to_have_count(0)
    pending.check();expect(panel.locator('tbody')).not_to_contain_text('Conta quitada QA')
    server.screenshot(path=str(out/'pagar-checkboxes.png'))
    print('PASS payable checkbox combinations: pending, both, paid, none; cancelled excluded')
    open_module(server,'Contas a receber');rp=server.locator('.pdv-receivable-professional')
    pending=rp.get_by_role('checkbox',name='A receber',exact=True);received=rp.get_by_role('checkbox',name='Recebidas',exact=True)
    expect(pending).to_be_checked();received.check();expect(rp.locator('tbody')).to_contain_text('Recebida QA')
    pending.uncheck();expect(rp.locator('tbody tr')).to_have_count(server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).receivables.filter(a=>a.status==='Recebida').length"))
    received.uncheck();expect(rp.locator('tbody tr')).to_have_count(0)
    pending.check();expect(rp.locator('tbody')).not_to_contain_text('Recebida QA')
    print('PASS receivable checkbox combinations: pending, both, received, none')
    open_module(server,'Privacidade');profiles=server.locator('.privacy-profiles')
    profiles.get_by_role('button',name='Novo',exact=True).click()
    profiles.get_by_label('Nome do perfil',exact=True).fill('Consulta QA')
    profiles.get_by_role('combobox',name='Valores no Caixa / Histórico',exact=True).select_option('search')
    profiles.get_by_label('Ocultar Total do Dia',exact=True).check()
    profiles.get_by_role('button',name='Duplicar',exact=True).click()
    expect(profiles.get_by_label('Nome do perfil',exact=True)).to_have_value('Consulta QA (cópia)')
    profiles.get_by_role('button',name='Excluir',exact=True).click()
    profiles.get_by_role('combobox',name='Perfil para editar',exact=True).select_option(label='Consulta QA')
    profiles.get_by_role('combobox',name='Ao ativar privacidade no Total do Dia',exact=True).select_option(label='Consulta QA')
    server.wait_for_function("async()=>{const p=(await window.caixa.getSnapshot()).settings.privacy;return p.profiles?.some(x=>x.name==='Consulta QA'&&x.historyValues==='search'&&x.id===p.enabledProfileId)}")
    server.screenshot(path=str(out/'privacidade-perfis.png'))
    server.locator('.module-window-close').click()
    def toggle(page,enable):
        page.locator('.topbar-card-button').click();page.get_by_role('button',name='Ativar privacidade' if enable else 'Desativar privacidade',exact=True).click()
    toggle(server,True);expect(server.locator('.topbar-card-button')).to_contain_text('Privado')
    server.get_by_role('button',name='Caixa',exact=True).click();history=server.locator('.professional-history-panel')
    history.get_by_label('Buscar',exact=True).fill('');history.get_by_label('Mesa exata',exact=True).fill('')
    expect(history.locator('tbody')).to_contain_text('Privado')
    history.get_by_label('Buscar',exact=True).fill('Privacidade QA');expect(history.locator('tbody')).to_contain_text('17,00')
    history.get_by_label('Buscar',exact=True).fill('');expect(history.locator('tbody')).to_contain_text('Privado')
    server.locator('.module-window-close').click();toggle(server,False)
    # Server definitions are identical on the client; activation stays local.
    await_start=server.evaluate("async()=>await window.caixa.startServer(46607,'qa-privacy-only')")
    client.evaluate("""async()=>{
      const snap=await window.caixa.getPdvSnapshot();if(!snap.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-layout/client/'))throw Error('Isolated client required');
      const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,privacy:{hideHeaderTotal:false,hideReportTotals:false},server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46607',password:'qa-privacy-only',deviceName:'QA Privacidade'}}});
    }""")
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    client.wait_for_function("async()=>(await window.caixa.getSnapshot()).settings.privacy.profiles?.some(p=>p.name==='Consulta QA')")
    toggle(server,True)
    expect(server.locator('.topbar-card-button')).to_contain_text('Privado');expect(client.locator('.topbar-card-button')).not_to_contain_text('Privado')
    toggle(client,True);expect(client.locator('.topbar-card-button')).to_contain_text('Privado')
    toggle(server,False);expect(client.locator('.topbar-card-button')).to_contain_text('Privado')
    open_module(client,'Privacidade');client_profiles=client.locator('.privacy-profiles')
    client_profiles.get_by_role('combobox',name='Perfil para editar',exact=True).select_option(label='Consulta QA')
    expect(client_profiles.get_by_label('Nome do perfil',exact=True)).to_be_disabled()
    expect(client_profiles.get_by_role('combobox',name='Valores no Caixa / Histórico',exact=True)).to_have_value('search')
    open_module(server,'Privacidade');profiles=server.locator('.privacy-profiles')
    profiles.get_by_role('combobox',name='Perfil para editar',exact=True).select_option(label='Consulta QA')
    profiles.get_by_label('Nome do perfil',exact=True).fill('Consulta atualizada QA')
    client.wait_for_function("async()=>(await window.caixa.getSnapshot()).settings.privacy.profiles?.some(p=>p.name==='Consulta atualizada QA')")
    expect(client.locator('.topbar-card-button')).to_contain_text('Privado')
    print('PASS server profile CRUD/search behavior; shared definitions update live; server/client activation is independent')
    open_module(client,'Produtos');catalog=client.locator('.catalog-workspace')
    catalog.get_by_role('button',name='Novo',exact=True).click();editor=catalog.locator('.catalog-inline-editor')
    editor.get_by_label('Nome do produto',exact=True).fill('QA produto do cliente')
    editor.get_by_label('Preco de venda',exact=True).fill('12')
    editor.get_by_role('button',name='Salvar produto',exact=True).click();expect(editor).to_have_count(0)
    assert server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.some(p=>p.name==='QA produto do cliente'&&p.price===12)")
    print('PASS client product registration with manageProducts enabled and customization disabled')
    open_module(server,'Visao geral');server.screenshot(path=str(out/'visao-geral.png'))
    server.locator('.module-window-close').click()
    # Context history always starts on today and selected exact table.
    card=server.locator('.pdv-table-card').filter(has=server.locator(':scope > strong',has_text='001')).first
    card.click(button='right');server.get_by_role('button',name='Marcar fechamento',exact=True).click()
    expect(card).to_have_class(__import__('re').compile('fechamento'))
    assert card.evaluate('(e)=>getComputedStyle(e).backgroundColor') in ['rgb(22, 128, 75)','rgb(27, 145, 87)']
    server.screenshot(path=str(out/'mesa-fechamento-verde.png'))
    card.click(button='right');server.get_by_role('button',name='Ver historico da mesa',exact=True).click()
    history=server.locator('.professional-history-panel');today=server.evaluate("()=>new Date().toLocaleDateString('sv-SE')")
    expect(history.get_by_label('De',exact=True)).to_have_value(today);expect(history.get_by_label('Ate',exact=True)).to_have_value(today);expect(history.get_by_label('Mesa exata',exact=True)).to_have_value('1')
    print('PASS right-click marks empty table green and opens exact table history with today dates')
    assert not errors,errors
    cb.close();sb.close()
