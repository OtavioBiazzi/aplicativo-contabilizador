"""0.4.16 fase 3 (financeiro) no servidor do fixture CDP 9401 de qa_close_reminders.py.

Confere: vencidas fora do periodo continuam visiveis com etiqueta e nota no total;
botao direito com Ver detalhes em Contas a pagar/receber e ficha em Clientes.
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
tag = str(int(time.time()))
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    s.set_default_timeout(12000)
    s.set_viewport_size({'width': 1280, 'height': 720})
    errors = []
    s.on('pageerror', lambda error: errors.append(str(error)))
    assert '/outputs/qa-close-reminders-20261101/' in s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).dataFile').replace('\\', '/')
    s.evaluate("""async(tag)=>{
      await window.caixa.savePdvPayable({description:'QA vencida antiga '+tag,supplier:'QA Fornecedor '+tag,amount:70,issueDate:'2026-07-01',dueDate:'2026-07-10'});
      const customer=await window.caixa.savePdvCustomer({name:'QA Cliente vencido '+tag,active:true});
      await window.caixa.savePdvReceivable({customerId:customer.id,description:'QA receber vencida '+tag,amount:25,dueDate:'2026-08-01'});
    }""", tag)
    s.reload()
    if s.get_by_text('Entrar como Servidor', exact=True).count():
        s.get_by_text('Entrar como Servidor', exact=True).click()
    s.locator('.professional-shell').wait_for(timeout=20000)

    def open_module(name):
        if s.locator('.module-window-close').count():
            s.locator('.module-window-close').click()
        s.get_by_role('button', name='Abrir Menu Gerencial', exact=True).click()
        s.locator('.managerial-menu').get_by_text(name, exact=True).click()

    # Contas a pagar: periodo padrao (este mes, por emissao) e a conta de julho continua visivel.
    open_module('Contas a pagar')
    row = s.locator('.finance-grid tr').filter(has_text='QA vencida antiga ' + tag)
    expect(row).to_have_count(1)
    expect(row).to_contain_text('fora do período')
    expect(s.locator('.finance-overdue-note')).to_contain_text('vencidas fora do período')
    row.click(button='right')
    menu = s.locator('.pdv-context-menu')
    expect(menu.get_by_role('menuitem', name='Ver detalhes', exact=True)).to_be_enabled()
    expect(menu.get_by_role('menuitem', name='Registrar pagamento', exact=True)).to_be_enabled()
    s.screenshot(path=str(out / 'phase3-payable-menu.png'))
    menu.get_by_role('menuitem', name='Ver detalhes', exact=True).click()
    detail = s.locator('.financial-account-detail')
    expect(detail).to_contain_text('01/07/2026')
    expect(detail).to_contain_text('Emissao')
    s.screenshot(path=str(out / 'phase3-payable-detail.png'))
    # Desmarcar "A pagar" esconde a vencida fora do periodo de novo.
    s.locator('.finance-back').click()
    s.locator('.financial-settlement-filter').get_by_label('A pagar', exact=True).uncheck()
    expect(s.locator('.finance-grid tr').filter(has_text='QA vencida antiga ' + tag)).to_have_count(0)
    s.locator('.financial-settlement-filter').get_by_label('A pagar', exact=True).check()
    print('PASS payables: overdue outside the period stays listed and right-click opens details with the issue date')

    # Contas a receber: filtrando por vencimento, a vencida de agosto aparece com etiqueta.
    open_module('Contas a receber')
    s.get_by_label('Data de', exact=True).select_option('due')
    row = s.locator('.finance-grid tr').filter(has_text='QA receber vencida ' + tag)
    expect(row).to_have_count(1)
    expect(row).to_contain_text('fora do período')
    row.click(button='right')
    menu = s.locator('.pdv-context-menu')
    expect(menu.get_by_role('menuitem', name='Registrar recebimento', exact=True)).to_be_enabled()
    menu.get_by_role('menuitem', name='Ver detalhes', exact=True).click()
    expect(s.locator('.financial-account-detail')).to_contain_text('QA Cliente vencido ' + tag)
    print('PASS receivables: overdue outside the period stays listed and right-click opens details')

    # Clientes: botao direito abre a ficha.
    open_module('Clientes')
    row = s.locator('.finance-grid tr').filter(has_text='QA Cliente vencido ' + tag)
    row.click(button='right')
    s.locator('.pdv-context-menu').get_by_role('menuitem', name='Ficha completa', exact=True).click()
    expect(s.get_by_role('dialog').filter(has_text='QA Cliente vencido ' + tag)).to_have_count(1)
    s.keyboard.press('Escape')
    print('PASS customers: right-click opens the full record')
    assert not errors, errors
