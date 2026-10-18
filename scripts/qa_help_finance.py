"""Exercise financial filters, help and history in an isolated Electron fixture."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cdp", default="http://127.0.0.1:9352")
args = parser.parse_args()
out = Path(__file__).resolve().parents[1] / "outputs" / "qa-help-finance"
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(12000)
    page.set_viewport_size({"width": 1280, "height": 720})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.wait_for_function("Boolean(window.caixa)")
    page.evaluate("""async () => {
      const state = await window.caixa.getPdvSnapshot();
      if (!state.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-help-finance/')) throw new Error('Use an isolated qa-help-finance data directory');
      if (localStorage.getItem('qa.help-fixture')) return;
      const app = await window.caixa.getSnapshot();
      await window.caixa.saveSettings({...app.settings, notificationsEnabled:false, server:{...app.settings.server, port:46581, password:'qa-help-only', autoConnection:{...app.settings.server.autoConnection,mode:'none'}}});
      await window.caixa.savePdvSettings({tableCount:24,cashControlMode:'automatic',subtablesEnabled:true});
      const customer = await window.caixa.savePdvCustomer({name:'QA Cliente pendências',active:true});
      const add = async (description,amount) => window.caixa.savePdvReceivable({customerId:customer.id,description,amount});
      await add('QA Aberta',20);
      const partial = await add('QA Parcial',30);
      const paid = await add('QA Recebida',50);
      const cancelled = await add('QA Cancelada',60);
      const deleted = await add('QA Excluida',70);
      const pay = (id,amount) => ({id:crypto.randomUUID(),receivableId:id,createdAt:new Date().toISOString(),method:'Pix',amount});
      await window.caixa.receivePdvReceivable(partial.id,pay(partial.id,10),crypto.randomUUID());
      await window.caixa.receivePdvReceivable(paid.id,pay(paid.id,50),crypto.randomUUID());
      await window.caixa.cancelPdvReceivable(cancelled.id);
      await window.caixa.deletePdvReceivable(deleted.id);
      for (const [description,amount,paidAmount] of [['QA Despesa aberta',10,0],['QA Despesa parcial',20,5],['QA Despesa paga',30,30]]) {
        const account = await window.caixa.savePdvPayable({supplier:'QA Fornecedor',description,amount,dueDate:new Date().toLocaleDateString('en-CA')});
        if (paidAmount) await window.caixa.payPdvPayable(account.id,{id:crypto.randomUUID(),payableId:account.id,createdAt:new Date().toISOString(),method:'Pix',amount:paidAmount},crypto.randomUUID());
      }
      const category = await window.caixa.savePdvCategory({name:'QA Cafe',sortOrder:0});
      const product = await window.caixa.savePdvProduct({name:'QA Cafe',categoryId:category.id,price:10,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true});
      const item = (quantity,price=10,subtableName='') => ({id:crypto.randomUUID(),productId:product.id,productName:product.name,categoryName:category.name,quantity,unitPrice:price,discount:0,total:quantity*price,subtableName});
      const pix = (amount) => [{id:crypto.randomUUID(),method:'Pix',amount}];
      await window.caixa.openPdvTable(3,2,'QA Parcialmente paga');
      const coffee = item(3); await window.caixa.savePdvTableItems(3,[coffee]);
      await window.caixa.savePdvTablePartial(3,[{...coffee,quantity:1,total:10}],pix(10),0,crypto.randomUUID());
      await window.caixa.openPdvTable(4,1,'QA Principal e submesa');
      await window.caixa.savePdvTableItems(4,[item(1,10),item(1,15,'Ana')],['Ana']);
      await window.caixa.openPdvTable(16,1,'QA Historico mesa');
      await window.caixa.savePdvTableItems(16,[item(1)]);
      await window.caixa.closePdvTable(16,pix(10),0,crypto.randomUUID());
      localStorage.setItem('qa.help-fixture','1');
    }""")
    page.reload()
    if page.get_by_text("Entrar como Servidor", exact=True).count():
        page.get_by_text("Entrar como Servidor", exact=True).click()
    page.locator(".professional-shell").wait_for()

    def close_window():
        page.locator(".module-window-close").click()
        page.locator(".module-window-shell").wait_for(state="detached")

    def open_module(label):
        if page.locator(".module-window-close").count():
            close_window()
        page.get_by_role("button", name="Abrir Menu Gerencial", exact=True).click()
        page.locator(".managerial-menu").get_by_text(label, exact=True).click()
        page.locator(".module-window-shell").wait_for()

    for label, selector, default_status, paid_status, pending_text, paid_text in (
        ("Contas a receber", ".pdv-receivable-professional", "Pendentes", "Recebida", "QA Aberta", "QA Recebida"),
        ("Contas a pagar", ".pdv-payable-professional", "Em aberto", "Pagas", "QA Despesa aberta", "QA Despesa paga"),
    ):
        open_module(label)
        panel = page.locator(selector)
        dates = panel.locator(".financial-filters input[type=date]")
        dates.nth(0).fill("2000-01-01"); dates.nth(1).fill("2000-01-01")
        panel.get_by_role("button", name="Ver todas em aberto", exact=True).click()
        expect(panel.locator(".financial-filters select")).to_have_value(default_status)
        expect(panel.locator("tbody")).to_contain_text(pending_text)
        expect(panel.locator("tbody")).not_to_contain_text(paid_text)
        panel.locator(".financial-filters select").select_option(paid_status)
        panel.get_by_role("button", name="Todo o período", exact=True).click()
        expect(panel.locator(".financial-filters select")).to_have_value(paid_status)
        expect(panel.locator("tbody")).to_contain_text(paid_text)
        panel.get_by_role("button", name="Ver todas em aberto", exact=True).click()
        page.screenshot(path=str(out / ("receivables.png" if label.endswith("receber") else "payables.png")))
        close_window()
    print("PASS financial period expansion preserves status and pending notices exclude paid accounts")

    open_module("Clientes")
    page.locator(".financial-customer-list article").filter(has_text="QA Cliente pendências").click()
    page.get_by_role("button", name="Contas pendentes (2)", exact=True).click()
    detail = page.locator(".pdv-customer-detail-modal")
    expect(detail.locator(".pdv-customer-detail-tabs button.active")).to_contain_text("Pendencias (2)")
    expect(detail.locator(".pdv-customer-account-list")).to_contain_text("QA Aberta")
    expect(detail.locator(".pdv-customer-account-list")).not_to_contain_text("QA Recebida")
    page.screenshot(path=str(out / "customer-pending.png"))
    detail.get_by_role("button", name="Fechar", exact=True).click()
    close_window()
    print("PASS customer shortcut opens only pending accounts")

    page.locator(".topbar-card-button").click()
    page.locator(".total-popover").get_by_role("button", name="Mesas em aberto", exact=True).click()
    summary = page.get_by_role("dialog", name="Mesas em aberto", exact=True)
    expect(summary.locator(".open-tables-total strong")).to_contain_text("45,00")
    expect(summary.locator("tbody tr")).to_have_count(2)
    page.screenshot(path=str(out / "open-tables.png"))
    page.get_by_role("button", name="Fechar resumo das mesas", exact=True).click()
    print("PASS open-table estimate excludes partial payments and includes subtables once")

    page.locator(".pdv-table-card").filter(has_text="016").first.click(button="right")
    page.get_by_role("button", name="Ver historico da mesa", exact=True).click()
    history = page.locator(".professional-history-panel")
    expect(history.get_by_placeholder("001, 004, 021")).to_have_value("16")
    expect(history.locator("input[type=date]").first).to_have_value("")
    close_window()
    page.get_by_role("button", name="Caixa", exact=True).click()
    history = page.locator(".professional-history-panel")
    expect(history.get_by_placeholder("001, 004, 021")).to_have_value("")
    today = page.evaluate("new Date().toLocaleDateString('en-CA')")
    expect(history.locator("input[type=date]").first).to_have_value(today)
    history.locator("input[type=date]").first.fill("2000-01-01")
    close_window()
    page.get_by_role("button", name="Caixa", exact=True).click()
    history = page.locator(".professional-history-panel")
    expect(history.get_by_placeholder("001, 004, 021")).to_have_value("")
    expect(history.locator("input[type=date]").first).to_have_value(today)
    close_window()
    print("PASS table-history focus is consumed and normal reopen defaults to today")

    page.get_by_role("button", name="Abrir Menu Gerencial", exact=True).click()
    page.get_by_role("button", name="Ajuda e tutoriais", exact=True).click()
    help_panel = page.locator(".help-center")
    expect(help_panel.locator(".help-connection")).not_to_contain_text("qa-help-only")
    help_panel.get_by_role("button", name="Mostrar senha", exact=True).click()
    expect(help_panel.locator(".help-connection")).to_contain_text("qa-help-only")
    help_panel.get_by_role("button", name="Ocultar senha", exact=True).click()
    help_panel.locator(".help-search input").fill("conexao")
    assert help_panel.locator(".help-article").count() > 0
    help_panel.locator(".help-search input").fill("quantidades")
    article = help_panel.locator(".help-article").filter(has_text="só a categoria Café")
    article.locator("summary").click()
    page.screenshot(path=str(out / "help.png"))
    article.get_by_role("button", name="Abrir relatório de produtos", exact=True).click()
    expect(page.locator(".module-window-titlebar")).to_contain_text("Produtos por categoria")
    close_window()
    print("PASS searchable help, explicit password reveal and report shortcut")

    open_module("Contas a receber")
    panel = page.locator(".pdv-receivable-professional")
    panel.get_by_role("button", name="Novo cliente", exact=True).click()
    editor = page.locator(".pdv-customer-editor-modal")
    editor.locator("input").first.fill("QA Cliente direto")
    editor.get_by_role("button", name="Salvar cliente", exact=True).click()
    editor.wait_for(state="detached")
    panel.get_by_role("button", name="Novo", exact=True).click()
    draft = page.locator(".pdv-financial-editor-modal")
    draft.locator("label").filter(has_text="Descricao *").locator("input").fill("QA Cobrança preservada")
    draft.get_by_role("button", name="Novo cliente", exact=True).click()
    editor = page.locator(".pdv-customer-editor-modal")
    editor.locator("input").first.fill("QA Cliente na cobrança")
    editor.get_by_role("button", name="Salvar cliente", exact=True).click()
    editor.wait_for(state="detached")
    expect(draft.locator(".financial-customer-picker select option:checked")).to_have_text("QA Cliente na cobrança")
    expect(draft.locator("label").filter(has_text="Descricao *").locator("input")).to_have_value("QA Cobrança preservada")
    draft.locator("label").filter(has_text="Valor *").locator("input").fill("19,50")
    draft.get_by_role("button", name="Salvar conta", exact=True).click()
    draft.wait_for(state="detached")
    expect(panel.locator("tbody")).to_contain_text("QA Cobrança preservada")
    print("PASS customer creation from financial screen and nested draft preserves fields and selection")
    assert not errors, errors
    print("PASS no renderer errors")
    browser.close()
