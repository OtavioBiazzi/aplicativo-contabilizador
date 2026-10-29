"""Verify compact catalog/client registrations on isolated CDP 9367."""
from pathlib import Path
from time import time_ns
from playwright.sync_api import sync_playwright, expect
run=str(time_ns())[-6:]
out=Path(__file__).resolve().parents[1]/'outputs/qa-ledger-layout'
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9367');page=browser.contexts[0].pages[0]
    page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate("""async()=>{
      const snap=await window.caixa.getPdvSnapshot();
      if(!snap.dataFile.replaceAll('\\\\','/').includes('/outputs/qa-ledger-layout/'))throw Error('Isolated fixture required');
      if(localStorage.getItem('qa.catalog.seed'))return;
      const category=snap.categories.find(c=>c.name==='Cafés')||await window.caixa.savePdvCategory({name:'Cafés',active:true,favorite:false,sortOrder:0});
      await window.caixa.savePdvSettings({complementsEnabled:true});
      for(let n=1;n<=32;n++)await window.caixa.savePdvProduct({name:'Café '+String(n).padStart(2,'0'),categoryId:category.id,price:7,costPrice:3,unit:'UNID',unitMode:'unidade',favorite:false,hasComplements:false,complementProductIds:[],sortOrder:0,sku:'CF-'+n,active:true,showOnPdv:true,trackStock:true,stockQuantity:20,minimumStock:2,canBeComplement:n==1});
      localStorage.setItem('qa.catalog.seed','1');
    }""")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    def open_module(title):
        if page.locator('.module-window-close').count():
            page.locator('.module-window-close').click();page.locator('.module-window-shell').wait_for(state='detached')
        page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click();page.locator('.managerial-menu').get_by_text(title,exact=True).click()
    def check_bounds(panel):
        bounds=panel.evaluate("""e=>{const r=e.getBoundingClientRect(), m=e.closest('.module-window-body').getBoundingClientRect();const f=e.querySelector('.financial-inline-editor .pdv-action-row,.finance-grid-footer').getBoundingClientRect();return {scroll:e.scrollWidth,width:e.clientWidth,bottom:r.bottom,limit:m.bottom,footer:f.bottom}}""")
        assert bounds['scroll']<=bounds['width']+1 and bounds['bottom']<=bounds['limit']+1 and bounds['footer']<=bounds['limit']+1,bounds
    open_module('Produtos');panel=page.locator('.catalog-workspace')
    for width,height in [(1280,720),(1024,600)]:
        page.set_viewport_size({'width':width,'height':height});check_bounds(panel)
        page.screenshot(path=str(out/f'produtos-{width}.png'))
        panel.get_by_role('button',name='Novo',exact=True).click();editor=panel.locator('.catalog-inline-editor')
        check_bounds(panel);page.screenshot(path=str(out/f'produto-registro-{width}.png'))
        for section in ['Dados e precos','Estoque e codigos','Disponibilidade','Adicionais']:
            editor.get_by_role('button',name=section,exact=True).click();check_bounds(panel)
            page.screenshot(path=str(out/f'produto-{section}-{width}.png'))
        editor.get_by_role('button',name='Cancelar',exact=True).click()
    page.set_viewport_size({'width':1280,'height':720})
    total=page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).products.length')
    expect(panel.locator('tbody tr')).to_have_count(25)
    panel.get_by_role('button',name='Próxima página',exact=True).click();expect(panel.locator('tbody tr')).to_have_count(total-25)
    panel.get_by_role('button',name='Página anterior',exact=True).click()
    panel.get_by_label('Buscar cadastro',exact=True).fill('cafe 01');expect(panel.locator('tbody tr')).to_have_count(1)
    panel.locator('tbody tr').first.click();panel.get_by_role('button',name='Alterar',exact=True).click()
    editor=panel.locator('.catalog-inline-editor');editor.get_by_label('Preco de venda',exact=True).fill('9,50')
    editor.get_by_role('button',name='Estoque e codigos',exact=True).click();editor.get_by_label('Quantidade atual',exact=True).fill('25')
    editor.get_by_role('button',name='Salvar produto',exact=True).click();expect(editor).to_have_count(0)
    saved=page.evaluate("async()=>(await window.caixa.getPdvSnapshot()).products.find(p=>p.name==='Café 01')")
    assert saved['price']==9.5 and saved['stockQuantity']==25,saved
    panel.get_by_label('Buscar cadastro',exact=True).fill('cafe 02');panel.get_by_role('checkbox',name='Selecionar Café 02',exact=True).check()
    panel.get_by_role('button',name='Ocultar',exact=True).click()
    expect(panel.locator('tbody tr').first).to_contain_text('Oculto')
    panel.get_by_role('tab',name='Categorias',exact=True).click();panel.get_by_role('button',name='Novo',exact=True).click()
    editor=panel.locator('.catalog-inline-editor');editor.get_by_label('Nome',exact=True).fill('Bebidas QA '+run)
    editor.get_by_role('button',name='Salvar categoria',exact=True).click();expect(editor).to_have_count(0)
    assert page.evaluate("async()=>(await window.caixa.getPdvSnapshot()).categories.some(c=>c.name.startsWith('Bebidas QA'))")
    panel.get_by_role('tab',name='Importação',exact=True).click();expect(panel.get_by_text('Importar arquivo Excel ou CSV',exact=True)).to_be_visible()
    print('PASS products: 1024/1280 layout, pagination, accent-insensitive search, price/stock editing, bulk hide, categories and import access')
    open_module('Clientes');panel=page.locator('.pdv-customer-professional')
    for width,height in [(1280,720),(1024,600)]:
        page.set_viewport_size({'width':width,'height':height});check_bounds(panel);page.screenshot(path=str(out/f'clientes-{width}.png'))
        panel.get_by_role('button',name='Novo',exact=True).click();editor=panel.locator('.catalog-inline-editor');check_bounds(panel)
        page.screenshot(path=str(out/f'cliente-registro-{width}.png'));editor.get_by_role('button',name='Cancelar',exact=True).click()
    panel.get_by_role('button',name='Novo',exact=True).click();editor=panel.locator('.catalog-inline-editor')
    editor.get_by_label('Nome *',exact=True).fill('João QA '+run);editor.get_by_label('Telefone',exact=True).fill('11999999999')
    editor.get_by_role('button',name='Salvar cliente',exact=True).click();expect(editor).to_have_count(0)
    panel.get_by_label('Buscar cliente',exact=True).fill('joao QA '+run);expect(panel.locator('tbody tr')).to_have_count(1)
    panel.locator('tbody tr').first.click();panel.get_by_role('button',name='Alterar',exact=True).click()
    editor=panel.locator('.catalog-inline-editor');editor.get_by_label('E-mail',exact=True).fill('qa@example.com')
    editor.get_by_role('button',name='Salvar cliente',exact=True).click();expect(editor).to_have_count(0)
    assert page.evaluate("async()=>(await window.caixa.getPdvSnapshot()).customers.some(c=>c.name.startsWith('João QA')&&c.email==='qa@example.com')")
    panel.get_by_label('Buscar cliente',exact=True).fill('Maria');panel.locator('tbody tr').first.click()
    panel.locator('.finance-command-bar').get_by_role('button',name='Contas pendentes',exact=False).click()
    expect(page.locator('.pdv-customer-detail-modal')).to_be_visible()
    page.screenshot(path=str(out/'cliente-contas-pendentes.png'))
    print('PASS clients: 1024/1280 layout, create/edit/cancel, accent-insensitive search and pending accounts access')
    assert not errors,errors
    browser.close()
