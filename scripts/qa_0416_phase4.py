"""0.4.16 fase 4 (selecao multipla no carrinho) no servidor do fixture CDP 9401 de qa_close_reminders.py.

Confere: Shift+clique (intervalo), Ctrl+clique, menu com N itens e opcoes de um item so
desabilitadas, Duplicar, Desconto %, Observacao, Remover, Transferir pre-selecionado e Esc.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
TABLE = 25
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(12000)
    s.set_viewport_size({'width': 1280, 'height': 720})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))
    s.evaluate("""async(n)=>{
      const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
      const snap=await window.caixa.getPdvSnapshot();
      const table=snap.tables.find(t=>t.number===n);
      if(table && table.items.length){await window.caixa.cancelPdvTable(n);}
      await window.caixa.openPdvTable(n,1);
      const items=['A','B','C','D','E'].map(l=>({id:crypto.randomUUID(),productId:coffee.id,productName:'Item '+l,categoryName:'QA',quantity:1,unitPrice:10,discount:0,total:10}));
      await window.caixa.savePdvTableItems(n,items,[],[]);
    }""", TABLE)
    s.reload()
    if s.get_by_text('Entrar como Servidor', exact=True).count():
        s.get_by_text('Entrar como Servidor', exact=True).click()
    s.locator('.professional-shell').wait_for(timeout=20000)
    if s.locator('.module-window-close').count():
        s.locator('.module-window-close').click()
    s.locator('.pdv-table-card').filter(has=s.get_by_text(str(TABLE).zfill(3), exact=True)).click()
    rows = s.locator('.pdv-cart-list article')
    expect(rows).to_have_count(5)

    def row(name):
        return rows.filter(has_text=name)

    def server_items():
        return s.evaluate("async(n)=>(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n).items", TABLE)

    # Shift: intervalo A..D
    row('Item A').click()
    row('Item D').click(modifiers=['Shift'])
    expect(s.locator('.pdv-cart-list article.multi-selected')).to_have_count(4)
    s.locator('.pdv-cart-list').click(position={'x': 5, 'y': 5})
    s.locator('.pdv-operational-head').click()
    expect(s.locator('.pdv-cart-list article.multi-selected')).to_have_count(4)
    row('Item B').click(button='right')
    menu = s.locator('.pdv-context-menu')
    expect(menu).to_contain_text('4 itens selecionados')
    expect(menu).to_contain_text('clique em um item só')
    expect(menu.get_by_role('button', name='Desconto em R$', exact=True)).to_have_count(0)
    s.screenshot(path=str(out / 'phase4-multi-menu.png'))
    menu.get_by_role('button', name='Duplicar todos', exact=True).click()
    expect(rows).to_have_count(9)
    print('PASS shift range selects 4 and survives clicks outside; menu shows count and hint; duplicate adds 4')

    # Esc desfaz a selecao multipla.
    row('Item A').first.click()
    row('Item C').first.click(modifiers=['Control'])
    expect(s.locator('.pdv-cart-list article.multi-selected')).to_have_count(2)
    s.locator('.pdv-cart-list').press('Escape')
    expect(s.locator('.pdv-cart-list article.multi-selected')).to_have_count(0)
    print('PASS ctrl toggles; Esc collapses the selection')

    # Ctrl: A e C -> desconto 10% em cada.
    row('Item A').first.click()
    row('Item C').first.click(modifiers=['Control'])
    row('Item C').first.click(button='right')
    s.locator('.pdv-context-menu').get_by_role('button', name='Desconto em % em cada item', exact=True).click()
    modal = s.locator('.pdv-batch-modal')
    modal.get_by_label('Desconto em %', exact=True).fill('10')
    expect(modal).to_contain_text('R$ 18,00')
    modal.get_by_role('button', name='Aplicar em todos', exact=True).click()
    expect(row('Item A').first).to_contain_text('9,00')
    expect(row('Item C').first).to_contain_text('9,00')
    expect(row('Item B').first).to_contain_text('10,00')
    print('PASS ctrl selection + 10% discount applies to each selected item only')

    # Observacao em A e B.
    row('Item A').first.click()
    row('Item B').first.click(modifiers=['Shift'])
    row('Item B').first.click(button='right')
    s.locator('.pdv-context-menu').get_by_role('button', name='Observacao em todos', exact=True).click()
    modal = s.locator('.pdv-batch-modal')
    modal.get_by_label('Observacao dos itens', exact=True).fill('sem gelo')
    modal.get_by_role('button', name='Aplicar em todos', exact=True).click()

    # Remover as 4 copias (linhas 6..9).
    rows.nth(5).click()
    rows.nth(8).click(modifiers=['Shift'])
    rows.nth(6).click(button='right')
    s.locator('.pdv-context-menu').get_by_role('button', name='Remover os 4 produtos', exact=True).click()
    s.screenshot(path=str(out / 'phase4-batch-remove.png'))
    s.locator('.pdv-batch-modal').get_by_role('button', name='Remover 4 produtos', exact=True).click()
    expect(rows).to_have_count(5)
    def converged(items):
        notes = {i['productName']: i.get('note') or '' for i in items}
        totals = {i['productName']: i['total'] for i in items}
        return (len(items) == 5 and 'sem gelo' in notes.get('Item A', '') and 'sem gelo' in notes.get('Item B', '')
                and 'sem gelo' not in notes.get('Item C', '') and totals.get('Item A') == 9 and totals.get('Item C') == 9 and totals.get('Item B') == 10)
    items = server_items()
    waited = 0
    while not converged(items) and waited < 20000:
        s.wait_for_timeout(500)
        waited += 500
        items = server_items()
    print('server synced after', waited, 'ms')
    if not converged(items):
        print('DEBUG toast:', s.locator('.pdv-toast').all_inner_texts(), 'subtitle:', s.locator('.pdv-operational-head p').all_inner_texts(), 'ui rows:', rows.count())
    assert converged(items), [(i['productName'], i.get('note'), i['total']) for i in items]
    print('PASS note on A+B, remove 4 copies, server saved 5 items with discount and notes')

    # Transferir: D e E pre-selecionados na janela de transferencia.
    row('Item D').first.click()
    row('Item E').first.click(modifiers=['Shift'])
    row('Item E').first.click(button='right')
    s.locator('.pdv-context-menu').get_by_role('button', name='Transferir para outra mesa ou submesa', exact=True).click()
    transfer = s.locator('.pdv-transfer-list')
    expect(transfer.locator('input[type=checkbox]:checked')).to_have_count(2)
    expect(transfer.locator('button.selected')).to_contain_text(['Item D', 'Item E'])
    s.screenshot(path=str(out / 'phase4-transfer-preselected.png'))
    s.get_by_role('button', name='Voltar', exact=True).click()
    print('PASS transfer opens with exactly the selected items checked')
    assert not errors, errors
