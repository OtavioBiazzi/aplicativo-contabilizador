"""Finance tab geometry and client access against isolated Electron fixtures."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path(__file__).resolve().parents[1] / 'outputs/qa-finance-frame'
out.mkdir(parents=True, exist_ok=True)

def open_module(page, name):
    if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
    if page.locator('.module-window-close').count():
        page.locator('.module-window-close').click()
        page.locator('.module-window-shell').wait_for(state='detached')
    page.get_by_role('button', name='Abrir Menu Gerencial', exact=True).click()
    page.locator('.managerial-menu').get_by_text(name, exact=True).click()

with sync_playwright() as p:
    sb = p.chromium.connect_over_cdp('http://127.0.0.1:9363')
    server = sb.contexts[0].pages[0]
    server.set_default_timeout(15000)
    errors = []
    server.on('pageerror', lambda error: errors.append(str(error)))
    server.wait_for_function('Boolean(window.caixa)')
    server.evaluate("""async () => {
        const pdv = await window.caixa.getPdvSnapshot();
        if (!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-finance-frame/server/')) throw Error('Isolated QA data required');
        if (localStorage.getItem('qa.frame')) return;
        const s = await window.caixa.getSnapshot();
        await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,server:{...s.settings.server,port:46585,password:'qa-frame-only',permissions:{...s.settings.server.permissions,manageProducts:true,manageTables:true,edit:true,delete:true,allowClientCustomization:false},autoConnection:{...s.settings.server.autoConnection,mode:'none'}}});
        for(let n=1;n<=27;n++) await window.caixa.savePdvPayable({supplier:'QA Fornecedor',description:`Conta ${String(n).padStart(2,'0')}`,amount:10,dueDate:''});
        const c = await window.caixa.savePdvCustomer({name:'QA Cliente',active:true});
        for (const amount of [20,30]) await window.caixa.savePdvReceivable({customerId:c.id,description:`Receber ${amount}`,amount});
        await window.caixa.savePdvCategory({name:'QA Categoria',sortOrder:0});
        localStorage.setItem('qa.frame','1');
    }""")
    server.reload()
    if server.get_by_text('Entrar como Servidor', exact=True).count():
        server.get_by_text('Entrar como Servidor', exact=True).click()
    server.locator('.professional-shell').wait_for()
    for width, height in [(1280,720),(1024,600)]:
        server.set_viewport_size({'width':width,'height':height})
        for title, selector, group in [('Contas a pagar','.pdv-payable-professional','Por fornecedor'),('Contas a receber','.pdv-receivable-professional','Por cliente')]:
            open_module(server,title)
            panel=server.locator(selector)
            panel.locator('tbody tr').first.click()
            geometry=[]
            for tab in ['Pesquisa',group,'Registro']:
                panel.get_by_role('tab',name=tab,exact=True).click()
                geometry.append(panel.evaluate("""e => ['.finance-command-bar','.finance-view-row','.simple-financial-filters'].map(s=>{const r=e.querySelector(s).getBoundingClientRect();return [r.y,r.height]})"""))
                expect(panel.get_by_role('button',name='Novo',exact=True)).to_be_visible()
                if tab==group:
                    expect(panel.get_by_role('combobox',name='Período das contas',exact=True)).to_be_disabled()
                server.screenshot(path=str(out/f'{width}-{title}-{tab}.png'))
            assert geometry[0]==geometry[1]==geometry[2],(title,width,geometry)
            panel.get_by_role('tab',name='Pesquisa',exact=True).click()
            assert not panel.get_by_text('Totais do filtro',exact=False).count()
            assert not panel.get_by_label('Linhas por página',exact=True).count()
            totals=panel.locator('.finance-grid-totals')
            assert totals.evaluate('(e)=>getComputedStyle(e).textAlign')=='right'
            header=panel.locator('thead th').last
            assert header.inner_text().strip() in ['Falta pagar','Saldo'],header.inner_text()
            if title=='Contas a pagar':
                expect(panel.locator('tbody tr')).to_have_count(25)
                panel.get_by_role('button',name='Próxima página',exact=True).click()
                expect(panel.locator('tbody tr')).to_have_count(2)
                panel.get_by_role('button',name='Página anterior',exact=True).click()
            else:
                expect(panel.locator('.finance-pagination')).to_have_count(0)
            # Choosing custom dates also keeps the frame stable across tabs.
            panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('custom')
            bounds=panel.locator('.simple-financial-filters').bounding_box()
            panel.get_by_role('tab',name=group,exact=True).click()
            assert panel.locator('.simple-financial-filters').bounding_box()==bounds
            panel.get_by_role('tab',name='Pesquisa',exact=True).click()
            panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('month')
    print('PASS stable finance headers at 1280/1024, custom periods, right-aligned values and pagination')
    for title,selector,group,verb,balance in [('Contas a pagar','.pdv-payable-professional','Por fornecedor','Pagar',255),('Contas a receber','.pdv-receivable-professional','Por cliente','Receber',35)]:
        open_module(server,title)
        panel=server.locator(selector)
        panel.get_by_role('tab',name=group,exact=True).click()
        panel.locator('tbody tr').first.click()
        expect(panel.get_by_role('button',name='Alterar',exact=True)).to_be_disabled()
        before=server.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].filter(a=>a.balance>0&&!['Cancelada','Excluida'].includes(a.status)).reduce((sum,a)=>sum+a.balance,0)",'payables' if verb=='Pagar' else 'receivables')
        balance=before-15
        panel.get_by_role('button',name=verb,exact=True).click()
        payment=server.get_by_role('dialog',name=verb+' conta',exact=True)
        payment.get_by_role('combobox',name='Forma de pagamento',exact=True).select_option('Pix')
        payment.get_by_label('Valor a pagar' if verb=='Pagar' else 'Valor a receber',exact=True).fill('15')
        payment.get_by_role('button',name='Confirmar pagamento' if verb=='Pagar' else 'Confirmar recebimento',exact=True).click()
        payment.wait_for(state='detached')
        expect(panel.locator('tbody tr').first).to_contain_text(f'{balance},00')
    print('PASS grouped supplier/customer payment from the shared toolbar')
    server.evaluate("async()=>await window.caixa.startServer(46585,'qa-frame-only')")
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9364')
    client=cb.contexts[0].pages[0]
    client.set_default_timeout(15000)
    client.on('pageerror',lambda error:errors.append(str(error)))
    client.wait_for_function('Boolean(window.caixa)')
    client.evaluate("""async()=>{
        const pdv=await window.caixa.getPdvSnapshot();
        if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-finance-frame/client/'))throw Error('Isolated client required');
        const s=await window.caixa.getSnapshot();
        await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46585',password:'qa-frame-only',deviceName:'QA Acesso'}}});
    }""")
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    server.evaluate("async()=>{for(const p of (await window.caixa.getPdvSnapshot()).products.filter(p=>p.name==='QA Produto do cliente'))await window.caixa.removePdvProduct(p.id)}")
    open_module(client,'Produtos')
    client.get_by_role('button',name='Novo produto',exact=True).click()
    client.get_by_label('Nome do produto',exact=True).fill('QA Produto do cliente')
    client.get_by_role('combobox',name='Categoria',exact=True).select_option(label='QA Categoria')
    client.get_by_label('Preco de venda',exact=True).fill('12')
    client.get_by_role('button',name='Salvar produto',exact=True).click()
    expect(client.get_by_role('heading',name='Novo produto',exact=True)).to_have_count(0)
    assert server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.some(p=>p.name==='QA Produto do cliente')")
    print('PASS client product creation with manageProducts enabled and server customization disabled')
    open_module(client,'Contas a pagar')
    client.locator('.pdv-payable-professional').get_by_role('button',name='Novo',exact=True).click()
    editor=client.locator('.simple-payable-editor')
    editor.get_by_label('Valor *',exact=True).fill('17')
    editor.get_by_label('Documento',exact=True).fill('CLIENTE-17')
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    assert server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).payables.some(a=>a.documentNumber==='CLIENTE-17')")
    open_module(client,'Contas a receber')
    expect(client.locator('.pdv-receivable-professional').get_by_role('button',name='Novo',exact=True)).to_be_enabled()
    print('PASS remote payable creation and receivable access')
    open_module(client,'Produtos')
    row=client.locator('.pdv-product-table article').filter(has_text='QA Produto do cliente')
    row.get_by_title('Editar produto',exact=True).click()
    client.get_by_label('Preco de venda',exact=True).fill('14')
    client.get_by_role('button',name='Salvar produto',exact=True).click()
    expect(client.get_by_role('heading',name='Editar produto',exact=True)).to_have_count(0)
    assert server.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.find(p=>p.name==='QA Produto do cliente').price")==14
    open_module(server,'Rede')
    server.get_by_role('button',name='Permissoes',exact=True).click()
    server.get_by_label('Criar, editar e excluir produtos e categorias',exact=True).uncheck()
    server.get_by_label('Gerenciar mesas, clientes e contas a pagar/receber',exact=True).uncheck()
    server.get_by_role('button',name='Salvar permissoes',exact=True).click()
    expect(client.get_by_role('button',name='Novo produto',exact=True)).to_have_count(0)
    open_module(client,'Contas a receber')
    expect(client.locator('.pdv-receivable-professional').get_by_role('button',name='Novo',exact=True)).to_be_disabled()
    open_module(client,'Contas a pagar')
    expect(client.locator('.pdv-payable-professional').get_by_role('button',name='Novo',exact=True)).to_be_disabled()
    server.get_by_role('button',name='Liberar acesso completo',exact=True).click()
    for box in server.locator('.permission-grid input[type=checkbox]').all():expect(box).to_be_checked()
    server.get_by_role('button',name='Salvar permissoes',exact=True).click()
    expect(client.locator('.pdv-payable-professional').get_by_role('button',name='Novo',exact=True)).to_be_enabled()
    open_module(client,'Produtos')
    expect(client.get_by_role('button',name='Novo produto',exact=True)).to_be_visible()
    assert all(server.evaluate("async()=>(await window.caixa.getSnapshot()).settings.server.permissions").values())
    print('PASS client product edit, live permission revocation and full-access preset')
    for title,selector,status in [('Contas a pagar','.pdv-payable-professional','Em aberto'),('Contas a receber','.pdv-receivable-professional','Pendentes')]:
        open_module(server,title)
        panel=server.locator(selector)
        panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('custom')
        dates=panel.locator('.simple-financial-date-row input[type=date]')
        dates.nth(0).fill('2000-01-01');dates.nth(1).fill('2000-01-01')
        expect(panel.locator('tbody tr')).to_have_count(0)
        panel.get_by_role('button',name='Ver todas em aberto',exact=True).click()
        expect(panel.locator('.simple-financial-filter-row select').first).to_have_value(status)
        expect(panel.locator('tbody tr').first).to_be_visible()
        expect(panel.get_by_role('combobox',name='Período das contas',exact=True)).to_have_value('all')
    print('PASS inline pending-account shortcut clears dates and retains open-only status')
    assert not errors,errors
    cb.close();sb.close()
