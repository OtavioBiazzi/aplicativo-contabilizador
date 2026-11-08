"""0.4.24 no fixture CDP 9401/9402 de qa_close_reminders.py (rode aquele antes).

1) Outro computador fecha uma submesa enquanto este lanca em outra: o salvamento nao falha e o item novo fica.
2) Mesa S/N (avulsa) aparece por ultimo, antes do "+", abre como "Mesa S/N" e aceita submesas; busca "s/n".
3) Duplo clique em cima de varios itens selecionados abre o Remover de todos.
4) A caixa de identificacao do pagamento nao vem selecionada.
5) Mesas em aberto: previsao de lancamentos (submesa = 1, principal = 1).
6) Privacidade: total so na caixa do Total do dia.
"""
import re
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    s = p.chromium.connect_over_cdp('http://127.0.0.1:9401').contexts[0].pages[0]
    errors = []
    s.set_default_timeout(12000)
    s.set_viewport_size({'width': 1366, 'height': 768})
    s.on('pageerror', lambda error: errors.append(str(error)))

    def reload():
        s.reload()
        try:
            s.get_by_text('Entrar como Servidor', exact=True).wait_for(timeout=3000)
            s.get_by_text('Entrar como Servidor', exact=True).click()
        except Exception:
            pass
        s.locator('.professional-shell').wait_for(timeout=20000)
        if s.locator('.module-window-close').count():
            s.locator('.module-window-close').click()

    seed = """async([n,items,subs])=>{const {coffee}=JSON.parse(localStorage.getItem('qa.reminder.products'));
      const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n); if(t&&t.items.length) await window.caixa.cancelPdvTable(n);
      await window.caixa.openPdvTable(n,1);
      const list=items.map(([name,sub])=>({id:crypto.randomUUID(),productId:coffee.id,productName:name,categoryName:'QA',quantity:1,unitPrice:10,discount:0,total:10,subtableName:sub||''}));
      await window.caixa.savePdvTableItems(n,list,subs,[]); return list;}"""

    def table_card(label):
        return s.locator('.pdv-table-card').filter(has=s.get_by_text(label, exact=True))

    # 1) Submesa fechada em outro computador.
    items = s.evaluate(seed, [46, [['Item Ana', 'Ana'], ['Item Fernando', 'Fernando']], ['Ana', 'Fernando']])
    result = s.evaluate("""async(items)=>{const n=46; const snap=await window.caixa.getPdvSnapshot(); const t=snap.tables.find(t=>t.number===n);
      const ana=items.find(i=>i.subtableName==='Ana');
      await window.caixa.savePdvTablePartial(n,[ana],[{id:crypto.randomUUID(),method:'Pix',amount:10}],0,crypto.randomUUID(),'',{kind:'subtable',subtableName:'Ana',sessionId:t.sessionId});
      const extra={...items[1],id:crypto.randomUUID(),productName:'Item novo Fernando'};
      let error=''; try{ await window.caixa.savePdvTableItems(n,[...items,extra],['Ana','Fernando'],items.map(i=>i.id)); }catch(e){error=String(e);}
      const after=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n);
      return {error, names: after.items.map(i=>i.productName).sort(), subs: after.subtables};}""", items)
    assert result['error'] == '', result
    assert result['names'] == ['Item Fernando', 'Item novo Fernando'], result
    assert result['subs'] == ['Fernando'], result
    print('PASS submesa closed on another computer: save keeps the new item, drops the closed one, no error')

    # 2) Mesa S/N.
    reload()
    grid = s.locator('.pdv-table-grid > *')
    count = grid.count()
    expect(grid.nth(count - 1)).to_have_class(re.compile('pdv-quick-value-card'))
    expect(grid.nth(count - 2)).to_have_class(re.compile('loose-table'))
    expect(grid.nth(count - 2).locator('strong').first).to_have_text('S/N')
    s.evaluate(seed, [999, [['Anotacao Joao', 'Joao sem mesa']], ['Joao sem mesa']])
    reload()
    s.get_by_label('Buscar mesa ou submesa').fill('s/n')
    expect(s.locator('.pdv-table-card:not(.pdv-quick-value-card)')).to_have_count(1)
    s.get_by_label('Buscar mesa ou submesa').fill('')
    s.locator('.pdv-table-card.loose-table').click()
    expect(s.get_by_text('Mesa S/N', exact=False).first).to_be_visible()
    s.screenshot(path='outputs/qa-close-reminders-20261101/0424-loose-table.png')
    print('PASS loose table S/N: last card before "+", opens as Mesa S/N with submesas, search s/n finds it')

    # 3) Duplo clique com varios itens selecionados.
    s.evaluate(seed, [44, [['Item um', ''], ['Item dois', ''], ['Item tres', '']], []])
    reload()
    table_card('044').click()
    rows = s.locator('.pdv-cart-list article')
    rows.filter(has_text='Item um').click()
    rows.filter(has_text='Item dois').click(modifiers=['Control'])
    expect(s.locator('.pdv-cart-list article.multi-selected')).to_have_count(2)
    rows.filter(has_text='Item dois').dblclick()
    batch = s.get_by_role('button', name='Remover 2 produtos', exact=True)
    expect(batch).to_be_visible()
    s.screenshot(path='outputs/qa-close-reminders-20261101/0424-double-click-batch.png')
    s.get_by_role('button', name='Cancelar', exact=True).last.click()
    expect(batch).to_have_count(0)
    print('PASS double click on a multi selection opens remove for all selected items')

    # 4) Identificacao sem foco automatico.
    reload()
    table_card('044').click()
    s.get_by_role('button', name='Fechar conta', exact=True).click()
    s.locator('.pdv-close-menu').get_by_role('button', name='Fechar total', exact=False).click()
    receive = s.locator('.pdv-receive-modal')
    description = receive.locator('.pdv-payment-description input')
    expect(description).to_be_visible()
    s.wait_for_timeout(400)
    assert not description.evaluate('el => el === document.activeElement')
    s.keyboard.type('abc')
    expect(description).to_have_value('')
    print('PASS payment identification box is not focused and stray keys do not type into it')

    # 5) Previsao de lancamentos.
    reload()
    expected = s.evaluate("""async()=>{const t=(await window.caixa.getPdvSnapshot()).tables; let n=0;
      for(const x of t){const unpaid=x.items.filter(i=>i.quantity-(i.paidQuantity||0)>0.009); const subs=new Set([...(x.subtables||[]),...unpaid.map(i=>i.subtableName||'').filter(Boolean)]); n+=subs.size+(unpaid.some(i=>!i.subtableName)?1:0);} return n;}""")
    s.locator('.professional-total .topbar-card-button').click()
    s.locator('.total-popover').get_by_role('button', name='Mesas em aberto', exact=False).click()
    launches = s.locator('.open-tables-launches')
    expect(launches).to_contain_text('Faltam lançar')
    left = launches.locator(':scope > div').nth(1).locator('strong').inner_text()
    assert int(left) == expected, (left, expected)
    row48 = s.locator('.open-tables-list tr').filter(has_text='Mesa 046')
    expect(row48.locator('td').nth(3)).to_have_text('1')
    expect(s.locator('.open-tables-list tr').filter(has_text='Mesa S/N')).to_have_count(1)
    s.screenshot(path='outputs/qa-close-reminders-20261101/0424-open-tables.png')
    s.keyboard.press('Escape')
    print('PASS open tables summary shows launches done, left (submesa = 1, main = 1) and forecast:', left)

    # 6) Privacidade: total so na caixa.
    original = s.evaluate("async()=>(await window.caixa.getSnapshot()).settings.privacy")
    s.evaluate("async()=>{const snap=await window.caixa.getSnapshot(); await window.caixa.saveSettings({...snap.settings, privacy:{...snap.settings.privacy, enabled:false, hideHeaderTotal:false, totalInMenuOnly:true}});}")
    reload()
    expect(s.locator('.professional-total .topbar-card-button')).to_contain_text('Hoje')
    expect(s.locator('.professional-total .topbar-card-button strong')).to_have_text(re.compile(r'^\d+ lançamentos?$'))
    expect(s.locator('.professional-total .topbar-card-button')).to_contain_text('Total na caixinha')
    s.locator('.professional-total .topbar-card-button').click()
    expect(s.locator('.total-popover .total-popover-value strong')).to_contain_text('R$')
    s.screenshot(path='outputs/qa-close-reminders-20261101/0424-total-menu.png')
    # 0.4.25: com a opcao marcada, Esconder/Mostrar valores deixa a caixa aberta e a linha embaixo vira Privado/valor.
    s.get_by_role('button', name='Esconder valores', exact=True).click()
    expect(s.locator('.total-popover .total-popover-value strong')).to_have_text('Privado')
    expect(s.locator('.professional-total .topbar-card-button strong')).to_have_text(re.compile(r'^\d+ lançamentos?$'))
    s.screenshot(path='outputs/qa-close-reminders-20261101/0425-total-menu-private.png')
    s.get_by_role('button', name='Mostrar valores', exact=True).click()
    expect(s.locator('.total-popover .total-popover-value strong')).to_contain_text('R$')
    s.screenshot(path='outputs/qa-close-reminders-20261101/0425-total-menu-open.png')
    s.evaluate("async(o)=>{const snap=await window.caixa.getSnapshot(); await window.caixa.saveSettings({...snap.settings, privacy:{...o, enabled:false, hideHeaderTotal:false, totalInMenuOnly:false}});}", original)
    reload()
    # Sem a opcao: como antes, a caixa fecha ao trocar e nao tem a linha embaixo.
    s.locator('.professional-total .topbar-card-button').click()
    expect(s.locator('.total-popover .total-popover-value')).to_have_count(0)
    s.get_by_role('button', name='Esconder valores', exact=True).click()
    expect(s.locator('.total-popover')).to_have_count(0)
    s.locator('.professional-total .topbar-card-button').click()
    s.get_by_role('button', name='Mostrar valores', exact=True).click()
    reload()
    expect(s.locator('.professional-total .topbar-card-button strong')).to_contain_text('R$')
    s.evaluate("async(o)=>{const snap=await window.caixa.getSnapshot(); await window.caixa.saveSettings({...snap.settings, privacy:o});}", original)
    # 0.4.25: tela de privacidade em blocos (abre pelo Ajustes de privacidade da caixa).
    s.locator('.professional-total .topbar-card-button').click()
    s.get_by_role('button', name='Ajustes de privacidade', exact=True).click()
    blocks = s.locator('.privacy-block')
    expect(blocks).to_have_count(2)
    expect(blocks.nth(0)).to_contain_text('Total do dia neste computador')
    expect(blocks.nth(0).locator('.privacy-option')).to_contain_text('Mostrar o valor só dentro da caixinha')
    expect(blocks.nth(1)).to_contain_text('Perfis de privacidade')
    blocks.nth(0).scroll_into_view_if_needed()
    s.screenshot(path='outputs/qa-close-reminders-20261101/0425-privacy-settings.png')
    reload()
    print('PASS privacy "total only in the box": header hides the value, the Total box shows it at the bottom')

    s.evaluate("async()=>{for(const n of [44,46,999]){const t=(await window.caixa.getPdvSnapshot()).tables.find(t=>t.number===n); if(t&&t.items.length) await window.caixa.cancelPdvTable(n);}}")
    reload()
    assert not errors, errors
