"""Isolated ledger actions: duplicate drafts, receipts, compact filters and product inset."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
out=Path(__file__).resolve().parents[1]/'outputs/qa-ledger-actions'
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9369');page=browser.contexts[0].pages[0];page.set_default_timeout(15000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.wait_for_function('Boolean(window.caixa)')
    page.evaluate("""async()=>{
      const snap=await window.caixa.getPdvSnapshot();
      if(!snap.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-actions/'))throw Error('Isolated data required');
      const s=await window.caixa.getSnapshot();await window.caixa.saveSettings({...s.settings,notificationsEnabled:false,server:{...s.settings.server,port:46609,password:'qa-actions-only',autoConnection:{...s.settings.server.autoConnection,mode:'none'},permissions:{...s.settings.server.permissions,manageProducts:true,manageTables:true,create:true,view:true,edit:true,printReceipts:true}}});
      if(localStorage.getItem('qa.actions.seed'))return;
      const category=await window.caixa.savePdvCategory({name:'Diversos QA',active:true,favorite:false,sortOrder:0});
      await window.caixa.savePdvProduct({name:'Guardanapo QA',categoryId:category.id,price:25,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true,favorite:false,canBeComplement:false,hasComplements:false,complementProductIds:[],sortOrder:0,trackStock:false});
      const a=await window.caixa.savePdvPayable({description:'Café torrado QA',supplier:'Café Central',amount:120,documentNumber:'NF-QA-1',dueDate:'2026-11-20',preferredPaymentMethod:'Pix'});
      await window.caixa.payPdvPayable(a.id,{id:crypto.randomUUID(),payableId:a.id,createdAt:new Date().toISOString(),method:'Pix',amount:40},crypto.randomUUID());
      const c=await window.caixa.savePdvCustomer({name:'Maria QA',active:true});
      const r=await window.caixa.savePdvReceivable({customerId:c.id,description:'Encomenda QA',amount:60,dueDate:'2026-11-20',documentNumber:'DOC-QA'});
      await window.caixa.receivePdvReceivable(r.id,{id:crypto.randomUUID(),receivableId:r.id,createdAt:new Date().toISOString(),method:'Dinheiro',amount:15},crypto.randomUUID());
      localStorage.setItem('qa.actions.seed','1');
    }""")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    def open_module(page,title):
        if page.locator('.module-window-close').count():page.locator('.module-window-close').click();page.locator('.module-window-shell').wait_for(state='detached')
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    for title,selector,key,amount,original_balance in [('Contas a pagar','.pdv-payable-professional','payables','120',80),('Contas a receber','.pdv-receivable-professional','receivables','60',45)]:
        open_module(page,title);panel=page.locator(selector)
        original=page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].find(a=>a.description===(key==='payables'?'Café torrado QA':'Encomenda QA'))",key)
        panel.get_by_label('Buscar',exact=True).fill(original['description']);panel.locator('tbody tr').first.click()
        for width,height in [(1280,720),(1024,600)]:
            page.set_viewport_size({'width':width,'height':height})
            states=panel.locator('.financial-settlement-filter').bounding_box();filters=panel.locator('.simple-financial-filters').bounding_box()
            assert abs(states['x']+states['width']-filters['x']-filters['width'])<12,(states,filters)
            expect(panel.get_by_role('combobox',name='Período das contas',exact=True)).to_be_hidden()
            # The main filters fit inside the window, with no duplicate period control.
            assert panel.locator('.simple-financial-filters').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
            page.screenshot(path=str(out/f'{key}-filtros-{width}.png'))
        panel.locator('.financial-state-options summary').click()
        expect(panel.get_by_role('combobox',name='Período das contas',exact=True)).to_be_visible()
        panel.get_by_role('combobox',name='Período das contas',exact=True).select_option('today')
        panel.locator('.financial-state-options summary').click()
        panel.get_by_role('button',name='Duplicar',exact=True).click();editor=panel.locator('.financial-inline-editor')
        expect(editor.get_by_label('Valor *',exact=True)).to_have_value(amount+',00')
        count=page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].length",key)
        editor.get_by_role('button',name='Cancelar',exact=True).click()
        assert page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key].length",key)==count
        panel.get_by_role('button',name='Duplicar',exact=True).click();editor=panel.locator('.financial-inline-editor')
        editor.get_by_label('Descrição' if key=='payables' else 'Descricao *',exact=True).fill('Cópia QA '+key)
        editor.get_by_role('button',name='Salvar conta',exact=True).click();expect(editor).to_have_count(0)
        if page.get_by_role('button',name='Entendi',exact=True).count():page.get_by_role('button',name='Entendi',exact=True).click()
        accounts=page.evaluate("async key=>(await window.caixa.getPdvSnapshot())[key]",key)
        copied=next(a for a in accounts if a['description']=='Cópia QA '+key)
        assert copied['id']!=original['id'] and copied['balance']==int(amount) and len(copied['payments'])==0,copied
        source=next(a for a in accounts if a['id']==original['id']);assert source['balance']==original_balance and len(source['payments'])==1,source
        # Preview the original with its actual settlement history.
        panel.get_by_label('Buscar',exact=True).fill(original['description']);panel.locator('tbody tr').first.click()
        panel.get_by_role('button',name='Recibo',exact=True).click();receipt=page.get_by_role('dialog',name='Gerar recibo',exact=True)
        frame=receipt.frame_locator('iframe');expect(frame.locator('body')).to_contain_text('80,00' if key=='payables' else '45,00')
        if key=='payables':
            expect(frame.locator('body')).to_contain_text('FORNECEDOR: Café Central');expect(frame.locator('body')).to_contain_text('NF-QA-1');expect(frame.locator('body')).to_contain_text('40,00')
        for width,height in [(1280,720),(1024,600)]:
            page.set_viewport_size({'width':width,'height':height})
            result=receipt.evaluate('''e=>{const r=e.getBoundingClientRect(),c=e.querySelector('[aria-label="Fechar recibo"]').getBoundingClientRect(),f=e.querySelector('.receipt-modal-actions').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,closeRight:c.right,footer:f.bottom,overflow:e.scrollWidth>e.clientWidth+1,width:innerWidth,height:innerHeight}}''')
            assert result['left']>=12 and result['right']<=width-12 and result['top']>=12 and result['bottom']<=height-12 and result['closeRight']<=result['right'] and result['footer']<=result['bottom'] and not result['overflow'],result
            page.screenshot(path=str(out/f'{key}-recibo-{width}.png'))
        receipt.get_by_role('button',name='Cancelar',exact=True).click()
        print('PASS',title,': right-aligned settlement filters, period in extra menu, cancel/save duplicate without copying payments, receipt preview')
    open_module(page,'Produtos');panel=page.locator('.catalog-workspace');panel.locator('tbody tr').first.click();panel.get_by_role('button',name='Alterar',exact=True).click();editor=panel.locator('.catalog-inline-editor')
    for width,height in [(1280,720),(1024,600)]:
        page.set_viewport_size({'width':width,'height':height})
        for section in ['Dados e precos','Estoque e codigos']:
            editor.get_by_role('button',name=section,exact=True).click()
            result=editor.locator('.pdv-product-editor-body').evaluate("""e=>{
              const panel=e.querySelector('.pdv-editor-section'),input=panel.querySelector('input:not([type=checkbox])');const a=panel.getBoundingClientRect(),b=input.getBoundingClientRect();
              const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const stray=[];while(walker.nextNode())if(walker.currentNode.textContent.trim()==='0')stray.push(walker.currentNode.parentElement.tagName);
              return {left:b.left-a.left,right:a.right-b.right,stray,overflow:e.scrollWidth>e.clientWidth+1};
            }""")
            assert result['left']>=10 and result['right']>=10 and not result['stray'] and not result['overflow'],result
            page.screenshot(path=str(out/f'produto-{section}-{width}.png'))
    editor.get_by_role('button',name='Cancelar',exact=True).click()
    print('PASS product fields have internal margins at 1024/1280; stock disabled renders no stray numeric text')
    assert not errors,errors
    browser.close()
