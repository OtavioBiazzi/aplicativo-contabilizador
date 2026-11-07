from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path.cwd();out=root/'outputs/qa-close-reminders-20261101'
with sync_playwright() as p:
 sb=p.chromium.connect_over_cdp('http://127.0.0.1:9401');s=sb.contexts[0].pages[0]
 cb=p.chromium.connect_over_cdp('http://127.0.0.1:9402');c=cb.contexts[0].pages[0]
 for page in [s,c]:
  page.set_default_timeout(12000)
  page.set_viewport_size({'width':1280,'height':720})
  assert '/outputs/qa-close-reminders-20261101/' in page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).dataFile').replace('\\','/')
 s.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,notificationsEnabled:false,server:{...snap.settings.server,port:46641,password:'qa-reminders-only',autoConnection:{...snap.settings.server.autoConnection,mode:'none'},permissions:{...snap.settings.server.permissions,view:true,viewEntryValues:true,viewTotals:true,create:true,edit:true,manageTables:true,manageProducts:true,allowClientCustomization:false}}});await window.caixa.savePdvSettings({cashControlMode:'automatic',subtablesEnabled:true});await window.caixa.startServer(46641,'qa-reminders-only');}""")
 if s.get_by_text('Entrar como Servidor',exact=True).count():s.get_by_text('Entrar como Servidor',exact=True).click()
 s.locator('.professional-shell').wait_for()
 c.evaluate("""async()=>{const snap=await window.caixa.getSnapshot();await window.caixa.saveSettings({...snap.settings,notificationsEnabled:false,server:{...snap.settings.server,autoConnection:{...snap.settings.server.autoConnection,mode:'client',host:'http://127.0.0.1:46641',password:'qa-reminders-only',deviceName:'QA Reminders'}}});}""")
 c.reload()
 if c.get_by_text('Entrar como Cliente',exact=True).count():c.get_by_text('Entrar como Cliente',exact=True).click()
 c.locator('.professional-shell').wait_for(timeout=20000)
 def module(page,name):
  if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
  page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(name,exact=True).click()
 def close_module(page):
  if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
 def card(page,n):return page.locator('.pdv-table-card').filter(has=page.get_by_text(str(n).zfill(3),exact=True))
 s.evaluate('''async()=>{
   await window.caixa.savePdvSettings({skipPaymentConfirmation:true});
   if(localStorage.getItem('qa.reminder.seed'))return;
   const cat=await window.caixa.savePdvCategory({name:'QA Avisos',active:true,sortOrder:0});
   const coffee=await window.caixa.savePdvProduct({name:'Cafe QA',categoryId:cat.id,price:30,unit:'UNID',unitMode:'unidade',active:true,showOnPdv:true});
   const mango=await window.caixa.savePdvProduct({name:'Manga QA',categoryId:cat.id,price:10,unit:'KG',unitMode:'kg',active:true,showOnPdv:true});
   localStorage.setItem('qa.reminder.products',JSON.stringify({coffee,mango}));
   const item=(p,q,extra={})=>({id:crypto.randomUUID(),productId:p.id,productName:p.name,categoryName:'QA Avisos',quantity:q,unitPrice:p.price,discount:0,total:p.price*q,...extra});
   for(const n of [39,40,41,42,47]){await window.caixa.openPdvTable(n,2);await window.caixa.savePdvTableItems(n,n===42?[item(coffee,1),item(mango,2.43,{measureLabel:'2430 g'})]:[item(coffee,2,n===41?{subtableName:'Ana da Silva - comanda separada'}:{})],n===41?['Ana da Silva - comanda separada']:[],[]);}
   localStorage.setItem('qa.reminder.seed','1');
 }''')
 close_module(s)
 # Default is off in both roles, independent of informational notifications.
 assert s.evaluate("JSON.parse(localStorage.getItem('caixa.local-tables.server')||'{}').reminders||'off'")=='off'
 s.evaluate("async()=>await window.caixa.closePdvTable(39,[{id:crypto.randomUUID(),method:'Pix',amount:60}],0,crypto.randomUUID())")
 expect(c.locator('.table-close-reminders')).to_have_count(0)
 module(c,'Mesas');c.get_by_role('tab',name='Lembretes',exact=True).click();options=c.locator('.local-table-options')
 options.locator('select').select_option('always');options.locator('input[placeholder^="Ex."]').fill('47+')
 c.get_by_role('tab',name='Visual',exact=True).click();c.get_by_label('Ocultar o botão + só neste computador',exact=True).check()
 close_module(c);expect(c.locator('.pdv-quick-value-card')).to_have_count(0)
 assert s.locator('.pdv-quick-value-card').count()==1
 print('PASS defaults off; client local options editable without server customization permission; hide + is local')
 # Real client mixed checkout: split amount defaults to 30, cap card to 60, cash allows overpayment.
 card(c,40).click();c.get_by_role('button',name='Fechar conta',exact=True).click()
 close=c.locator('.pdv-close-menu');close.get_by_role('button',name='Fechar total',exact=False).click()
 receive=c.locator('.pdv-receive-modal');receive.get_by_role('button',name='Debito',exact=False).click()
 amount=c.locator('.pdv-payment-amount-modal');field=amount.locator('input:not([readonly])')
 expect(field).to_have_value('30');field.fill('9999');expect(field).to_have_value('60');field.fill('30')
 amount.get_by_role('button',name='OK',exact=True).click()
 receive.get_by_role('button',name='Dinheiro',exact=False).click();amount=c.locator('.pdv-payment-amount-modal');field=amount.locator('input:not([readonly])');field.fill('9999');expect(field).to_have_value('9999');amount.get_by_role('button',name='Cancelar',exact=True).click()
 receive.get_by_role('button',name='Pix',exact=False).click();c.locator('.pdv-payment-amount-modal').get_by_role('button',name='OK',exact=True).click()
 receive.get_by_role('button',name='Finalizar conta',exact=True).click();expect(receive).to_have_count(0)
 # Close optional receipt preview if configured.
 if c.locator('.pdv-receipt-preview').count():c.locator('.pdv-receipt-preview').get_by_role('button',name='Fechar',exact=True).click()
 c.wait_for_function("!!document.querySelector('.table-close-reminders article')")
 expect(c.locator('.table-close-reminders article')).to_have_count(1)
 expect(s.locator('.table-close-reminders')).to_have_count(0)
 assert s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===40).status')=='Livre'
 print('PASS real client split checkout; card cap; cash change; successful close reminder once; server stays off')
 # Excluded close, subtable close, stack and named layout.
 s.evaluate("async()=>await window.caixa.closePdvTable(47,[{id:crypto.randomUUID(),method:'Pix',amount:60}],0,crypto.randomUUID())")
 s.evaluate('''async()=>{const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===41);await window.caixa.savePdvTablePartial(41,t.items,[{id:crypto.randomUUID(),method:'Pix',amount:60}],0,crypto.randomUUID(),'',{kind:'subtable',subtableName:t.subtables[0],sessionId:t.sessionId})}''')
 expect(c.locator('.table-close-reminders article')).to_have_count(2)
 expect(c.locator('.table-close-reminders')).to_contain_text('Ana da Silva')
 # Persist across reload, dedup retries, hide while table is open.
 c.reload()
 if c.get_by_text('Entrar como Cliente',exact=True).count():c.get_by_text('Entrar como Cliente',exact=True).click()
 c.locator('.professional-shell').wait_for();expect(c.locator('.table-close-reminders article')).to_have_count(2)
 card(c,42).click();expect(c.locator('.table-close-reminders')).to_have_count(0)
 print('PASS exclusion 47+; named subtable; stacked reminders persist across reload and hide inside a table')
 c.locator('.pdv-cart-list').get_by_text('Manga QA',exact=False).click(button='right');c.get_by_role('button',name='Alterar valor (peso)',exact=True).click()
 edit=c.locator('.pdv-item-edit-modal');edit.get_by_label('Valor do item (R$)',exact=True).fill('30,00');expect(edit).to_contain_text('3000 g');edit.get_by_role('button',name='Confirmar',exact=True).click()
 c.locator('.pdv-cart-list').get_by_text('Manga QA',exact=False).click(button='right');c.get_by_role('button',name='Duplicar produto',exact=True).click()
 c.wait_for_function("document.querySelector('.pdv-cart-head')?.innerText.includes('7 item(ns)')")
 c.wait_for_timeout(300)
 items=s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===42).items')
 assert len(items)==3 and len(set(i['id'] for i in items))==3
 assert sum(i['total'] for i in items)==90
 c.screenshot(path=str(out/'cart-weight-duplicate.png'))
 print('PASS change value of weighed item recalculates weight over 1kg; context duplication has distinct IDs; compact integer count')
 # Cash-opening cancellation must release payment lock without losing drafted payments.
 s.evaluate("""async()=>{const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));await window.caixa.openPdvTable(43,1);await window.caixa.savePdvTableItems(43,[{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:1,unitPrice:30,discount:0,total:30}],[],[]);await window.caixa.savePdvSettings({cashControlMode:'manual'});} """)
 c.reload()
 if c.get_by_text('Entrar como Cliente',exact=True).count():c.get_by_text('Entrar como Cliente',exact=True).click()
 c.locator('.professional-shell').wait_for();card(c,43).click();c.get_by_role('button',name='Fechar conta',exact=True).click();c.locator('.pdv-close-menu').get_by_role('button',name='Fechar total',exact=False).click()
 receive=c.locator('.pdv-receive-modal');receive.get_by_role('button',name='Pix',exact=False).click();c.locator('.pdv-payment-amount-modal').get_by_role('button',name='OK',exact=True).click();receive.get_by_role('button',name='Finalizar conta',exact=True).click()
 c.locator('.pdv-cash-shift-modal').get_by_role('button',name='Cancelar',exact=True).click();expect(receive.get_by_role('button',name='Finalizar conta',exact=True)).to_be_enabled()
 s.evaluate("async()=>await window.caixa.savePdvSettings({cashControlMode:'automatic'})")
 c.wait_for_timeout(300);receive.get_by_role('button',name='Finalizar conta',exact=True).click();expect(receive).to_have_count(0)
 print('PASS cancel cash opening and retry checkout without leaving table')
 # Only OK acknowledges notices, with no expiry; standard table cards have equal heights.
 rows=c.locator('.table-close-reminders article');expect(rows).to_have_count(3)
 boxes=rows.bounding_box() if rows.count()==1 else rows.evaluate_all('(es)=>es.map(e=>({width:e.offsetWidth,height:e.offsetHeight}))')
 assert boxes[0]['width']==boxes[1]['width']==boxes[2]['width']
 assert boxes[0]['height']==boxes[2]['height']
 c.screenshot(path=str(out/'reminder-stack.png'))
 c.locator('.table-close-reminders button').first.click();expect(rows).to_have_count(2)
 # Re-delivering the same acknowledged event must not re-create a notice.
 s.evaluate("""async()=>{const sale=(await window.caixa.getPdvSnapshot()).recentSales.find(s=>s.tableNumber===40);await window.caixa.closePdvTable(40,sale.payments,0,sale.operationId)}""")
 expect(rows).to_have_count(2)
 for size in [{'width':1024,'height':600},{'width':1280,'height':720}]:
  c.set_viewport_size(size);box=c.locator('.table-close-reminders').bounding_box();assert box['x']>=0 and box['y']>=0 and box['x']+box['width']<=size['width']
  c.screenshot(path=str(out/f"reminders-{size['width']}.png"))
 print('PASS uniform widths/normal heights, OK acknowledgment, retry dedup and 1024x600/1280x720 bounds')
 # History filters remain usable after returning/cancelling a checkout.
 card(c,42).click();c.get_by_role('button',name='Fechar conta',exact=True).click();c.locator('.pdv-close-menu').get_by_role('button',name='Fechar total',exact=False).click();c.locator('.pdv-receive-modal').get_by_role('button',name='Voltar',exact=True).click();c.locator('.pdv-close-menu').get_by_role('button',name='Voltar',exact=False).click()
 c.locator('.pdv-table-cart-actions').get_by_role('button',name='Cancelar',exact=True).click()
 c.get_by_role('button',name='Cancelar mesa inteira',exact=True).click();expect(c.locator('.pdv-cart-area')).to_have_count(0)
 c.get_by_role('button',name='Caixa',exact=True).click()
 c.get_by_label('Mesa exata',exact=True).fill('040');expect(c.locator('tbody tr')).to_have_count(1)
 c.get_by_label('Mesa exata',exact=True).fill('040, 042');expect(c.locator('tbody tr')).to_have_count(2)
 c.get_by_role('combobox',name='Status',exact=True).select_option('cancelled');expect(c.locator('tbody tr')).to_have_count(1);expect(c.locator('tbody')).to_contain_text('Cancelado')
 c.get_by_role('button',name='Limpar',exact=True).click();expect(c.locator('tbody tr')).to_have_count(6)
 c.get_by_role('combobox',name='Pagamento',exact=True).select_option('Debito');expect(c.locator('tbody tr')).to_have_count(1);expect(c.locator('tbody')).to_contain_text('30,00')
 c.screenshot(path=str(out/'history-filters.png'));close_module(c)
 print('PASS abort checkout, cancel table, history exact-list/status/reset/payment filters')
 # A committed closure whose response is lost must be retryable, without duplicate sale or reminder.
 s.evaluate("""async()=>{const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));await window.caixa.openPdvTable(45,1);await window.caixa.savePdvTableItems(45,[{id:crypto.randomUUID(),productId:coffee.id,productName:coffee.name,categoryName:'QA',quantity:1,unitPrice:30,discount:0,total:30}],[],[]);} """)
 c.get_by_placeholder('Mesa, submesa ou digite Produtos: e pressione Enter',exact=True).fill('045')
 card(c,45).click();c.get_by_role('button',name='Fechar conta',exact=True).click();c.locator('.pdv-close-menu').get_by_role('button',name='Fechar total',exact=False).click()
 receive=c.locator('.pdv-receive-modal');receive.get_by_role('button',name='Pix',exact=False).click();c.locator('.pdv-payment-amount-modal').get_by_role('button',name='OK',exact=True).click()
 def lose_response(route):
  result=route.fetch();assert result.ok;route.abort('failed')
 c.route('**/api/pdv/tables/45/close',lose_response,times=1)
 receive.get_by_role('button',name='Finalizar conta',exact=True).click()
 c.get_by_role('button',name='Entendi',exact=True).click()
 expect(receive.get_by_role('button',name='Finalizar conta',exact=True)).to_be_enabled()
 receive.get_by_role('button',name='Finalizar conta',exact=True).click();expect(receive).to_have_count(0)
 assert s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).recentSales.filter(s=>s.tableNumber===45).length')==1
 print('PASS lost response after server commit: retry unlocks, exactly one sale and no vanished item')
 module(c,'Mesas');c.get_by_role('tab',name='Lembretes',exact=True).click();options=c.locator('.local-table-options');options.locator('select').select_option('off');close_module(c);expect(c.locator('.table-close-reminders')).to_have_count(0)
 module(c,'Mesas');c.get_by_role('tab',name='Lembretes',exact=True).click();options=c.locator('.local-table-options');options.locator('select').select_option('weekdays')
 c.screenshot(path=str(out/'local-options.png'));options.locator('select').select_option('always');close_module(c)
 expect(c.locator('.table-close-reminders article')).to_have_count(3)
 assert s.evaluate("JSON.parse(localStorage.getItem('caixa.local-tables.server')||'{}').reminders||'off'")=='off'
 print('PASS disable/re-enable keeps pending reminders; server preferences remain unchanged')
