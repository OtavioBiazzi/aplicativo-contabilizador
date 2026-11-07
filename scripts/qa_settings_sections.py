"""Settings organization on isolated CDP 9401/9402 fixture from qa_close_reminders.py."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1];out=root/'outputs/qa-close-reminders-20261101'
with sync_playwright() as p:
 s=p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
 c=p.chromium.connect_over_cdp('http://127.0.0.1:9402').contexts[0].pages[0]
 errors=[]
 for page in [s,c]:
  page.set_default_timeout(12000);page.on('pageerror',lambda e:errors.append(str(e)))
  assert '/outputs/qa-close-reminders-20261101/' in page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).dataFile').replace('\\','/')
 def module(page,name):
  if page.locator('.module-window-close').count():page.locator('.module-window-close').click()
  page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(name,exact=True).click()
 def close(page):page.locator('.module-window-close').click()
 for page in [s,c]:
  module(page,'Aparencia')
  expect(page.get_by_role('tab',name='Interface',exact=True)).to_have_attribute('aria-selected','true')
  expect(page.get_by_role('combobox',name='Altura do cabecalho',exact=True)).to_be_visible()
  expect(page.get_by_role('combobox',name='Mesas por linha',exact=True)).to_have_count(0)
  expect(page.locator('.local-table-options')).to_have_count(0)
  page.get_by_role('tab',name='Venda e produtos',exact=True).click()
  expect(page.get_by_role('combobox',name='Produtos por linha',exact=True)).to_be_visible()
  expect(page.get_by_role('combobox',name='Mesas por linha',exact=True)).to_have_count(0)
  expect(page.get_by_text('Ocultar legenda de status',exact=True)).to_have_count(0)
  page.get_by_role('tab',name='Avisos gerais',exact=True).click()
  expect(page.get_by_role('combobox',name='Tempo dos avisos',exact=True)).to_be_visible()
  expect(page.locator('.local-table-options')).to_have_count(0)
 print('PASS Appearance groups interface, product layout and general notices; no table settings duplicated')
 # Product appearance on restricted client must save to client-only storage on tab switch.
 c.get_by_role('tab',name='Venda e produtos',exact=True).click()
 c.get_by_role('combobox',name='Produtos por linha',exact=True).select_option('6')
 c.get_by_role('tab',name='Interface',exact=True).click()
 assert c.evaluate("JSON.parse(localStorage.getItem('caixa.pdv.client-visual-settings.client')).gridColumns")==6
 close(c);c.get_by_role('button',name='Venda',exact=True).click()
 assert c.locator('.pdv-product-grid').evaluate("e=>e.style.getPropertyValue('--pdv-grid-cols')")=='6'
 c.get_by_role('button',name='Mesas',exact=True).click()
 # Local table layout remains separate from server defaults; quick + is on Visual only.
 before=s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).settings')
 module(c,'Mesas');expect(c.get_by_role('tab',name='Funcionamento',exact=True)).to_have_attribute('aria-selected','true')
 expect(c.get_by_text('Configuração controlada pelo servidor',exact=True)).to_be_visible()
 c.get_by_role('tab',name='Visual',exact=True).click()
 expect(c.get_by_role('combobox',name='Mesas por linha',exact=True)).to_be_enabled()
 c.get_by_role('combobox',name='Mesas por linha',exact=True).select_option('11')
 c.get_by_label('Altura das mesas',exact=True).fill('78')
 c.get_by_label('Ocultar o botão + só neste computador',exact=True).uncheck()
 c.get_by_role('tab',name='Lembretes',exact=True).click()
 expect(c.locator('.local-table-options')).to_be_visible()
 expect(c.get_by_role('combobox',name='Mesas por linha',exact=True)).to_have_count(0)
 expect(c.get_by_label('Ocultar o botão + só neste computador',exact=True)).to_have_count(0)
 saved=c.evaluate("JSON.parse(localStorage.getItem('caixa.pdv.client-visual-settings.client'))")
 assert saved['tableColumns']==11 and saved['tableCardHeight']==78 and saved['gridColumns']==6
 c.get_by_role('tab',name='Visual',exact=True).click();c.get_by_label('Altura das mesas',exact=True).fill('96');c.get_by_role('tab',name='Lembretes',exact=True).click()
 close(c)
 assert c.locator('.pdv-table-grid').evaluate("e=>e.style.getPropertyValue('--pdv-table-cols')")=='11'
 expect(c.locator('.pdv-quick-value-card')).to_have_count(1)
 after=s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).settings')
 assert before['tableColumns']==after['tableColumns'] and before['tableCardHeight']==after['tableCardHeight']
 assert s.evaluate("JSON.parse(localStorage.getItem('caixa.pdv.client-visual-settings.server')||'{}').tableColumns||null") is None
 print('PASS local client visuals autosave across tab changes and update live; server defaults unaffected')
 # Shared structure on server still saves before opening local tabs.
 module(s,'Mesas');s.get_by_label('Quantidade de mesas',exact=True).fill('48')
 s.get_by_role('tab',name='Visual',exact=True).click()
 assert s.evaluate('async()=>(await window.caixa.getPdvSnapshot()).settings.tableCount')==48
 expect(s.get_by_role('combobox',name='Mesas por linha',exact=True)).to_be_visible()
 s.get_by_role('tab',name='Funcionamento',exact=True).click();expect(s.get_by_label('Quantidade de mesas',exact=True)).to_have_value('48')
 close(s)
 print('PASS shared table structure and local visual tabs have independent saves')
 for size in [{'width':1024,'height':600},{'width':1280,'height':720}]:
  c.set_viewport_size(size)
  rows=c.locator('.table-close-reminders article');assert rows.count()>=2
  dimensions=rows.evaluate_all('(es)=>es.map(e=>({w:e.offsetWidth,h:e.offsetHeight,text:e.innerText}))')
  assert all(d['w']<=210 for d in dimensions)
  assert rows.first.locator('button').evaluate('e=>getComputedStyle(e).color===getComputedStyle(e.closest("article")).color')
  normal=[d for d in dimensions if 'Retirar comanda' in d['text']];assert all(d['h']<=50 for d in normal)
  named=next(d for d in dimensions if 'Ana da Silva' in d['text']);assert 'Mesa 41' in named['text'] and 'comanda separada' in named['text']
  c.screenshot(path=str(out/f'compact-notices-{size["width"]}.png'))
  module(c,'Mesas');c.get_by_role('tab',name='Visual',exact=True).click();c.screenshot(path=str(out/f'table-visual-tabs-{size["width"]}.png'))
  c.get_by_role('tab',name='Lembretes',exact=True).click();c.screenshot(path=str(out/f'table-reminder-tabs-{size["width"]}.png'));close(c)
 assert not errors,errors
 print('PASS compact notices <=210x50, table+subtable identification and layout at 1024x600/1280x720; no JS errors')
