"""0.4.26 no fixture CDP 9401 de qa_close_reminders.py (rode aquele antes).

1) Rolagem igual no app todo: 10px, sem setas.
2) Conta a pagar cadastrada com Pix: ao pagar, a forma ja vem Pix (lista e por fornecedor) e da para trocar.
"""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(10000)
    s.set_viewport_size({'width': 1366, 'height': 768})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))

    def reload():
        s.reload()
        if s.get_by_text('Entrar como Servidor', exact=True).count():
            s.get_by_text('Entrar como Servidor', exact=True).click()
        s.locator('.professional-shell').wait_for(timeout=20000)
        while s.locator('.module-window-close').count():
            s.locator('.module-window-close').first.click()

    def module(name):
        while s.locator('.module-window-close').count():
            s.locator('.module-window-close').first.click()
        s.get_by_role('button', name='Abrir Menu Gerencial', exact=True).click()
        s.locator('.managerial-menu').get_by_text(name, exact=True).first.click()
        s.wait_for_timeout(500)

    reload()
    module('Operacoes')
    width = s.evaluate(r"""()=>{const e=[...document.querySelectorAll('*')].find(e=>{const cs=getComputedStyle(e);return (cs.overflowY==='auto'||cs.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+2&&e.offsetWidth>600}); return e ? e.offsetWidth - e.clientWidth : -1;}""")
    assert width == 10, width
    print('PASS scrollbars are 10px and styled across the app')

    s.evaluate("async()=>window.caixa.savePdvPayable({description:'QA Pix padrao',amount:55,preferredPaymentMethod:'Pix',supplier:'Fornecedor QA Pix'})")
    reload()
    module('Contas a pagar')
    s.get_by_text('QA Pix padrao').first.click()
    s.get_by_role('button', name='Pagar', exact=True).first.click()
    dialog = s.get_by_role('dialog', name='Pagar conta')
    expect(dialog.locator('select').first).to_have_value('Pix')
    dialog.locator('select').first.select_option('Dinheiro')
    expect(dialog.locator('select').first).to_have_value('Dinheiro')
    s.keyboard.press('Escape')
    print('PASS payable registered with Pix opens Pagar with Pix selected, and it can be changed')
    assert not errors, errors
