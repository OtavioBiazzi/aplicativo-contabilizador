"""0.4.23 lembretes de comanda no fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).

Confere: OK dado enquanto o outro computador estava fora tambem some quando ele volta (lista no servidor);
tecla ] ao lado do Enter fecha sem lembrete em nenhum computador; Ctrl configuravel; Enter normal ainda lembra.
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    c = p.chromium.connect_over_cdp('http://127.0.0.1:9402').contexts[0].pages[0]
    errors = []
    for page in [s, c]:
        page.set_default_timeout(12000)
        page.set_viewport_size({'width': 1366, 'height': 768})
        page.on('pageerror', lambda error: errors.append(str(error)))

    def reload(page):
        page.reload()
        label = 'Entrar como Servidor' if page is s else 'Entrar como Cliente'
        try:
            page.get_by_text(label, exact=True).wait_for(timeout=3000)
            page.get_by_text(label, exact=True).click()
        except Exception:
            pass
        page.locator('.professional-shell').wait_for(timeout=20000)
        if page.locator('.module-window-close').count():
            page.locator('.module-window-close').click()

    def prefs(page, **values):
        page.evaluate("""(patch)=>{for(const k of ['caixa.local-tables.server','caixa.local-tables.client']){const v=JSON.parse(localStorage.getItem(k)||'{}');Object.assign(v,patch);localStorage.setItem(k,JSON.stringify(v));localStorage.removeItem(k+'.pending');localStorage.removeItem(k+'.collapsed');}window.dispatchEvent(new Event('local-table-preferences'));}""", values)

    def cards(page):
        return page.locator('.table-close-reminders article')

    coffee = s.evaluate("async()=>JSON.parse(localStorage.getItem('qa.reminder.products')).coffee")

    def open_with_item(number):
        s.evaluate("""async([n,coffee])=>{const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n); if(t&&t.items.length) await window.caixa.cancelPdvTable(n);
          await window.caixa.openPdvTable(n,1);await window.caixa.savePdvTableItems(n,[{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:1,unitPrice:30,discount:0,total:30}],[],[]);}""", [number, coffee])

    def close_on_server(number, key):
        reload(s)
        s.locator('.pdv-table-card').filter(has=s.get_by_text(str(number).zfill(3), exact=True)).click()
        s.get_by_role('button', name='Fechar conta', exact=True).click()
        s.locator('.pdv-close-menu').get_by_role('button', name='Fechar total', exact=False).click()
        receive = s.locator('.pdv-receive-modal')
        receive.get_by_role('button', name='Pix', exact=False).click()
        s.locator('.pdv-payment-amount-modal').get_by_role('button', name='OK', exact=True).click()
        expect(receive.locator('.pdv-checkout-payments article.remaining')).to_have_count(0)
        s.keyboard.press(key)
        if s.locator('.pdv-confirm-modal').count():
            s.keyboard.press(key)
        expect(receive).to_have_count(0)
        if s.locator('.pdv-receipt-preview').count():
            s.locator('.pdv-receipt-preview').get_by_role('button', name='Fechar', exact=True).click()
        return s.evaluate("async(n)=>(await window.caixa.getPdvSnapshot()).recentSales.find(x=>x.tableNumber===n).id", number)

    base = {'reminders': 'always', 'excludedTables': '', 'hideQuickValue': False, 'syncAcknowledge': True, 'visibleLimit': 4, 'reminderSource': 'all'}
    prefs(s, skipReminderKey='bracket', **base)
    prefs(c, skipReminderKey='bracket', **base)
    reload(s); reload(c)

    # 1) OK perdido: o OK foi dado enquanto o cliente estava fora; ao voltar, o lembrete some.
    missed = f'qa-missed-{int(time.time())}'
    s.evaluate("async(id)=>window.caixa.ackTableClosed(id)", missed)
    acks = s.evaluate("async()=>window.caixa.getCloseNoticeAcks()")
    assert missed in acks, acks
    c.evaluate("""(id)=>{for(const k of ['caixa.local-tables.server.pending','caixa.local-tables.client.pending']) localStorage.setItem(k, JSON.stringify([{id, tableNumber: 40, createdAt: new Date().toISOString()}]));}""", missed)
    reload(c)
    c.wait_for_timeout(2500)
    expect(cards(c).filter(has_text='Mesa 40')).to_have_count(0, timeout=8000)
    print('PASS OK given while the other computer was away is applied when it comes back (acks kept on the server)')

    # 2) Enter normal: lembrete nos dois (controle).
    open_with_item(42)
    close_on_server(42, 'Enter')
    expect(s.locator('.table-close-reminders')).to_contain_text('Mesa 42')
    expect(c.locator('.table-close-reminders')).to_contain_text('Mesa 42', timeout=8000)
    s.get_by_role('button', name='Confirmar retirada da comanda da mesa 42', exact=True).click()
    expect(cards(c).filter(has_text='Mesa 42')).to_have_count(0, timeout=8000)
    print('PASS Enter still creates the reminder on both computers; OK removes it on both')

    # 3) Tecla ] ao lado do Enter: fecha sem lembrete em nenhum computador e fica registrado como OK.
    open_with_item(41)
    sale_id = close_on_server(41, ']')
    s.wait_for_timeout(2000)
    expect(cards(s).filter(has_text='Mesa 41')).to_have_count(0)
    expect(cards(c).filter(has_text='Mesa 41')).to_have_count(0)
    assert sale_id in s.evaluate("async()=>window.caixa.getCloseNoticeAcks()")
    print('PASS ] key closes the table with no reminder on any computer and records it as acknowledged')

    # 4) Configuravel: com Ctrl, Ctrl+Enter fecha sem lembrete e ] nao faz nada de especial.
    prefs(s, skipReminderKey='ctrl', **base)
    open_with_item(43)
    close_on_server(43, 'Control+Enter')
    s.wait_for_timeout(2000)
    expect(cards(s).filter(has_text='Mesa 43')).to_have_count(0)
    expect(cards(c).filter(has_text='Mesa 43')).to_have_count(0)
    prefs(s, skipReminderKey='bracket', **base)
    print('PASS configurable key: Ctrl + Enter closes without reminder')

    # 5) "Só nos outros computadores" no cliente: o que ele fecha nao lembra; o que o servidor fecha, lembra.
    prefs(c, skipReminderKey='bracket', **{**base, 'reminderSource': 'others'})
    reload(c)
    open_with_item(45)
    reload(c)
    c.locator('.pdv-table-card').filter(has=c.get_by_text('045', exact=True)).click()
    c.get_by_role('button', name='Fechar conta', exact=True).click()
    c.locator('.pdv-close-menu').get_by_role('button', name='Fechar total', exact=False).click()
    receive = c.locator('.pdv-receive-modal')
    receive.get_by_role('button', name='Pix', exact=False).click()
    c.locator('.pdv-payment-amount-modal').get_by_role('button', name='OK', exact=True).click()
    receive.get_by_role('button', name='Finalizar conta', exact=True).click()
    if c.locator('.pdv-confirm-modal').count():
        c.locator('.pdv-confirm-modal').get_by_role('button', name='Confirmar', exact=False).click()
    expect(receive).to_have_count(0)
    if c.locator('.pdv-receipt-preview').count():
        c.locator('.pdv-receipt-preview').get_by_role('button', name='Fechar', exact=True).click()
    c.wait_for_timeout(2000)
    expect(cards(c).filter(has_text='Mesa 45')).to_have_count(0)
    expect(cards(s).filter(has_text='Mesa 45')).to_have_count(1, timeout=8000)
    open_with_item(46)
    close_on_server(46, 'Enter')
    expect(cards(c).filter(has_text='Mesa 46')).to_have_count(1, timeout=8000)
    print('PASS "only other computers": own close does not remind, the server close does')

    # 6) Tamanho dos lembretes: Compacto e Pequeno diminuem o quadro em 1300x760.
    c.set_viewport_size({'width': 1300, 'height': 760})
    sizes = {}
    for size in ['normal', 'compact', 'small']:
        prefs(c, skipReminderKey='bracket', reminderSize=size, **base)
        reload(c)
        c.evaluate("""()=>{for(let i=0;i<3;i++) window.dispatchEvent(new CustomEvent('table-closed-notice',{detail:{source:'self',notice:{id:'qa-size-'+Date.now()+'-'+i,tableNumber:60+i,createdAt:new Date().toISOString()}}}));}""")
        expect(cards(c)).to_have_count(3)
        box = c.locator('.table-close-reminders').bounding_box()
        sizes[size] = (round(box['width']), round(box['height']))
        c.screenshot(path=str(out / f'reminders-{size}-1300.png'))
    assert sizes['small'][0] < sizes['compact'][0] < sizes['normal'][0], sizes
    assert sizes['small'][1] < sizes['normal'][1], sizes
    prefs(c, skipReminderKey='bracket', reminderSize='normal', **base)
    print('PASS reminder size setting shrinks the box (normal/compact/small):', sizes)
    assert not errors, errors
