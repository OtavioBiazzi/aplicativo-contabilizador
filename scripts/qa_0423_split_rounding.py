"""0.4.23 dividir item com aproximacao, no fixture CDP 9401 de qa_close_reminders.py (rode aquele antes).

R$ 25,00 em 3 com aproximacao R$ 0,50 (mais proximo): 8,50 + 8,50 + 8,00 (total exato).
Desmarcando na janela: 8,33 + 8,33 + 8,34. Com a configuracao desligada, a caixa vem desmarcada.
"""
from playwright.sync_api import sync_playwright, expect

TABLE = 44
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(12000)
    s.set_viewport_size({'width': 1366, 'height': 768})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))
    original = s.evaluate("async()=>{const st=(await window.caixa.getPdvSnapshot()).settings; return {roundingStep: st.roundingStep, roundingDirection: st.roundingDirection, splitItemRounding: !!st.splitItemRounding};}")

    def prepare(enabled):
        s.evaluate("""async([n,enabled])=>{const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
          await window.caixa.savePdvSettings({roundingStep:0.5, roundingDirection:'nearest', splitItemRounding: enabled});
          const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n); if(t&&t.items.length) await window.caixa.cancelPdvTable(n);
          await window.caixa.openPdvTable(n,1);
          await window.caixa.savePdvTableItems(n,[{id:crypto.randomUUID(),productId:coffee.id,productName:'Porcao QA',categoryName:'QA',quantity:1,unitPrice:25,discount:0,total:25}],[],[]);}""", [TABLE, enabled])
        s.reload()
        if s.get_by_text('Entrar como Servidor', exact=True).count():
            s.get_by_text('Entrar como Servidor', exact=True).click()
        s.locator('.professional-shell').wait_for(timeout=20000)
        if s.locator('.module-window-close').count():
            s.locator('.module-window-close').click()
        s.locator('.pdv-table-card').filter(has=s.get_by_text(str(TABLE).zfill(3), exact=True)).click()
        s.locator('.pdv-cart-list article').filter(has_text='Porcao QA').click(button='right')
        s.locator('.pdv-context-menu').get_by_role('button', name='Dividir item entre pessoas', exact=True).click()
        modal = s.locator('.pdv-split-item-modal')
        expect(modal).to_be_visible()
        modal.locator('input[type=number]').fill('3')
        return modal

    def preview(modal):
        return [t.replace('\xa0', ' ').strip() for t in modal.locator('.pdv-split-item-preview strong').all_inner_texts()]

    modal = prepare(True)
    box = modal.get_by_role('checkbox', name='Aproximar os valores', exact=False)
    expect(box).to_be_checked()
    assert preview(modal) == ['R$ 8,50', 'R$ 8,50', 'R$ 8,00'], preview(modal)
    s.screenshot(path='outputs/qa-close-reminders-20261101/split-rounding.png')
    box.uncheck()
    assert preview(modal) == ['R$ 8,33', 'R$ 8,33', 'R$ 8,34'], preview(modal)
    box.check()
    modal.get_by_role('button', name='Dividir item', exact=True).click()
    expect(modal).to_have_count(0)
    totals = s.locator('.pdv-cart-list article').filter(has_text='Porcao QA')
    expect(totals).to_have_count(3)
    print('PASS split item with rounding: 8,50 + 8,50 + 8,00 keeps R$ 25,00; unchecking goes back to exact cents')

    s.keyboard.press('Escape')
    modal = prepare(False)
    expect(modal.get_by_role('checkbox', name='Aproximar os valores', exact=False)).not_to_be_checked()
    assert preview(modal) == ['R$ 8,33', 'R$ 8,33', 'R$ 8,34'], preview(modal)
    modal.get_by_role('button', name='Cancelar', exact=True).click()
    print('PASS setting off: split stays exact and the box comes unchecked')

    s.evaluate("async([n,o])=>{await window.caixa.savePdvSettings(o); await window.caixa.cancelPdvTable(n);}", [TABLE, original])
    assert not errors, errors
