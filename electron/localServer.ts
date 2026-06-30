import http from "node:http";
import { randomUUID } from "node:crypto";
import os from "node:os";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { ENTRY_TYPES, PAYMENT_METHODS } from "../src/shared/defaults.js";
import type { EntryDraft, EntryType, LedgerEntry, PaymentMethod, ServerDevice, ServerPermissions, ServerState } from "../src/shared/types.js";
import { calculateCash, filterEntriesByLocalDate, roundMoney, summarizeEntries } from "../src/shared/calculations.js";

interface LocalServerOptions {
  permissions: ServerPermissions;
  getEntries: () => Promise<LedgerEntry[]>;
  addEntry: (draft: EntryDraft) => Promise<LedgerEntry>;
  updateEntry: (id: string, patch: Partial<LedgerEntry>) => Promise<LedgerEntry>;
  cancelEntry: (id: string) => Promise<LedgerEntry>;
  removeEntry: (id: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  onRemoteChange: () => void;
}

interface ClientRecord extends ServerDevice {
  socket: WebSocket;
}

export class LocalServer {
  private server: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private clients = new Map<string, ClientRecord>();
  private port = 0;
  private password = "";
  private permissions: ServerPermissions;

  constructor(private readonly options: LocalServerOptions) {
    this.permissions = options.permissions;
  }

  setPermissions(permissions: ServerPermissions) {
    this.permissions = permissions;
  }

  async start(port: number, password: string): Promise<ServerState> {
    if (!password.trim()) {
      throw new Error("Defina uma senha para abrir o servidor local.");
    }

    if (this.server) {
      await this.stop();
    }

    this.port = port;
    this.password = password;
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get("/", (_request, response) => {
      response.type("html").send(remoteClientHtml(port));
    });

    app.post("/api/login", (request, response) => {
      const ok = request.body?.password === this.password;
      response.status(ok ? 200 : 401).json({ ok });
    });

    app.get("/api/entries", this.authorize("view"), async (_request, response) => {
      const entries = await this.options.getEntries();
      const todayEntries = filterEntriesByLocalDate(entries);
      response.json({
        entries: this.permissions.viewTotals ? entries : entries.map(maskMoneyFields),
        summary: this.permissions.viewTotals ? summarizeEntries(todayEntries) : null,
        permissions: this.permissions
      });
    });

    app.post("/api/entries", this.authorize("create"), async (request, response) => {
      const device = String(request.header("x-device-name") || request.ip || "Dispositivo remoto");
      const entry = await this.options.addEntry({
        type: request.body.type || "Venda",
        value: Number(request.body.value || 0),
        description: request.body.description || "",
        people: Number(request.body.people || 1),
        tableNumber: request.body.tableNumber || "",
        busNumber: request.body.busNumber || "",
        paymentMethod: request.body.paymentMethod || "Nao informado",
        paidWith: Number(request.body.paidWith || 0),
        observations: request.body.observations || "",
        originDevice: device
      });
      this.broadcast({ type: "entry-added", entry });
      this.options.onRemoteChange();
      response.status(201).json({ entry });
    });

    app.patch("/api/entries/:id", this.authorize("edit"), async (request, response) => {
      try {
        const entries = await this.options.getEntries();
        const current = entries.find((entry) => entry.id === request.params.id);
        if (!current) {
          response.status(404).json({ error: "Lancamento nao encontrado." });
          return;
        }
        const entry = await this.options.updateEntry(request.params.id, buildRemotePatch(request.body || {}, current));
        this.broadcast({ type: "entry-updated", entry });
        this.options.onRemoteChange();
        response.json({ entry: this.permissions.viewTotals ? entry : maskMoneyFields(entry) });
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : "Nao foi possivel editar." });
      }
    });

    app.post("/api/entries/:id/cancel", this.authorize("edit"), async (request, response) => {
      try {
        const entry = await this.options.cancelEntry(request.params.id);
        this.broadcast({ type: "entry-cancelled", entry });
        this.options.onRemoteChange();
        response.json({ entry: this.permissions.viewTotals ? entry : maskMoneyFields(entry) });
      } catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : "Lancamento nao encontrado." });
      }
    });

    app.delete("/api/entries/:id", this.authorize("delete"), async (request, response) => {
      try {
        const permanent = request.query.permanent === "1" || request.query.mode === "permanent";
        if (permanent) {
          await this.options.deleteEntry(request.params.id);
          this.broadcast({ type: "entry-deleted", id: request.params.id });
        } else {
          await this.options.removeEntry(request.params.id);
          this.broadcast({ type: "entry-removed", id: request.params.id });
        }
        this.options.onRemoteChange();
        response.json({ ok: true });
      } catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : "Lancamento nao encontrado." });
      }
    });

    this.server = http.createServer(app);
    this.wsServer = new WebSocketServer({ server: this.server, path: "/sync" });
    this.wsServer.on("connection", (socket, request) => this.handleSocket(socket, request));

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "0.0.0.0", () => resolve());
    });

    return this.getState();
  }

  async stop(): Promise<ServerState> {
    for (const client of this.clients.values()) {
      client.socket.close();
    }
    this.clients.clear();

    await new Promise<void>((resolve) => {
      this.wsServer?.close(() => resolve());
      if (!this.wsServer) {
        resolve();
      }
    });
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      if (!this.server) {
        resolve();
      }
    });

    this.wsServer = null;
    this.server = null;
    return this.getState();
  }

  disconnectDevice(id: string): ServerState {
    const client = this.clients.get(id);
    client?.socket.close();
    this.clients.delete(id);
    return this.getState();
  }

  broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(message);
      }
    }
  }

  getState(): ServerState {
    const ips = getLocalIps();
    return {
      running: Boolean(this.server),
      port: this.port,
      url: this.server && ips[0] ? `http://${ips[0]}:${this.port}` : "",
      ips,
      devices: [...this.clients.values()].map(({ socket: _socket, ...device }) => device)
    };
  }

  private authorize(permission: keyof ServerPermissions) {
    return (request: Request, response: Response, next: NextFunction) => {
      const password = request.header("x-caixa-password") || request.query.password;
      if (password !== this.password) {
        response.status(401).json({ error: "Senha invalida." });
        return;
      }
      if (!this.permissions[permission]) {
        response.status(403).json({ error: "Permissao negada." });
        return;
      }
      next();
    };
  }

  private handleSocket(socket: WebSocket, request: http.IncomingMessage) {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const password = url.searchParams.get("password") || "";
    if (password !== this.password || !this.permissions.view) {
      socket.close(1008, "Senha invalida");
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const device: ClientRecord = {
      id,
      name: url.searchParams.get("device") || "Dispositivo remoto",
      ip: request.socket.remoteAddress || "",
      connectedAt: now,
      lastSeen: now,
      permissions: this.permissions,
      socket
    };
    this.clients.set(id, device);
    socket.on("message", () => {
      device.lastSeen = new Date().toISOString();
    });
    socket.on("close", () => {
      this.clients.delete(id);
    });
    socket.send(JSON.stringify({ type: "connected", id, state: this.getState() }));
  }
}

function getLocalIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const values of Object.values(interfaces)) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) {
        ips.push(item.address);
      }
    }
  }
  return ips;
}

function maskMoneyFields(entry: LedgerEntry): LedgerEntry {
  return {
    ...entry,
    originalValue: 0,
    finalValue: 0,
    perPerson: 0,
    difference: 0,
    paidWith: 0,
    change: 0,
    splitDetails: entry.splitDetails
      ? {
          ...entry.splitDetails,
          originalValue: 0,
          perPersonRaw: 0,
          perPersonRounded: 0,
          finalTotal: 0,
          difference: 0
        }
      : undefined,
    cashDetails: entry.cashDetails
      ? {
          ...entry.cashDetails,
          accountValue: 0,
          paidWith: 0,
          change: 0,
          breakdown: [],
          unrepresentedCents: 0
        }
      : undefined
  };
}

function buildRemotePatch(body: Record<string, unknown>, current: LedgerEntry): Partial<LedgerEntry> {
  const patch: Partial<LedgerEntry> = {};
  const nextType = toEntryType(body.type);
  const nextPeople = body.people !== undefined ? Math.max(1, Math.floor(Number(body.people) || 1)) : current.people;
  const rawValue = body.value ?? body.finalValue;
  const nextValue =
    rawValue !== undefined && Number.isFinite(Number(rawValue))
      ? roundMoney(Math.max(0, Number(rawValue)))
      : current.finalValue;

  if (nextType) {
    patch.type = nextType;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim() || "Venda";
  }
  if (rawValue !== undefined) {
    patch.originalValue = nextValue;
    patch.finalValue = nextValue;
  }
  if (body.people !== undefined) {
    patch.people = nextPeople;
  }
  if (rawValue !== undefined || body.people !== undefined) {
    patch.perPerson = roundMoney(nextValue / nextPeople);
  }
  if (typeof body.tableNumber === "string") {
    patch.tableNumber = body.tableNumber.trim();
  }
  if (typeof body.busNumber === "string") {
    patch.busNumber = body.busNumber.trim();
  }
  if (typeof body.observations === "string") {
    patch.observations = body.observations.trim();
  }
  if (isPaymentMethod(body.paymentMethod)) {
    patch.paymentMethod = body.paymentMethod;
  }
  if (body.paidWith !== undefined && Number.isFinite(Number(body.paidWith))) {
    const cash = calculateCash(nextValue, Number(body.paidWith));
    patch.paidWith = cash.paidWith;
    patch.change = cash.change;
    patch.cashDetails = cash;
    patch.paymentMethod = "Dinheiro";
  }

  if (!Object.keys(patch).length) {
    throw new Error("Nada para editar.");
  }
  return patch;
}

function toEntryType(value: unknown): EntryType | undefined {
  return typeof value === "string" && ENTRY_TYPES.includes(value as EntryType) ? (value as EntryType) : undefined;
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.includes(value as PaymentMethod);
}

function remoteClientHtml(port: number): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Caixa remoto</title>
  <style>
    :root { color-scheme: light; font-family: Bahnschrift, "Segoe UI Variable Text", "Segoe UI", sans-serif; background: #e8f3fb; color: #092844; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; background: radial-gradient(circle at top left, rgba(5, 101, 183, 0.18), transparent 32%), linear-gradient(180deg, #f7fcff, #e8f3fb); }
    main { max-width: 1060px; margin: 0 auto; display: grid; gap: 12px; }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: stretch; }
    section, .hero-card { border: 1px solid #9ac9e8; border-radius: 8px; padding: 14px; background: rgba(255, 255, 255, 0.94); box-shadow: 0 18px 45px rgba(2, 50, 91, 0.14); }
    h1 { margin: 0; font-size: clamp(23px, 4.8vw, 34px); letter-spacing: -0.03em; color: #024b8d; }
    h2, h3, p { margin: 0; }
    p { margin-top: 6px; color: #52728a; }
    label { display: grid; gap: 6px; font-size: 11px; font-weight: 900; color: #52728a; text-transform: uppercase; letter-spacing: 0.06em; }
    input, select, button { border-radius: 7px; border: 1px solid #9ac9e8; padding: 11px 12px; background: #ffffff; color: #092844; font: inherit; }
    input:focus, select:focus { outline: none; border-color: #0565b7; box-shadow: 0 0 0 3px rgba(5, 101, 183, 0.16); }
    button { cursor: pointer; background: #0565b7; border-color: #0565b7; color: #ffffff; font-weight: 950; }
    button.secondary { background: #dff0fb; border-color: #9ac9e8; color: #024b8d; }
    button.danger { background: #d90000; border-color: #d90000; color: #ffffff; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .hero-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; background: linear-gradient(135deg, #0565b7, #024b8d); color: #ffffff; }
    .hero-card p, .hero-card span { color: rgba(255,255,255,0.78); }
    .mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 8px; background: #ffffff; color: #0565b7; font-weight: 950; }
    .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 10px; align-items: end; }
    .grid label { grid-column: span 3; }
    .grid .wide { grid-column: span 6; }
    .grid .small { grid-column: span 2; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .actions button { min-height: 34px; padding: 0 10px; font-size: 12px; }
    .dashboard { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .stat { border: 1px solid #c9e2f2; border-radius: 8px; padding: 11px; background: #f7fcff; }
    .stat span { display: block; color: #52728a; font-size: 11px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 4px; color: #024b8d; font-size: 20px; }
    .list { display: grid; gap: 8px; }
    .item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; border: 1px solid #c9e2f2; border-radius: 8px; padding: 10px; background: #ffffff; }
    .item-main { min-width: 0; }
    .item-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 900; }
    .item-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 4px; font-size: 12px; color: #52728a; }
    .item-value { color: #0565b7; font-weight: 950; white-space: nowrap; }
    .item-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 7px; }
    .item-actions button { min-height: 31px; padding: 0 9px; font-size: 12px; }
    .muted { color: #52728a; }
    .status { min-height: 18px; color: #52728a; }
    .status.error { color: #d90000; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #9ac9e8; border-radius: 999px; padding: 6px 10px; color: #024b8d; background: #f7fcff; font-size: 12px; font-weight: 900; }
    .permission-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .permission-list span { border-radius: 999px; padding: 5px 8px; background: #dff0fb; color: #024b8d; font-size: 12px; font-weight: 850; }
    .permission-title { display: block; margin-top: 10px; color: #024b8d; }
    .section-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 10px; }
    @media (max-width: 620px) {
      body { padding: 10px; }
      header, .dashboard { grid-template-columns: 1fr; }
      .grid label, .grid .wide, .grid .small { grid-column: 1 / -1; }
      .item { grid-template-columns: 1fr; }
      .item-value { justify-self: start; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="hero-card">
        <div class="mark">C</div>
        <div>
          <h1>Caixa remoto</h1>
          <p>Conectado ao computador principal na porta ${port}. Registros entram no mesmo historico e na mesma planilha.</p>
        </div>
      </div>
      <span class="pill" id="permissionBadge">Aguardando senha</span>
    </header>
    <section id="login">
      <div class="grid">
        <label class="wide">Senha <input id="password" type="password" autofocus /></label>
        <label class="wide">Nome deste caixa <input id="deviceName" placeholder="Caixa secundario, Notebook..." /></label>
      </div>
      <div class="actions">
        <button id="loginButton">Entrar</button>
      </div>
      <p id="loginMessage" class="muted"></p>
    </section>
    <section id="app" hidden>
      <div class="grid">
        <label>Tipo
          <select id="type">
            <option>Venda</option><option>Mesa</option><option>Onibus</option><option>Dinheiro/Troco</option><option>Extra</option><option>Taxa</option><option>Personalizado</option>
          </select>
        </label>
        <label>Valor <input id="value" inputmode="decimal" placeholder="0,00" /></label>
        <label>Pago com <input id="paidWith" inputmode="decimal" placeholder="Opcional" /></label>
        <label class="small">Pessoas <input id="people" type="number" value="1" min="1" /></label>
        <label class="small">Mesa <input id="tableNumber" placeholder="8" /></label>
        <label class="small">Onibus <input id="busNumber" placeholder="2" /></label>
        <label class="wide">Descricao <input id="description" placeholder="Mesa 4, Cliente..." /></label>
      </div>
      <div class="actions">
        <button id="sendButton">Registrar</button>
        <button class="secondary" id="reloadButton" type="button">Atualizar</button>
      </div>
      <p id="appMessage" class="status"></p>
    </section>
    <section id="history" hidden>
      <div class="section-title">
        <strong>Historico remoto</strong>
        <span class="pill" id="connectionState">Online</span>
      </div>
      <div class="dashboard" id="summaryCards"></div>
      <div id="summary" class="muted"></div>
      <strong class="permission-title">Permissoes deste dispositivo</strong>
      <div class="permission-list" id="permissionList"></div>
      <div id="entries" class="list"></div>
    </section>
  </main>
  <script>
    let password = "";
    let permissions = {};
    let entriesCache = [];
    let socket = null;
    const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const qs = (selector) => document.querySelector(selector);
    const parseValue = (value) => Number(String(value).replace(/[^\\d,.-]/g, "").replace(",", ".")) || 0;
    const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const visibleMoney = (value) => permissions.viewTotals ? money.format(Number(value || 0)) : "Restrito";
    const params = new URLSearchParams(location.search);
    qs("#password").value = params.get("password") || "";
    qs("#deviceName").value = params.get("device") || localStorage.getItem("caixaRemoteDevice") || "";
    const setStatus = (message, error) => {
      qs("#appMessage").textContent = message || "";
      qs("#appMessage").className = error ? "status error" : "status";
    };
    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-caixa-password": password, "x-device-name": deviceName(), ...(options.headers || {}) } });
      const text = await response.text();
      if (!response.ok) throw new Error(text || response.statusText);
      return text ? JSON.parse(text) : {};
    }
    function deviceName() {
      return qs("#deviceName").value.trim() || navigator.platform || "Caixa remoto";
    }
    function permissionChips() {
      const rows = [
        permissions.view ? "Visualizar" : "",
        permissions.create ? "Registrar" : "",
        permissions.edit ? "Editar" : "",
        permissions.delete ? "Apagar" : "",
        permissions.viewTotals ? "Ver totais" : "Totais ocultos"
      ].filter(Boolean);
      qs("#permissionList").innerHTML = rows.map((item) => "<span>" + item + "</span>").join("");
    }
    function summaryCards(summary) {
      const cards = summary
        ? [
            ["Total hoje", money.format(summary.total)],
            ["Lancamentos", String(summary.count)],
            ["Dinheiro", money.format(summary.cashTotal || 0)]
          ]
        : [
            ["Total hoje", "Restrito"],
            ["Lancamentos", String(entriesCache.length)],
            ["Permissao", "Totais ocultos"]
          ];
      qs("#summaryCards").innerHTML = cards.map((card) => "<article class='stat'><span>" + card[0] + "</span><strong>" + card[1] + "</strong></article>").join("");
    }
    function renderEntry(entry) {
      const actions = [];
      if (permissions.edit && entry.status !== "deleted") {
        actions.push("<button class='secondary' onclick='editEntry(\\\"" + entry.id + "\\\")'>Editar</button>");
        actions.push("<button class='secondary' onclick='cancelEntry(\\\"" + entry.id + "\\\")'>Cancelar</button>");
      }
      if (permissions.delete) {
        if (entry.status === "deleted") {
          actions.push("<button class='danger' onclick='deleteForever(\\\"" + entry.id + "\\\")'>Apagar definitivo</button>");
        } else {
          actions.push("<button class='danger' onclick='moveToTrash(\\\"" + entry.id + "\\\")'>Lixeira</button>");
        }
      }
      return "<div class='item'>" +
        "<div class='item-main'><span class='item-title'>" + escapeText(entry.description || "Venda") + "</span>" +
        "<span class='item-meta'><span>" + escapeText(entry.type) + "</span><span>" + escapeText(entry.status) + "</span><span>" + escapeText(entry.originDevice || "Origem local") + "</span><span>" + new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + "</span></span></div>" +
        "<b class='item-value'>" + visibleMoney(entry.finalValue) + "</b>" +
        (actions.length ? "<div class='item-actions'>" + actions.join("") + "</div>" : "") +
        "</div>";
    }
    async function load() {
      const data = await api("/api/entries");
      permissions = data.permissions || {};
      entriesCache = data.entries || [];
      qs("#permissionBadge").textContent =
        (permissions.create ? "Registra" : "So visualiza") +
        (permissions.edit ? " + edita" : "") +
        (permissions.delete ? " + apaga" : "") +
        (permissions.viewTotals ? "" : " | sem totais");
      qs("#app").hidden = !permissions.create;
      qs("#summary").textContent = data.summary
        ? "Hoje: " + money.format(data.summary.total) + " | Lancamentos: " + data.summary.count
        : "Totais ocultos pelas permissoes do servidor.";
      permissionChips();
      summaryCards(data.summary);
      qs("#entries").innerHTML = entriesCache.slice(0, 24).map(renderEntry).join("") || "<p class='muted'>Nenhum lancamento ainda.</p>";
    }
    qs("#loginButton").onclick = async () => {
      password = qs("#password").value;
      localStorage.setItem("caixaRemoteDevice", deviceName());
      try {
        await load();
        qs("#login").hidden = true;
        qs("#history").hidden = false;
        load();
        if (socket) socket.close();
        socket = new WebSocket("ws://" + location.host + "/sync?password=" + encodeURIComponent(password) + "&device=" + encodeURIComponent(deviceName()));
        socket.onopen = () => qs("#connectionState").textContent = "Tempo real ativo";
        socket.onclose = () => qs("#connectionState").textContent = "Reconecte se precisar";
        socket.onmessage = load;
      } catch {
        qs("#loginMessage").textContent = "Senha invalida ou permissao negada.";
      }
    };
    qs("#reloadButton").onclick = load;
    qs("#sendButton").onclick = async () => {
      try {
        await api("/api/entries", {
          method: "POST",
          body: JSON.stringify({
            type: qs("#type").value,
            value: parseValue(qs("#value").value),
            paidWith: parseValue(qs("#paidWith").value),
            people: Number(qs("#people").value || 1),
            description: qs("#description").value,
            tableNumber: qs("#tableNumber").value,
            busNumber: qs("#busNumber").value
          })
        });
        qs("#value").value = "";
        qs("#paidWith").value = "";
        qs("#description").value = "";
        qs("#tableNumber").value = "";
        qs("#busNumber").value = "";
        setStatus("Lancamento registrado.");
        await load();
        qs("#value").focus();
      } catch (error) {
        setStatus("Nao foi possivel registrar.", true);
      }
    };
    window.editEntry = async (id) => {
      const entry = entriesCache.find((item) => item.id === id);
      if (!entry) return;
      const description = prompt("Nova descricao", entry.description || "");
      if (description === null) return;
      const payload = { description };
      if (permissions.viewTotals) {
        const value = prompt("Novo valor", String(entry.finalValue || 0).replace(".", ","));
        if (value !== null) payload.value = parseValue(value);
      }
      await api("/api/entries/" + id, { method: "PATCH", body: JSON.stringify(payload) });
      setStatus("Lancamento editado.");
      await load();
    };
    window.cancelEntry = async (id) => {
      await api("/api/entries/" + id + "/cancel", { method: "POST" });
      setStatus("Lancamento cancelado.");
      await load();
    };
    window.moveToTrash = async (id) => {
      if (!confirm("Enviar este lancamento para a lixeira?")) return;
      await api("/api/entries/" + id, { method: "DELETE" });
      setStatus("Lancamento enviado para a lixeira.");
      await load();
    };
    window.deleteForever = async (id) => {
      if (!confirm("Apagar definitivamente este lancamento?")) return;
      await api("/api/entries/" + id + "?permanent=1", { method: "DELETE" });
      setStatus("Lancamento apagado definitivamente.");
      await load();
    };
    if (qs("#password").value) {
      qs("#loginButton").click();
    }
  </script>
</body>
</html>`;
}
