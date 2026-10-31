"""End-to-end refinements on isolated Electron server/client, 31 Oct 2026."""
from pathlib import Path
from time import time_ns, monotonic, sleep
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
out=root/'outputs/qa-operations-20261031'
with sync_playwright() as p:
    for port in [9387,9388]:
        deadline=monotonic()+20
        while True:
            try:
                if 'webSocketDebuggerUrl' in urlopen('http://127.0.0.1:'+str(port)+'/json/list',timeout=1).read().decode():break
            except Exception:
                if monotonic()>deadline:raise
            sleep(.1)
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9387');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9388');client=cb.contexts[0].pages[0]
    errors=[]
    for page in [server,client]:
        page.set_default_timeout(18000);page.set_viewport_size({'width':1024,'height':700})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.wait_for_function('Boolean(window.caixa)')
        assert '/outputs/qa-operations-20261031/' in page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).dataFile').replace('\\','/')
    server.evaluate("""async()=>{
      const s=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,privacy:{hideHeaderTotal:false,hideReportTotals:false,historyValues:'show'},server:{...s.settings.server,port:46631,password:'qa-operations-only',autoConnection:{...s.settings.server.autoConnection,mode:'none'},permissions:{...s.settings.server.permissions,view:true,viewEntryValues:true,viewTotals:true,create:true,edit:true,manageTables:true,manageProducts:true,allowClientCustomization:false}}});
      await window.caixa.savePdvSettings({cashControlMode:'automatic',frequentCategoryEnabled:false});
      if(localStorage.getItem('qa.ops.seed'))return;
      const cat=await window.caixa.savePdvCategory({name:'Café QA',active:true,favorite:false,sortOrder:0});
      const coffee=await window.caixa.savePdvProduct({name:'Café frequente QA',categoryId:cat.id,price:30,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true,favorite:false,canBeComplement:false,hasComplements:false,complementProductIds:[],sortOrder:0,trackStock:true,stockQuantity:100,sku:'QA-COFFEE',barcode:'QA123'});
      const other=await window.caixa.savePdvProduct({name:'Outro produto QA',categoryId:cat.id,price:10,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true,favorite:false,canBeComplement:false,hasComplements:false,complementProductIds:[],sortOrder:1,trackStock:false});
      const item=(p,q)=>({id:crypto.randomUUID(),productId:p.id,productName:p.name,categoryName:'Café QA',quantity:q,unitPrice:p.price,total:p.price*q,discount:0});
      await window.caixa.openPdvTable(1,1);await window.caixa.savePdvTableItems(1,[item(coffee,2)],[],[]);
      const sale=await window.caixa.closePdvTable(1,[{id:crypto.randomUUID(),method:'Credito',amount:30,description:'Credito',customerName:'Operacao QA'},{id:crypto.randomUUID(),method:'Debito',amount:30}]);
      localStorage.setItem('qa.ops.sale',sale.id);
      await window.caixa.saveDirectSale([item(other,1)],0,[{id:crypto.randomUUID(),method:'Pix',amount:10}]);
      await window.caixa.openPdvTable(3,2);await window.caixa.savePdvTableItems(3,[item(other,2)],[],[]);
      await window.caixa.savePdvFinancialLookup({id:crypto.randomUUID(),kind:'category',name:'Fornecedores'});
      await window.caixa.savePdvFinancialLookup({id:crypto.randomUUID(),kind:'category',name:'Foncedores'});
      await window.caixa.savePdvFinancialLookup({id:crypto.randomUUID(),kind:'costCenter',name:'Loja'});
      const customer=await window.caixa.savePdvCustomer({name:'Cliente recebimento QA',active:true});
      await window.caixa.savePdvReceivable({customerId:customer.id,description:'Recebimento data QA',amount:60});
      localStorage.setItem('qa.ops.seed','1');
    }""")
    server.reload()
    if server.get_by_text('Entrar como Servidor',exact=True).count():server.get_by_text('Entrar como Servidor',exact=True).click()
    server.locator('.professional-shell').wait_for()
    server.evaluate("()=>window.caixa.startServer(46631,'qa-operations-only')")
    client.evaluate("""async()=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,privacy:{hideHeaderTotal:false,hideReportTotals:false,historyValues:'show'},server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46631',password:'qa-operations-only',deviceName:'QA Operations'}}})}""")
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    def dismiss(page):
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
    def module(page,title):
        dismiss(page)
        if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
        page.locator('.managerial-menu').get_by_text(title,exact=True).click()

    # Current-day forecast: completed 60 + 10, open 20.
    client.locator('.topbar-card-button').click();client.get_by_role('button',name='Mesas em aberto',exact=True).click()
    summary=client.get_by_role('dialog',name='Mesas em aberto',exact=True)
    expect(summary.locator('.open-tables-total')).to_contain_text('20,00')
    expect(summary.locator('.open-tables-projection')).to_contain_text('70,00')
    expect(summary.locator('.open-tables-projection')).to_contain_text('90,00')
    summary.get_by_role('button',name='Fechar',exact=True).click()
    print('PASS forecast includes completed 70 + open 20 = 90 on connected client')

    suffix=str(time_ns())[-6:];person='Pessoa fornecedor UI '+suffix
    module(client,'Clientes');panel=client.locator('.pdv-customer-professional')
    panel.get_by_role('button',name='Novo',exact=True).click();editor=panel.locator('.catalog-inline-editor')
    editor.get_by_label('Nome *',exact=True).fill(person)
    editor.get_by_role('combobox',name='Tipo de cadastro',exact=True).select_option('both')
    editor.get_by_role('button',name='Salvar cliente',exact=True).click();expect(editor).to_have_count(0)
    contact=server.evaluate("async name=>(await window.caixa.getPdvSnapshot()).customers.find(c=>c.name===name)",person)
    assert contact['role']=='both'
    assert server.evaluate("async id=>(await window.caixa.getPdvSnapshot()).suppliers.some(s=>s.customerId===id)",contact['id'])
    print('PASS client contact classification creates supplier on server')

    module(client,'Contas a pagar');panel=client.locator('.pdv-payable-professional')
    panel.get_by_role('button',name='Novo',exact=True).click();editor=panel.locator('.financial-inline-editor')
    editor.get_by_label('Valor *',exact=True).fill('120')
    editor.get_by_role('combobox',name='Fornecedor',exact=True).select_option(label=person)
    category=editor.get_by_role('combobox',name='Categoria',exact=True)
    editor.get_by_role('combobox',name='Fornecedor',exact=True).focus();client.keyboard.press('Tab');expect(category).to_be_focused()
    category.press_sequentially('for',delay=100);expect(category).to_have_value('Fornecedores')
    client.wait_for_timeout(1000);category.press_sequentially('fon',delay=100);expect(category).to_have_value('Foncedores')
    client.keyboard.press('Tab');expect(editor.get_by_role('combobox',name='Centro de custo',exact=True)).to_be_focused()
    category.focus();client.keyboard.press('F2')
    lookup=client.get_by_role('dialog',name='Categorias',exact=True);expect(lookup).to_be_visible()
    lookup.get_by_role('button',name='Fechar categorias',exact=True).click()
    editor.get_by_label('Documento',exact=True).fill('DOC-'+suffix)
    description='Conta UI datas '+suffix;editor.get_by_label('Descrição',exact=True).fill(description)
    editor.get_by_role('button',name='Salvar conta',exact=True).click();expect(editor).to_have_count(0)
    panel.get_by_label('Buscar',exact=True).fill(description);panel.locator('tbody tr').first.click()
    panel.get_by_role('button',name='Pagar',exact=True).click()
    payment=client.get_by_role('dialog',name='Pagar conta',exact=True)
    expect(payment.get_by_label('Data e hora do pagamento',exact=True)).not_to_have_value('')
    payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Pix')
    payment.get_by_label('Valor a pagar',exact=True).fill('40')
    chosen='2026-10-21T11:15';payment.get_by_label('Data e hora do pagamento',exact=True).fill(chosen)
    client.screenshot(path=str(out/'dated-payment-client.png'))
    payment.get_by_role('button',name='Confirmar pagamento',exact=True).click();expect(payment).to_have_count(0)
    saved=server.evaluate("async description=>(await window.caixa.getPdvSnapshot()).payables.find(a=>a.description===description)",description)
    assert saved['balance']==80 and saved['category']=='Foncedores'
    assert saved['payments'][0]['createdAt']==client.evaluate('value=>new Date(value).toISOString()',chosen)
    print('PASS type-ahead reset, Tab skips helpers, F2 registration and backdated client payment')

    module(client,'Contas a receber');panel=client.locator('.pdv-receivable-professional')
    panel.get_by_label('Buscar',exact=True).fill('Recebimento data QA');panel.locator('tbody tr').first.click()
    panel.get_by_role('button',name='Receber',exact=True).click();payment=client.get_by_role('dialog',name='Receber conta',exact=True)
    payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Dinheiro')
    payment.get_by_label('Valor a receber',exact=True).fill('15');payment.get_by_label('Dinheiro entregue pelo cliente',exact=True).fill('20')
    payment.get_by_label('Data e hora do pagamento',exact=True).fill(chosen)
    payment.get_by_role('button',name='Confirmar recebimento',exact=True).click();expect(payment).to_have_count(0)
    received=server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).receivables.find(a=>a.description==='Recebimento data QA')")
    assert received['balance']==45 and received['payments'][-1]['change']==5
    assert received['payments'][-1]['createdAt']==client.evaluate('value=>new Date(value).toISOString()',chosen)
    print('PASS dated receivable with cash/change through client')

    module(client,'Produtos');panel=client.locator('.catalog-workspace')
    panel.get_by_label('Habilitar aba FREQUENTE',exact=True).check()
    server.wait_for_function("async()=>(await window.caixa.getPdvSnapshot()).settings.frequentCategoryEnabled===true")
    panel.get_by_label('Buscar cadastro',exact=True).fill('Café frequente QA');panel.locator('tbody tr').first.click()
    count=server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.length")
    panel.get_by_role('button',name='Duplicar',exact=True).click();editor=panel.locator('.catalog-inline-editor')
    expect(editor.get_by_label('Nome do produto',exact=True)).to_have_value('Café frequente QA (cópia)')
    editor.get_by_role('button',name='Estoque e codigos',exact=True).click()
    expect(editor.get_by_label('Codigo interno (SKU)',exact=True)).to_have_value('')
    expect(editor.get_by_label('Codigo de barras',exact=True)).to_have_value('')
    expect(editor.get_by_label('Quantidade atual',exact=True)).to_have_value('0')
    editor.get_by_role('button',name='Cancelar',exact=True).click()
    assert server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.length")==count
    panel.get_by_role('button',name='Duplicar',exact=True).click();editor=panel.locator('.catalog-inline-editor')
    copy='Copia produto UI '+suffix;editor.get_by_label('Nome do produto',exact=True).fill(copy)
    editor.get_by_role('button',name='Salvar produto',exact=True).click();expect(editor).to_have_count(0)
    copied=server.evaluate("async name=>(await window.caixa.getPdvSnapshot()).products.find(p=>p.name===name)",copy)
    assert copied and copied['stockQuantity']==0 and copied['sku']=='' and copied['barcode']==''
    dismiss(client);client.locator('.module-window-close').click();client.get_by_role('button',name='Venda',exact=True).click()
    categories=client.locator('.pdv-category-grid');expect(categories.locator('button').last).to_have_text('FREQUENTE')
    categories.get_by_role('button',name='FREQUENTE',exact=True).click()
    expect(client.locator('.pdv-product-grid')).to_contain_text('Café frequente QA')
    expect(client.locator('.pdv-product-grid')).not_to_contain_text(copy)
    client.screenshot(path=str(out/'frequent-client.png'))
    print('PASS optional FREQUENTE on client with product permission only; duplicate cancel/save without stock or codes')

    client.get_by_role('button',name='Caixa',exact=True).click();history=client.locator('.professional-history-panel')
    history.get_by_label('Buscar',exact=True).fill('Operacao QA')
    history.get_by_role('combobox',name='Pagamento',exact=True).select_option('Credito')
    row=history.locator('tbody tr').first;expect(row).to_contain_text('30,00')
    expect(history.locator('.history-summary-strip')).to_contain_text('30,00')
    button=row.get_by_role('button',name='Ver produtos e pagamentos',exact=True)
    centers=button.evaluate("e=>{const b=e.getBoundingClientRect(),s=e.querySelector('svg').getBoundingClientRect();return [Math.abs(b.x+b.width/2-s.x-s.width/2),Math.abs(b.y+b.height/2-s.y-s.height/2)]}")
    assert max(centers)<1.1,centers
    row.get_by_title('Editar',exact=True).click();editor=client.locator('.entry-editor-modal')
    editor.get_by_label('Mesa',exact=True).fill('016');editor.get_by_role('button',name='Salvar',exact=True).click();expect(editor).to_have_count(0)
    sale_id=server.evaluate("()=>localStorage.getItem('qa.ops.sale')")
    sale=server.evaluate("async id=>(await window.caixa.getPdvSnapshot()).recentSales.find(s=>s.id===id)",sale_id)
    assert sale['tableNumber']==16
    row=history.locator('tbody tr').first;expect(row).to_contain_text('Mesa 16')
    row.get_by_role('button',name='Editar pagamentos',exact=True).click();editor=client.get_by_role('dialog',name='Editar pagamentos',exact=True)
    expect(editor.locator('.simple-history-payments')).to_be_visible();expect(editor.locator('.pdv-payment-methods')).to_have_count(0)
    editor.get_by_role('combobox',name='Forma de pagamento',exact=True).first.select_option('Pix')
    for width,height in [(1280,720),(1024,600)]:
        client.set_viewport_size({'width':width,'height':height})
        box=editor.locator('.simple-history-payments').bounding_box();assert box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width and box['y']+box['height']<=height,box
        client.screenshot(path=str(out/f'history-payments-simple-{width}.png'))
    client.screenshot(path=str(out/'history-payments-simple-client.png'))
    editor.get_by_role('button',name='Salvar pagamentos',exact=True).click();expect(editor).to_have_count(0)
    expect(history.locator('tbody tr')).to_have_count(0)
    history.get_by_role('combobox',name='Pagamento',exact=True).select_option('Pix')
    expect(history.locator('tbody tr').first).to_contain_text('30,00');expect(history.locator('tbody tr').first).to_contain_text('Pix')
    sale=server.evaluate("async id=>(await window.caixa.getPdvSnapshot()).recentSales.find(s=>s.id===id)",sale_id)
    assert sale['total']==60 and {p['method'] for p in sale['payments']}=={'Pix','Debito'}
    assert sale['payments'][0]['description']=='Pix'
    print('PASS exact split-payment sum, centered eye, persisted historical table, compact payment editor and updated description')
    assert not errors,errors
    cb.close();sb.close()
