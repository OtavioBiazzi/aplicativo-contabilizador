"""0.4.16 fase 1 no fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).

Confere: regra do servidor para o botao + chega ao cliente; privacidade do resumo
Mesas em aberto; caixa de quantidade sem setinhas nativas.
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
        if page.locator('.module-window-close').count():
            page.locator('.module-window-close').click()

    def quick(page):
        return page.locator('.pdv-quick-value-card')

    def reload(page):
        page.reload()
        for label in (['Entrar como Servidor'] if page is s else ['Entrar como Cliente']):
            try:
                page.get_by_text(label, exact=True).wait_for(timeout=3000)
                page.get_by_text(label, exact=True).click()
                break
            except Exception:
                pass
        page.locator('.professional-shell').wait_for(timeout=20000)

    # Garante que a opcao local nao esta escondendo o botao nos dois computadores.
    for page in [s, c]:
        page.evaluate("""()=>{for(const k of ['caixa.local-tables.server','caixa.local-tables.client']){const v=JSON.parse(localStorage.getItem(k)||'{}');v.hideQuickValue=false;localStorage.setItem(k,JSON.stringify(v));}window.dispatchEvent(new Event('local-table-preferences'));}""")
    s.evaluate("async()=>{await window.caixa.savePdvSettings({hideTableQuickValue:false});}")
    reload(c)
    expect(quick(s)).to_have_count(1)
    expect(quick(c)).to_have_count(1)

    s.evaluate("async()=>{await window.caixa.savePdvSettings({hideTableQuickValue:true});}")
    reload(s)
    expect(quick(s)).to_have_count(0)
    reload(c)
    expect(quick(c)).to_have_count(0)
    s.evaluate("async()=>{await window.caixa.savePdvSettings({hideTableQuickValue:false});}")
    reload(s)
    expect(quick(s)).to_have_count(1)
    print('PASS server rule hides + on server and client; turning it off restores it')

    # Privacidade no resumo Mesas em aberto (servidor).
    s.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,privacy:{...snap.settings.privacy,enabled:true,hideHeaderTotal:true}});}""")
    reload(s)
    s.get_by_role('button', name='Total oculto', exact=False).first.click()
    s.get_by_role('button', name='Mesas em aberto', exact=True).click()
    summary = s.locator('.open-tables-summary')
    expect(summary.locator('.open-tables-projection')).to_contain_text('Privado')
    expect(summary.locator('.open-tables-total strong')).not_to_contain_text('Privado')
    s.screenshot(path=str(out / 'phase1-open-tables-private.png'))
    summary.get_by_role('button', name='Fechar', exact=True).click()
    s.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,privacy:{...snap.settings.privacy,enabled:false,hideHeaderTotal:false}});}""")
    reload(s)
    s.get_by_role('button', name='Total do dia', exact=False).first.click()
    s.get_by_role('button', name='Mesas em aberto', exact=True).click()
    expect(s.locator('.open-tables-projection')).not_to_contain_text('Privado')
    s.locator('.open-tables-summary').get_by_role('button', name='Fechar', exact=True).click()
    print('PASS open tables summary hides realized/forecast with privacy and keeps pending balance')

    # Caixa de quantidade sem setinhas nativas.
    s.locator('.pdv-table-card').filter(has=s.get_by_text('030', exact=True)).click()
    field = s.get_by_label('Quantidade do proximo produto', exact=True).locator('input')
    if not field.count():
        field = s.locator('.pdv-cart-add-quantity input')
    appearance = field.first.evaluate("e=>getComputedStyle(e).appearance")
    assert appearance == 'textfield', appearance
    print('PASS quantity box uses textfield appearance (no native spin buttons)')
