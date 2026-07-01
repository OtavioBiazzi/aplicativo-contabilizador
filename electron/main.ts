import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DiagnosticLogger } from "./diagnostics.js";
import { LedgerExporter } from "./exporter.js";
import { readLedgerImport } from "./importer.js";
import { LocalServer } from "./localServer.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let store: LedgerStore;
let exporter: LedgerExporter;
let localServer: LocalServer;
let logger: DiagnosticLogger;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const RELEASE_API_URL = "https://api.github.com/repos/OtavioBiazzi/aplicativo-contabilizador/releases/latest";
const FLOATING_MIN_WIDTH = 520;
const FLOATING_MAX_WIDTH = 1240;
const FLOATING_MIN_HEIGHT = 112;

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

async function createFloatingWindow(options?: { opacity?: number; lockPosition?: boolean }, settings?: AppSettings) {
  const size = settings ? floatingWindowSize(settings) : { width: FLOATING_MAX_WIDTH, minWidth: FLOATING_MIN_WIDTH, height: 132, minHeight: FLOATING_MIN_HEIGHT };
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

function floatingWindowSize(settings: AppSettings) {
  const fields = new Set(settings.floating.visibleFields?.length ? settings.floating.visibleFields : ["mode", "type", "value", "people", "description", "submit"]);
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
    height: fields.has("tabs") ? 132 : 112,
    minHeight: FLOATING_MIN_HEIGHT
  };
}

function applyFloatingWindowOptions(options?: { opacity?: number; lockPosition?: boolean }, settings?: AppSettings) {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }
  const size = settings ? floatingWindowSize(settings) : { width: FLOATING_MAX_WIDTH, minWidth: FLOATING_MIN_WIDTH, height: 132, minHeight: FLOATING_MIN_HEIGHT };
  floatingWindow.setMinimumSize(size.minWidth, size.minHeight);
  const [width, height] = floatingWindow.getSize();
  const shouldResizeWidth = settings && Math.abs(width - size.width) > 80;
  if (shouldResizeWidth || width < size.minWidth || height < size.minHeight) {
    floatingWindow.setSize(Math.max(size.width, size.minWidth), Math.max(size.height, size.minHeight));
  }
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

async function bootstrap() {
  Menu.setApplicationMenu(null);
  registerAppProtocol();
  const dataDirectory = process.env.CAIXA_DATA_DIR || path.join(app.getPath("userData"), "data");
  const defaultOutputDirectory =
    process.env.CAIXA_OUTPUT_DIR || path.join(app.getPath("documents"), "Contabilizador Caixa");
  store = new LedgerStore({ dataDirectory, defaultOutputDirectory });
  exporter = new LedgerExporter(dataDirectory);
  logger = new DiagnosticLogger(dataDirectory);
  await store.initialize();
  await logger.info("Aplicativo iniciado", `Versao ${app.getVersion()}`);

  localServer = new LocalServer({
    permissions: (await store.getSettings()).server.permissions,
    getSettings: () => store.getSettings(),
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

async function logExportStatus(action: string, status: ExportStatus) {
  if (!status.ok) {
    await logger.warn(`Exportacao pendente em ${action}`, status.message || "Sem detalhe informado.");
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
    await logExportStatus("novo lancamento", exportStatus);
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:update", async (_event, id: string, patch: Partial<LedgerEntry>) => {
    const entry = await store.updateEntry(id, patch);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    await logExportStatus("edicao de lancamento", exportStatus);
    localServer.broadcast({ type: "entry-updated", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:remove", async (_event, id: string) => {
    await store.removeEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    await logExportStatus("lixeira", exportStatus);
    localServer.broadcast({ type: "entry-removed", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:delete", async (_event, id: string) => {
    await store.deleteEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    await logExportStatus("exclusao definitiva", exportStatus);
    localServer.broadcast({ type: "entry-deleted", id });
    sendToAll("entries:changed");
    return { exportStatus };
  });

  ipcMain.handle("entries:duplicate", async (_event, id: string) => {
    const entry = await store.duplicateEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
    await logExportStatus("duplicacao", exportStatus);
    localServer.broadcast({ type: "entry-added", entry });
    sendToAll("entries:changed");
    return { entry, exportStatus };
  });

  ipcMain.handle("entries:cancel", async (_event, id: string) => {
    const entry = await store.cancelEntry(id);
    const exportStatus = await exporter.export(await store.getEntries(), await store.getSettings());
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
    const exportStatus = await exporter.export(await store.getEntries(), saved);
    await logExportStatus("salvar configuracoes", exportStatus);
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
    await logExportStatus("exportacao manual", status);
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
  });

  ipcMain.handle("reports:exportFiltered", async (_event, ids: string[], label: string) => {
    const idSet = new Set(ids);
    const entries = (await store.getEntries()).filter((entry) => idSet.has(entry.id));
    const status = await exporter.exportReport(entries, await store.getSettings(), label);
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
    const exportStatus = await exporter.export(await store.getEntries(), settings);
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

    const exportStatus = await exporter.export(await store.getEntries(), settings);
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
      entryCount: (await store.getEntries()).length,
      backupCount: backups.length,
      backups,
      logs: await logger.list()
    };
  });

  ipcMain.handle("diagnostics:createBackup", async (_event, reason?: string): Promise<DataBackupInfo> => {
    const backup = await store.createDataBackup(reason || "manual");
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

    const restored = await store.restoreDataBackup(filePath);
    const settings = await store.getSettings();
    localServer.setPermissions(settings.server.permissions);
    const exportStatus = await exporter.export(await store.getEntries(), settings);
    await logExportStatus("restauracao de backup", exportStatus);
    await logger.warn("Backup restaurado", `${restored.backup.fileName}; backup de seguranca: ${restored.safetyBackup.fileName}`);
    sendToAll("settings:changed", settings);
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
