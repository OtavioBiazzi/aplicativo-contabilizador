import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DiagnosticLogger } from "./diagnostics.js";
import { LedgerExporter } from "./exporter.js";
import { readLedgerImport } from "./importer.js";
import { LocalServer } from "./localServer.js";
import { PdvExporter } from "./pdvExporter.js";
import { buildPdvReceiptHtml, printPdvReceipt, printPdvReceiptDirect } from "./pdvReceipt.js";
import { configureCoseDellAbadiaComplements, normalizeImportedProducts, readPdvProductsFromXlsx } from "./productImporter.js";
import { PdvStore } from "./pdvStore.js";
import { getLocalDateKey } from "../src/shared/calculations.js";
import { pdvSalesToLedgerEntries } from "../src/shared/pdvLedger.js";
import { LedgerStore } from "./storage.js";
import type {
  AppSettings,
  DataBackupInfo,
  DiagnosticsSnapshot,
  EntryDraft,
  ExportStatus,
  LedgerFolderImportResult,
  LedgerImportPreview,
  LedgerImportResult,
  LedgerEntry,
  UpdateInstallResult,
  UpdateInfo
} from "../src/shared/types.js";
import type { PdvCartItem, PdvCategory, PdvCategoryDraft, PdvCustomer, PdvCustomerDraft, PdvExportFilters, PdvPayable, PdvPayableDraft, PdvPayablePayment, PdvPayment, PdvProduct, PdvProductDraft, PdvProductImportPreview, PdvProductImportResult, PdvReceivable, PdvReceivablePatch, PdvReceivablePayment, PdvSale, PdvSettings, PdvTableStatus, PdvTransferSelection } from "../src/shared/pdvTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let secondInstancePending = false;
let store: LedgerStore;
let pdvStore: PdvStore;
let exporter: LedgerExporter;
let localServer: LocalServer;
let logger: DiagnosticLogger;
let floatingBoundsSaveTimer: NodeJS.Timeout | null = null;
let floatingRememberBounds = true;
let restoringFloatingBounds = false;
let gracefulQuitStarted = false;
let gracefulQuitFinished = false;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const RELEASE_API_URL = "https://api.github.com/repos/OtavioBiazzi/aplicativo-contabilizador/releases/latest";
const WINDOWS_APP_USER_MODEL_ID = "com.otaviobiazzi.contabilizador";
const FLOATING_MIN_WIDTH = 520;
const FLOATING_MAX_WIDTH = 1240;
const FLOATING_MIN_HEIGHT = 56;

interface FloatingWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 420,
    minHeight: 360,
    show: false,
    backgroundColor: "#0f1311",
    title: "Contabilizador Caixa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    await mainWindow.loadURL("app://local/index.html");
  }
}

function floatingBoundsPath() {
  return path.join(store.getDataDirectory(), "floating-window.json");
}

function validFloatingBounds(value: unknown): value is FloatingWindowBounds {
  if (!value || typeof value !== "object") {
    return false;
  }
  const bounds = value as Partial<FloatingWindowBounds>;
  const numbers = [bounds.x, bounds.y, bounds.width, bounds.height];
  return numbers.every((item) => typeof item === "number" && Number.isFinite(item))
    && Number(bounds.width) >= FLOATING_MIN_WIDTH
    && Number(bounds.height) >= FLOATING_MIN_HEIGHT;
}

async function readFloatingBounds(settings?: AppSettings): Promise<FloatingWindowBounds | null> {
  if (!settings?.floating.rememberBounds) {
    return null;
  }
  try {
    const value = JSON.parse(await fs.readFile(floatingBoundsPath(), "utf8")) as unknown;
    return validFloatingBounds(value) ? value : null;
  } catch {
    return null;
  }
}

async function saveFloatingBounds(settings?: AppSettings) {
  if (!floatingWindow || floatingWindow.isDestroyed() || !floatingRememberBounds || (settings && !settings.floating.rememberBounds)) {
    return;
  }
  const [x, y] = floatingWindow.getPosition();
  const [width, height] = floatingWindow.getSize();
  await fs.writeFile(floatingBoundsPath(), JSON.stringify({ x, y, width, height }, null, 2), "utf8");
}

function scheduleFloatingBoundsSave(settings?: AppSettings) {
  // A restauracao de uma janela sem moldura tambem dispara eventos de resize/move.
  // Eles nao sao um ajuste manual e nao devem sobrescrever os limites salvos.
  if (restoringFloatingBounds) {
    return;
  }
  if (floatingBoundsSaveTimer) {
    clearTimeout(floatingBoundsSaveTimer);
  }
  floatingBoundsSaveTimer = setTimeout(() => {
    floatingBoundsSaveTimer = null;
    void saveFloatingBounds(settings);
  }, 250);
}

async function createFloatingWindow(options?: { opacity?: number; lockPosition?: boolean }, settings?: AppSettings) {
  floatingRememberBounds = settings?.floating.rememberBounds ?? true;
  const size = settings ? floatingWindowSize(settings) : { width: FLOATING_MAX_WIDTH, minWidth: FLOATING_MIN_WIDTH, height: 118, minHeight: FLOATING_MIN_HEIGHT };
  const savedBounds = await readFloatingBounds(settings);
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    applyFloatingWindowOptions(options, settings);
    floatingWindow.showInactive();
    floatingWindow.moveTop();
    return floatingWindow;
  }

  floatingWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    movable: !options?.lockPosition,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    title: "Contabilizador Fixado",
    ...(savedBounds || {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  restoringFloatingBounds = Boolean(savedBounds);
  if (restoringFloatingBounds) {
    setTimeout(() => {
      restoringFloatingBounds = false;
    }, 700);
  }

  floatingWindow.setAlwaysOnTop(true, "screen-saver", 1);
  floatingWindow.setOpacity(options?.opacity ?? 1);
  try {
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    floatingWindow.setVisibleOnAllWorkspaces(true);
  }

  floatingWindow.once("ready-to-show", () => {
    floatingWindow?.showInactive();
    floatingWindow?.moveTop();
  });
  floatingWindow.on("close", () => {
    void saveFloatingBounds(settings);
  });
  floatingWindow.on("closed", () => {
    void saveFloatingBounds(settings);
    floatingWindow = null;
    restoringFloatingBounds = false;
    sendToMain("window:pinnedChanged", false);
  });
  floatingWindow.on("moved", () => scheduleFloatingBoundsSave(settings));
  floatingWindow.on("resized", () => scheduleFloatingBoundsSave(settings));

  if (isDev) {
    await floatingWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?floating=1`);
  } else {
    await floatingWindow.loadURL("app://local/index.html?floating=1");
  }

  sendToMain("window:pinnedChanged", true);
  return floatingWindow;
}

function floatingWindowSize(settings: AppSettings) {
  const fields = new Set(settings.floating.visibleFields?.length ? settings.floating.visibleFields : ["mode", "type", "value", "people", "description", "submit"]);
  const layoutMode = settings.floating.layoutMode || "adaptive";
  const hasTabs = fields.has("tabs") && layoutMode !== "mini";
  const weights: Record<string, number> = {
    tabs: 80,
    mode: 126,
    type: 146,
    value: 205,
    people: 160,
    tableNumber: 112,
    busNumber: 112,
    paymentMethod: 160,
    description: 285,
    paidWith: 190,
    result: 130,
    submit: 150
  };
  const width = Math.max(
    FLOATING_MIN_WIDTH,
    Math.min(
      FLOATING_MAX_WIDTH,
      76 + [...fields].reduce((total, field) => total + (weights[field] || 120), 0) + Math.max(0, fields.size - 1) * 8
    )
  );
  return {
    width,
    minWidth: FLOATING_MIN_WIDTH,
    height: hasTabs ? 106 : layoutMode === "mini" ? 62 : 86,
    minHeight: hasTabs ? 76 : layoutMode === "mini" ? FLOATING_MIN_HEIGHT : 62
  };
}

function applyFloatingWindowOptions(options?: { opacity?: number; lockPosition?: boolean }, settings?: AppSettings) {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }
  const size = settings ? floatingWindowSize(settings) : { width: FLOATING_MAX_WIDTH, minWidth: FLOATING_MIN_WIDTH, height: 118, minHeight: FLOATING_MIN_HEIGHT };
  if (settings) {
    floatingRememberBounds = settings.floating.rememberBounds;
  }
  floatingWindow.setMinimumSize(size.minWidth, size.minHeight);
  floatingWindow.setOpacity(options?.opacity ?? 1);
  floatingWindow.setMovable(!options?.lockPosition);
}

async function fetchLatestRelease(): Promise<GitHubReleaseResponse> {
  const response = await net.fetch(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Contabilizador-Caixa"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub respondeu ${response.status}.`);
  }
  return (await response.json()) as GitHubReleaseResponse;
}

function selectInstallerAsset(release: GitHubReleaseResponse): GitHubReleaseAsset | undefined {
  const assets = release.assets || [];
  const setup = assets.find((asset) => {
    const name = asset.name || "";
    return /setup/i.test(name) && /\.exe$/i.test(name) && !/blockmap/i.test(name);
  });
  if (setup) {
    return setup;
  }
  return assets.find((asset) => {
    const name = asset.name || "";
    return /\.exe$/i.test(name) && !/blockmap/i.test(name);
  });
}

function releaseToUpdateInfo(release: GitHubReleaseResponse, currentVersion: string): UpdateInfo {
  const latestVersion = normalizeVersion(release.tag_name || currentVersion);
  const asset = selectInstallerAsset(release);
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  return {
    currentVersion,
    latestVersion,
    hasUpdate,
    releaseUrl: release.html_url || "https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases",
    downloadUrl: hasUpdate ? asset?.browser_download_url : undefined,
    assetName: hasUpdate ? asset?.name : undefined,
    checkedAt: new Date().toISOString(),
    message: hasUpdate && !asset ? "Versao nova encontrada, mas sem instalador .exe anexado." : undefined
  };
}

async function downloadUpdateAsset(info: UpdateInfo): Promise<string> {
  if (!info.downloadUrl) {
    throw new Error("A release nova nao tem instalador disponivel para baixar.");
  }
  const fileName = info.assetName || `Contabilizador-Caixa-Setup-${info.latestVersion}.exe`;
  const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "contabilizador-update-"));
  const filePath = path.join(directory, fileName.replace(/[<>:"/\\|?*]/g, "-"));
  const response = await net.fetch(info.downloadUrl, {
    headers: {
      "User-Agent": "Contabilizador-Caixa"
    }
  });
  if (!response.ok) {
    throw new Error(`Download respondeu ${response.status}.`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, data);
  return filePath;
}

function defaultInstalledExePath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
  return path.join(localAppData, "Programs", "aplicativo-contabilizador", "Contabilizador Caixa.exe");
}

async function launchWindowsUpdater(installerPath: string) {
  const scriptPath = path.join(path.dirname(installerPath), "instalar-atualizacao.vbs");
  const script = [
    "Option Explicit",
    "Dim shell, fso, appPid, installerPath, currentExe, fallbackExe, targetExe",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    "appPid = WScript.Arguments.Item(0)",
    "installerPath = WScript.Arguments.Item(1)",
    "currentExe = WScript.Arguments.Item(2)",
    "fallbackExe = WScript.Arguments.Item(3)",
    "Do While IsProcessRunning(appPid)",
    "  WScript.Sleep 400",
    "Loop",
    "shell.Run Quote(installerPath) & \" /S\", 0, True",
    "targetExe = currentExe",
    "If Not fso.FileExists(targetExe) And fso.FileExists(fallbackExe) Then",
    "  targetExe = fallbackExe",
    "End If",
    "If fso.FileExists(targetExe) Then",
    "  shell.Run Quote(targetExe), 1, False",
    "End If",
    "Function IsProcessRunning(pid)",
    "  Dim service, processes",
    "  Set service = GetObject(\"winmgmts:\")",
    "  Set processes = service.ExecQuery(\"SELECT ProcessId FROM Win32_Process WHERE ProcessId=\" & CLng(pid))",
    "  IsProcessRunning = (processes.Count > 0)",
    "End Function",
    "Function Quote(value)",
    "  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)",
    "End Function"
  ].join("\r\n");
  await fs.writeFile(scriptPath, script, "utf8");
  const child = spawn("wscript.exe", ["//B", "//Nologo", scriptPath, String(process.pid), installerPath, app.getPath("exe"), defaultInstalledExePath()], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function listImportableLedgerFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(currentDirectory: string) {
    const items = await fs.readdir(currentDirectory, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(currentDirectory, item.name);
      if (item.isDirectory()) {
        if (!item.name.startsWith(".")) {
          await walk(fullPath);
        }
        continue;
      }
      const extension = path.extname(item.name).toLowerCase();
      if (!item.name.startsWith("~$") && [".xlsx", ".csv", ".tsv"].includes(extension)) {
        files.push(fullPath);
      }
    }
  }
  await walk(directory);
  return files.sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
}

async function importPdvProducts(filePath: string, importSource = "Importacao externa"): Promise<PdvProductImportResult> {
  const rows = await readPdvProductsFromXlsx(filePath);
  const normalized = normalizeImportedProducts(rows);
  if (importSource === "Cose Dell Abadia") {
    const beverageCategory = normalized.categories.find((category) => category.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase() === "BEBIDAS");
    const category = beverageCategory || {
      id: "category-cose-bebidas",
      name: "BEBIDAS",
      active: true,
      favorite: false,
      sortOrder: normalized.categories.length
    };
    if (!beverageCategory) {
      normalized.categories.push(category);
    }
    if (!normalized.products.some((product) => product.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase() === "COCA MINI")) {
      normalized.products.push({
        id: "product-cose-coca-mini",
        name: "COCA MINI",
        categoryId: category.id,
        categoryName: category.name,
        price: 5,
        unit: "UNID",
        unitMode: "unidade",
        active: true,
        showOnPdv: true,
        favorite: false,
        canBeComplement: false,
        hasComplements: false,
        complementProductIds: [],
        sortOrder: normalized.products.length
      });
    }
    configureCoseDellAbadiaComplements(normalized.products);
  }
  const result = await pdvStore.replaceProducts(normalized.categories, normalized.products, filePath, importSource);
  await logger.info(
    "Produtos PDV importados",
    `${result.importedProducts} produto(s), ${result.importedCategories} categoria(s): ${path.basename(filePath)}`
  );
  publishPdvChanged();
  return {
    ...result,
    skippedRows: result.skippedRows + normalized.skippedRows
  };
}

async function previewPdvProducts(filePath: string, importSource = "Importacao externa"): Promise<PdvProductImportPreview> {
  const rows = await readPdvProductsFromXlsx(filePath);
  const normalized = normalizeImportedProducts(rows);
  if (importSource === "Cose Dell Abadia") {
    const beverageCategory = normalized.categories.find((category) => category.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase() === "BEBIDAS");
    const category = beverageCategory || {
      id: "category-cose-bebidas",
      name: "BEBIDAS",
      active: true,
      favorite: false,
      sortOrder: normalized.categories.length
    };
    if (!beverageCategory) normalized.categories.push(category);
    if (!normalized.products.some((product) => product.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase() === "COCA MINI")) {
      normalized.products.push({
        id: "product-cose-coca-mini",
        name: "COCA MINI",
        categoryId: category.id,
        categoryName: category.name,
        price: 5,
        unit: "UNID",
        unitMode: "unidade",
        active: true,
        showOnPdv: true,
        favorite: false,
        canBeComplement: false,
        hasComplements: false,
        complementProductIds: [],
        sortOrder: normalized.products.length
      });
    }
    configureCoseDellAbadiaComplements(normalized.products);
  }
  const preview = pdvStore.previewProductImport(normalized.categories, normalized.products, filePath, importSource);
  return { ...preview, ignoredRows: normalized.skippedRows + preview.ignoredRows };
}

async function createUpgradeSafetyBackup(dataDirectory: string) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const markerPath = path.join(dataDirectory, ".pdv-remake-safety-backup");
  try {
    await fs.access(markerPath);
    return;
  } catch {
    // Primeira execucao da base PDV nova neste diretorio.
  }

  const files = ["settings.json", "ledger.json", "pdv.sqlite"];
  const existing: string[] = [];
  for (const file of files) {
    try {
      await fs.access(path.join(dataDirectory, file));
      existing.push(file);
    } catch {
      // Instalacoes novas podem nao ter arquivos antigos ainda.
    }
  }

  if (existing.length) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetDirectory = path.join(dataDirectory, "upgrade-backups", `antes-remake-pdv-${timestamp}`);
    await fs.mkdir(targetDirectory, { recursive: true });
    await Promise.all(existing.map((file) => fs.copyFile(path.join(dataDirectory, file), path.join(targetDirectory, file))));
  }
  await fs.writeFile(markerPath, new Date().toISOString(), "utf8");
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  registerAppProtocol();
  const dataDirectory = process.env.CAIXA_DATA_DIR || path.join(app.getPath("userData"), "data");
  const defaultOutputDirectory =
    process.env.CAIXA_OUTPUT_DIR || path.join(app.getPath("userData"), "planilhas");
  await createUpgradeSafetyBackup(dataDirectory);
  store = new LedgerStore({ dataDirectory, defaultOutputDirectory });
  pdvStore = new PdvStore(dataDirectory);
  exporter = new LedgerExporter(dataDirectory);
  logger = new DiagnosticLogger(dataDirectory);
  await store.initialize();
  await pdvStore.initialize();
  await logger.info("Aplicativo iniciado", `Versao ${app.getVersion()}`);

  localServer = new LocalServer({
    appVersion: app.getVersion(),
    permissions: (await store.getSettings()).server.permissions,
    getSettings: () => store.getSettings(),
    saveSettings: (settings) => store.saveSettings(settings),
    getEntries: () => getIntegratedLedgerEntries(),
    addEntry: async (draft: EntryDraft) => {
      const entry = await store.addEntry(draft);
      await exportLedgerIfEnabled();
      return entry;
    },
    updateEntry: async (id, patch) => {
      if (id.startsWith("pdv-")) {
        await pdvStore.updateSale(id.slice(4), patch);
        await exportLedgerIfEnabled();
        return (await getIntegratedLedgerEntries()).find((entry) => entry.id === id) || (() => { throw new Error("Venda PDV nao encontrada."); })();
      }
      const entry = await store.updateEntry(id, patch);
      await exportLedgerIfEnabled();
      return entry;
    },
    cancelEntry: async (id) => {
      if (id.startsWith("pdv-")) {
        await pdvStore.cancelSale(id.slice(4));
        await exportLedgerIfEnabled();
        return (await getIntegratedLedgerEntries()).find((entry) => entry.id === id) || (() => { throw new Error("Venda PDV nao encontrada."); })();
      }
      const entry = await store.cancelEntry(id);
      await exportLedgerIfEnabled();
      return entry;
    },
    removeEntry: async (id) => {
      if (id.startsWith("pdv-")) {
        await pdvStore.updateSale(id.slice(4), { status: "deleted" });
        await exportLedgerIfEnabled();
        return;
      }
      await store.removeEntry(id);
      await exportLedgerIfEnabled();
    },
    deleteEntry: async (id) => {
      if (id.startsWith("pdv-")) {
        await pdvStore.deleteSale(id.slice(4));
        await exportLedgerIfEnabled();
        return;
      }
      await store.deleteEntry(id);
      await exportLedgerIfEnabled();
    },
    getPdvSnapshot: (salesLimit) => pdvStore.getSnapshot(salesLimit),
    savePdvDirectSale: async (items, discount, payments, originDevice, operationId, saleType) => {
      const sale = await pdvStore.saveSale({ type: saleType === "Mesa" ? "Mesa" : saleType === "Onibus" ? "Onibus" : "Venda direta", items, discount, payments, originDevice, operationId });
      await exportLedgerIfEnabled();
      sendToAll("entries:changed");
      return sale;
    },
    openPdvTable: (tableNumber, people, note) => pdvStore.openTable(tableNumber, people, note),
    setPdvTableStatus: (tableNumber, status) => pdvStore.setTableStatus(tableNumber, status),
    savePdvTableItems: (tableNumber, items, subtables) => pdvStore.saveTableItems(tableNumber, items, subtables),
    transferPdvTableItems: (sourceTableNumber, targetTableNumber, selections) => pdvStore.transferTableItems(sourceTableNumber, targetTableNumber, selections),
    updatePdvProducts: (ids, patch) => pdvStore.updateProducts(ids, patch),
    savePdvCategory: (draft) => pdvStore.saveCategory(draft),
    savePdvProduct: (draft) => pdvStore.saveProduct(draft),
    savePdvSettings: (patch) => pdvStore.saveSettings(patch),
    savePdvCustomer: (draft) => pdvStore.saveCustomer(draft),
    receivePdvReceivable: (id, payment, originDevice, operationId) => pdvStore.receiveReceivable(id, payment, originDevice, operationId),
    updatePdvReceivable: (id, patch) => pdvStore.updateReceivable(id, patch),
    cancelPdvReceivable: (id) => pdvStore.cancelReceivable(id),
    savePdvPayable: (draft) => pdvStore.savePayable(draft),
    payPdvPayable: (id, payment, originDevice, operationId) => pdvStore.payPayable(id, payment, originDevice, operationId),
    cancelPdvPayable: (id) => pdvStore.cancelPayable(id),
    printPdvReceipt: async ({ sale, customer, receivable, customerName, customerDocument }) => {
      const snapshot = await pdvStore.getSnapshot();
      const hostWindow = mainWindow || BrowserWindow.getAllWindows()[0];
      const printers = hostWindow ? await hostWindow.webContents.getPrintersAsync() : [];
      const configured = snapshot.settings.receiptPrinterName;
      const printer = printers.find((item) => item.name === configured)
        || printers.find((item) => item.isDefault)
        || printers[0];
      if (!printer) {
        throw new Error("Nenhuma impressora foi encontrada no computador servidor.");
      }
      return printPdvReceiptDirect(sale, snapshot.settings, printer.name, customer, receivable, customerName, customerDocument);
    },
    importPdvPreset: () => importPdvProducts(path.join(app.getPath("downloads"), "produtos.xlsx"), "Cose Dell Abadia"),
    removePdvPreset: () => pdvStore.removeImportedProducts("Cose Dell Abadia"),
    closePdvTable: async (tableNumber, payments, discount, originDevice, operationId) => {
      const sale = await pdvStore.closeTable(tableNumber, payments, discount, originDevice, operationId);
      await exportLedgerIfEnabled();
      sendToAll("entries:changed");
      return sale;
    },
    cancelPdvTable: async (tableNumber, originDevice) => {
      const sale = await pdvStore.cancelTable(tableNumber, originDevice);
      await exportLedgerIfEnabled();
      sendToAll("entries:changed");
      return sale;
    },
    savePdvTablePartial: async (tableNumber, items, payments, discount, originDevice, operationId, observations) => {
      const sale = await pdvStore.closeTablePartial(tableNumber, items, payments, discount || 0, originDevice, operationId, observations);
      await exportLedgerIfEnabled();
      sendToAll("entries:changed");
      return sale;
    },
    updatePdvSalePayments: async (saleId, payments) => {
      const sale = await pdvStore.updateSalePayments(saleId, payments);
      await exportLedgerIfEnabled();
      sendToAll("entries:changed");
      return sale;
    },
    onRemoteChange: () => {
      sendToAll("entries:changed");
      sendToAll("server:changed", localServer.getState());
    },
    onRemoteSettingsChange: () => {
      sendToAll("settings:changed");
    },
    onRemotePdvChange: () => {
      sendToAll("pdv:changed");
      sendToAll("server:changed", localServer.getState());
    },
    onServerStateChange: () => {
      sendToAll("server:changed", localServer.getState());
    },
    onRemotePrintResult: (result) => {
      sendToAll("receipt-print:result", result);
    }
  });

  registerIpc();
  await createWindow();
}

function registerAppProtocol() {
  const distRoot = path.normalize(path.join(__dirname, "../../dist"));

  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const filePath = path.normalize(path.join(distRoot, requestedPath));

    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function sendToMain(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function sendToAll(channel: string, ...args: unknown[]) {
  sendToMain(channel, ...args);
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send(channel, ...args);
  }
}

function publishPdvChanged() {
  sendToAll("pdv:changed");
  localServer.broadcast({ type: "pdv-changed", changedAt: new Date().toISOString() });
}

function publishServerPolicyChanged() {
  localServer.broadcast({ type: "server-policy-changed", changedAt: new Date().toISOString() });
}

async function logExportStatus(action: string, status: ExportStatus) {
  if (!status.ok) {
    await logger.warn(`Exportacao pendente em ${action}`, status.message || "Sem detalhe informado.");
  }
}

async function getIntegratedLedgerEntries() {
  return [
    ...(await store.getEntries()),
    ...pdvSalesToLedgerEntries(pdvStore.getSales({}))
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function exportLedgerIfEnabled(settingsOverride?: AppSettings): Promise<ExportStatus> {
  const settings = settingsOverride || await store.getSettings();
  if (!settings.automaticSpreadsheetEnabled) {
    return {
      ok: true,
      pendingCount: 0,
      message: "Sincronizacao automatica desativada. Use a exportacao manual quando desejar."
    };
  }
  return exporter.export(await getIntegratedLedgerEntries(), settings);
}

function registerIpc() {
  ipcMain.handle("app:getSnapshot", async () => ({
    entries: await getIntegratedLedgerEntries(),
    settings: await store.getSettings(),
    server: localServer.getState(),
    exportStatus: await exporter.getStatus()
  }));

  ipcMain.handle("pdv:getSnapshot", async (_event, salesLimit?: number) => pdvStore.getSnapshot(salesLimit));

  ipcMain.handle("pdv:saveSettings", async (_event, patch: Partial<PdvSettings>) => {
    const settings = await pdvStore.saveSettings(patch);
    publishPdvChanged();
    return settings;
  });

  ipcMain.handle("pdv:updateProducts", async (_event, ids: string[], patch: { categoryId?: string; canBeComplement?: boolean; hasComplements?: boolean; showOnPdv?: boolean; favorite?: boolean }) => {
    await pdvStore.updateProducts(ids, patch);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:saveCategory", async (_event, draft: PdvCategoryDraft): Promise<PdvCategory> => {
    const category = await pdvStore.saveCategory(draft);
    publishPdvChanged();
    return category;
  });

  ipcMain.handle("pdv:saveProduct", async (_event, draft: PdvProductDraft): Promise<PdvProduct> => {
    const product = await pdvStore.saveProduct(draft);
    publishPdvChanged();
    return product;
  });

  ipcMain.handle("pdv:removeProduct", async (_event, id: string) => {
    const mode = await pdvStore.removeProduct(id);
    publishPdvChanged();
    return { id, mode };
  });

  ipcMain.handle("pdv:importCoseProducts", async (): Promise<PdvProductImportResult> => {
    const defaultPath = path.join(app.getPath("downloads"), "produtos.xlsx");
    return importPdvProducts(defaultPath, "Cose Dell Abadia");
  });

  ipcMain.handle("pdv:previewCoseProducts", async (): Promise<PdvProductImportPreview> => {
    const defaultPath = path.join(app.getPath("downloads"), "produtos.xlsx");
    return previewPdvProducts(defaultPath, "Cose Dell Abadia");
  });

  ipcMain.handle("pdv:removeCoseProducts", async (): Promise<number> => {
    const removed = await pdvStore.removeImportedProducts("Cose Dell Abadia");
    publishPdvChanged();
    return removed;
  });

  ipcMain.handle("pdv:previewProductsFile", async (): Promise<PdvProductImportPreview | null> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Importar produtos para o PDV",
      properties: ["openFile"],
      filters: [{ name: "Planilha de produtos", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return previewPdvProducts(result.filePaths[0]);
  });

  ipcMain.handle("pdv:importProductsFile", async (_event, filePath?: string): Promise<PdvProductImportResult | null> => {
    if (filePath) {
      return importPdvProducts(filePath);
    }
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Importar produtos para o PDV",
      properties: ["openFile"],
      filters: [{ name: "Planilha de produtos", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importPdvProducts(result.filePaths[0]);
  });

  ipcMain.handle("pdv:saveDirectSale", async (_event, input: { items: PdvCartItem[]; discount: number; payments: PdvPayment[]; saleType?: PdvSale["type"]; operationId?: string }): Promise<PdvSale> => {
    const sale = await pdvStore.saveSale({
      type: input.saleType === "Mesa" ? "Mesa" : input.saleType === "Onibus" ? "Onibus" : "Venda direta",
      items: input.items,
      discount: input.discount,
      payments: input.payments,
      operationId: input.operationId || randomUUID()
    });
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
    return sale;
  });

  ipcMain.handle("pdv:openTable", async (_event, tableNumber: number, people?: number, note?: string) => {
    await pdvStore.openTable(tableNumber, people, note);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:setTableStatus", async (_event, tableNumber: number, status: PdvTableStatus) => {
    await pdvStore.setTableStatus(tableNumber, status);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:saveTableItems", async (_event, tableNumber: number, items: PdvCartItem[], subtables?: string[]) => {
    await pdvStore.saveTableItems(tableNumber, items, subtables);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:transferTableItems", async (_event, sourceTableNumber: number, targetTableNumber: number, selections: PdvTransferSelection[]): Promise<PdvCartItem[]> => {
    const items = await pdvStore.transferTableItems(sourceTableNumber, targetTableNumber, selections);
    publishPdvChanged();
    return items;
  });

  ipcMain.handle("pdv:closeTable", async (_event, tableNumber: number, payments: PdvPayment[], discount?: number, operationId?: string): Promise<PdvSale> => {
    const sale = await pdvStore.closeTable(tableNumber, payments, discount, "Este computador", operationId || randomUUID());
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
    return sale;
  });

  ipcMain.handle("pdv:cancelTable", async (_event, tableNumber: number): Promise<PdvSale | null> => {
    const sale = await pdvStore.cancelTable(tableNumber, "Este computador");
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
    return sale;
  });

  ipcMain.handle("pdv:saveTablePartial", async (_event, tableNumber: number, items: PdvCartItem[], payments: PdvPayment[], discount?: number, operationId?: string, observations?: string): Promise<PdvSale> => {
    const sale = await pdvStore.closeTablePartial(tableNumber, items, payments, discount || 0, "Este computador", operationId || randomUUID(), observations);
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
    return sale;
  });

  ipcMain.handle("pdv:cancelSale", async (_event, id: string) => {
    await pdvStore.cancelSale(id);
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
  });

  ipcMain.handle("pdv:updateSalePayments", async (_event, id: string, payments: PdvPayment[]): Promise<PdvSale> => {
    const sale = await pdvStore.updateSalePayments(id, payments);
    await exportLedgerIfEnabled();
    sendToAll("entries:changed");
    publishPdvChanged();
    return sale;
  });

  ipcMain.handle("pdv:saveCustomer", async (_event, draft: PdvCustomerDraft): Promise<PdvCustomer> => {
    const customer = await pdvStore.saveCustomer(draft);
    publishPdvChanged();
    return customer;
  });

  ipcMain.handle("pdv:receiveReceivable", async (_event, id: string, payment: PdvReceivablePayment, operationId?: string): Promise<PdvReceivable> => {
    const receivable = await pdvStore.receiveReceivable(id, payment, "Este computador", operationId || randomUUID());
    publishPdvChanged();
    return receivable;
  });

  ipcMain.handle("pdv:updateReceivable", async (_event, id: string, patch: PdvReceivablePatch): Promise<PdvReceivable> => {
    const receivable = await pdvStore.updateReceivable(id, patch);
    publishPdvChanged();
    return receivable;
  });

  ipcMain.handle("pdv:cancelReceivable", async (_event, id: string) => {
    await pdvStore.cancelReceivable(id);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:savePayable", async (_event, draft: PdvPayableDraft): Promise<PdvPayable> => {
    const payable = await pdvStore.savePayable(draft);
    publishPdvChanged();
    return payable;
  });

  ipcMain.handle("pdv:payPayable", async (_event, id: string, payment: PdvPayablePayment, operationId?: string): Promise<PdvPayable> => {
    const payable = await pdvStore.payPayable(id, payment, "Este computador", operationId || randomUUID());
    publishPdvChanged();
    return payable;
  });

  ipcMain.handle("pdv:cancelPayable", async (_event, id: string) => {
    await pdvStore.cancelPayable(id);
    publishPdvChanged();
  });

  ipcMain.handle("pdv:printReceipt", async (
    _event,
    sale: PdvSale,
    customer?: PdvCustomer,
    receivable?: PdvReceivable,
    options?: { customerName?: string; customerDocument?: string; action?: "open" | "save" | "print"; printerName?: string; receiptSettings?: PdvSettings }
  ) => {
    try {
      const appSettings = await store.getSettings();
      const snapshot = await pdvStore.getSnapshot();
      const receiptSettings = options?.receiptSettings ? { ...snapshot.settings, ...options.receiptSettings } : snapshot.settings;
      if (options?.action === "print") {
        const printerName = options.printerName || snapshot.settings.receiptPrinterName || "";
        if (printerName) {
          const directResult = await printPdvReceiptDirect(sale, receiptSettings, printerName, customer, receivable, options.customerName, options.customerDocument);
          if (directResult.ok) return directResult;
        }
      }
      const pdf = await printPdvReceipt(sale, receiptSettings, customer, receivable, options?.customerName, options?.customerDocument);
      const safeId = sale.id.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48);
      const date = new Date(sale.createdAt);
      const stamp = `${date.toISOString().slice(0, 10)}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
      const defaultDirectory = path.join(appSettings.outputDirectory, "Recibos");
      const defaultPath = path.join(defaultDirectory, `recibo-${stamp}-${safeId}.pdf`);
      let filePath = defaultPath;
      if (options?.action === "save") {
        const dialogOptions = {
          title: "Salvar recibo em PDF",
          defaultPath,
          filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
        };
        const selected = mainWindow
          ? await dialog.showSaveDialog(mainWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (selected.canceled || !selected.filePath) {
          return { ok: false, message: "Salvamento do recibo cancelado." };
        }
        filePath = selected.filePath;
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, pdf);
      if (options?.action !== "save") {
        const openError = await shell.openPath(filePath);
        if (openError) {
          return { ok: false, message: "O recibo foi criado, mas o Windows nao conseguiu abri-lo.", filePath };
        }
      }
      return {
        ok: true,
        message: options?.action === "save"
          ? "Recibo salvo em PDF."
          : options?.action === "print"
            ? "A impressora configurada nao respondeu. O recibo foi aberto em PDF."
            : "Recibo aberto. Use a opcao Imprimir do visualizador.",
        filePath
      };
    } catch (error) {
      await logger.error("Falha ao gerar recibo", error instanceof Error ? error.message : String(error));
      return { ok: false, message: "Nao foi possivel gerar o recibo. Confira a pasta de exportacao e tente novamente." };
    }
  });

  ipcMain.handle("pdv:receiptPreview", async (
    _event,
    sale: PdvSale,
    customer?: PdvCustomer,
    receivable?: PdvReceivable,
    customerName?: string,
    customerDocument?: string,
    receiptSettings?: PdvSettings
  ) => buildPdvReceiptHtml(sale, receiptSettings || (await pdvStore.getSnapshot()).settings, customer, receivable, customerName, customerDocument));

  ipcMain.handle("pdv:listPrinters", async () => {
    try {
      const printers = await mainWindow?.webContents.getPrintersAsync() || [];
      return printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        isDefault: Boolean(printer.isDefault)
      }));
    } catch (error) {
      await logger.warn("Impressoras indisponiveis", error instanceof Error ? error.message : String(error));
      return [];
    }
  });

  ipcMain.handle("pdv:chooseReceiptLogo", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Escolher logotipo do recibo",
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || !result.filePaths[0]) return "";
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) throw new Error("A imagem selecionada nao pode ser lida.");
    return image.resize({ width: 320, quality: "best" }).toDataURL();
  });

  ipcMain.handle("pdv:exportSales", async (_event, filters: PdvExportFilters = {}) => {
    const settings = await store.getSettings();
    const snapshot = await pdvStore.getSnapshot();
    const status = await new PdvExporter(path.join(settings.outputDirectory, "Relatorios")).exportSales(
      pdvStore.getSales(filters),
      filters,
      await store.getEntries(),
      "",
      settings.reportExportSections,
      false,
      snapshot.customers,
      snapshot.receivables
    );
    await logExportStatus("exportacao PDV", status);
    return status;
  });

  ipcMain.handle("entries:add", async (_event, draft: EntryDraft) => {
    const entry = await store.addEntry(draft);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("novo lancamento", exportStatus);
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:update", async (_event, id: string, patch: Partial<LedgerEntry>) => {
    if (id.startsWith("pdv-")) {
      const saleId = id.replace("pdv-", "");
      await pdvStore.updateSale(saleId, patch);
      const exportStatus = await exportLedgerIfEnabled();
      await logExportStatus("edicao de lancamento pdv", exportStatus);
      sendToAll("entries:changed");
      publishPdvChanged();
      return { entry: null, exportStatus };
    }
    const entry = await store.updateEntry(id, patch);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("edicao de lancamento", exportStatus);
    localServer.broadcast({ type: "entry-updated", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:remove", async (_event, id: string) => {
    if (id.startsWith("pdv-")) {
      const saleId = id.replace("pdv-", "");
      await pdvStore.updateSale(saleId, { status: "deleted" });
      const exportStatus = await exportLedgerIfEnabled();
      await logExportStatus("lixeira pdv", exportStatus);
      sendToAll("entries:changed");
      publishPdvChanged();
      return { exportStatus };
    }
    await store.removeEntry(id);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("lixeira", exportStatus);
    localServer.broadcast({ type: "entry-removed", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:delete", async (_event, id: string) => {
    if (id.startsWith("pdv-")) {
      const saleId = id.replace("pdv-", "");
      await pdvStore.deleteSale(saleId);
      const exportStatus = await exportLedgerIfEnabled();
      await logExportStatus("exclusao definitiva pdv", exportStatus);
      sendToAll("entries:changed");
      publishPdvChanged();
      return { exportStatus };
    }
    await store.deleteEntry(id);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("exclusao definitiva", exportStatus);
    localServer.broadcast({ type: "entry-deleted", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:duplicate", async (_event, id: string) => {
    if (id.startsWith("pdv-")) {
      throw new Error("Duplicacao de venda do PDV nao suportada.");
    }
    const entry = await store.duplicateEntry(id);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("duplicacao", exportStatus);
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:cancel", async (_event, id: string) => {
    if (id.startsWith("pdv-")) {
      const saleId = id.replace("pdv-", "");
      await pdvStore.cancelSale(saleId);
      const exportStatus = await exportLedgerIfEnabled();
      await logExportStatus("cancelamento pdv", exportStatus);
      sendToAll("entries:changed");
      publishPdvChanged();
      return { entry: null, exportStatus };
    }
    const entry = await store.cancelEntry(id);
    const exportStatus = await exportLedgerIfEnabled();
    await logExportStatus("cancelamento", exportStatus);
    localServer.broadcast({ type: "entry-cancelled", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    const saved = await store.saveSettings(settings);
    localServer.setPermissions(saved.server.permissions);
    applyFloatingWindowOptions({
      opacity: saved.floating.opacity,
      lockPosition: saved.floating.lockPosition
    }, saved);
    const exportStatus = await exportLedgerIfEnabled(saved);
    await logExportStatus("salvar configuracoes", exportStatus);
    sendToAll("settings:changed", saved);
    sendToAll("server:changed", localServer.getState());
    publishServerPolicyChanged();
    return saved;
  });

  ipcMain.handle("settings:chooseOutputDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Escolher pasta dos arquivos",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("settings:exportConfig", async (_event, settings: AppSettings) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Exportar configuracoes",
      defaultPath: `contabilizador-config-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Configuracoes JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await fs.writeFile(
      result.filePath,
      JSON.stringify(
        {
          app: "Contabilizador Caixa",
          version: app.getVersion(),
          exportedAt: new Date().toISOString(),
          settings
        },
        null,
        2
      ),
      "utf8"
    );
    return result.filePath;
  });

  ipcMain.handle("settings:importConfig", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Importar configuracoes",
      properties: ["openFile"],
      filters: [{ name: "Configuracoes JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const filePath = result.filePaths[0];
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { settings?: Partial<AppSettings> } | Partial<AppSettings>;
    return {
      filePath,
      settings: "settings" in parsed && parsed.settings ? parsed.settings : parsed
    };
  });

  ipcMain.handle("export:now", async () => {
    const status = await exporter.export(await getIntegratedLedgerEntries(), await store.getSettings(), { rewriteHistorical: true });
    await logExportStatus("exportacao manual", status);
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
  });

  ipcMain.handle("export:today", async () => {
    const status = await exporter.exportTodayRecovery(await getIntegratedLedgerEntries(), await store.getSettings());
    await logExportStatus("arquivo de resgate de hoje", status);
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
  });

  ipcMain.handle("reports:exportFiltered", async (_event, ids: string[], label: string) => {
    const idSet = new Set(ids);
    const settings = await store.getSettings();
    const saleIds = new Set(ids.filter((id) => id.startsWith("pdv-")).map((id) => id.slice(4)));
    const sales = pdvStore.getSales({}).filter((sale) => saleIds.has(sale.id));
    const entries = (await store.getEntries()).filter((entry) => idSet.has(entry.id));
    const reportDirectory = path.join(settings.outputDirectory, label.includes("products") ? "Produtos" : "Relatorios");
    const snapshot = await pdvStore.getSnapshot();
    const selectedReceivables = snapshot.receivables.filter((item) => saleIds.has(item.saleId));
    const selectedCustomerIds = new Set(selectedReceivables.map((item) => item.customerId));
    const status = await new PdvExporter(reportDirectory).exportSales(sales, {}, entries, label || "relatorio", settings.reportExportSections, false, snapshot.customers.filter((item) => selectedCustomerIds.has(item.id)), selectedReceivables);
    await logExportStatus("relatorio filtrado", status);
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
  });

  ipcMain.handle("entries:previewImportFile", async (_event, providedPath?: string): Promise<LedgerImportPreview | null> => {
    let filePath = providedPath;
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Importar Excel ou CSV",
        properties: ["openFile"],
        filters: [
          { name: "Planilhas compativeis", extensions: ["xlsx", "csv", "tsv"] },
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv", "tsv"] }
        ]
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      filePath = result.filePaths[0];
    }

    const settings = await store.getSettings();
    const parsed = await readLedgerImport(filePath, settings);
    const preview = await store.previewImportEntries(parsed.entries);
    return {
      filePath,
      fileName: path.basename(filePath),
      totalRows: parsed.totalRows,
      parsedRows: parsed.parsedRows,
      ignoredRows: parsed.skippedRows,
      newRows: preview.imported,
      duplicateRows: preview.skipped,
      warnings: parsed.warnings,
      sample: preview.items.slice(0, 30).map(({ entry, duplicate }) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        type: entry.type,
        description: entry.description,
        finalValue: entry.finalValue,
        paymentMethod: entry.paymentMethod,
        status: entry.status,
        tableNumber: entry.tableNumber,
        busNumber: entry.busNumber,
        duplicate
      }))
    };
  });

  ipcMain.handle("entries:importFile", async (_event, providedPath?: string): Promise<LedgerImportResult | null> => {
    let filePath = providedPath;
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Importar Excel ou CSV",
        properties: ["openFile"],
        filters: [
          { name: "Planilhas compativeis", extensions: ["xlsx", "csv", "tsv"] },
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv", "tsv"] }
        ]
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      filePath = result.filePaths[0];
    }

    const settings = await store.getSettings();
    const parsed = await readLedgerImport(filePath, settings);
    const imported = await store.importEntries(parsed.entries);
    const exportStatus = await exportLedgerIfEnabled(settings);
    await logExportStatus("importacao de planilha", exportStatus);
    if (imported.imported) {
      await logger.info("Planilha importada", `${imported.imported} novo(s), ${imported.skipped + parsed.skippedRows} pulado(s): ${path.basename(filePath)}`);
      localServer.broadcast({ type: "entries-imported", count: imported.imported });
      sendToAll("entries:changed");
    }
    return {
      filePath,
      imported: imported.imported,
      skipped: imported.skipped + parsed.skippedRows,
      totalRows: parsed.totalRows,
      parsedRows: parsed.parsedRows,
      warnings: parsed.warnings,
      exportStatus
    };
  });

  ipcMain.handle("entries:importFolder", async (_event, providedPath?: string): Promise<LedgerFolderImportResult | null> => {
    let folderPath = providedPath;
    if (!folderPath) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Importar pasta com planilhas",
        properties: ["openDirectory"]
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      folderPath = result.filePaths[0];
    }

    const settings = await store.getSettings();
    const files = await listImportableLedgerFiles(folderPath);
    let importedCount = 0;
    let skippedCount = 0;
    let totalRows = 0;
    let parsedRows = 0;
    let filesImported = 0;
    const warnings: string[] = [];

    for (const filePath of files) {
      try {
        const parsed = await readLedgerImport(filePath, settings);
        const imported = await store.importEntries(parsed.entries);
        if (imported.imported) {
          filesImported += 1;
        }
        importedCount += imported.imported;
        skippedCount += imported.skipped + parsed.skippedRows;
        totalRows += parsed.totalRows;
        parsedRows += parsed.parsedRows;
        warnings.push(...parsed.warnings.map((warning) => `${path.basename(filePath)}: ${warning}`));
      } catch (error) {
        skippedCount += 1;
        warnings.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : "Nao foi possivel importar."}`);
      }
    }

    const exportStatus = await exportLedgerIfEnabled(settings);
    await logExportStatus("importacao de pasta", exportStatus);
    if (importedCount) {
      await logger.info("Pasta de planilhas importada", `${importedCount} novo(s), ${skippedCount} pulado(s), ${files.length} arquivo(s): ${folderPath}`);
      localServer.broadcast({ type: "entries-imported", count: importedCount });
      sendToAll("entries:changed");
    }
    return {
      folderPath,
      filesScanned: files.length,
      filesImported,
      imported: importedCount,
      skipped: skippedCount,
      totalRows,
      parsedRows,
      warnings,
      exportStatus
    };
  });

  ipcMain.handle("diagnostics:get", async (): Promise<DiagnosticsSnapshot> => {
    const settings = await store.getSettings();
    const backups = await store.listDataBackups();
    return {
      dataDirectory: store.getDataDirectory(),
      outputDirectory: settings.outputDirectory,
      exportStatus: await exporter.getStatus(),
      entryCount: (await getIntegratedLedgerEntries()).length,
      backupCount: backups.length,
      backups,
      logs: await logger.list()
    };
  });

  ipcMain.handle("diagnostics:createBackup", async (_event, reason?: string): Promise<DataBackupInfo> => {
    const backup = await store.createDataBackup(reason || "manual", await pdvStore.exportBackupBase64());
    await logger.info("Backup local criado", backup.fileName);
    return backup;
  });

  ipcMain.handle("diagnostics:restoreBackup", async (_event, providedPath?: string) => {
    let filePath = providedPath;
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Restaurar backup do Contabilizador",
        properties: ["openFile"],
        filters: [{ name: "Backup JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      filePath = result.filePaths[0];
    }

    const restored = await store.restoreDataBackup(filePath, await pdvStore.exportBackupBase64());
    if (restored.pdvDatabaseBase64) {
      await pdvStore.restoreBackupBase64(restored.pdvDatabaseBase64);
    }
    const settings = await store.getSettings();
    localServer.setPermissions(settings.server.permissions);
    const exportStatus = await exportLedgerIfEnabled(settings);
    await logExportStatus("restauracao de backup", exportStatus);
    await logger.warn("Backup restaurado", `${restored.backup.fileName}; backup de seguranca: ${restored.safetyBackup.fileName}`);
    sendToAll("settings:changed", settings);
    sendToAll("server:changed", localServer.getState());
    sendToAll("entries:changed");
    return { ...restored, exportStatus };
  });

  ipcMain.handle("diagnostics:openDataDirectory", async () => {
    return shell.openPath(store.getDataDirectory());
  });

  ipcMain.handle("diagnostics:openOutputDirectory", async () => {
    return shell.openPath((await store.getSettings()).outputDirectory);
  });

  ipcMain.handle("updates:check", async (): Promise<UpdateInfo> => {
    const currentVersion = app.getVersion();
    try {
      return releaseToUpdateInfo(await fetchLatestRelease(), currentVersion);
    } catch (error) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        releaseUrl: "https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases",
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Nao foi possivel verificar atualizacoes."
      };
    }
  });

  ipcMain.handle("updates:install", async (): Promise<UpdateInstallResult> => {
    const currentVersion = app.getVersion();
    try {
      const info = releaseToUpdateInfo(await fetchLatestRelease(), currentVersion);
      if (!info.hasUpdate) {
        return {
          ok: false,
          latestVersion: info.latestVersion,
          message: "Voce ja esta na versao mais recente."
        };
      }
      const installerPath = await downloadUpdateAsset(info);
      await logger.info("Atualizacao baixada", `${info.latestVersion}; ${installerPath}`);
      if (process.platform === "win32") {
        await launchWindowsUpdater(installerPath);
        floatingWindow?.close();
        mainWindow?.close();
        setTimeout(() => app.quit(), 250);
        return {
          ok: true,
          latestVersion: info.latestVersion,
          filePath: installerPath,
          message: "Atualizacao baixada. O app vai fechar, instalar e abrir de novo."
        };
      }
      await shell.openPath(installerPath);
      return {
        ok: true,
        latestVersion: info.latestVersion,
        filePath: installerPath,
        message: "Atualizacao baixada. Conclua a instalacao pelo arquivo aberto."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel instalar a atualizacao.";
      await logger.error("Falha ao instalar atualizacao", message);
      return { ok: false, latestVersion: currentVersion, message };
    }
  });

  ipcMain.handle("server:start", async (_event, port: number, password: string) => {
    localServer.setPermissions((await store.getSettings()).server.permissions);
    const state = await localServer.start(port, password);
    sendToAll("server:changed", state);
    return state;
  });

  ipcMain.handle("server:stop", async () => {
    const state = await localServer.stop();
    sendToAll("server:changed", state);
    return state;
  });

  ipcMain.handle("server:disconnectDevice", async (_event, id: string) => {
    const state = localServer.disconnectDevice(id);
    sendToAll("server:changed", state);
    return state;
  });

  ipcMain.handle("app:getVersion", async () => app.getVersion());

  ipcMain.handle("server:printPdvReceipt", async (
    _event,
    deviceId: string,
    payload: {
      sale: PdvSale;
      customer?: PdvCustomer;
      receivable?: PdvReceivable;
      customerName?: string;
      customerDocument?: string;
    }
  ) => {
    const snapshot = await pdvStore.getSnapshot();
    return localServer.requestReceiptPrint(deviceId, {
      jobId: randomUUID(),
      ...payload,
      receiptSettings: snapshot.settings
    });
  });

  ipcMain.handle("window:setPinned", async (_event, enabled: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) => {
    if (enabled) {
      await createFloatingWindow(options, await store.getSettings());
      return true;
    }

    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
    floatingWindow = null;
    sendToMain("window:pinnedChanged", false);
    return false;
  });

  ipcMain.handle("window:getPinned", async () => Boolean(floatingWindow && !floatingWindow.isDestroyed()));
}

function normalizeVersion(version: string) {
  return version.replace(/^v/i, "").trim();
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : floatingWindow;
    if (target && !target.isDestroyed()) {
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      target.webContents.send("app:secondInstance");
      return;
    }
    secondInstancePending = true;
  });

  app.whenReady().then(async () => {
    await bootstrap();
    if (secondInstancePending && mainWindow && !mainWindow.isDestroyed()) {
      secondInstancePending = false;
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("app:secondInstance");
    }
  });
}

app.on("before-quit", (event) => {
  if (gracefulQuitFinished || !store || !pdvStore) {
    return;
  }
  event.preventDefault();
  if (gracefulQuitStarted) {
    return;
  }
  gracefulQuitStarted = true;
  void (async () => {
    try {
      const settings = await store.getSettings();
      const today = getLocalDateKey();
      if (settings.automaticClosingReportEnabled) {
        const snapshot = await pdvStore.getSnapshot();
        const status = await new PdvExporter(path.join(settings.outputDirectory, "Fechamentos diarios")).exportSales(
          pdvStore.getSales({ from: today, to: today }),
          { from: today, to: today, type: "Todos", payment: "Todos", status: "Todos" },
          await store.getEntries(),
          `fechamento-diario-${today}`,
          settings.reportExportSections,
          true,
          snapshot.customers,
          snapshot.receivables.filter((item) => item.createdAt.slice(0, 10) === today || item.payments.some((payment) => payment.createdAt.slice(0, 10) === today))
        );
        await logExportStatus("fechamento automatico do dia", status);
      }
      if (settings.backupEnabled) {
        const backup = await store.createDailyDataBackup("fechamento-do-dia", await pdvStore.exportBackupBase64());
        await logger.info("Backup diario atualizado", backup.fileName);
      }
    } catch (error) {
      await logger?.error("Falha no fechamento automatico", error instanceof Error ? error.message : String(error));
    } finally {
      gracefulQuitFinished = true;
      app.quit();
    }
  })();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
