import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DEFAULT_TABLE_PREFERENCES, SKIP_REMINDER_KEYS, isOwnCloseNotice, shouldRemind, validTableExceptions, type CloseNoticeSource, type LocalTablePreferences, type TableClosedNotice } from "../shared/closeReminders";

export function tablePreferencesKey(client: boolean) { return `caixa.local-tables.${client ? "client" : "server"}`; }
export function readTablePreferences(client: boolean): LocalTablePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(tablePreferencesKey(client)) || "{}");
    return {
      reminders: ["off", "always", "weekdays"].includes(value.reminders) ? value.reminders : "off",
      weekdays: Array.isArray(value.weekdays) ? value.weekdays.filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 6],
      excludedTables: typeof value.excludedTables === "string" && validTableExceptions(value.excludedTables) ? value.excludedTables : "",
      hideQuickValue: value.hideQuickValue === true,
      reminderSource: value.reminderSource === "all" ? "all" : "mine",
      syncAcknowledge: value.syncAcknowledge !== false,
      skipReminderKey: SKIP_REMINDER_KEYS.includes(value.skipReminderKey) ? value.skipReminderKey : DEFAULT_TABLE_PREFERENCES.skipReminderKey,
      visibleLimit: Number.isInteger(value.visibleLimit) && value.visibleLimit >= 1 && value.visibleLimit <= 10 ? value.visibleLimit : DEFAULT_TABLE_PREFERENCES.visibleLimit
    };
  } catch { return { ...DEFAULT_TABLE_PREFERENCES }; }
}

export function useLocalTablePreferences(client: boolean) {
  const [preferences, setPreferences] = useState(() => readTablePreferences(client));
  useEffect(() => {
    const refresh = () => setPreferences(readTablePreferences(client));
    refresh(); window.addEventListener("local-table-preferences", refresh);
    return () => window.removeEventListener("local-table-preferences", refresh);
  }, [client]);
  return preferences;
}

function saveTablePreferences(client: boolean, patch: Partial<LocalTablePreferences>) {
  localStorage.setItem(tablePreferencesKey(client), JSON.stringify({ ...readTablePreferences(client), ...patch }));
  window.dispatchEvent(new Event("local-table-preferences"));
}

export function LocalTableOptions({ client }: { client: boolean }) {
  const preferences = useLocalTablePreferences(client);
  const [exceptions, setExceptions] = useState(preferences.excludedTables);
  useEffect(() => setExceptions(preferences.excludedTables), [preferences.excludedTables]);
  const save = (patch: Partial<LocalTablePreferences>) => {
    saveTablePreferences(client, patch);
  };
  return <section className="local-table-options">
    <h3>Lembretes de comandas</h3>
    <p>Configuração local: não altera os outros clientes nem o servidor.</p>
    <label><span>Avisar para retirar a comanda após fechar</span><select value={preferences.reminders} onChange={(e) => save({ reminders: e.target.value as LocalTablePreferences["reminders"] })}>
      <option value="off">Desativado</option><option value="always">Todos os dias</option><option value="weekdays">Dias da semana</option>
    </select></label>
    {preferences.reminders === "weekdays" && <div className="reminder-weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day, index) => <label key={day}><input type="checkbox" checked={preferences.weekdays.includes(index)} onChange={(e) => save({ weekdays: e.target.checked ? [...preferences.weekdays, index] : preferences.weekdays.filter((d) => d !== index) })} />{day}</label>)}</div>}
    <label><span>Avisar fechamentos feitos</span><select aria-label="Avisar fechamentos feitos" value={preferences.reminderSource} onChange={(e) => save({ reminderSource: e.target.value === "all" ? "all" : "mine" })}>
      <option value="mine">Só neste computador</option><option value="all">Em todos os computadores</option>
    </select></label>
    <label><span>Lembretes visíveis antes de rolar</span><select aria-label="Lembretes visíveis antes de rolar" value={preferences.visibleLimit} onChange={(e) => save({ visibleLimit: Number(e.target.value) })}>
      {[1, 2, 3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label><span>Fechar conta sem lembrete (comanda já retirada)</span><select aria-label="Fechar conta sem lembrete" value={preferences.skipReminderKey} onChange={(e) => save({ skipReminderKey: e.target.value as LocalTablePreferences["skipReminderKey"] })}>
      <option value="bracket">Tecla ] º (ao lado do Enter) em vez do Enter</option><option value="shift">Segurar Shift ao finalizar</option><option value="ctrl">Segurar Ctrl ao finalizar</option><option value="off">Desativado</option>
    </select></label>
    <label className="switch-line reminder-sync-line"><input type="checkbox" checked={preferences.syncAcknowledge} onChange={(e) => save({ syncAcknowledge: e.target.checked })} />Ao confirmar em OK aqui, remover também dos outros computadores</label>
    <label><span>Não avisar nestas mesas</span><input value={exceptions} placeholder="Ex.: 47 ou 47+ ou 10-15, 47" aria-invalid={!validTableExceptions(exceptions)} onChange={(e) => { setExceptions(e.target.value); if (validTableExceptions(e.target.value)) save({ excludedTables: e.target.value }); }} /></label>
    <small>{validTableExceptions(exceptions) ? "47+ significa da mesa 47 em diante. O aviso fica pendente até confirmar em OK, inclusive após reabrir o app." : "Use números, intervalos como 10-15 ou 47+. A última configuração válida foi mantida."}</small>
  </section>;
}

/** Mesas fechadas com Shift: a comanda ja foi retirada, entao o proximo aviso dela nao vira lembrete. */
const suppressedTables = new Map<number, number>();
export function suppressCloseNotice(tableNumber: number) {
  if (Number.isInteger(tableNumber) && tableNumber > 0) suppressedTables.set(tableNumber, Date.now() + 120000);
}
function takeSuppression(tableNumber: number): boolean {
  const until = suppressedTables.get(tableNumber);
  if (!until) return false;
  suppressedTables.delete(tableNumber);
  return until > Date.now();
}

export function dispatchTableClosed(notice: TableClosedNotice, source: CloseNoticeSource = "self") {
  window.dispatchEvent(new CustomEvent("table-closed-notice", { detail: { notice, source } }));
}

/** Confirmacao vinda de outro computador pela rede. */
export function dispatchTableCloseAck(id: string) {
  window.dispatchEvent(new CustomEvent("table-close-ack", { detail: id }));
}

/** Pedido para avisar os outros computadores; o App envia por IPC (servidor) ou pela rede (cliente). */
export const TABLE_CLOSE_ACK_REQUEST = "table-close-ack-request";

function readList(key: string): string[] {
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; } catch { return []; }
}

/**
 * Dock do canto inferior direito: avisos temporarios (children) em cima e lembretes de comanda embaixo,
 * com a mesma aparencia e sem sobreposicao.
 */
export function TableCloseReminders({ client, hidden, loadAcks, children }: { client: boolean; hidden: boolean; /** OKs ja dados em qualquer computador, guardados no servidor. */ loadAcks?: () => Promise<string[]>; children?: ReactNode }) {
  const key = `${tablePreferencesKey(client)}.pending`;
  const seenKey = `${key}.seen`;
  const collapsedKey = `${tablePreferencesKey(client)}.collapsed`;
  const [notices, setNotices] = useState<TableClosedNotice[]>([]);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(collapsedKey) === "1"; } catch { return false; } });
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const read = (): TableClosedNotice[] => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter((n) => n && typeof n.id === "string" && Number.isInteger(n.tableNumber) && n.tableNumber > 0) : []; } catch { return []; } };
    // Seen IDs also include acknowledged notices, so network retries cannot bring them back.
    const markSeen = (id: string) => localStorage.setItem(seenKey, JSON.stringify([...readList(seenKey).filter((item) => item !== id), id].slice(-5000)));
    setNotices(read());
    const receive = (notice: TableClosedNotice, source: CloseNoticeSource) => {
      const preferences = readTablePreferences(client);
      if (!notice || !notice.id || !Number.isInteger(notice.tableNumber) || notice.tableNumber < 1) return;
      if (readList(seenKey).includes(notice.id)) return;
      if (takeSuppression(notice.tableNumber)) {
        // Conta como OK: some daqui e dos outros computadores.
        markSeen(notice.id);
        window.dispatchEvent(new CustomEvent(TABLE_CLOSE_ACK_REQUEST, { detail: notice.id }));
        return;
      }
      if (!shouldRemind(preferences, notice)) return;
      // Fechamentos de outros computadores so contam com a opcao "todos".
      // Nao marca como visto: a copia local do proprio fechamento ainda pode chegar depois.
      if (preferences.reminderSource === "mine" && !isOwnCloseNotice(notice, source)) return;
      if (readList(seenKey).includes(notice.id)) return;
      const next = [...read(), notice];
      localStorage.setItem(key, JSON.stringify(next));
      markSeen(notice.id);
      setNotices(next);
      setPulse((value) => value + 1);
    };
    // O OK dado em outro computador sempre remove aqui; a opcao "remover tambem dos outros" vale para quem clica.
    const acknowledge = (id: string) => {
      if (!id) return;
      markSeen(id);
      const current = read();
      if (!current.some((n) => n.id === id)) return;
      const next = current.filter((n) => n.id !== id);
      localStorage.setItem(key, JSON.stringify(next));
      setNotices(next);
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ notice: TableClosedNotice; source: CloseNoticeSource }>).detail;
      if (detail?.notice) receive(detail.notice, detail.source || "self");
    };
    const ackListener = (event: Event) => acknowledge(String((event as CustomEvent<string>).detail || ""));
    window.addEventListener("table-closed-notice", listener);
    window.addEventListener("table-close-ack", ackListener);
    const off = window.caixa.onTableClosed((notice) => receive(notice, "ipc"));
    // Quem estava desconectado quando o OK foi dado confere a lista do servidor ao abrir, a cada 20 s e ao voltar a janela.
    let disposed = false;
    const syncAcks = () => {
      if (!loadAcks || !read().length) return;
      void loadAcks().then((ids) => {
        if (disposed || !Array.isArray(ids)) return;
        const done = new Set(ids);
        const current = read();
        const next = current.filter((n) => !done.has(n.id));
        if (next.length === current.length) return;
        current.filter((n) => done.has(n.id)).forEach((n) => markSeen(n.id));
        localStorage.setItem(key, JSON.stringify(next));
        setNotices(next);
      }).catch(() => undefined);
    };
    syncAcks();
    const ackTimer = window.setInterval(syncAcks, 20000);
    window.addEventListener("focus", syncAcks);
    const offAck = window.caixa.onTableCloseAck ? window.caixa.onTableCloseAck((id) => acknowledge(id)) : () => undefined;
    return () => { disposed = true; window.clearInterval(ackTimer); window.removeEventListener("focus", syncAcks); off(); offAck(); window.removeEventListener("table-closed-notice", listener); window.removeEventListener("table-close-ack", ackListener); };
  }, [key, seenKey, client, loadAcks]);
  const preferences = useLocalTablePreferences(client);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(collapsedKey, next ? "1" : "0"); } catch { /* preferencia visual opcional */ }
  };
  const confirm = (notice: TableClosedNotice) => {
    const next = notices.filter((n) => n.id !== notice.id);
    localStorage.setItem(key, JSON.stringify(next));
    setNotices(next);
    if (preferences.syncAcknowledge) window.dispatchEvent(new CustomEvent(TABLE_CLOSE_ACK_REQUEST, { detail: notice.id }));
  };
  const showReminders = !hidden && preferences.reminders !== "off" && notices.length > 0;
  if (!showReminders && !children) return null;
  return <div className="notification-dock">
    {children}
    {showReminders && <aside className={`table-close-reminders ${collapsed ? "is-collapsed" : ""}`} aria-label="Comandas a retirar" aria-live="polite" style={{ "--reminder-limit": preferences.visibleLimit } as CSSProperties}>
      <button type="button" key={collapsed ? `collapsed-${pulse}` : "open"} className={`table-close-reminders-head ${collapsed && pulse ? "has-news" : ""}`} aria-expanded={!collapsed} aria-label={collapsed ? `Mostrar ${notices.length} lembrete(s) de comanda` : "Minimizar lembretes de comanda"} title={collapsed ? "Mostrar lembretes" : "Minimizar lembretes"} onClick={toggleCollapsed}>
        <span>Comandas ({notices.length})</span>{collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {!collapsed && <div className="table-close-reminders-list">
        {notices.map((notice) => <article key={notice.id} className={notice.subtableName ? "named" : ""}>
          <div><strong>Mesa {notice.tableNumber}</strong>{notice.subtableName ? <span>{notice.subtableName}</span> : <small>Retirar comanda</small>}</div>
          <button type="button" aria-label={`Confirmar retirada da comanda da mesa ${notice.tableNumber}${notice.subtableName ? `, ${notice.subtableName}` : ""}`} onClick={() => confirm(notice)}>OK</button>
        </article>)}
      </div>}
    </aside>}
  </div>;
}
