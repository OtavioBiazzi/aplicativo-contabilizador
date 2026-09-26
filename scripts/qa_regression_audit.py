from playwright.sync_api import sync_playwright
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    server = p.chromium.connect_over_cdp("http://127.0.0.1:9334").contexts[0].pages[0]
    server.set_default_timeout(10000)
    errors = []
    server.on("pageerror", lambda error: errors.append(str(error)))
    if server.locator(".module-window-close").count(): server.locator(".module-window-close").click()
    server.evaluate("""async () => {
      const customer = await window.caixa.savePdvCustomer({name:'Cliente selecao QA',active:true});
      for(const [description,amount] of [['Selecionada A',10],['Selecionada B',20],['Nao selecionada C',15]]) await window.caixa.savePdvReceivable({customerId:customer.id,description,amount});
    }""")
    server.get_by_role("button",name="Abrir Menu Gerencial").click()
    server.locator(".managerial-menu").get_by_text("Contas a receber",exact=True).click()
    receivables = server.locator(".pdv-receivable-professional")
    receivables.get_by_role("checkbox",name="Selecionar conta Selecionada A",exact=True).check()
    receivables.get_by_role("checkbox",name="Selecionar conta Selecionada B",exact=True).check()
    receivables.get_by_role("button",name="Receber selecionadas (2)",exact=True).click()
    server.locator(".pdv-collection-modal").get_by_role("button",name="Pix",exact=True).click()
    server.locator(".pdv-modal-backdrop").last.locator("input").last.fill("25")
    server.get_by_role("button",name="OK",exact=True).click()
    server.get_by_role("button",name="Entendi",exact=True).click()
    actual = server.evaluate("""async()=> (await window.caixa.getPdvSnapshot()).receivables.filter(a=>a.customerName==='Cliente selecao QA').map(a=>({name:a.description,balance:a.balance}))""")
    assert sorted((row['name'],row['balance']) for row in actual) == [('Nao selecionada C',15),('Selecionada A',0),('Selecionada B',5)], actual
    receivables.get_by_role("tab",name="Por cliente",exact=True).click()
    server.screenshot(path=str(root / "outputs/audit-selected-accounts.png"),full_page=True)
    server.locator(".module-window-close").click()
    server.get_by_role("button",name="Abrir Menu Gerencial").click()
    server.locator(".managerial-menu").get_by_text("Contas a pagar",exact=True).click()
    payables=server.locator(".pdv-payable-professional")
    assert payables.locator("tbody tr").count()==1
    payables.get_by_role("tab",name="Por fornecedor",exact=True).click()
    assert '12,00' in payables.inner_text()
    server.screenshot(path=str(root / "outputs/audit-supplier-balance.png"),full_page=True)
    assert not errors, errors
    print('UI selected receivables and supplier balance passed')
