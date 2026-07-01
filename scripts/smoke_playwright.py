import os
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from zipfile import ZipFile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DEBUG_URL = "http://127.0.0.1:9333"
SMOKE_DIR = ROOT / ".tmp-smoke"


def wait_for_cdp() -> None:
  deadline = time.time() + 35
  while time.time() < deadline:
    try:
      with urllib.request.urlopen(f"{DEBUG_URL}/json/version", timeout=1):
        return
    except Exception:
      time.sleep(0.4)
  raise RuntimeError("Electron did not expose the debugging endpoint.")


def find_app_page(browser, floating: bool = False):
  deadline = time.time() + 20
  while time.time() < deadline:
    for context in browser.contexts:
      for page in context.pages:
        is_app = page.url.startswith("app://local/")
        is_floating = "floating=1" in page.url
        if is_app and is_floating == floating:
          return page
    time.sleep(0.25)
  raise RuntimeError("Electron app page was not found.")


def stop_process_tree(process: subprocess.Popen) -> None:
  if process.poll() is not None:
    return
  if os.name == "nt":
    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
  else:
    process.terminate()
    try:
      process.wait(timeout=8)
    except subprocess.TimeoutExpired:
      process.kill()


def api_json(base_url: str, path: str, password: str, method: str = "GET", payload: dict | None = None) -> dict:
  data = json.dumps(payload).encode("utf-8") if payload is not None else None
  request = urllib.request.Request(
    base_url + path,
    data=data,
    method=method,
    headers={
      "content-type": "application/json",
      "x-caixa-password": password,
      "x-device-name": "Smoke remoto",
    },
  )
  with urllib.request.urlopen(request, timeout=5) as response:
    raw = response.read().decode("utf-8")
  return json.loads(raw) if raw else {}


def main() -> int:
  if not (ROOT / "dist-electron" / "electron" / "main.js").exists():
    print("Run npm run build before the smoke test.", file=sys.stderr)
    return 1
  main_source = (ROOT / "dist-electron" / "electron" / "main.js").read_text(encoding="utf-8")
  if "instalar-atualizacao.cmd" in main_source or "cmd.exe" in main_source:
    print("Updater still launches through a visible command shell.", file=sys.stderr)
    return 1

  shutil.rmtree(SMOKE_DIR, ignore_errors=True)
  (SMOKE_DIR / "data").mkdir(parents=True, exist_ok=True)
  (SMOKE_DIR / "exports").mkdir(parents=True, exist_ok=True)
  (SMOKE_DIR / "imports").mkdir(parents=True, exist_ok=True)
  import_file = SMOKE_DIR / "imports" / "importacao-smoke.csv"
  import_file.write_text(
    "Data;Hora;Tipo;Valor pago;Descricao;Mesa;Forma de pagamento;Status\n"
    f"{datetime.now().strftime('%d/%m/%Y')};10:15:00;Mesa;12,50;Mesa Importada;9;Dinheiro;active\n",
    encoding="utf-8",
  )
  folder_import_file = SMOKE_DIR / "imports" / "lote-pasta-smoke.csv"
  folder_import_file.write_text(
    "Data;Hora;Tipo;Valor pago;Descricao;Onibus;Forma de pagamento;Status\n"
    f"{datetime.now().strftime('%d/%m/%Y')};11:20:00;Onibus;22,00;Pasta Smoke;3;Pix;active\n",
    encoding="utf-8",
  )

  env = os.environ.copy()
  env["CAIXA_DATA_DIR"] = str(SMOKE_DIR / "data")
  env["CAIXA_OUTPUT_DIR"] = str(SMOKE_DIR / "exports")

  electron_cmd = ROOT / "node_modules" / ".bin" / ("electron.cmd" if os.name == "nt" else "electron")
  process = subprocess.Popen(
    [str(electron_cmd), ".", "--remote-debugging-port=9333"],
    cwd=ROOT,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
  )

  try:
    wait_for_cdp()
    with sync_playwright() as playwright:
      browser = playwright.chromium.connect_over_cdp(DEBUG_URL)
      page = find_app_page(browser, floating=False)
      console_errors = []
      page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
      page.wait_for_load_state("networkidle")
      expect(page.get_by_text("Registro rapido").first).to_be_visible(timeout=15000)
      expect(page.locator(".brand-mark img")).to_be_visible(timeout=15000)
      page.evaluate(
        """async () => {
          const snapshot = await window.caixa.getSnapshot();
          await window.caixa.saveSettings({
            ...snapshot.settings,
            theme: 'datacaixa',
            accentColor: '#0565b7',
            floating: { ...snapshot.settings.floating, theme: 'follow', opacity: 1 }
          });
          const yesterdayResult = await window.caixa.addEntry({ type: 'Venda', value: 800, people: 1, description: 'Ontem smoke' });
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          yesterday.setHours(12, 0, 0, 0);
          await window.caixa.updateEntry(yesterdayResult.entry.id, { createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString() });
        }"""
      )
      expect(page.locator("html")).to_have_attribute("data-theme", "datacaixa")
      page.wait_for_timeout(500)
      expect(page.locator(".topbar-card strong")).to_contain_text("R$ 0,00")
      history_tab = page.get_by_role("button", name="Historico")
      history_tab.hover()
      hover_style = history_tab.evaluate(
        """(element) => {
          const style = getComputedStyle(element);
          const channels = style.backgroundColor.match(/[\\d.]+/g)?.map(Number) || [0, 0, 0, 1];
          return {
            backgroundColor: style.backgroundColor,
            red: channels[0] || 0,
            green: channels[1] || 0,
            blue: channels[2] || 0,
            alpha: channels.length > 3 ? channels[3] : 1
          };
        }"""
      )
      if hover_style["alpha"] >= 0.95 and min(hover_style["red"], hover_style["green"], hover_style["blue"]) > 220:
        print(f"DataCaixa hover is too pale: {hover_style['backgroundColor']}", file=sys.stderr)
        return 1
      page.get_by_label("Valor").first.fill("45,00")
      page.get_by_label("Descricao").first.fill("Mesa 4")
      page.get_by_role("button", name="Registrar").first.click()
      expect(page.get_by_text("Lancamento registrado.")).to_be_visible(timeout=15000)
      expect(page.locator(".topbar-card strong")).to_contain_text("R$ 45,00")
      page.get_by_role("button", name="Caixa").click()
      page.get_by_role("button", name="Divisao de conta").click()
      page.get_by_label("Valor").first.fill("10,64")
      page.get_by_label("Pessoas").first.fill("4")
      expect(page.get_by_text("Mostrar cobranca extra")).to_be_visible()
      expect(page.get_by_text("Vai cobrar")).not_to_be_visible()
      page.get_by_label("Mostrar cobranca extra").check()
      expect(page.get_by_text("Vai cobrar R$ 0,36 a mais no total")).to_be_visible()
      page.get_by_role("button", name="Historico").click()
      expect(page.get_by_text("Mesa 4").first).to_be_visible()
      page.get_by_role("button", name="Relatorios").click()
      expect(page.get_by_text("Total do periodo")).to_be_visible()
      expect(page.get_by_text("Relatorios com filtros")).to_be_visible()
      expect(page.get_by_text("Fechamento").first).to_be_visible()
      expect(page.get_by_text("Movimento por dia")).to_be_visible()
      expect(page.get_by_text("Maiores lancamentos")).to_be_visible()
      expect(page.get_by_text("Alertas do recorte")).to_be_visible()
      expect(page.get_by_text("Total por origem/caixa")).to_be_visible()
      now = datetime.now()
      month_start = now.replace(day=1).strftime("%Y-%m-%d")
      month_end = ((now.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).strftime("%Y-%m-%d")
      report_dates = page.locator(".report-filter-bar input[type='date']")
      if report_dates.nth(0).input_value() != month_start or report_dates.nth(1).input_value() != month_end:
        print("Report filters did not default to the current month.", file=sys.stderr)
        return 1
      page.get_by_label("Tipo").select_option("Venda")
      page.get_by_role("button", name="Exportar filtrado").click()
      expect(page.get_by_text("Relatorio filtrado exportado.")).to_be_visible(timeout=15000)
      page.get_by_role("button", name="Ajustes").click()
      expect(page.get_by_role("button", name="Aparencia")).to_be_visible()
      page.locator(".settings-nav").get_by_role("button", name="Barra fixada").click()
      expect(page.get_by_text("Elementos da barra")).to_be_visible()
      expect(page.get_by_text("Campo curto para numero da mesa.")).to_be_visible()
      expect(page.get_by_text("Campo curto para numero do onibus.")).to_be_visible()
      expect(page.get_by_text("Pix, debito, credito ou voucher.")).to_be_visible()
      root_font_before = page.locator("html").evaluate("""(element) => getComputedStyle(element).fontSize""")
      page.get_by_role("button", name="Onibus enxuto").click()
      expect(page.get_by_text("Preset Onibus enxuto aplicado ao rascunho.")).to_be_visible(timeout=10000)
      page.get_by_role("button", name="Minimalista Barra bem pequena").click()
      expect(page.get_by_text("Preset Minimalista aplicado ao rascunho.")).to_be_visible(timeout=10000)
      root_font_after = page.locator("html").evaluate("""(element) => getComputedStyle(element).fontSize""")
      if root_font_before != root_font_after:
        print(f"Floating preset changed global font size: {root_font_before} -> {root_font_after}", file=sys.stderr)
        return 1
      page.get_by_role("button", name="Onibus enxuto").click()
      expect(page.get_by_text("Preset Onibus enxuto aplicado ao rascunho.")).to_be_visible(timeout=10000)
      expect(page.get_by_label("Visual sem borda de janela")).to_be_checked()
      range_fill = page.get_by_label("Opacidade (100%)").evaluate("""(element) => getComputedStyle(element).getPropertyValue('--range-fill').trim()""")
      if range_fill != "100%":
        print(f"Opacity slider fill did not reach 100%: {range_fill}", file=sys.stderr)
        return 1
      page.locator(".settings-nav").get_by_role("button", name="Planilha e backup").click()
      expect(page.get_by_role("button", name="Importar Excel/CSV")).to_be_visible()
      expect(page.get_by_role("button", name="Gerar/abrir arquivo")).to_be_visible()
      import_preview = page.evaluate("""async (filePath) => await window.caixa.previewLedgerImport(filePath)""", str(import_file))
      if import_preview["newRows"] != 1 or import_preview["duplicateRows"] != 0 or not import_preview["sample"]:
        print(f"Import preview did not detect the new row: {import_preview}", file=sys.stderr)
        return 1
      first_import = page.evaluate("""async (filePath) => await window.caixa.importLedgerFile(filePath)""", str(import_file))
      if first_import["imported"] != 1:
        print(f"Import did not create the expected row: {first_import}", file=sys.stderr)
        return 1
      duplicate_preview = page.evaluate("""async (filePath) => await window.caixa.previewLedgerImport(filePath)""", str(import_file))
      if duplicate_preview["newRows"] != 0 or duplicate_preview["duplicateRows"] < 1:
        print(f"Import preview did not mark the row as duplicate: {duplicate_preview}", file=sys.stderr)
        return 1
      second_import = page.evaluate("""async (filePath) => await window.caixa.importLedgerFile(filePath)""", str(import_file))
      if second_import["imported"] != 0 or second_import["skipped"] < 1:
        print(f"Import dedupe did not skip the existing row: {second_import}", file=sys.stderr)
        return 1
      today_xlsx = SMOKE_DIR / "exports" / f"vendas-{datetime.now().strftime('%Y-%m-%d')}.xlsx"
      if not today_xlsx.exists():
        print("Expected daily xlsx was not created before xlsx import smoke.", file=sys.stderr)
        return 1
      xlsx_import = page.evaluate("""async (filePath) => await window.caixa.importLedgerFile(filePath)""", str(today_xlsx))
      if xlsx_import["imported"] != 0 or xlsx_import["skipped"] < 1:
        print(f"XLSX import did not dedupe existing rows: {xlsx_import}", file=sys.stderr)
        return 1
      folder_import = page.evaluate("""async (folderPath) => await window.caixa.importLedgerFolder(folderPath)""", str(SMOKE_DIR / "imports"))
      if folder_import["filesScanned"] < 2 or folder_import["imported"] != 1:
        print(f"Folder import did not import only the new rows: {folder_import}", file=sys.stderr)
        return 1
      page.locator(".settings-nav").get_by_role("button", name="Barra rapida").click()
      expect(page.get_by_text("Abas e modos que aparecem na barra fixada.")).to_be_visible()
      page.locator(".settings-nav").get_by_role("button", name="Vendas").click()
      expect(page.get_by_label("Mostrar campo de numero da mesa")).to_be_checked()
      expect(page.get_by_label("Mostrar campo de numero do onibus")).to_be_checked()
      page.locator(".settings-nav").get_by_role("button", name="Perfis").click()
      expect(page.get_by_text("Perfil ativo")).to_be_visible()
      page.get_by_label("Nome do novo perfil").fill("Perfil smoke")
      page.get_by_role("button", name="Criar com ajustes atuais").click()
      expect(page.get_by_text("Perfil Perfil smoke criado.")).to_be_visible(timeout=10000)
      page.locator(".profile-card").filter(has_text="Perfil fixado").get_by_title("Aplicar perfil").click()
      expect(page.get_by_text("Perfil Perfil fixado aplicado ao rascunho.")).to_be_visible(timeout=10000)
      page.locator(".settings-nav").get_by_role("button", name="Atalhos").click()
      expect(page.get_by_text("Clique no atalho e pressione")).to_be_visible()
      money_shortcut = page.locator(".shortcut-card").filter(has_text="Modo dinheiro").locator(".shortcut-capture")
      money_shortcut.click()
      page.keyboard.press("Control+Alt+D")
      expect(money_shortcut).to_have_text("Ctrl+Alt+D")
      page.locator(".shortcut-card").filter(has_text="Modo dinheiro").get_by_role("button", name="Desativar").click()
      expect(money_shortcut).to_have_text("Desativado")
      money_shortcut.click()
      page.keyboard.press("Control+D")
      expect(money_shortcut).to_have_text("Ctrl+D")
      has_config_io = page.evaluate(
        """() => typeof window.caixa.exportSettings === 'function' && typeof window.caixa.importSettings === 'function'"""
      )
      if not has_config_io:
        print("Settings import/export API is not exposed.", file=sys.stderr)
        return 1
      page.locator(".settings-nav").get_by_role("button", name="Servidor").click()
      expect(page.get_by_text("Porta padrao")).to_be_visible()
      page.once("dialog", lambda dialog: dialog.accept())
      page.get_by_role("button", name="Salvar configuracoes").click()
      expect(page.get_by_text("Configuracoes salvas.")).to_be_visible(timeout=10000)
      has_diagnostics = page.evaluate(
        """() => typeof window.caixa.getDiagnostics === 'function'
          && typeof window.caixa.createDataBackup === 'function'
          && typeof window.caixa.restoreDataBackup === 'function'"""
      )
      if not has_diagnostics:
        print("Diagnostics API is not exposed.", file=sys.stderr)
        return 1
      backup_smoke = page.evaluate(
        """async () => {
          const backup = await window.caixa.createDataBackup('smoke');
          await window.caixa.addEntry({ type: 'Venda', value: 9.99, people: 1, description: 'Entrada apos backup smoke' });
          const restored = await window.caixa.restoreDataBackup(backup.filePath);
          const snapshot = await window.caixa.getSnapshot();
          const diagnostics = await window.caixa.getDiagnostics();
          return {
            backupCount: diagnostics.backupCount,
            restored: Boolean(restored),
            hasTempEntry: snapshot.entries.some((item) => item.description === 'Entrada apos backup smoke'),
            logCount: diagnostics.logs.length
          };
        }"""
      )
      if not backup_smoke["restored"] or backup_smoke["hasTempEntry"] or backup_smoke["backupCount"] < 2 or backup_smoke["logCount"] < 1:
        print(f"Backup/restore smoke failed: {backup_smoke}", file=sys.stderr)
        return 1
      page.locator(".settings-nav").get_by_role("button", name="Avancado").click()
      expect(page.get_by_text("Backup local do caixa")).to_be_visible(timeout=10000)
      expect(page.get_by_text("Ultimos eventos")).to_be_visible()
      page.get_by_role("button", name="Atualizacoes").click()
      expect(page.get_by_text("Nenhuma verificacao feita")).to_be_visible()
      has_update_install = page.evaluate("""() => typeof window.caixa.installUpdate === 'function'""")
      if not has_update_install:
        print("Update installer API is not exposed.", file=sys.stderr)
        return 1
      page.locator(".settings-nav").get_by_role("button", name="Servidor").click()
      expect(page.get_by_text("Porta padrao")).to_be_visible()
      page.get_by_role("button", name="Rede").click()
      expect(page.get_by_text("Criar servidor")).to_be_visible()
      page.get_by_role("button", name="Conectar").click()
      expect(page.get_by_text("Conectar este computador")).to_be_visible()
      remote_port = 43179
      remote_password = "smoke-pass"
      page.evaluate(
        """async ({ port, password }) => {
          const snapshot = await window.caixa.getSnapshot();
          await window.caixa.saveSettings({
            ...snapshot.settings,
            server: {
              ...snapshot.settings.server,
              port,
              password,
              permissions: { view: true, create: true, edit: true, delete: true, viewEntryValues: true, viewTotals: false }
            }
          });
          await window.caixa.startServer(port, password);
        }""",
        {"port": remote_port, "password": remote_password},
      )
      remote_base = f"http://127.0.0.1:{remote_port}"
      page.locator(".connect-panel").get_by_label("Endereco do servidor").fill(remote_base)
      page.locator(".connect-panel").get_by_label("Senha").fill(remote_password)
      page.locator(".connect-panel").get_by_label("Nome deste caixa").fill("App cliente smoke")
      page.get_by_role("button", name="Conectar no app").click()
      expect(page.get_by_text("Cliente conectado no app")).to_be_visible(timeout=15000)
      expect(page.get_by_text("Historico vindo do caixa principal")).to_be_visible(timeout=15000)
      page.locator(".connect-panel").get_by_label("Valor").first.fill("18,75")
      page.locator(".connect-panel").get_by_label("Descricao").first.fill("Cliente app smoke")
      page.locator(".connect-panel").get_by_role("button", name="Registrar").first.click()
      expect(page.get_by_text("Lancamento enviado ao caixa principal.")).to_be_visible(timeout=15000)
      api_after_app_client = api_json(remote_base, "/api/entries", remote_password)
      if not any(item["description"] == "Cliente app smoke" for item in api_after_app_client["entries"]):
        print("Native app remote client did not create the remote entry.", file=sys.stderr)
        return 1
      page.get_by_role("button", name="Desconectar").click()
      expect(page.get_by_role("button", name="Conectar no app")).to_be_visible(timeout=10000)
      created = api_json(
        remote_base,
        "/api/entries",
        remote_password,
        "POST",
        {"type": "Venda", "value": 29.9, "people": 1, "description": "Remoto smoke"},
      )["entry"]
      masked = api_json(remote_base, "/api/entries", remote_password)
      if masked["summary"] is not None:
        print("Remote API exposed summary when viewTotals was disabled.", file=sys.stderr)
        return 1
      remote_entry = next((item for item in masked["entries"] if item["id"] == created["id"]), None)
      if not remote_entry or remote_entry["finalValue"] != 29.9:
        print("Remote API did not keep entry values visible when only totals were hidden.", file=sys.stderr)
        return 1
      remote_browser = playwright.chromium.launch(headless=True)
      try:
        remote_page = remote_browser.new_page()
        remote_errors = []
        remote_page.on("console", lambda message: remote_errors.append(message.text) if message.type == "error" else None)
        remote_page.goto(remote_base)
        expect(remote_page.get_by_text("Caixa remoto")).to_be_visible(timeout=10000)
        remote_page.locator("#password").fill(remote_password)
        remote_page.locator("#loginButton").click()
        expect(remote_page.locator("#history")).to_be_visible(timeout=10000)
        expect(remote_page.locator("#summary")).to_contain_text("Totais ocultos", timeout=10000)
        expect(remote_page.get_by_text("Permissoes deste dispositivo")).to_be_visible(timeout=10000)
        if remote_errors:
          print("\n".join(remote_errors), file=sys.stderr)
          return 1
      finally:
        remote_browser.close()
      api_json(remote_base, f"/api/entries/{created['id']}", remote_password, "PATCH", {"description": "Remoto editado", "value": 31.25})
      api_json(remote_base, f"/api/entries/{created['id']}/cancel", remote_password, "POST")
      api_json(remote_base, f"/api/entries/{created['id']}", remote_password, "DELETE")
      after_remote_delete = api_json(remote_base, "/api/entries", remote_password)
      deleted_remote = next((item for item in after_remote_delete["entries"] if item["id"] == created["id"]), None)
      if not deleted_remote or deleted_remote["status"] != "deleted":
        print("Remote delete did not move the entry to trash.", file=sys.stderr)
        return 1
      page.get_by_role("button", name="Caixa").click()
      page.get_by_role("button", name="Historico").click()
      expect(page.get_by_text("Mesa Importada").first).to_be_visible()
      page.get_by_role("button", name="Caixa").click()
      page.get_by_role("button", name="Abrir barra fixada").click()
      expect(page.locator(".app-shell")).to_be_visible()
      browser.close()
      browser = playwright.chromium.connect_over_cdp(DEBUG_URL)
      page = find_app_page(browser, floating=False)
      floating_page = find_app_page(browser, floating=True)
      floating_page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
      expect(floating_page.locator(".floating-bar")).to_be_visible(timeout=15000)
      body_classes = floating_page.locator("body").get_attribute("class") or ""
      if "floating-borderless" not in body_classes:
        print(f"Floating bar did not use the borderless class: {body_classes}", file=sys.stderr)
        return 1
      expect(floating_page.locator("html")).to_have_attribute("data-theme", "datacaixa")
      expect(floating_page.get_by_text("Caixa rapido")).not_to_be_visible()
      expect(floating_page.locator(".floating-kind select")).not_to_be_visible()
      expect(floating_page.locator(".floating-description input")).not_to_be_visible()
      expect(floating_page.locator(".floating-detail input")).to_be_visible()
      floating_page.locator(".floating-mode").click()
      expect(floating_page.locator(".floating-mode")).to_contain_text("Conta")
      expect(floating_page.locator(".floating-cash-kind select")).not_to_be_visible()
      expect(floating_page.locator(".floating-detail input")).to_be_visible()
      expect(floating_page.get_by_text("TROCO")).to_be_visible()
      floating_page.locator(".amount-field input").fill("87,50")
      expect(floating_page.locator(".floating-result strong")).to_contain_text("0,00")
      floating_page.locator(".floating-detail input").fill("12")
      floating_page.locator(".floating-send").click()
      expect(floating_page.get_by_text("Lancamento registrado.")).to_be_visible(timeout=15000)
      removed = page.evaluate(
        """async () => {
          const snapshot = await window.caixa.getSnapshot();
          const entry = snapshot.entries.find((item) => item.description === 'Mesa 4');
          if (!entry) return false;
          await window.caixa.removeEntry(entry.id);
          return true;
        }"""
      )
      if not removed:
        print("Could not remove the test entry.", file=sys.stderr)
        return 1
      page.wait_for_timeout(500)
      page.get_by_role("button", name="Historico").click()
      expect(page.get_by_text("Mesa 4")).not_to_be_visible()
      page.get_by_label("Status").select_option("deleted")
      expect(page.get_by_text("Mesa 4").first).to_be_visible()
      deleted = page.evaluate(
        """async () => {
          const snapshot = await window.caixa.getSnapshot();
          const entry = snapshot.entries.find((item) => item.description === 'Mesa 4');
          if (!entry) return false;
          await window.caixa.deleteEntry(entry.id);
          return true;
        }"""
      )
      if not deleted:
        print("Could not permanently delete the test entry.", file=sys.stderr)
        return 1
      page.wait_for_timeout(500)
      browser.close()
      if console_errors:
        print("\n".join(console_errors), file=sys.stderr)
        return 1
      exported_files = [item for item in (SMOKE_DIR / "exports").glob("*.xlsx") if not item.name.startswith("relatorio-")]
      if not exported_files:
        print("No exported xlsx file found.", file=sys.stderr)
        return 1
      sheets = []
      has_styles = False
      for exported_file in exported_files:
        with ZipFile(exported_file) as zip_file:
          has_styles = has_styles or "xl/styles.xml" in zip_file.namelist()
          sheets.append(zip_file.read("xl/worksheets/sheet1.xml").decode("utf-8"))
      sheet = "\n".join(sheets)
      if "Mesa 4" in sheet or "Onibus 12" not in sheet or "TOTAL" not in sheet:
        print("Exported xlsx did not reflect removal/total correctly.", file=sys.stderr)
        return 1
      if not has_styles or "SUBTOTAL(109" not in sheet or "<autoFilter" not in sheet:
        print("Exported xlsx is missing styles, total formula, or autofilter.", file=sys.stderr)
        return 1
      report_files = list((SMOKE_DIR / "exports").glob("relatorio-*.xlsx"))
      if not report_files:
        print("No filtered report xlsx file found.", file=sys.stderr)
        return 1
    return 0
  finally:
    stop_process_tree(process)


if __name__ == "__main__":
  raise SystemExit(main())
