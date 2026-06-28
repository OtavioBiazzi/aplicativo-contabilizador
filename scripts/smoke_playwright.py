import os
import shutil
import subprocess
import sys
import time
import urllib.request
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


def find_app_page(browser):
  deadline = time.time() + 20
  while time.time() < deadline:
    for context in browser.contexts:
      for page in context.pages:
        if page.url.startswith("app://local/"):
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


def main() -> int:
  if not (ROOT / "dist-electron" / "electron" / "main.js").exists():
    print("Run npm run build before the smoke test.", file=sys.stderr)
    return 1

  shutil.rmtree(SMOKE_DIR, ignore_errors=True)
  (SMOKE_DIR / "data").mkdir(parents=True, exist_ok=True)
  (SMOKE_DIR / "exports").mkdir(parents=True, exist_ok=True)

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
      page = find_app_page(browser)
      console_errors = []
      page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
      page.wait_for_load_state("networkidle")
      expect(page.get_by_text("Registro rapido").first).to_be_visible(timeout=15000)
      page.get_by_label("Valor").first.fill("45,00")
      page.get_by_label("Descricao").first.fill("Mesa 4")
      page.get_by_role("button", name="Registrar").first.click()
      expect(page.get_by_text("Lancamento registrado.")).to_be_visible(timeout=15000)
      page.get_by_role("button", name="Historico").click()
      expect(page.get_by_text("Mesa 4").first).to_be_visible()
      page.get_by_role("button", name="Relatorios").click()
      expect(page.get_by_text("Total do periodo")).to_be_visible()
      page.get_by_role("button", name="Registro").click()
      page.get_by_role("button", name="Fixar na tela").click()
      expect(page.locator(".floating-bar")).to_be_visible(timeout=15000)
      expect(page.get_by_text("Caixa rapido")).not_to_be_visible()
      expect(page.locator(".floating-mode")).to_contain_text("Dinheiro")
      page.locator(".floating-mode").click()
      expect(page.locator(".floating-mode")).to_contain_text("Conta")
      expect(page.get_by_text("TROCO")).to_be_visible()
      page.locator(".amount-field input").fill("87,50")
      page.locator(".paid-field input").fill("100,00")
      expect(page.locator(".floating-result strong")).to_contain_text("12,50")
      page.locator(".floating-description input").fill("Pagamento fixado")
      page.locator(".floating-send").click()
      expect(page.get_by_text("Lancamento registrado.")).to_be_visible(timeout=15000)
      browser.close()
      if console_errors:
        print("\n".join(console_errors), file=sys.stderr)
        return 1
    return 0
  finally:
    stop_process_tree(process)


if __name__ == "__main__":
  raise SystemExit(main())
