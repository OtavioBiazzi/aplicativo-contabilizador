import http from "node:http";
import { randomUUID } from "node:crypto";
import os from "node:os";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import type { EntryDraft, LedgerEntry, ServerDevice, ServerPermissions, ServerState } from "../src/shared/types.js";
import { summarizeEntries } from "../src/shared/calculations.js";

interface LocalServerOptions {
  permissions: ServerPermissions;
  getEntries: () => Promise<LedgerEntry[]>;
  addEntry: (draft: EntryDraft) => Promise<LedgerEntry>;
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
      response.json({ entries, summary: summarizeEntries(entries) });
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
        observations: request.body.observations || "",
        originDevice: device
      });
      this.broadcast({ type: "entry-added", entry });
      this.options.onRemoteChange();
      response.status(201).json({ entry });
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

function remoteClientHtml(port: number): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contabilizador remoto</title>
  <style>
    :root { color-scheme: dark; font-family: Bahnschrift, "Segoe UI", sans-serif; background: #0f1311; color: #f4f7f1; }
    body { margin: 0; padding: 20px; }
    main { max-width: 760px; margin: 0 auto; display: grid; gap: 16px; }
    section { border: 1px solid #2b332e; border-radius: 8px; padding: 16px; background: #171c19; }
    h1 { margin: 0; font-size: 24px; }
    label { display: grid; gap: 6px; font-size: 13px; color: #b9c4bb; }
    input, select, button { border-radius: 7px; border: 1px solid #38423b; padding: 12px; background: #0f1311; color: #f4f7f1; font: inherit; }
    button { cursor: pointer; background: #17c964; border-color: #17c964; color: #06110a; font-weight: 800; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .list { display: grid; gap: 8px; }
    .item { display: flex; justify-content: space-between; border-bottom: 1px solid #2b332e; padding: 8px 0; }
    .muted { color: #8d9a91; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Contabilizador remoto</h1>
      <p class="muted">Conectado ao servidor local na porta ${port}. Informe a senha definida no app principal.</p>
    </header>
    <section id="login">
      <label>Senha <input id="password" type="password" autofocus /></label>
      <button id="loginButton">Entrar</button>
      <p id="loginMessage" class="muted"></p>
    </section>
    <section id="app" hidden>
      <div class="grid">
        <label>Tipo
          <select id="type">
            <option>Venda</option><option>Mesa</option><option>Onibus</option><option>Dinheiro/Troco</option><option>Extra</option>
          </select>
        </label>
        <label>Valor <input id="value" inputmode="decimal" placeholder="0,00" /></label>
        <label>Pessoas <input id="people" type="number" value="1" min="1" /></label>
        <label>Descricao <input id="description" placeholder="Mesa 4, Cliente..." /></label>
      </div>
      <button id="sendButton">Registrar</button>
    </section>
    <section id="history" hidden>
      <strong>Historico</strong>
      <div id="summary" class="muted"></div>
      <div id="entries" class="list"></div>
    </section>
  </main>
  <script>
    let password = "";
    const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const parseValue = (value) => Number(String(value).replace(/[^\\d,.-]/g, "").replace(",", ".")) || 0;
    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-caixa-password": password, "x-device-name": navigator.userAgent, ...(options.headers || {}) } });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    async function load() {
      const data = await api("/api/entries");
      document.querySelector("#summary").textContent = "Total: " + money.format(data.summary.total) + " | Lancamentos: " + data.summary.count;
      document.querySelector("#entries").innerHTML = data.entries.slice(0, 20).map((entry) => "<div class='item'><span>" + entry.description + "<br><small class='muted'>" + entry.type + "</small></span><b>" + money.format(entry.finalValue) + "</b></div>").join("");
    }
    document.querySelector("#loginButton").onclick = async () => {
      password = document.querySelector("#password").value;
      try {
        await api("/api/entries");
        document.querySelector("#login").hidden = true;
        document.querySelector("#app").hidden = false;
        document.querySelector("#history").hidden = false;
        load();
        const ws = new WebSocket("ws://" + location.host + "/sync?password=" + encodeURIComponent(password) + "&device=" + encodeURIComponent(navigator.platform || "browser"));
        ws.onmessage = load;
      } catch {
        document.querySelector("#loginMessage").textContent = "Senha invalida ou permissao negada.";
      }
    };
    document.querySelector("#sendButton").onclick = async () => {
      await api("/api/entries", { method: "POST", body: JSON.stringify({ type: type.value, value: parseValue(value.value), people: Number(people.value || 1), description: description.value }) });
      value.value = "";
      description.value = "";
      await load();
      value.focus();
    };
  </script>
</body>
</html>`;
}
