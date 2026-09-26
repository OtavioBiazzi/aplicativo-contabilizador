"""Run against isolated Electron server/client instances on CDP 9334/9335."""
from pathlib import Path
from time import perf_counter
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    server = p.chromium.connect_over_cdp("http://127.0.0.1:9334").contexts[0].pages[0]
    client = p.chromium.connect_over_cdp("http://127.0.0.1:9335").contexts[0].pages[0]
    client.set_default_timeout(10000)
    server.evaluate("""async () => {
      await window.caixa.openPdvTable(19,1,'Temporaria cancelamento');
      await window.caixa.savePdvTableItems(19,[{id:crypto.randomUUID(),productId:'qa',productName:'Cafe',categoryName:'Cafe',quantity:1,unitPrice:10,discount:0,total:10}]);
    }""")
    card = client.locator(".pdv-table-card").filter(has=client.get_by_text("019",exact=True))
    expect(card).to_contain_text("Temporaria cancelamento")
    card.click()
    client.get_by_role("button",name="Cancelar",exact=True).click()
    # No follow-up snapshot can complete. The mutation's own confirmed table
    # must still free the card and leave the user ready for another operation.
    client.route("**/api/pdv/snapshot*", lambda route: route.abort())
    begin = perf_counter()
    client.get_by_role("button",name="Cancelar mesa inteira",exact=True).click()
    expect(card).to_contain_text("Vazia")
    elapsed_ms = round((perf_counter()-begin)*1000)
    state = server.evaluate("""async()=>{
      const snapshot=await window.caixa.getPdvSnapshot();
      return {status:snapshot.tables.find(t=>t.number===19).status,sale:snapshot.recentSales.find(s=>s.description==='Temporaria cancelamento')};
    }""")
    assert state["status"] == "Livre", state
    assert state["sale"]["status"] == "Cancelada", state
    client.unroute("**/api/pdv/snapshot*")
    client.get_by_role("button",name="Caixa",exact=True).click()
    expect(client.get_by_text("Temporaria cancelamento",exact=True)).to_be_visible()
    client.screenshot(path=str(root/"outputs/client-cancel-confirmed-045.png"),full_page=True)
    print(f"Client cancellation passed with unavailable general snapshot; isolated UI duration {elapsed_ms} ms")
