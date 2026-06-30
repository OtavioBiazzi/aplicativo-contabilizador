import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LedgerExporter } from "./exporter.js";
import { readLedgerImport } from "./importer.js";
import { LocalServer } from "./localServer.js";
import { LedgerStore } from "./storage.js";
import type { AppSettings, EntryDraft, LedgerImportPreview, LedgerImportResult, LedgerEntry, UpdateInfo } from "../src/shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let store: LedgerStore;
let exporter: LedgerExporter;
let localServer: LocalServer;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const RELEASE_API_URL = "https://api.github.com/repos/OtavioBiazzi/aplicativo-contabilizador/releases/latest";

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

async function createFloatingWindow(options?: { opacity?: number; lockPosition?: boolean }) {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    applyFloatingWindowOptions(options);
    floatingWindow.showInactive();
    floatingWindow.moveTop();
    return floatingWindow;
  }

  floatingWindow = new BrowserWindow({
    width: 1240,
    height: 132,
    minWidth: 560,
    minHeight: 110,
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
  floatingWindow.on("closed", () => {
    floatingWindow = null;
    sendToMain("window:pinnedChanged", false);
  });

  if (isDev) {
    await floatingWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?floating=1`);
  } else {
    await floatingWindow.loadURL("app://local/index.html?floating=1");
  }

  sendToMain("window:pinnedChanged", true);
  return floatingWindow;
}

function applyFloatingWindowOptions(options?: { opacity?: number; lockPosition?: boolean }) {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }
  floatingWindow.setOpacity(options?.opacity ?? 1);
  floatingWindow.setMovable(!options?.lockPosition);
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  registerAppProtocol();
  const dataDirectory = process.env.CAIXA_DATA_DIR || path.join(app.getPath("userData"), "data");
  const defaultOutputDirectory =
    process.env.CAIXA_OUTPUT_DIR || path.join(app.getPath("documents"), "Contabilizador Caixa");
  store = new LedgerStore({ dataDirectory, defaultOutputDirectory });
  exporter = new LedgerExporter(dataDirectory);
  await store.initialize();

  localServer = new LocalServer({
    permissions: (await store.getSettings()).server.permissions,
    getEntries: () => store.getEntries(),
    addEntry: async (draft: EntryDraft) => {
      const entry = await store.addEntry(draft);
      await exporter.export(await store.getEntries(), await store.getSettings());
      return entry;
    },
    updateEntry: async (id, patch) => {
      const entry = await store.updateEntry(id, patch);
      await exporter.export(await store.getEntries(), await store.getSettings());
      return entry;
    },
    cancelEntry: async (id) => {
      const entry = await store.cancelEntry(id);
      await exporter.export(await store.getEntries(), await store.getSettings());
      return entry;
    },
    removeEntry: async (id) => {
      await store.removeEntry(id);
      await exporter.export(await store.getEntries(), await store.getSettings());
    },
    deleteEntry: async (id) => {
      await store.deleteEntry(id);
      await exporter.export(await store.getEntries(), await store.getSettings());
    },
    onRemoteChange: () => {
      sendToAll("entries:changed");
      sendToAll("server:changed", localServer.getState());
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

function registerIpc() {
  ipcMain.handle("app:getSnapshot", async () => ({
    entries: await store.getEntries(),
    settings: await store.getSettings(),
    server: localServer.getState(),
    exportStatus: await exporter.getStatus()
  }));

  ipcMain.handle("entries:add", async (_event, draft: EntryDraft) => {
    const entry = await store.addEntry(draft);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:update", async (_event, id: string, patch: Partial<LedgerEntry>) => {
    const entry = await store.updateEntry(id, patch);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    localServer.broadcast({ type: "entry-updated", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:remove", async (_event, id: string) => {
    await store.removeEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    localServer.broadcast({ type: "entry-removed", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:delete", async (_event, id: string) => {
    await store.deleteEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    localServer.broadcast({ type: "entry-deleted", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:duplicate", async (_event, id: string) => {
    const entry = await store.duplicateEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:cancel", async (_event, id: string) => {
    const entry = await store.cancelEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
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
    });
    await exporter.export(await store.getEntries(), saved);
    sendToAll("settings:changed", saved);
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
    const status = await exporter.export(await store.getEntries(), await store.getSettings());
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
  });

  ipcMain.handle("reports:exportFiltered", async (_event, ids: string[], label: string) => {
    const idSet = new Set(ids);
    const entries = (await store.getEntries()).filter((entry) => idSet.has(entry.id));
    const status = await exporter.exportReport(entries, await store.getSettings(), label);
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
    const exportStatus = await exporter.export(await store.getEntries(), settings);
    if (imported.imported) {
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

  ipcMain.handle("updates:check", async (): Promise<UpdateInfo> => {
    const currentVersion = app.getVersion();
    try {
      const response = await net.fetch(RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Contabilizador-Caixa"
        }
      });
      if (!response.ok) {
        throw new Error(`GitHub respondeu ${response.status}.`);
      }
      const release = (await response.json()) as { tag_name?: string; html_url?: string };
      const latestVersion = normalizeVersion(release.tag_name || currentVersion);
      return {
        currentVersion,
        latestVersion,
        hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
        releaseUrl: release.html_url || "https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases",
        checkedAt: new Date().toISOString()
      };
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

  ipcMain.handle("window:setPinned", async (_event, enabled: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) => {
    if (enabled) {
      await createFloatingWindow(options);
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

app.whenReady().then(bootstrap);

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
