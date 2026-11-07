"""0.4.16 tela de pagamento estilo "Receber" no fixture CDP 9401/9402 de qa_close_reminders.py.

Confere: cliente no topo com pesquisa (lista, busca por nome/CPF, Enter seleciona), cadastro rapido,
teclas F bloqueadas com a pesquisa aberta, conta a receber ja com o cliente escolhido, troco e
fechamento gravado; layout em 1280x720 e 1024x600, no servidor e no cliente.
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path.cwd() / 'outputs/qa-close-reminders-20261101'
tag = str(int(time.time()))[-6:]
with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    c = p.chromium.connect_over_cdp('http://127.0.0.1:9402').contexts[0].pages[0]
    errors = []
    for page in [s, c]:
        page.set_default_timeout(12000)
        page.set_viewport_size({'width': 1280, 'height': 720})
        page.on('pageerror', lambda error: errors.append(str(error)))
    s.evaluate("""async(tag)=>{
      for(const [name,document,phone,email,address] of [['MARIA QA '+tag,'123.'+tag+'-00','(11) 98888-0000','maria@qa.test','LOUVEIRA'],['JOAO QA '+tag,'55.897.561/0001-27','','joao@qa.test','JUNDIAI'],['ANA QA '+tag,'','(19) 3333-0000','','VALINHOS']])
        await window.caixa.savePdvCustomer({name,document,phone,email,address,active:true,role:'customer'});
      const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
      for(const n of [27,28]){
        const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n);
        if(t && t.items.length) await window.caixa.cancelPdvTable(n);
        await window.caixa.openPdvTable(n,1);
        await window.caixa.savePdvTableItems(n,[{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:2,unitPrice:30,discount:0,total:60}],[],[]);
      }
    }""", tag)

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

    def open_checkout(page, number):
        page.locator('.pdv-table-card').filter(has=page.get_by_text(str(number).zfill(3), exact=True)).click()
        page.get_by_role('button', name='Fechar conta', exact=True).click()
        page.locator('.pdv-close-menu').get_by_role('button', name='Fechar total', exact=False).click()
        modal = page.locator('.pdv-checkout')
        expect(modal).to_be_visible()
        return modal

    reload(s)
    modal = open_checkout(s, 27)
    expect(modal.get_by_role('textbox').first).to_have_value('CONSUMIDOR NÃO IDENTIFICADO')
    expect(modal.locator('.pdv-checkout-payments article.remaining')).to_contain_text('60,00')
    s.screenshot(path=str(out / 'checkout-1280.png'))
    for size in [{'width': 1024, 'height': 600}]:
        s.set_viewport_size(size)
        box = modal.bounding_box()
        assert box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= size['width'] and box['y'] + box['height'] <= size['height'], box
        confirm = modal.get_by_role('button', name='Finalizar conta', exact=False)
        cb = confirm.bounding_box()
        assert cb['y'] + cb['height'] <= size['height'], cb
        s.screenshot(path=str(out / 'checkout-1024x600.png'))
    s.set_viewport_size({'width': 1280, 'height': 720})
    print('PASS checkout layout: customer block, methods, remaining row and totals fit 1280x720 and 1024x600')

    # Pesquisa: F4 nao abre Pix por baixo; busca por CPF; Enter seleciona.
    modal.get_by_role('button', name='Pesquisar', exact=True).click()
    picker = s.locator('.pdv-customer-picker')
    expect(picker).to_be_visible()
    s.keyboard.press('F4')
    expect(s.locator('.pdv-payment-amount-modal')).to_have_count(0)
    picker.get_by_label('Pesquisar cliente', exact=True).fill('123' + tag)
    expect(picker.locator('.row')).to_have_count(1)
    picker.get_by_label('Pesquisar cliente', exact=True).fill('maria qa ' + tag)
    expect(picker.locator('.row')).to_have_count(1)
    s.keyboard.press('ArrowDown')
    s.screenshot(path=str(out / 'checkout-customer-picker.png'))
    s.keyboard.press('Enter')
    expect(picker).to_have_count(0)
    expect(modal.get_by_role('textbox').first).to_have_value('MARIA QA ' + tag)
    expect(modal.locator('.pdv-checkout-customer')).to_contain_text('') 
    assert modal.locator('.pdv-checkout-customer input').nth(2).input_value() == 'maria@qa.test'
    print('PASS customer picker: F-keys blocked, search by CPF digits and name, Enter selects')

    # Conta a receber ja vem com Maria; 20 a receber + 40 em dinheiro com 50 entregues (troco 10).
    modal.get_by_role('button', name='Conta a receber', exact=False).click()
    rec = s.locator('.pdv-receivable-entry-modal')
    expect(rec.locator('select')).to_have_value(s.evaluate("(tag)=>window.caixa.getPdvSnapshot().then(x=>x.customers.find(c=>c.name==='MARIA QA '+tag).id)", tag))
    rec.locator('input[inputmode=decimal]').fill('20')
    rec.get_by_role('button', name='Adicionar a conta', exact=True).click()
    modal.get_by_role('button', name='Dinheiro', exact=False).click()
    amount = s.locator('.pdv-payment-amount-modal')
    fields = amount.locator('input:not([readonly])')
    expect(fields.first).to_have_value('40')
    fields.first.fill('50')  # dinheiro aceita valor maior: a diferenca vira troco
    amount.get_by_role('button', name='OK', exact=True).click()
    expect(modal.locator('.pdv-checkout-figure.change')).to_contain_text('10,00')
    expect(modal.locator('.pdv-checkout-payments article.remaining')).to_have_count(0)
    s.screenshot(path=str(out / 'checkout-paid.png'))
    modal.get_by_role('button', name='Finalizar conta', exact=False).click()
    if s.locator('.pdv-confirm-modal').count():
        s.locator('.pdv-confirm-modal').get_by_role('button', name='Confirmar', exact=False).click()
    expect(modal).to_have_count(0)
    if s.locator('.pdv-receipt-preview').count():
        s.locator('.pdv-receipt-preview').get_by_role('button', name='Fechar', exact=True).click()
    sale = s.evaluate("async()=>(await window.caixa.getPdvSnapshot()).recentSales.find(x=>x.tableNumber===27)")
    methods = sorted((pmt['method'], pmt['amount']) for pmt in sale['payments'])
    assert methods == [('Conta a receber', 20), ('Dinheiro', 40)], methods
    assert any(pmt.get('customerName') == 'MARIA QA ' + tag for pmt in sale['payments'])
    print('PASS receivable defaults to the chosen customer; cash change shown; sale saved with both payments')

    # Cliente remoto: cadastro rapido pela pesquisa e selecao.
    reload(c)
    modal = open_checkout(c, 28)
    modal.get_by_role('button', name='Pesquisar', exact=True).click()
    picker = c.locator('.pdv-customer-picker')
    picker.get_by_label('Pesquisar cliente', exact=True).fill('NOVO QA ' + tag)
    expect(picker.locator('.row')).to_have_count(0)
    c.keyboard.press('F2')
    expect(picker.get_by_label('Nome do novo cliente', exact=True)).to_have_value('NOVO QA ' + tag)
    picker.get_by_label('Telefone do novo cliente', exact=True).fill('(19) 90000-0000')
    picker.get_by_role('button', name='Cadastrar e selecionar', exact=True).click()
    expect(picker).to_have_count(0)
    expect(modal.get_by_role('textbox').first).to_have_value('NOVO QA ' + tag)
    created = s.evaluate("async(tag)=>(await window.caixa.getPdvSnapshot()).customers.find(c=>c.name==='NOVO QA '+tag)", tag)
    assert created and created['phone'] == '(19) 90000-0000', created
    c.screenshot(path=str(out / 'checkout-client.png'))
    modal.get_by_role('button', name='Voltar', exact=False).click()
    print('PASS remote client quick-registers a customer from the picker and selects it')
    assert not errors, errors
