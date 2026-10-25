"""Run after qa_simple_finance.py with a second isolated Electron at port 9356."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path(__file__).resolve().parents[1]/'outputs/qa-simple-finance'
with sync_playwright() as p:
    server_browser=p.chromium.connect_over_cdp('http://127.0.0.1:9355')
    server=server_browser.contexts[0].pages[0]
    client_browser=p.chromium.connect_over_cdp('http://127.0.0.1:9356')
    page=client_browser.contexts[0].pages[0]
    page.set_default_timeout(12000)
    page.set_viewport_size({'width':1024,'height':768})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.evaluate("""async()=>{
      const pdv=await window.caixa.getPdvSnapshot();
      if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-simple-finance/'))throw new Error('Use an isolated QA profile');
      const app=await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...app.settings,server:{...app.settings.server,autoConnection:{...app.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46582',password:'qa-simple-only',deviceName:'QA Financeiro simples'}}});
    }""")
    page.reload()
    page.get_by_text('Entrar como Cliente',exact=True).click()
    page.locator('.professional-shell').wait_for()
    page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
    page.locator('.managerial-menu').get_by_text('Contas a pagar',exact=True).click()
    panel=page.locator('.pdv-payable-professional')
    expect(panel.locator('th')).to_have_count(6)
    panel.locator('tbody tr').filter(has_text='QA Conta existente editada').click()
    panel.get_by_role('button',name='Pagar',exact=True).click()
    payment=page.get_by_role('dialog',name='Pagar conta',exact=True)
    expect(payment.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('Debito')
    payment.get_by_role('button',name='Cancelar',exact=True).click()
    panel.get_by_role('button',name='Fornecedores',exact=True).click()
    suppliers=page.get_by_role('dialog',name='Fornecedores',exact=True)
    suppliers.get_by_label('Nome do fornecedor',exact=True).fill('QA Fornecedor do cliente')
    suppliers.get_by_role('button',name='Cadastrar',exact=True).click()
    expect(suppliers.locator('.simple-suppliers-list')).to_contain_text('QA Fornecedor do cliente')
    assert server.evaluate("async()=> (await window.caixa.getPdvSnapshot()).suppliers.some(s=>s.name==='QA Fornecedor do cliente')")
    suppliers.get_by_role('button',name='Excluir fornecedor QA Fornecedor do cliente',exact=True).click()
    suppliers.get_by_role('button',name='Excluir',exact=True).click()
    expect(suppliers.locator('.simple-suppliers-list')).not_to_contain_text('QA Fornecedor do cliente')
    assert not server.evaluate("async()=> (await window.caixa.getPdvSnapshot()).suppliers.some(s=>s.name==='QA Fornecedor do cliente')")
    suppliers.get_by_role('button',name='Fechar',exact=True).click()
    panel.get_by_role('button',name='Novo',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    editor.get_by_label('Descrição *',exact=True).fill('QA Conta criada no cliente')
    editor.get_by_label('Valor *',exact=True).fill('12')
    expect(editor.get_by_role('combobox',name='Forma de pagamento',exact=True)).to_have_value('Pix')
    editor.get_by_role('combobox',name='Fornecedor',exact=True).select_option(label='QA Fornecedor antigo')
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    account=server.evaluate("async()=> (await window.caixa.getPdvSnapshot()).payables.find(a=>a.description==='QA Conta criada no cliente')")
    assert account['preferredPaymentMethod']=='Pix' and account['supplier']=='QA Fornecedor antigo',account
    page.screenshot(path=str(out/'payables-client.png'))
    assert not errors,errors
    print('PASS client supplier creation/deletion, stored payment preference and remote payable creation')
    client_browser.close();server_browser.close()
