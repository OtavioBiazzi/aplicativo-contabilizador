import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LedgerExporter } from "./exporter.js";
import { LocalServer } from "./localServer.js";
import { LedgerStore } from "./storage.js";
import type { EntryDraft, LedgerEntry } from "../src/shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let store: LedgerStore;
let exporter: LedgerExporter;
let localServer: LocalServer;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

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
    await exporter.export(await store.getEntries(), saved);
    return saved;
  });

  ipcMain.handle("settings:chooseOutputDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Escolher pasta dos arquivos",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("export:now", async () => {
    const status = await exporter.export(await store.getEntries(), await store.getSettings());
    if (status.filePath) {
      shell.showItemInFolder(status.filePath);
    }
    return status;
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
