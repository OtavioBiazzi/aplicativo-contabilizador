"""0.4.16 fase 2 (lembretes) no fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).

Confere: origem dos lembretes (so deste computador / todos), baixa sincronizada,
limite com rolagem, minimizar/expandir e dock com aviso + lembretes sem sobreposicao.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    c = p.chromium.connect_over_cdp('http://127.0.0.1:9402').contexts[0].pages[0]
    for page in [s, c]:
        page.set_default_timeout(12000)
        page.set_viewport_size({'width': 1280, 'height': 720})

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
        import json
        page.evaluate("""(patch)=>{for(const k of ['caixa.local-tables.server','caixa.local-tables.client']){const v=JSON.parse(localStorage.getItem(k)||'{}');Object.assign(v,patch);localStorage.setItem(k,JSON.stringify(v));localStorage.removeItem(k+'.pending');localStorage.removeItem(k+'.collapsed');}window.dispatchEvent(new Event('local-table-preferences'));}""", values)

    def cards(page):
        return page.locator('.table-close-reminders article')

    base = {'reminders': 'always', 'excludedTables': '', 'hideQuickValue': False, 'syncAcknowledge': True, 'visibleLimit': 4}
    prefs(s, reminderSource='mine', **base)
    prefs(c, reminderSource='mine', **base)
    reload(s); reload(c)

    # Fecha a mesa 21 pelo cliente via API remota: so o cliente deve lembrar.
    seed = s.evaluate("async()=>JSON.parse(localStorage.getItem('qa.reminder.products'))")
    coffee = seed['coffee']

    def open_with_item(number):
        s.evaluate("""async([n,coffee])=>{await window.caixa.openPdvTable(n,1);await window.caixa.savePdvTableItems(n,[{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:1,unitPrice:30,discount:0,total:30}],[],[]);}""", [number, coffee])

    def close_on(page, number):
        """Fecha a mesa pela interface daquele computador (pagamento Pix)."""
        page.locator('.pdv-table-card').filter(has=page.get_by_text(str(number).zfill(3), exact=True)).click()
        page.get_by_role('button', name='Fechar conta', exact=True).click()
        page.locator('.pdv-close-menu').get_by_role('button', name='Fechar total', exact=False).click()
        receive = page.locator('.pdv-receive-modal')
        receive.get_by_role('button', name='Pix', exact=False).click()
        page.locator('.pdv-payment-amount-modal').get_by_role('button', name='OK', exact=True).click()
        receive.get_by_role('button', name='Finalizar conta', exact=True).click()
        expect(receive).to_have_count(0)
        if page.locator('.pdv-receipt-preview').count():
            page.locator('.pdv-receipt-preview').get_by_role('button', name='Fechar', exact=True).click()

    open_with_item(21)
    reload(c)
    close_on(c, 21)
    expect(cards(c)).to_have_count(1)
    s.wait_for_timeout(1200)
    expect(cards(s)).to_have_count(0)
    print('PASS client close reminds only the client when the server is set to "only this computer"')

    # Servidor passa a avisar de todos: o proximo fechamento do cliente aparece nos dois.
    prefs(s, reminderSource='all', **base)
    reload(s)
    open_with_item(22)
    reload(c)
    close_on(c, 22)
    expect(cards(c)).to_have_count(2)
    expect(cards(s)).to_have_count(1)
    expect(s.locator('.table-close-reminders')).to_contain_text('Mesa 22')
    print('PASS "all computers" on the server shows the client close')

    # OK no servidor remove o mesmo lembrete do cliente.
    s.get_by_role('button', name='Confirmar retirada da comanda da mesa 22', exact=True).click()
    expect(cards(s)).to_have_count(0)
    expect(c.locator('.table-close-reminders')).not_to_contain_text('Mesa 22', timeout=8000)
    print('PASS OK on the server removes the reminder on the client')

    # Limite e rolagem: 7 lembretes, limite 4 -> rola; minimizar e expandir.
    expect(c.locator('.table-close-reminders')).to_contain_text('Mesa 21')
    prefs(c, reminderSource='mine', **base)
    reload(c)
    c.evaluate("""()=>{for(let i=0;i<7;i++){window.dispatchEvent(new CustomEvent('table-closed-notice',{detail:{source:'self',notice:{id:'qa-limit-'+Date.now()+'-'+i,tableNumber:30+i,createdAt:new Date().toISOString()}}}));}}""")
    expect(cards(c)).to_have_count(7)
    lst = c.locator('.table-close-reminders-list')
    box = lst.bounding_box()
    assert box['height'] <= 4 * 52, box
    assert lst.evaluate('e=>e.scrollHeight>e.clientHeight'), 'list should scroll'
    c.screenshot(path=str(out / 'phase2-limit-1280.png'))
    c.get_by_role('button', name='Minimizar lembretes de comanda', exact=True).click()
    expect(cards(c)).to_have_count(0)
    expect(c.locator('.table-close-reminders-head')).to_contain_text('Comandas (7)')
    head = c.locator('.table-close-reminders-head').bounding_box()
    assert head['height'] <= 34, head
    reload(c)
    expect(cards(c)).to_have_count(0)
    c.get_by_role('button', name='Mostrar 7 lembrete(s) de comanda', exact=True).click()
    expect(cards(c)).to_have_count(7)
    c.set_viewport_size({'width': 1024, 'height': 600})
    box = c.locator('.table-close-reminders-list').bounding_box()
    assert box['height'] <= 3 * 52, box
    c.screenshot(path=str(out / 'phase2-limit-1024x600.png'))
    c.set_viewport_size({'width': 1280, 'height': 720})
    print('PASS limit 4 scrolls, collapse persists across reload, small screens cap at 3')

    # Dock: aviso temporario aparece acima dos lembretes, sem sobrepor.
    # Abrir o app de novo com o mesmo perfil dispara o aviso "ja estava aberto" no cliente.
    import os, subprocess
    c.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,notificationsEnabled:true});}""")
    reload(c)
    profile = os.environ.get('QA_CLIENT_PROFILE', str(out / 'run-0416' / 'client' / 'profile'))
    electron = os.environ.get('QA_ELECTRON')
    if electron:
        subprocess.run([electron, f'--user-data-dir={profile}'], timeout=30)
    else:
        electron = str(Path.cwd() / 'node_modules' / 'electron' / 'dist' / 'electron.exe')
        subprocess.run([electron, str(Path.cwd()), f'--user-data-dir={profile}'], timeout=30)
    toast = c.locator('.notification-dock .toast')
    toast.wait_for(timeout=8000)
    t = toast.bounding_box(); r = c.locator('.table-close-reminders').bounding_box()
    assert t['y'] + t['height'] <= r['y'] + 1, (t, r)
    assert abs((t['x'] + t['width']) - (r['x'] + r['width'])) <= 2, (t, r)
    c.screenshot(path=str(out / 'phase2-dock-toast.png'))
    c.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,notificationsEnabled:false});}""")
    print('PASS toast and reminders share the dock without overlapping')
