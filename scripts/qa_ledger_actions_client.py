"""Remote client duplicate/receipt actions with server-managed finances."""
from pathlib import Path
from time import time_ns
from playwright.sync_api import sync_playwright, expect
out=Path(__file__).resolve().parents[1]/'outputs/qa-ledger-actions'
with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9369');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9370');client=cb.contexts[0].pages[0];client.set_default_timeout(20000)
    errors=[];client.on('pageerror',lambda e:errors.append(str(e)))
    server.evaluate("""async()=>{const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,server:{...s.settings.server,permissions:{...s.settings.server.permissions,manageTables:true,create:true,view:true,edit:true,printReceipts:true,allowClientCustomization:false}}});await window.caixa.startServer(46609,'qa-actions-only')}""")
    client.wait_for_function('Boolean(window.caixa)')
    client.evaluate("""async()=>{
      const pdv=await window.caixa.getPdvSnapshot();if(!pdv.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-actions/client/'))throw Error('Isolated client required');
      const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46609',password:'qa-actions-only',deviceName:'QA Financeiro'}}});
    }""")
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    for title,selector,key,source,amount,balance in [('Contas a pagar','.pdv-payable-professional','payables','Café torrado QA',120,80),('Contas a receber','.pdv-receivable-professional','receivables','Encomenda QA',60,45)]:
        if client.locator('.module-window-close').count():client.locator('.module-window-close').click();client.locator('.module-window-shell').wait_for(state='detached')
        client.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();client.locator('.managerial-menu').get_by_text(title,exact=True).click()
        panel=client.locator(selector);panel.get_by_label('Buscar',exact=True).fill(source);panel.locator('tbody tr').first.click()
        panel.get_by_role('button',name='Recibo',exact=True).click();receipt=client.get_by_role('dialog',name='Gerar recibo',exact=True)
        expect(receipt.frame_locator('iframe').locator('body')).to_contain_text(str(balance)+',00')
        receipt.get_by_role('button',name='Cancelar',exact=True).click()
        panel.get_by_role('button',name='Duplicar',exact=True).click();editor=panel.locator('.financial-inline-editor')
        label='Descrição' if key=='payables' else 'Descricao *';description='Cópia cliente '+key+' '+str(time_ns())[-7:]
        editor.get_by_label(label,exact=True).fill(description);editor.get_by_role('button',name='Salvar conta',exact=True).click();expect(editor).to_have_count(0)
        if client.get_by_role('button',name='Entendi',exact=True).count():client.get_by_role('button',name='Entendi',exact=True).click()
        saved=server.evaluate("async({key,description})=>(await window.caixa.getPdvSnapshot())[key].find(a=>a.description===description)",{'key':key,'description':description})
        assert saved and saved['balance']==amount and len(saved['payments'])==0,saved
        print('PASS client',key,': receipt preview and server-persisted duplicate without copied settlements')
    assert not errors,errors
    cb.close();sb.close()
