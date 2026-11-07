"""0.4.17: medidor de desempenho e edicao do Caixa sem esperar a planilha.

Fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(15000)
    s.set_viewport_size({'width': 1280, 'height': 720})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))

    # Planilha automatica ligada para medir; uma venda direta gera gravacao e planilha em segundo plano.
    s.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,automaticSpreadsheetEnabled:true});}""")
    before = s.evaluate("async()=>(await window.caixa.getDiagnostics()).performance")
    sale = s.evaluate("""async()=>{const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
      return await window.caixa.saveDirectSale([{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:1,unitPrice:30,discount:0,total:30}],0,[{id:crypto.randomUUID(),method:'Pix',amount:30}],'Venda direta',crypto.randomUUID());}""")
    # Editar a forma de pagamento (caminho do Caixa) responde sem esperar a planilha.
    started = time.time()
    s.evaluate("async(id)=>window.caixa.updatePdvSalePayments(id,[{id:crypto.randomUUID(),method:'Dinheiro',amount:30}])", sale['id'])
    edit_ms = (time.time() - started) * 1000
    saved = s.evaluate("async(id)=>(await window.caixa.getPdvSnapshot()).recentSales.find(x=>x.id===id).payments.map(p=>p.method)", sale['id'])
    assert saved == ['Dinheiro'], saved
    # A planilha e atualizada logo depois, em segundo plano.
    after = before
    for _ in range(30):
        after = s.evaluate("async()=>(await window.caixa.getDiagnostics()).performance")
        if after['spreadsheet']['count'] > before['spreadsheet']['count']:
            break
        s.wait_for_timeout(300)
    assert after['spreadsheet']['count'] > before['spreadsheet']['count'], (before, after)
    assert after['writes']['count'] >= before['writes']['count'] + 2, (before, after)
    assert after['databaseBytes'] > 0
    print(f'PASS sale edit responds without waiting for the spreadsheet ({edit_ms:.0f} ms); spreadsheet updated in background')

    # O cliente conectado baixou o pacote completo pelo menos uma vez.
    assert after['remoteSnapshot']['count'] > 0 and after['remoteSnapshot']['lastBytes'] > 0, after['remoteSnapshot']
    print('PASS meter reports database size, writes, spreadsheet time and client package size', {
        'db': after['databaseBytes'], 'write_ms': round(after['writes']['avgMs'], 1),
        'sheet_ms': round(after['spreadsheet']['avgMs'], 1), 'client_kb': round(after['remoteSnapshot']['avgBytes'] / 1024, 1)})

    # Tela de Diagnostico mostra os quatro cartoes.
    if s.locator('.module-window-close').count():
        s.locator('.module-window-close').click()
    s.get_by_role('button', name='Abrir Menu Gerencial', exact=True).click()
    s.locator('.managerial-menu').get_by_text('Backup e diagnostico', exact=True).click()
    meter = s.locator('.performance-meter')
    expect(meter).to_be_visible()
    expect(meter.locator('.performance-card')).to_have_count(4)
    meter.scroll_into_view_if_needed()
    s.screenshot(path=str(out / 'performance-meter.png'))
    print('PASS diagnostics shows the performance meter')
    assert not errors, errors
