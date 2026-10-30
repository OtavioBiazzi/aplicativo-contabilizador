"""Packaged 0.4.13 server/client receipt and privacy checks, with isolated native PDF save."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
out=root/'outputs/qa-release-0.4.13'
with sync_playwright() as p:
    sb=p.chromium.connect_over_cdp('http://127.0.0.1:9381');server=sb.contexts[0].pages[0]
    cb=p.chromium.connect_over_cdp('http://127.0.0.1:9382');client=cb.contexts[0].pages[0]
    errors=[]
    for page in [server,client]:
        page.set_default_timeout(20000);page.set_viewport_size({'width':1024,'height':600})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.wait_for_function('Boolean(window.caixa)')
        assert page.evaluate("()=>window.caixa.getAppVersion()")=='0.4.13'
        assert '/outputs/qa-release-0.4.13/' in page.evaluate("async()=>(await window.caixa.getPdvSnapshot()).dataFile").replace('\\','/')
    privacy=server.evaluate("""async()=>{
      const app=await window.caixa.getSnapshot(),snap=await window.caixa.getPdvSnapshot();
      const s=await window.caixa.saveSettings({...app.settings,notificationsEnabled:false,privacy:{enabled:true,activeProfileId:'private',hideHeaderTotal:true,hideReportTotals:true,historyValues:'hide',profiles:[
        {id:'normal',name:'Aberto',hideHeaderTotal:false,hideReportTotals:false,historyValues:'show'},
        {id:'private',name:'Reservado',hideHeaderTotal:true,hideReportTotals:true,historyValues:'hide'}
      ]},server:{...app.settings.server,port:46613,password:'qa-release-only',autoConnection:{...app.settings.server.autoConnection,mode:'none'},permissions:{...app.settings.server.permissions,view:true,viewTotals:true,viewEntryValues:true,create:true,edit:true,manageTables:true,printReceipts:true}}});
      if(!snap.products.some(x=>x.name==='Produto release QA')){
        const c=await window.caixa.savePdvCategory({name:'QA',active:true,favorite:false,sortOrder:0});
        const product=await window.caixa.savePdvProduct({name:'Produto release QA',categoryId:c.id,price:37,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true,favorite:false,sortOrder:0});
        await window.caixa.saveDirectSale([{id:crypto.randomUUID(),productId:product.id,productName:'Produto release QA',categoryName:'QA',quantity:1,unitPrice:37,total:37,discount:0}],0,[{id:crypto.randomUUID(),method:'Pix',amount:37,customerName:'Cliente release QA'}]);
        const payable=await window.caixa.savePdvPayable({description:'Despesa release QA',supplier:'Fornecedor QA',amount:120});
        await window.caixa.payPdvPayable(payable.id,{id:crypto.randomUUID(),payableId:payable.id,createdAt:new Date().toISOString(),method:'Pix',amount:40},crypto.randomUUID());
        const customer=await window.caixa.savePdvCustomer({name:'Cliente release QA',active:true});
        const receivable=await window.caixa.savePdvReceivable({customerId:customer.id,description:'Conta release QA',amount:60});
        await window.caixa.receivePdvReceivable(receivable.id,{id:crypto.randomUUID(),receivableId:receivable.id,createdAt:new Date().toISOString(),method:'Pix',amount:15},crypto.randomUUID());
      }
      return s.privacy;
    }""")
    assert privacy['historyValues']=='show'
    server.reload()
    if server.get_by_text('Entrar como Servidor',exact=True).count():server.get_by_text('Entrar como Servidor',exact=True).click()
    server.locator('.professional-shell').wait_for()
    server.evaluate("()=>window.caixa.startServer(46613,'qa-release-only')")
    client.evaluate("""async privacy=>{
      const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,privacy,server:{...s.settings.server,autoConnection:{...s.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46613',password:'qa-release-only',deviceName:'QA Release 0.4.13'}}});
    }""",privacy)
    client.reload()
    if client.get_by_text('Entrar como Cliente',exact=True).count():client.get_by_text('Entrar como Cliente',exact=True).click()
    client.locator('.professional-shell').wait_for()
    def close_module(page):
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
    def module(page,title):
        close_module(page);page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    for page,label in [(server,'server'),(client,'client')]:
        page.get_by_role('button',name='Caixa',exact=True).click()
        history=page.locator('.professional-history-panel')
        history.get_by_label('Buscar',exact=True).fill('Produto release QA')
        row=history.locator('tbody tr').first;expect(row).to_contain_text('37,00')
        expect(history.locator('.history-summary-strip')).to_contain_text('Privado')
        expect(page.locator('.topbar-card-button')).to_contain_text('Privado')
        expect(row.get_by_title('Editar',exact=True)).to_be_enabled()
        expect(row.get_by_role('button',name='Ver produtos e pagamentos',exact=True)).to_be_enabled()
        row.get_by_role('button',name='Gerar recibo ou cupom',exact=True).click()
        receipt=page.get_by_role('dialog',name='Gerar recibo',exact=True)
        expect(receipt.frame_locator('iframe').locator('body')).to_contain_text('37,00')
        page.screenshot(path=str(out/f'{label}-history-receipt.png'))
        receipt.get_by_role('button',name='Salvar PDF',exact=True).click();expect(receipt).to_have_count(0)
        for title,selector,query,balance in [('Contas a pagar','.pdv-payable-professional','Despesa release QA','80,00'),('Contas a receber','.pdv-receivable-professional','Conta release QA','45,00')]:
            module(page,title);panel=page.locator(selector);panel.get_by_label('Buscar',exact=True).fill(query);panel.locator('tbody tr').first.click()
            panel.get_by_role('button',name='Recibo',exact=True).click();receipt=page.get_by_role('dialog',name='Gerar recibo',exact=True)
            expect(receipt.frame_locator('iframe').locator('body')).to_contain_text(balance)
            receipt.get_by_role('button',name='Salvar PDF',exact=True).click();expect(receipt).to_have_count(0)
        print('PASS packaged',label,'0.4.13: totals hidden, values/actions/receipts accessible; history/payable/receivable PDFs saved')
    results=server.evaluate("""async()=>{
      const settings=(await window.caixa.getPdvSnapshot()).settings,results=[];
      for(const [paper,count] of [['58',2],['80',200],['a4',100]]){
        const sale={id:'release-'+paper,createdAt:new Date().toISOString(),type:'Venda direta',status:'Finalizada',subtotal:count*7,discount:0,total:count*7,payments:[{id:'qa',method:'Pix',amount:count*7}],
          items:Array.from({length:count},(_,i)=>({id:'qa-'+i,productId:'qa-'+i,productName:'Cafe release QA '+String(i+1).padStart(3,'0'),categoryName:'QA',quantity:1,unitPrice:7,total:7,discount:0,note:'Observacao de conferencia do recibo e da quebra de pagina.'}))};
        const result=await window.caixa.printPdvReceipt(sale,undefined,undefined,{action:'save',receiptSettings:{...settings,receiptPaperWidth:paper,receiptGroupIdenticalItems:false,receiptFooter:'FIM RELEASE QA'}});
        if(!result.ok)throw Error(result.message);
        results.push({paper,count,filePath:result.filePath});
      }
      return results;
    }""")
    import json
    (out/'pdf-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    assert not errors,errors
    print('PASS packaged PDF engine: 58mm, long 80mm and A4 documents generated; no renderer errors or physical print jobs')
    cb.close();sb.close()
