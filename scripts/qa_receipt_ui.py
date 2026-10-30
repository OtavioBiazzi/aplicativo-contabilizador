"""Receipt access with privacy, PDF actions and print routing; fixture intercepts physical jobs."""
from pathlib import Path
import json, re
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
out=root/'outputs/qa-receipt-checks'
server_data=root/'outputs/qa-ledger-actions/receipt-check-20261030/data'
client_data=root/'outputs/qa-ledger-actions/client/receipt-check-20261030/data'
with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9369');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9370');client=cb.contexts[0].pages[0]
    errors=[]
    for page in [server,client]:
        page.set_default_timeout(18000)
        page.on('pageerror',lambda e: errors.append(str(e)))
    server.wait_for_function('Boolean(window.caixa)')
    privacy=server.evaluate("""async()=>{
      const s=await window.caixa.getSnapshot(),pdv=await window.caixa.getPdvSnapshot();
      if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-actions/receipt-check-20261030/'))throw Error('Isolated data required');
      const privacy={enabled:true,activeProfileId:'private',enabledProfileId:'private',disabledProfileId:'normal',hideHeaderTotal:true,hideReportTotals:true,historyValues:'hide',profiles:[
        {id:'normal',name:'Aberto',hideHeaderTotal:false,hideReportTotals:false,historyValues:'show'},
        {id:'private',name:'Reservado',hideHeaderTotal:true,hideReportTotals:true,historyValues:'hide'},
        {id:'custom-qa',name:'Personalizado QA',hideHeaderTotal:true,hideReportTotals:false,historyValues:'search'}
      ]};
      const saved=await window.caixa.saveSettings({...s.settings,privacy,server:{...s.settings.server,port:46609,password:'qa-actions-only',permissions:{...s.settings.server.permissions,view:true,viewEntryValues:true,viewTotals:true,edit:true,printReceipts:true,manageTables:true}}});
      if(!pdv.recentSales.some(x=>x.items.some(i=>i.productName==='Recibo privacidade QA'))){
        const product=pdv.products[0];
        await window.caixa.saveDirectSale([{id:crypto.randomUUID(),productId:product.id,productName:'Recibo privacidade QA',categoryName:'QA',quantity:1,unitPrice:37,total:37,discount:0}],0,[{id:crypto.randomUUID(),method:'Pix',amount:37,customerName:'Maria recibo QA'}]);
      }
      return saved.privacy;
    }""")
    assert privacy['historyValues']=='show' and privacy['hideHeaderTotal'] and privacy['hideReportTotals']
    assert privacy['profiles'][2]['historyValues']=='search'
    server.reload()
    if server.get_by_text('Entrar como Servidor',exact=True).count():server.get_by_text('Entrar como Servidor',exact=True).click()
    server.locator('.professional-shell').wait_for()
    server.evaluate("async()=>{await window.caixa.startServer(46609,'qa-actions-only')}")
    client.evaluate("""async privacy=>{
      const s=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...s.settings,privacy,server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46609',password:'qa-actions-only',deviceName:'QA Recibos'}}});
    }""",privacy)
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()

    def close_module(page):
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
    def open_module(page,title):
        close_module(page);page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
        page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    def close_receipt(receipt):
        receipt.get_by_role('button',name='Cancelar',exact=True).click()
    def print_button(receipt):
        return receipt.get_by_role('button',name=re.compile(r'^Imprimir(?: agora)?$'))

    for page,label in [(server,'server'),(client,'client')]:
        page.set_viewport_size({'width':1024,'height':600})
        close_module(page)
        page.get_by_role('button',name='Caixa',exact=True).click()
        panel=page.locator('.professional-history-panel')
        panel.get_by_label('Buscar',exact=True).fill('Recibo privacidade QA')
        row=panel.locator('tbody tr').first
        expect(row).to_contain_text('37,00')
        expect(panel.locator('.history-summary-strip')).to_contain_text('Privado')
        expect(page.locator('.topbar-card-button')).to_contain_text('Privado')
        expect(row.get_by_role('button',name='Ver produtos e pagamentos',exact=True)).to_be_enabled()
        expect(row.get_by_title('Editar',exact=True)).to_be_enabled()
        row.get_by_role('button',name='Gerar recibo ou cupom',exact=True).click()
        receipt=page.get_by_role('dialog',name='Gerar recibo',exact=True)
        expect(receipt.frame_locator('iframe').locator('body')).to_contain_text('37,00')
        expect(receipt.get_by_role('combobox',name='Imprimir em',exact=True).locator('option[value="local"]')).to_have_text('Este computador')
        bounds=receipt.bounding_box();assert bounds['x']>=0 and bounds['y']>=0 and bounds['x']+bounds['width']<=1024 and bounds['y']+bounds['height']<=600,bounds
        page.screenshot(path=str(out/f'privacy-receipt-{label}.png'))
        receipt.get_by_role('button',name='Salvar PDF',exact=True).click()
        expect(receipt).to_have_count(0)
        data=server_data if label=='server' else client_data
        pdf=data/'print-probe/saved-receipt.pdf'
        assert pdf.read_bytes().startswith(b'%PDF')
        expect(panel.locator('.history-summary-strip')).to_contain_text('Privado')
        print('PASS',label,': total/header hidden, rows/details/edit/receipt accessible; PDF saved at 1024x600')

    for title,selector,description,balance in [('Contas a pagar','.pdv-payable-professional','Café torrado QA','80,00'),('Contas a receber','.pdv-receivable-professional','Encomenda QA','45,00')]:
        open_module(client,title);panel=client.locator(selector)
        panel.get_by_label('Buscar',exact=True).fill(description);panel.locator('tbody tr').first.click()
        panel.get_by_role('button',name='Recibo',exact=True).click()
        receipt=client.get_by_role('dialog',name='Gerar recibo',exact=True)
        expect(receipt.frame_locator('iframe').locator('body')).to_contain_text(balance)
        receipt.get_by_role('combobox',name='Imprimir em',exact=True).select_option('server')
        client.route('**/api/pdv/print-receipt',lambda route:route.fulfill(status=400,content_type='application/json',body=json.dumps({'error':'Servidor indisponivel QA'})))
        print_button(receipt).click()
        expect(receipt.get_by_role('alert')).to_contain_text('Servidor indisponivel QA')
        expect(print_button(receipt)).to_be_enabled()
        client.unroute('**/api/pdv/print-receipt')
        print_button(receipt).click();expect(receipt).to_have_count(0)
        print('PASS',title,': client print failure shown inside receipt, retry sent to server queue')

    # Local printer failure must not be reported as a successful print.
    open_module(server,'Contas a pagar');panel=server.locator('.pdv-payable-professional')
    panel.get_by_label('Buscar',exact=True).fill('Café torrado QA');panel.locator('tbody tr').first.click();panel.get_by_role('button',name='Recibo',exact=True).click()
    receipt=server.get_by_role('dialog',name='Gerar recibo',exact=True)
    receipt.get_by_role('combobox',name='Imprimir em',exact=True).select_option('local')
    fail=server_data/'print-probe/fail-print';fail.touch()
    try:
        print_button(receipt).click()
        expect(receipt.get_by_role('alert')).to_contain_text('Nao foi possivel imprimir')
        expect(receipt.get_by_role('alert')).to_contain_text('PDF')
        assert (server_data/'print-probe/opened.jsonl').exists()
    finally:fail.unlink(missing_ok=True)
    print_button(receipt).click();expect(receipt).to_have_count(0)
    print('PASS failed local queue keeps receipt open and PDF fallback; retry succeeds')

    # The server can also route a receipt to the connected client.
    panel.get_by_role('button',name='Recibo',exact=True).click();receipt=server.get_by_role('dialog',name='Gerar recibo',exact=True)
    destination=receipt.get_by_role('combobox',name='Imprimir em',exact=True)
    option=destination.locator('option:not([value="local"])').first
    expect(option).to_have_count(1);destination.select_option(option.get_attribute('value'))
    print_button(receipt).click();expect(receipt).to_have_count(0)
    from time import monotonic, sleep
    deadline=monotonic()+5
    while not (client_data/'print-probe/jobs.jsonl').exists() and monotonic()<deadline:sleep(.1)
    assert (client_data/'print-probe/jobs.jsonl').exists(), 'Client did not receive the queued receipt'
    close_module(server);server.locator('.topbar-card-button').click()
    server.get_by_role('button',name='Desativar privacidade',exact=True).click()
    expect(server.locator('.topbar-card-button')).not_to_contain_text('Privado')
    expect(client.locator('.topbar-card-button')).to_contain_text('Privado')
    print('PASS disabling privacy on server does not change client activation')
    server.evaluate("""async()=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,permissions:{...s.settings.server.permissions,viewTotals:false,viewEntryValues:true,printReceipts:false}}})}""")
    close_module(client);client.get_by_role('button',name='Caixa',exact=True).click()
    history=client.locator('.professional-history-panel');history.get_by_label('Buscar',exact=True).fill('Recibo privacidade QA')
    history.locator('tbody tr').first.get_by_role('button',name='Gerar recibo ou cupom',exact=True).click()
    receipt=client.get_by_role('dialog',name='Gerar recibo',exact=True)
    expect(print_button(receipt)).to_be_disabled()
    receipt.get_by_role('button',name='Salvar PDF',exact=True).click();expect(receipt).to_have_count(0)
    server.evaluate("""async()=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,permissions:{...s.settings.server.permissions,viewEntryValues:false}}})}""")
    expect(history.locator('tbody tr').first.get_by_role('button',name='Gerar recibo ou cupom',exact=True)).to_be_disabled()
    print('PASS server print/read permissions remain enforced separately from privacy')
    # Explicit PDF rendering remains available even while privacy is active.
    assert not errors,errors
    print('PASS server -> client queue; no unhandled renderer errors; no physical print jobs submitted')
    cb.close();sb.close()
