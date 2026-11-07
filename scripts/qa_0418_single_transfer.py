"""0.4.18: transferir um produto so abre o modal padrao de transferencia (o mesmo do lote).

Fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
SOURCE, TARGET = 31, 32
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(12000)
    s.set_viewport_size({'width': 1280, 'height': 720})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))
    s.evaluate("""async([a,b])=>{
      const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
      const snap=await window.caixa.getPdvSnapshot();
      for (const n of [a,b]) { const t=snap.tables.find(x=>x.number===n); if(t && t.items.length) await window.caixa.cancelPdvTable(n); }
      await window.caixa.openPdvTable(a,1);
      await window.caixa.openPdvTable(b,1);
      await window.caixa.savePdvTableItems(b,[{id:crypto.randomUUID(),productId:coffee.id,productName:'Ja na destino',categoryName:'QA',quantity:1,unitPrice:5,discount:0,total:5}],[],[]);
      const items=[{id:crypto.randomUUID(),productId:coffee.id,productName:'Cerveja X',categoryName:'QA',quantity:3,unitPrice:10,discount:0,total:30},
                   {id:crypto.randomUUID(),productId:coffee.id,productName:'Porcao Y',categoryName:'QA',quantity:1,unitPrice:40,discount:0,total:40}];
      await window.caixa.savePdvTableItems(a,items,[],[]);
    }""", [SOURCE, TARGET])
    s.reload()
    if s.get_by_text('Entrar como Servidor', exact=True).count():
        s.get_by_text('Entrar como Servidor', exact=True).click()
    s.locator('.professional-shell').wait_for(timeout=20000)
    if s.locator('.module-window-close').count():
        s.locator('.module-window-close').click()
    s.locator('.pdv-table-card').filter(has=s.get_by_text(str(SOURCE).zfill(3), exact=True)).click()
    rows = s.locator('.pdv-cart-list article')
    expect(rows).to_have_count(2)

    # Botao direito em um produto so -> Transferir abre o modal padrao com so ele marcado.
    rows.filter(has_text='Cerveja X').click(button='right')
    s.locator('.pdv-context-menu').get_by_role('button', name='Transferir para outra mesa ou submesa', exact=True).click()
    modal = s.locator('.pdv-transfer-list-modal')
    expect(modal).to_be_visible()
    expect(modal.locator('.pdv-transfer-list input[type=checkbox]:checked')).to_have_count(1)
    expect(modal.locator('.pdv-transfer-list button.selected')).to_contain_text('Cerveja X')
    s.screenshot(path=str(out / 'single-transfer-standard-modal.png'))
    print('PASS single-item transfer opens the standard transfer modal with only that item checked')

    # Transfere 2 das 3 cervejas para a mesa principal da outra mesa.
    modal.locator('.pdv-transfer-target select').first.select_option(str(TARGET))
    modal.locator('.pdv-transfer-target select').nth(1).select_option('')
    modal.locator('.pdv-transfer-list button.selected .pdv-transfer-qty input').fill('2')
    modal.get_by_role('button', name='Transferir selecionados', exact=True).click()
    expect(modal).to_have_count(0)
    tables = s.evaluate("async()=>(await window.caixa.getPdvSnapshot()).tables")
    by = {t['number']: t for t in tables}
    src = {i['productName']: i['quantity'] for i in by[SOURCE]['items']}
    dst = {i['productName']: i['quantity'] for i in by[TARGET]['items']}
    assert src == {'Cerveja X': 1, 'Porcao Y': 1}, src
    assert dst == {'Ja na destino': 1, 'Cerveja X': 2}, dst
    print('PASS partial quantity moved: source keeps 1, destination receives 2 and keeps its own item')
    assert not errors, errors
