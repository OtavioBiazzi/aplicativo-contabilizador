"""Prevent payment fields from overflowing the compact payable editor (isolated CDP 9365)."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path(__file__).resolve().parents[1]/'outputs/qa-payable-fit'
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9365')
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(12000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    assert '/outputs/qa-payable-fit/' in page.evaluate("async()=>(await window.caixa.getPdvSnapshot()).dataFile.replaceAll('\\\\','/')")
    page.reload()
    if page.get_by_text('Entrar como Servidor',exact=True).count():page.get_by_text('Entrar como Servidor',exact=True).click()
    page.get_by_role('button',name='Abrir Menu Gerencial',exact=True).click()
    page.locator('.managerial-menu').get_by_text('Contas a pagar',exact=True).click()
    page.locator('.pdv-payable-professional tbody tr').first.click()
    page.get_by_role('button',name='Alterar',exact=True).click()
    editor=page.locator('.simple-payable-editor')
    editor.locator('summary').filter(has_text='Pagamentos registrados').click()
    def check_bounds():
        result=editor.evaluate("""e=>{
          const body=e.querySelector('.payable-editor-body');
          const bounds=e.getBoundingClientRect();
          const nodes=[body,...e.querySelectorAll('.payable-editor-payments,.payable-editor-payment-row,.payable-editor-payment-row label,.payable-editor-payment-row input,.payable-editor-payment-row select,.payable-editor-section-head button,.payable-editor-payment-row button')];
          return {bodyWidth:body.clientWidth,scrollWidth:body.scrollWidth,bad:nodes.filter(x=>{const r=x.getBoundingClientRect();return r.left<bounds.left+1||r.right>bounds.right-1}).map(x=>x.className||x.tagName)};
        }""")
        assert result['scrollWidth']<=result['bodyWidth']+1,result
        assert not result['bad'],result
        footer=editor.locator('.modal-actions').bounding_box()
        assert footer['y']>=0 and footer['y']+footer['height']<=page.viewport_size['height'],footer
    for width,height in [(1280,720),(1024,600),(800,600)]:
        page.set_viewport_size({'width':width,'height':height})
        check_bounds()
        editor.locator('.payable-editor-payment-row input').last.focus()
        check_bounds()
        page.screenshot(path=str(out/f'fixed-{width}.png'))
    page.set_viewport_size({'width':1024,'height':600})
    narrow=page.add_style_tag(content='#root .simple-payable-editor {width:420px !important}')
    check_bounds()
    page.screenshot(path=str(out/'fixed-narrow-form.png'))
    narrow.evaluate('(e)=>e.remove()')
    print('PASS payment controls remain inside editor at 1280, 1024, 800 and a 420px form; no horizontal scroll after focus')
    row=editor.locator('.payable-editor-payment-row').first
    row.get_by_label('Valor',exact=True).fill('40')
    row.get_by_label('Observação',exact=True).fill('Pagamento conferido')
    editor.get_by_role('button',name='Adicionar',exact=True).click()
    rows=editor.locator('.payable-editor-payment-row')
    expect(rows).to_have_count(2)
    rows.last.get_by_role('combobox',name='Forma',exact=True).select_option('Dinheiro')
    rows.last.get_by_label('Valor',exact=True).fill('75')
    check_bounds()
    expect(editor.locator('.payable-balance-summary .remaining')).to_contain_text('5,00')
    editor.get_by_role('button',name='Adicionar',exact=True).click()
    expect(rows).to_have_count(3)
    rows.last.get_by_title('Remover pagamento',exact=True).click()
    expect(rows).to_have_count(2)
    editor.get_by_role('button',name='Salvar conta',exact=True).click()
    editor.wait_for(state='detached')
    saved=page.evaluate('async()=>(await window.caixa.getPdvSnapshot()).payables[0]')
    assert saved['balance']==5 and saved['paidAmount']==115 and len(saved['payments'])==2,saved
    assert saved['payments'][0]['description']=='Pagamento conferido',saved
    assert saved['payments'][1]['method']=='Dinheiro',saved
    print('PASS edit/add/remove multiple payments and save methods, note and remaining balance')
    assert not errors,errors
    browser.close()
