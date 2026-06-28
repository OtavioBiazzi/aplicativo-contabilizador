import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:4173"


MOCK_API = """
(() => {
  const now = () => new Date().toISOString();
  let entries = [];
  const settings = {
    outputDirectory: "C:/temp/contabilizador",
    fileFormat: "xlsx",
    fileStrategy: "daily",
    dateFormat: "yyyy-MM-dd",
    csvSeparator: ";",
    currency: "BRL",
    visibleColumns: [],
    backupEnabled: true,
    defaultType: "Venda",
    defaultPeople: 1,
    defaultRoundingStep: 0.25,
    defaultRoundingDirection: "up",
    theme: "dark",
    accentColor: "#17c964",
    fieldSize: "medium",
    density: "normal",
    layout: "complete",
    profiles: {},
    activeProfile: "Teste",
    floating: { visibleFields: ["type", "value", "people", "description", "submit"], opacity: 0.96, borderless: false, lockPosition: false },
    server: { port: 4317, password: "teste", permissions: { view: true, create: true, edit: false, delete: false } },
    shortcuts: {}
  };
  const server = { running: false, port: 4317, url: "", ips: ["127.0.0.1"], devices: [] };
  const exportStatus = { ok: true, pendingCount: 0, message: "ok" };
  const makeEntry = (draft) => ({
    id: crypto.randomUUID(),
    createdAt: now(),
    updatedAt: now(),
    type: draft.type || "Venda",
    originalValue: draft.value || 0,
    finalValue: draft.splitDetails?.finalTotal || draft.cashDetails?.accountValue || draft.value || 0,
    people: draft.people || 1,
    perPerson: draft.splitDetails?.perPersonRounded || draft.value || 0,
    roundingStep: 0.25,
    roundingDirection: "up",
    difference: draft.splitDetails?.difference || 0,
    description: draft.description || "Venda",
    tableNumber: draft.tableNumber || "",
    busNumber: draft.busNumber || "",
    paymentMethod: draft.paymentMethod || "Nao informado",
    paidWith: draft.paidWith || 0,
    change: draft.cashDetails?.change || 0,
    observations: draft.observations || "",
    originDevice: "Smoke",
    status: "active"
  });
  window.caixa = {
    getSnapshot: async () => ({ entries, settings, server, exportStatus }),
    addEntry: async (draft) => {
      const entry = makeEntry(draft);
      entries.unshift(entry);
      return { entry, exportStatus };
    },
    updateEntry: async (id, patch) => {
      entries = entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
      return { entry: entries.find((entry) => entry.id === id), exportStatus };
    },
    removeEntry: async (id) => {
      entries = entries.map((entry) => entry.id === id ? { ...entry, status: "deleted" } : entry);
      return { exportStatus };
    },
    duplicateEntry: async (id) => {
      const source = entries.find((entry) => entry.id === id);
      const entry = { ...source, id: crypto.randomUUID(), createdAt: now(), updatedAt: now() };
      entries.unshift(entry);
      return { entry, exportStatus };
    },
    cancelEntry: async (id) => {
      entries = entries.map((entry) => entry.id === id ? { ...entry, status: "cancelled" } : entry);
      return { entry: entries.find((entry) => entry.id === id), exportStatus };
    },
    saveSettings: async (next) => Object.assign(settings, next),
    chooseOutputDirectory: async () => "C:/temp/contabilizador",
    exportNow: async () => exportStatus,
    startServer: async () => ({ ...server, running: true }),
    stopServer: async () => ({ ...server, running: false }),
    disconnectDevice: async () => server,
    setPinned: async (pinned) => pinned,
    getPinned: async () => false,
    onEntriesChanged: () => () => {},
    onServerChanged: () => () => {}
  };
})();
"""


def wait_for_server() -> None:
  deadline = time.time() + 30
  while time.time() < deadline:
    try:
      with urllib.request.urlopen(URL, timeout=1):
        return
    except Exception:
      time.sleep(0.4)
  raise RuntimeError("Preview server did not start.")


def main() -> int:
  process = subprocess.Popen(
    "npm run preview -- --host 127.0.0.1 --port 4173",
    cwd=ROOT,
    shell=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
  )
  try:
    wait_for_server()
    with sync_playwright() as playwright:
      browser = playwright.chromium.launch(headless=True)
      page = browser.new_page(viewport={"width": 1366, "height": 820})
      console_errors = []
      page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
      page.add_init_script(MOCK_API)
      page.goto(URL)
      page.wait_for_load_state("networkidle")
      expect(page.get_by_text("Registro rapido").first).to_be_visible()
      page.get_by_label("Valor").first.fill("45,00")
      page.get_by_label("Descricao").first.fill("Mesa 4")
      page.get_by_role("button", name="Registrar").first.click()
      expect(page.get_by_text("Lancamento registrado.")).to_be_visible()
      page.get_by_role("button", name="Historico").click()
      expect(page.get_by_text("Mesa 4").first).to_be_visible()
      page.get_by_role("button", name="Relatorios").click()
      expect(page.get_by_text("Total do periodo")).to_be_visible()
      browser.close()
      if console_errors:
        print("\\n".join(console_errors), file=sys.stderr)
        return 1
    return 0
  finally:
    process.terminate()
    try:
      process.wait(timeout=8)
    except subprocess.TimeoutExpired:
      process.kill()


if __name__ == "__main__":
  raise SystemExit(main())

