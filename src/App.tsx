import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  History,
  Laptop,
  LayoutPanelTop,
  MinusCircle,
  MonitorUp,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Settings,
  Trash2,
  Undo2,
  Wallet,
  X
} from "lucide-react";
import { ENTRY_TYPES, PAYMENT_METHODS, DEFAULT_COLUMNS, DEFAULT_FLOATING_FIELDS, SIMPLE_COLUMNS } from "./shared/defaults";
import {
  calculateCash,
  calculateSplit,
  formatCurrency,
  formatDateTime,
  parseMoney,
  ROUNDING_STEPS,
  summarizeEntries
} from "./shared/calculations";
import type {
  AppSettings,
  DaySummary,
  EntryDraft,
  EntryType,
  ExportStatus,
  LedgerEntry,
  PaymentMethod,
  RoundDirection,
  ServerState
} from "./shared/types";

type TabKey = "register" | "history" | "reports" | "server" | "settings";

interface ToastState {
  tone: "success" | "error" | "info";
  message: string;
}

interface ModeCommand {
  type: EntryType;
  nonce: number;
}

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: typeof Send }> = [
  { key: "register", label: "Registro", icon: Send },
  { key: "history", label: "Historico", icon: History },
  { key: "reports", label: "Relatorios", icon: BarChart3 },
  { key: "server", label: "Servidor", icon: Server },
  { key: "settings", label: "Ajustes", icon: Settings }
];

export function App() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("register");
  const [pinned, setPinnedState] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modeCommand, setModeCommand] = useState<ModeCommand | null>(null);

  const summary = useMemo(() => summarizeEntries(entries), [entries]);

  const reload = async () => {
    const snapshot = await window.caixa.getSnapshot();
    setEntries(snapshot.entries);
    setSettings(snapshot.settings);
    setServer(snapshot.server);
    setExportStatus(snapshot.exportStatus);
    setPinnedState(await window.caixa.getPinned());
  };

  useEffect(() => {
    reload();
    const offEntries = window.caixa.onEntriesChanged(reload);
    const offServer = window.caixa.onServerChanged((state) => setServer(state));
    return () => {
      offEntries();
      offServer();
    };
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.dataset.fieldSize = settings.fieldSize;
    document.documentElement.style.setProperty("--accent", settings.accentColor);
    document.body.classList.toggle("is-pinned", pinned);
  }, [settings, pinned]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === "f") {
        event.preventDefault();
        await togglePinned();
      }
      if (ctrl && event.key.toLowerCase() === "d") {
        event.preventDefault();
        commandMode("Dinheiro/Troco");
      }
      if (ctrl && event.key.toLowerCase() === "m") {
        event.preventDefault();
        commandMode("Mesa");
      }
      if (ctrl && event.key.toLowerCase() === "o") {
        event.preventDefault();
        commandMode("Onibus");
      }
      if (ctrl && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setActiveTab("history");
      }
      if (ctrl && event.key === ",") {
        event.preventDefault();
        setActiveTab("settings");
      }
      if (ctrl && event.key.toLowerCase() === "r") {
        event.preventDefault();
        await repeatLastEntry();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, settings, pinned]);

  const showToast = (tone: ToastState["tone"], message: string) => {
    setToast({ tone, message });
  };

  const commandMode = (type: EntryType) => {
    setActiveTab("register");
    setModeCommand({ type, nonce: Date.now() });
  };

  const saveSettings = async (next: AppSettings) => {
    const saved = await window.caixa.saveSettings(next);
    setSettings(saved);
    showToast("success", "Configuracoes salvas.");
  };

  const addEntry = async (draft: EntryDraft) => {
    const result = await window.caixa.addEntry(draft);
    await reload();
    setExportStatus(result.exportStatus);
    showToast(result.exportStatus.ok ? "success" : "error", result.exportStatus.ok ? "Lancamento registrado." : result.exportStatus.message || "Lancamento salvo localmente.");
  };

  const repeatLastEntry = async () => {
    const last = entries.find((entry) => entry.status === "active");
    if (!last) {
      showToast("info", "Nenhum lancamento para repetir.");
      return;
    }
    const result = await window.caixa.duplicateEntry(last.id);
    await reload();
    setExportStatus(result.exportStatus);
    showToast("success", "Ultimo lancamento repetido.");
  };

  const togglePinned = async () => {
    if (!settings) {
      return;
    }
    const next = !pinned;
    const result = await window.caixa.setPinned(next, {
      opacity: settings.floating.opacity,
      borderless: settings.floating.borderless,
      lockPosition: settings.floating.lockPosition
    });
    setPinnedState(result);
  };

  if (!settings || !server) {
    return (
      <div className="boot-screen">
        <div className="pulse-mark" />
        <strong>Carregando Contabilizador Caixa...</strong>
      </div>
    );
  }

  if (pinned) {
    return (
      <div className="pinned-app">
        <QuickEntry
          entries={entries}
          settings={settings}
          pinned
          modeCommand={modeCommand}
          onSubmit={addEntry}
          onUnpin={togglePinned}
        />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">C</div>
          <div>
            <strong>Contabilizador</strong>
            <span>Caixa diario</span>
          </div>
        </div>

        <nav className="tabs">
          {TAB_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeTab === item.key ? "active" : ""}
                onClick={() => setActiveTab(item.key)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <span>Total de hoje</span>
          <strong>{formatCurrency(summary.total)}</strong>
          <small>{summary.count} lancamentos</small>
        </div>

        <button className="pin-button" onClick={togglePinned}>
          <Pin size={18} />
          Fixar na tela
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Operacao diaria</span>
            <h1>{titleForTab(activeTab)}</h1>
          </div>
          <div className="status-strip">
            <StatusPill label="Excel/CSV" ok={exportStatus?.ok ?? true} text={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente` : "sincronizado"} />
            <StatusPill label="Servidor" ok={server.running} text={server.running ? `:${server.port}` : "off"} />
          </div>
        </header>

        {activeTab === "register" && (
          <div className="register-layout">
            <QuickEntry
              entries={entries}
              settings={settings}
              pinned={false}
              modeCommand={modeCommand}
              onSubmit={addEntry}
              onUnpin={togglePinned}
            />
            <TodayPanel summary={summary} entries={entries} onMode={commandMode} />
          </div>
        )}

        {activeTab === "history" && (
          <HistoryPanel
            entries={entries}
            onChange={async () => {
              await reload();
            }}
            onToast={showToast}
          />
        )}

        {activeTab === "reports" && (
          <ReportsPanel entries={entries} summary={summary} exportStatus={exportStatus} onExport={async () => {
            const status = await window.caixa.exportNow();
            setExportStatus(status);
            showToast(status.ok ? "success" : "error", status.message || "Exportacao executada.");
          }} />
        )}

        {activeTab === "server" && (
          <ServerPanel
            settings={settings}
            server={server}
            onSaveSettings={saveSettings}
            onServerChange={setServer}
            onToast={showToast}
          />
        )}

        {activeTab === "settings" && (
          <SettingsPanel settings={settings} onSave={saveSettings} onToast={showToast} />
        )}
      </main>

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function QuickEntry({
  entries,
  settings,
  pinned,
  modeCommand,
  onSubmit,
  onUnpin
}: {
  entries: LedgerEntry[];
  settings: AppSettings;
  pinned: boolean;
  modeCommand: ModeCommand | null;
  onSubmit: (draft: EntryDraft) => Promise<void>;
  onUnpin?: () => Promise<void> | void;
}) {
  const [type, setType] = useState<EntryType>(settings.defaultType);
  const [valueText, setValueText] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState(settings.defaultPeople);
  const [tableNumber, setTableNumber] = useState("");
  const [busNumber, setBusNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Nao informado");
  const [paidWithText, setPaidWithText] = useState("");
  const [observations, setObservations] = useState("");
  const [roundingStep, setRoundingStep] = useState(settings.defaultRoundingStep);
  const [roundingDirection, setRoundingDirection] = useState<RoundDirection>(settings.defaultRoundingDirection);
  const [registerDifference, setRegisterDifference] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const value = parseMoney(valueText);
  const paidWith = parseMoney(paidWithText);
  const split = calculateSplit(value, people, roundingStep, roundingDirection, registerDifference);
  const cash = calculateCash(value, paidWith);
  const lastActive = entries.find((entry) => entry.status === "active");

  useEffect(() => {
    if (modeCommand) {
      setType(modeCommand.type);
    }
  }, [modeCommand?.nonce]);

  useEffect(() => {
    if (type === "Mesa" && tableNumber && !description) {
      setDescription(`Mesa ${tableNumber}`);
    }
    if (type === "Onibus" && busNumber && !description) {
      setDescription(`Onibus ${busNumber}`);
    }
  }, [type, tableNumber, busNumber]);

  const visible = (field: string) => !pinned || settings.floating.visibleFields.includes(field);

  const clearForm = () => {
    setValueText("");
    setDescription("");
    setPeople(settings.defaultPeople);
    setTableNumber("");
    setBusNumber("");
    setPaidWithText("");
    setObservations("");
  };

  const submit = async () => {
    if (value <= 0 && type !== "Cancelado/Estorno") {
      return;
    }
    setSubmitting(true);
    const effectiveType: EntryType =
      pinned && type !== "Dinheiro/Troco" && people > 1 ? "Divisao de conta" : type;
    const effectiveSplit = effectiveType === "Divisao de conta" ? split : undefined;
    const effectiveCash = effectiveType === "Dinheiro/Troco" ? cash : undefined;
    const draft: EntryDraft = {
      type: effectiveType,
      value,
      description,
      people: effectiveSplit?.people ?? people,
      tableNumber,
      busNumber,
      paymentMethod: effectiveType === "Dinheiro/Troco" ? "Dinheiro" : paymentMethod,
      paidWith,
      observations,
      splitDetails: effectiveSplit,
      cashDetails: effectiveCash
    };
    try {
      await onSubmit(draft);
      clearForm();
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    await submit();
  };

  if (pinned) {
    const isMoney = type === "Dinheiro/Troco";
    const nextModeLabel = isMoney ? "Conta" : "Dinheiro";
    const moneyDisabled = isMoney && (value <= 0 || paidWith <= 0);
    const disabled = submitting || value <= 0 || moneyDisabled;

    return (
      <form className={`floating-bar ${isMoney ? "money" : "account"}`} onSubmit={onSubmitForm}>
        <div className="floating-grip" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <button
          className="floating-mode"
          type="button"
          onClick={() => setType(isMoney ? "Venda" : "Dinheiro/Troco")}
        >
          <span>← →</span>
          {nextModeLabel}
        </button>

        <label className="floating-field amount-field">
          <span>VALOR DA CONTA</span>
          <div className="money-input">
            <b>R$</b>
            <input
              autoFocus
              inputMode="decimal"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              placeholder="0,00"
            />
          </div>
        </label>

        {isMoney ? (
          <label className="floating-field paid-field">
            <span>PAGO COM</span>
            <div className="money-input warm">
              <b>R$</b>
              <input
                inputMode="decimal"
                value={paidWithText}
                onChange={(event) => setPaidWithText(event.target.value)}
                placeholder="0,00"
              />
            </div>
          </label>
        ) : (
          <div className="floating-field people-field">
            <span>PESSOAS</span>
            <div className="people-stepper">
              <button type="button" onClick={() => setPeople(Math.max(1, people - 1))}>
                -
              </button>
              <input
                type="number"
                min={1}
                value={people}
                onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))}
              />
              <button type="button" onClick={() => setPeople(people + 1)}>
                +
              </button>
            </div>
          </div>
        )}

        <label className="floating-field floating-description">
          <span>DESCRICAO</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Descricao opcional"
          />
        </label>

        {isMoney ? (
          <div className="floating-result">
            <span>TROCO</span>
            <strong>{formatCurrency(cash.change)}</strong>
          </div>
        ) : (
          people > 1 && (
            <div className="floating-result">
              <span>POR PESSOA</span>
              <strong>{formatCurrency(split.perPersonRounded)}</strong>
            </div>
          )
        )}

        <button className="floating-send" type="submit" disabled={disabled}>
          {submitting ? <RefreshCw size={17} className="spin" /> : <Send size={18} />}
          Enviar
        </button>

        <button className="floating-close" type="button" onClick={onUnpin} title="Voltar ao app completo">
          <Undo2 size={16} />
        </button>
      </form>
    );
  }

  return (
    <form className={`quick-entry ${pinned ? "pinned" : ""}`} onSubmit={onSubmitForm}>
      <div className="quick-head">
        <div>
          <span className="eyebrow">Registro rapido</span>
          <h2>Lancar valor</h2>
        </div>
        {!pinned && (
          <div className="mode-chips">
            {(["Venda", "Mesa", "Onibus", "Dinheiro/Troco", "Divisao de conta"] as EntryType[]).map((item) => (
              <button type="button" key={item} className={type === item ? "selected" : ""} onClick={() => setType(item)}>
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="entry-grid">
        {visible("type") && (
          <label className="field">
            <span>Tipo</span>
            <select value={type} onChange={(event) => setType(event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}

        {visible("value") && (
          <label className="field value-field">
            <span>Valor</span>
            <input
              autoFocus
              inputMode="decimal"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              placeholder="0,00"
            />
          </label>
        )}

        {visible("people") && (
          <label className="field small-field">
            <span>Pessoas</span>
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Math.max(1, Number(event.target.value || 1)))}
            />
          </label>
        )}

        {visible("description") && (
          <label className="field description-field">
            <span>Descricao</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mesa 8, Cliente Joao..." />
          </label>
        )}

        {type === "Mesa" && !pinned && (
          <label className="field small-field">
            <span>Mesa</span>
            <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} placeholder="8" />
          </label>
        )}

        {type === "Onibus" && !pinned && (
          <label className="field small-field">
            <span>Onibus</span>
            <input value={busNumber} onChange={(event) => setBusNumber(event.target.value)} placeholder="2" />
          </label>
        )}

        {!pinned && (
          <label className="field">
            <span>Pagamento</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {type === "Divisao de conta" && !pinned && (
        <SplitBox
          split={split}
          roundingStep={roundingStep}
          roundingDirection={roundingDirection}
          registerDifference={registerDifference}
          onRoundingStep={setRoundingStep}
          onRoundingDirection={setRoundingDirection}
          onRegisterDifference={setRegisterDifference}
        />
      )}

      {type === "Dinheiro/Troco" && !pinned && (
        <CashBox
          cash={cash}
          paidWithText={paidWithText}
          lastValue={lastActive?.finalValue || 0}
          onPaidWithText={setPaidWithText}
          onUseLast={() => {
            if (lastActive) {
              setValueText(String(lastActive.finalValue).replace(".", ","));
            }
          }}
        />
      )}

      {!pinned && (
        <label className="field observations-field">
          <span>Observacoes</span>
          <input value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="Ajuste, identificador, detalhe do pagamento..." />
        </label>
      )}

      <div className="submit-row">
        <button className="primary-button" type="submit" disabled={submitting || (value <= 0 && type !== "Cancelado/Estorno")}>
          {submitting ? <RefreshCw size={18} className="spin" /> : <Send size={18} />}
          Registrar
        </button>
        {!pinned && (
          <button className="ghost-button" type="button" onClick={clearForm}>
            <X size={18} />
            Limpar
          </button>
        )}
      </div>
    </form>
  );
}

function SplitBox({
  split,
  roundingStep,
  roundingDirection,
  registerDifference,
  onRoundingStep,
  onRoundingDirection,
  onRegisterDifference
}: {
  split: ReturnType<typeof calculateSplit>;
  roundingStep: number;
  roundingDirection: RoundDirection;
  registerDifference: boolean;
  onRoundingStep: (value: number) => void;
  onRoundingDirection: (value: RoundDirection) => void;
  onRegisterDifference: (value: boolean) => void;
}) {
  return (
    <section className="calculation-panel">
      <div className="calc-controls">
        <label className="field">
          <span>Multiplo</span>
          <select value={roundingStep} onChange={(event) => onRoundingStep(Number(event.target.value))}>
            {ROUNDING_STEPS.map((step) => (
              <option key={step} value={step}>{formatCurrency(step)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Direcao</span>
          <select value={roundingDirection} onChange={(event) => onRoundingDirection(event.target.value as RoundDirection)}>
            <option value="up">Para cima</option>
            <option value="down">Para baixo</option>
            <option value="nearest">Mais proximo</option>
          </select>
        </label>
        <label className="switch-line">
          <input type="checkbox" checked={registerDifference} onChange={(event) => onRegisterDifference(event.target.checked)} />
          Registrar sobra como ajuste
        </label>
      </div>
      <div className="calc-results">
        <Metric label="Original" value={formatCurrency(split.originalValue)} />
        <Metric label="Sem arredondar" value={formatCurrency(split.perPersonRaw)} />
        <Metric label="Por pessoa" value={formatCurrency(split.perPersonRounded)} />
        <Metric label="Total final" value={formatCurrency(split.finalTotal)} />
        <Metric label="Sobra/diferenca" value={formatCurrency(split.difference)} />
      </div>
    </section>
  );
}

function CashBox({
  cash,
  paidWithText,
  lastValue,
  onPaidWithText,
  onUseLast
}: {
  cash: ReturnType<typeof calculateCash>;
  paidWithText: string;
  lastValue: number;
  onPaidWithText: (value: string) => void;
  onUseLast: () => void;
}) {
  return (
    <section className="calculation-panel money-panel">
      <div className="calc-controls">
        <label className="field">
          <span>Pago com</span>
          <input inputMode="decimal" value={paidWithText} onChange={(event) => onPaidWithText(event.target.value)} placeholder="100,00" />
        </label>
        <button type="button" className="ghost-button" onClick={onUseLast} disabled={!lastValue}>
          <Wallet size={16} />
          Usar ultima conta ({formatCurrency(lastValue)})
        </button>
      </div>
      <div className="cash-result">
        <Metric label="Troco" value={formatCurrency(cash.change)} />
        <div className="breakdown">
          {cash.breakdown.length ? (
            cash.breakdown.map((item) => (
              <span key={item.label}>{item.quantity}x {item.label}</span>
            ))
          ) : (
            <span>Sem troco calculado.</span>
          )}
          {cash.unrepresentedCents > 0 && <span>Ajuste nao representavel: {formatCurrency(cash.unrepresentedCents)}</span>}
        </div>
      </div>
    </section>
  );
}

function TodayPanel({ summary, entries, onMode }: { summary: DaySummary; entries: LedgerEntry[]; onMode: (type: EntryType) => void }) {
  const latest = entries.slice(0, 5);
  return (
    <aside className="today-panel">
      <div className="total-plate">
        <span>Total geral</span>
        <strong>{formatCurrency(summary.total)}</strong>
        <small>{summary.count} registros, media {formatCurrency(summary.average)}</small>
      </div>

      <div className="quick-actions">
        <button onClick={() => onMode("Mesa")}><LayoutPanelTop size={18} /> Mesa</button>
        <button onClick={() => onMode("Onibus")}><MonitorUp size={18} /> Onibus</button>
        <button onClick={() => onMode("Dinheiro/Troco")}><Wallet size={18} /> Troco</button>
        <button onClick={() => onMode("Divisao de conta")}><Plus size={18} /> Dividir</button>
      </div>

      <section className="flat-section">
        <div className="section-title">
          <strong>Ultimos lancamentos</strong>
        </div>
        <div className="mini-list">
          {latest.map((entry) => (
            <div key={entry.id}>
              <span>{entry.description}</span>
              <strong>{formatCurrency(entry.finalValue)}</strong>
            </div>
          ))}
          {!latest.length && <p className="empty-text">Nenhum registro ainda.</p>}
        </div>
      </section>

      <section className="flat-section">
        <div className="section-title">
          <strong>Totais rapidos</strong>
        </div>
        <Metric label="Onibus" value={formatCurrency(summary.busTotal)} />
        <Metric label="Dinheiro" value={formatCurrency(summary.cashTotal)} />
        <Metric label="Sobras" value={formatCurrency(summary.differenceTotal)} />
      </section>
    </aside>
  );
}

function HistoryPanel({
  entries,
  onChange,
  onToast
}: {
  entries: LedgerEntry[];
  onChange: () => Promise<void>;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("Todos");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const haystack = `${entry.description} ${entry.tableNumber} ${entry.busNumber} ${entry.paymentMethod}`.toLowerCase();
      const sameType = type === "Todos" || entry.type === type;
      const sameDate = !date || entry.createdAt.startsWith(date);
      return sameType && sameDate && haystack.includes(query.toLowerCase());
    });
  }, [entries, query, type, date]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await onChange();
      onToast("success", success);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel concluir.");
    }
  };

  return (
    <section className="panel">
      <div className="filter-bar">
        <label className="field">
          <span>Buscar</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Descricao, mesa, onibus..." />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option>Todos</option>
            {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Data</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Descricao</th>
              <th>Mesa</th>
              <th>Onibus</th>
              <th>Pagamento</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const { time } = formatDateTime(entry.createdAt);
              return (
                <tr key={entry.id} className={entry.status !== "active" ? "muted-row" : ""}>
                  <td>{time}</td>
                  <td>{entry.customType || entry.type}</td>
                  <td>{entry.description}</td>
                  <td>{entry.tableNumber || "-"}</td>
                  <td>{entry.busNumber || "-"}</td>
                  <td>{entry.paymentMethod}</td>
                  <td>{formatCurrency(entry.finalValue)}</td>
                  <td><span className={`status-dot ${entry.status}`}>{entry.status}</span></td>
                  <td>
                    <div className="row-actions">
                      <button title="Editar" onClick={() => setEditing(entry)}><Edit3 size={15} /></button>
                      <button title="Duplicar" onClick={() => run(() => window.caixa.duplicateEntry(entry.id), "Lancamento duplicado.")}><Copy size={15} /></button>
                      <button title="Cancelar" onClick={() => run(() => window.caixa.cancelEntry(entry.id), "Lancamento cancelado.")}><MinusCircle size={15} /></button>
                      <button title="Remover" onClick={() => window.confirm("Marcar este lancamento como removido?") && run(() => window.caixa.removeEntry(entry.id), "Lancamento removido.")}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filtered.length && <p className="empty-text">Nada encontrado com esses filtros.</p>}

      {editing && (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await run(() => window.caixa.updateEntry(editing.id, patch), "Lancamento atualizado.");
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function EditEntryModal({
  entry,
  onClose,
  onSave
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onSave: (patch: Partial<LedgerEntry>) => Promise<void>;
}) {
  const [type, setType] = useState<EntryType>(entry.type);
  const [description, setDescription] = useState(entry.description);
  const [finalValue, setFinalValue] = useState(String(entry.finalValue).replace(".", ","));
  const [tableNumber, setTableNumber] = useState(entry.tableNumber);
  const [busNumber, setBusNumber] = useState(entry.busNumber);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(entry.paymentMethod);
  const [observations, setObservations] = useState(entry.observations);

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <strong>Editar lancamento</strong>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="entry-grid">
          <label className="field">
            <span>Tipo</span>
            <select value={type} onChange={(event) => setType(event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Valor final</span>
            <input value={finalValue} onChange={(event) => setFinalValue(event.target.value)} />
          </label>
          <label className="field description-field">
            <span>Descricao</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">
            <span>Mesa</span>
            <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} />
          </label>
          <label className="field">
            <span>Onibus</span>
            <input value={busNumber} onChange={(event) => setBusNumber(event.target.value)} />
          </label>
          <label className="field">
            <span>Pagamento</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field observations-field">
            <span>Observacoes</span>
            <input value={observations} onChange={(event) => setObservations(event.target.value)} />
          </label>
        </div>
        <div className="submit-row">
          <button
            className="primary-button"
            onClick={() =>
              onSave({
                type,
                description,
                finalValue: parseMoney(finalValue),
                tableNumber,
                busNumber,
                paymentMethod,
                observations
              })
            }
          >
            <Save size={18} />
            Salvar
          </button>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ReportsPanel({
  entries,
  summary,
  exportStatus,
  onExport
}: {
  entries: LedgerEntry[];
  summary: DaySummary;
  exportStatus: ExportStatus | null;
  onExport: () => Promise<void>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const periodEntries = entries.filter((entry) => {
    const date = entry.createdAt.slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  });
  const periodSummary = summarizeEntries(periodEntries);

  return (
    <section className="panel report-panel">
      <div className="filter-bar">
        <label className="field"><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>Ate</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="primary-button" onClick={onExport}><Download size={18} /> Exportar agora</button>
      </div>

      <div className="metric-grid">
        <Metric label="Total do periodo" value={formatCurrency(periodSummary.total)} />
        <Metric label="Quantidade" value={String(periodSummary.count)} />
        <Metric label="Media" value={formatCurrency(periodSummary.average)} />
        <Metric label="Maior venda" value={formatCurrency(periodSummary.biggestSale)} />
        <Metric label="Onibus" value={formatCurrency(periodSummary.busTotal)} />
        <Metric label="Dinheiro" value={formatCurrency(periodSummary.cashTotal)} />
        <Metric label="Sobras" value={formatCurrency(periodSummary.differenceTotal)} />
        <Metric label="Arquivo" value={exportStatus?.pendingCount ? `${exportStatus.pendingCount} pendente` : "OK"} />
      </div>

      <div className="report-columns">
        <BarList title="Total por tipo" data={periodSummary.byType} total={periodSummary.total} />
        <BarList title="Total por mesa" data={periodSummary.byTable} total={periodSummary.total} />
        <BarList title="Total por onibus" data={periodSummary.byBus} total={periodSummary.total} />
        <BarList title="Forma de pagamento" data={periodSummary.byPayment} total={periodSummary.total} />
      </div>
    </section>
  );
}

function ServerPanel({
  settings,
  server,
  onSaveSettings,
  onServerChange,
  onToast
}: {
  settings: AppSettings;
  server: ServerState;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onServerChange: (server: ServerState) => void;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const [port, setPort] = useState(settings.server.port);
  const [password, setPassword] = useState(settings.server.password);
  const [permissions, setPermissions] = useState(settings.server.permissions);

  const start = async () => {
    try {
      const nextSettings = { ...settings, server: { ...settings.server, port, password, permissions } };
      await onSaveSettings(nextSettings);
      const next = await window.caixa.startServer(port, password);
      onServerChange(next);
      onToast("success", "Servidor local aberto.");
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : "Nao foi possivel abrir o servidor.");
    }
  };

  const stop = async () => {
    const next = await window.caixa.stopServer();
    onServerChange(next);
    onToast("info", "Servidor desligado.");
  };

  return (
    <section className="panel server-panel">
      <div className="server-hero">
        <div>
          <span className="eyebrow">Rede local</span>
          <h2>{server.running ? "Servidor ativo" : "Servidor desligado"}</h2>
          <p>Outro computador na mesma rede pode abrir o endereco, informar a senha e registrar vendas conforme as permissoes.</p>
        </div>
        <div className="server-url">
          <Laptop size={24} />
          <strong>{server.running ? server.url : "Aguardando abertura"}</strong>
          <span>{server.ips.join(" | ") || "Nenhum IP local encontrado"}</span>
        </div>
      </div>

      <div className="entry-grid">
        <label className="field">
          <span>Porta</span>
          <input type="number" value={port} onChange={(event) => setPort(Number(event.target.value || 4317))} />
        </label>
        <label className="field">
          <span>Senha</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Defina uma senha" />
        </label>
        <div className="permission-box">
          {(["view", "create", "edit", "delete"] as const).map((key) => (
            <label className="switch-line" key={key}>
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}
              />
              {permissionLabel(key)}
            </label>
          ))}
        </div>
      </div>

      <div className="submit-row">
        {server.running ? (
          <button className="danger-button" onClick={stop}>Desligar servidor</button>
        ) : (
          <button className="primary-button" onClick={start}><Server size={18} /> Abrir servidor</button>
        )}
      </div>

      <section className="flat-section">
        <div className="section-title"><strong>Dispositivos conectados</strong></div>
        <div className="mini-list">
          {server.devices.map((device) => (
            <div key={device.id}>
              <span>{device.name}<small>{device.ip}</small></span>
              <button onClick={async () => onServerChange(await window.caixa.disconnectDevice(device.id))}>Desconectar</button>
            </div>
          ))}
          {!server.devices.length && <p className="empty-text">Nenhum dispositivo conectado agora.</p>}
        </div>
      </section>
    </section>
  );
}

function SettingsPanel({
  settings,
  onSave,
  onToast
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onToast: (tone: ToastState["tone"], message: string) => void;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => setDraft(settings), [settings]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const chooseFolder = async () => {
    const folder = await window.caixa.chooseOutputDirectory();
    if (folder) {
      update("outputDirectory", folder);
    }
  };

  const applyPreset = (preset: "Caixa" | "Mesa" | "Onibus" | "Dinheiro" | "Minimalista") => {
    const map: Record<typeof preset, Partial<AppSettings>> = {
      Caixa: { defaultType: "Venda", layout: "complete", density: "normal" },
      Mesa: { defaultType: "Mesa", layout: "sidePanel", density: "compact" },
      Onibus: { defaultType: "Onibus", layout: "compact", density: "compact" },
      Dinheiro: { defaultType: "Dinheiro/Troco", layout: "complete", density: "normal" },
      Minimalista: { defaultType: "Venda", layout: "pinnedBar", density: "compact", fieldSize: "small" }
    };
    setDraft((current) => ({ ...current, ...map[preset] }));
  };

  const moveColumn = (column: string, direction: -1 | 1) => {
    const next = [...draft.visibleColumns];
    const index = next.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    update("visibleColumns", next);
  };

  const toggleColumn = (column: string) => {
    const exists = draft.visibleColumns.includes(column);
    update("visibleColumns", exists ? draft.visibleColumns.filter((item) => item !== column) : [...draft.visibleColumns, column]);
  };

  const toggleFloatingField = (field: string) => {
    const exists = draft.floating.visibleFields.includes(field);
    update("floating", {
      ...draft.floating,
      visibleFields: exists
        ? draft.floating.visibleFields.filter((item) => item !== field)
        : [...draft.floating.visibleFields, field]
    });
  };

  return (
    <section className="panel settings-panel">
      <div className="preset-row">
        {(["Caixa", "Mesa", "Onibus", "Dinheiro", "Minimalista"] as const).map((preset) => (
          <button key={preset} onClick={() => applyPreset(preset)}>{preset}</button>
        ))}
      </div>

      <div className="settings-grid">
        <section className="settings-group">
          <h3>Aparencia</h3>
          <label className="field"><span>Tema</span>
            <select value={draft.theme} onChange={(event) => update("theme", event.target.value as AppSettings["theme"])}>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
              <option value="auto">Automatico</option>
              <option value="contrast">Alto contraste</option>
            </select>
          </label>
          <label className="field"><span>Cor principal</span><input type="color" value={draft.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></label>
          <label className="field"><span>Tamanho dos campos</span>
            <select value={draft.fieldSize} onChange={(event) => update("fieldSize", event.target.value as AppSettings["fieldSize"])}>
              <option value="small">Pequeno</option>
              <option value="medium">Medio</option>
              <option value="large">Grande</option>
            </select>
          </label>
          <label className="field"><span>Densidade</span>
            <select value={draft.density} onChange={(event) => update("density", event.target.value as AppSettings["density"])}>
              <option value="compact">Compacta</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Confortavel</option>
            </select>
          </label>
          <label className="field"><span>Layout</span>
            <select value={draft.layout} onChange={(event) => update("layout", event.target.value as AppSettings["layout"])}>
              <option value="complete">Completo</option>
              <option value="compact">Compacto</option>
              <option value="pinnedBar">Barra fixada</option>
              <option value="grid">Grade</option>
              <option value="sidePanel">Painel lateral</option>
            </select>
          </label>
        </section>

        <section className="settings-group">
          <h3>Padroes</h3>
          <label className="field"><span>Tipo padrao</span>
            <select value={draft.defaultType} onChange={(event) => update("defaultType", event.target.value as EntryType)}>
              {ENTRY_TYPES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field"><span>Pessoas padrao</span><input type="number" min={1} value={draft.defaultPeople} onChange={(event) => update("defaultPeople", Number(event.target.value || 1))} /></label>
          <label className="field"><span>Arredondamento</span>
            <select value={draft.defaultRoundingStep} onChange={(event) => update("defaultRoundingStep", Number(event.target.value))}>
              {ROUNDING_STEPS.map((step) => <option value={step} key={step}>{formatCurrency(step)}</option>)}
            </select>
          </label>
          <label className="field"><span>Direcao</span>
            <select value={draft.defaultRoundingDirection} onChange={(event) => update("defaultRoundingDirection", event.target.value as RoundDirection)}>
              <option value="up">Para cima</option>
              <option value="down">Para baixo</option>
              <option value="nearest">Mais proximo</option>
            </select>
          </label>
        </section>

        <section className="settings-group wide">
          <h3>Arquivos</h3>
          <label className="field path-field"><span>Pasta padrao</span><input value={draft.outputDirectory} onChange={(event) => update("outputDirectory", event.target.value)} /><button onClick={chooseFolder} type="button">Escolher</button></label>
          <label className="field"><span>Formato</span>
            <select value={draft.fileFormat} onChange={(event) => update("fileFormat", event.target.value as AppSettings["fileFormat"])}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="field"><span>Organizacao</span>
            <select value={draft.fileStrategy} onChange={(event) => update("fileStrategy", event.target.value as AppSettings["fileStrategy"])}>
              <option value="daily">Um arquivo por dia</option>
              <option value="monthlyTabs">Um arquivo por mes com abas</option>
              <option value="fixedAll">Arquivo fixo geral</option>
              <option value="byType">Arquivos por tipo</option>
            </select>
          </label>
          <label className="field"><span>Modo da planilha</span>
            <select
              value={draft.spreadsheetMode}
              onChange={(event) => {
                const spreadsheetMode = event.target.value as AppSettings["spreadsheetMode"];
                setDraft((current) => ({
                  ...current,
                  spreadsheetMode,
                  visibleColumns: spreadsheetMode === "simple" ? SIMPLE_COLUMNS : DEFAULT_COLUMNS
                }));
              }}
            >
              <option value="simple">Simples: valor pago e total</option>
              <option value="advanced">Avancado: todas as colunas</option>
            </select>
          </label>
          <label className="field"><span>Formato da data</span>
            <select value={draft.dateFormat} onChange={(event) => update("dateFormat", event.target.value as AppSettings["dateFormat"])}>
              <option value="yyyy-MM-dd">2026-06-28</option>
              <option value="dd-MM-yyyy">28-06-2026</option>
              <option value="yyyyMMdd">20260628</option>
            </select>
          </label>
          <label className="field"><span>Separador CSV</span>
            <select value={draft.csvSeparator} onChange={(event) => update("csvSeparator", event.target.value as AppSettings["csvSeparator"])}>
              <option value=";">Ponto e virgula</option>
              <option value=",">Virgula</option>
              <option value="\t">Tab</option>
            </select>
          </label>
          <label className="switch-line"><input type="checkbox" checked={draft.backupEnabled} onChange={(event) => update("backupEnabled", event.target.checked)} /> Criar backup automatico</label>
        </section>

        <section className="settings-group wide">
          <h3>Modo fixado</h3>
          <label className="field"><span>Opacidade</span><input type="range" min={0.5} max={1} step={0.01} value={draft.floating.opacity} onChange={(event) => update("floating", { ...draft.floating, opacity: Number(event.target.value) })} /></label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.borderless} onChange={(event) => update("floating", { ...draft.floating, borderless: event.target.checked })} /> Esconder bordas</label>
          <label className="switch-line"><input type="checkbox" checked={draft.floating.lockPosition} onChange={(event) => update("floating", { ...draft.floating, lockPosition: event.target.checked })} /> Travar posicao</label>
          <div className="chip-grid">
            {DEFAULT_FLOATING_FIELDS.concat(["table", "bus", "payment"]).map((field) => (
              <button key={field} className={draft.floating.visibleFields.includes(field) ? "selected" : ""} onClick={() => toggleFloatingField(field)}>
                {field}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-group wide">
          <h3>Colunas do arquivo</h3>
          {draft.spreadsheetMode === "simple" && (
            <p className="settings-note">
              O modo simples usa Data, Hora, Valor pago, Descricao, Tipo, Pessoas, Pago com, Troco e uma linha TOTAL.
              Troque para avancado para reordenar todas as colunas.
            </p>
          )}
          <div className="column-list">
            {DEFAULT_COLUMNS.map((column) => (
              <div key={column} className={draft.visibleColumns.includes(column) ? "" : "disabled"}>
                <label><input type="checkbox" disabled={draft.spreadsheetMode === "simple"} checked={draft.visibleColumns.includes(column)} onChange={() => toggleColumn(column)} /> {column}</label>
                <span>
                  <button disabled={draft.spreadsheetMode === "simple"} onClick={() => moveColumn(column, -1)}><ArrowUp size={14} /></button>
                  <button disabled={draft.spreadsheetMode === "simple"} onClick={() => moveColumn(column, 1)}><ArrowDown size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="submit-row sticky-save">
        <button className="primary-button" onClick={() => onSave(draft)}><Save size={18} /> Salvar configuracoes</button>
        <button className="ghost-button" onClick={() => {
          setDraft(settings);
          onToast("info", "Alteracoes descartadas.");
        }}>Descartar</button>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarList({ title, data, total }: { title: string; data: Record<string, number>; total: number }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <section className="bar-list">
      <h3>{title}</h3>
      {rows.map(([label, value]) => (
        <div key={label} className="bar-row">
          <div>
            <span>{label}</span>
            <strong>{formatCurrency(value)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.min(100, Math.abs(total ? (value / total) * 100 : 0))}%` }} />
          </div>
        </div>
      ))}
      {!rows.length && <p className="empty-text">Sem dados suficientes.</p>}
    </section>
  );
}

function StatusPill({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <span className={`status-pill ${ok ? "ok" : "warn"}`}>
      <i />
      {label}: {text}
    </span>
  );
}

function Toast({ toast }: { toast: ToastState }) {
  return (
    <div className={`toast ${toast.tone}`}>
      {toast.tone === "success" ? <Check size={18} /> : toast.tone === "error" ? <X size={18} /> : <Eye size={18} />}
      {toast.message}
    </div>
  );
}

function titleForTab(tab: TabKey): string {
  const map: Record<TabKey, string> = {
    register: "Registro rapido",
    history: "Historico editavel",
    reports: "Relatorios",
    server: "Servidor local",
    settings: "Configuracoes"
  };
  return map[tab];
}

function permissionLabel(key: "view" | "create" | "edit" | "delete"): string {
  return {
    view: "Somente visualizar",
    create: "Registrar vendas",
    edit: "Editar lancamentos",
    delete: "Apagar lancamentos"
  }[key];
}
