import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { SettingsBlock, SettingsField } from "./SettingsBlocks";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DEFAULT_TABLE_PREFERENCES, SKIP_REMINDER_KEYS, closedHere, isOwnCloseNotice, shouldRemind, validTableExceptions, type CloseNoticeSource, type LocalTablePreferences, type TableClosedNotice } from "../shared/closeReminders";

export function tablePreferencesKey(client: boolean) { return `caixa.local-tables.${client ? "client" : "server"}`; }
export function readTablePreferences(client: boolean): LocalTablePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(tablePreferencesKey(client)) || "{}");
    return {
      reminders: ["off", "always", "weekdays"].includes(value.reminders) ? value.reminders : "off",
      weekdays: Array.isArray(value.weekdays) ? value.weekdays.filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 6],
      excludedTables: typeof value.excludedTables === "string" && validTableExceptions(value.excludedTables) ? value.excludedTables : "",
      hideQuickValue: value.hideQuickValue === true,
      reminderSource: value.reminderSource === "all" || value.reminderSource === "others" ? value.reminderSource : "mine",
      syncAcknowledge: value.syncAcknowledge !== false,
      reminderSize: value.reminderSize === "compact" || value.reminderSize === "small" ? value.reminderSize : "normal",
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
  const exceptionsValid = validTableExceptions(exceptions);
  return <div className="local-table-options settings-blocks">
    <SettingsBlock title="Quando lembrar" description="Depois de fechar uma conta, aparece um lembrete para retirar a comanda até alguém dar OK. Configuração só deste computador.">
      <SettingsField label="Lembrar de retirar a comanda">
        <select value={preferences.reminders} onChange={(e) => save({ reminders: e.target.value as LocalTablePreferences["reminders"] })}>
          <option value="off">Desativado</option><option value="always">Todos os dias</option><option value="weekdays">Só em alguns dias</option>
        </select>
      </SettingsField>
      <SettingsField label="Avisar fechamentos feitos">
        <select aria-label="Avisar fechamentos feitos" value={preferences.reminderSource} onChange={(e) => save({ reminderSource: e.target.value === "all" || e.target.value === "others" ? e.target.value : "mine" })}>
          <option value="mine">Só neste computador</option><option value="others">Só nos outros computadores</option><option value="all">Em todos os computadores</option>
        </select>
      </SettingsField>
      {preferences.reminders === "weekdays" && <div className="settings-weekdays wide" aria-label="Dias com lembrete">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day, index) => <label key={day}><input type="checkbox" checked={preferences.weekdays.includes(index)} onChange={(e) => save({ weekdays: e.target.checked ? [...preferences.weekdays, index] : preferences.weekdays.filter((d) => d !== index) })} />{day}</label>)}</div>}
      <SettingsField wide label="Não avisar nestas mesas" hint={exceptionsValid ? "Ex.: 47 (só a 47), 47+ (da 47 em diante) ou 10-15. Separe com vírgula." : "Use números, intervalos como 10-15 ou 47+. A última configuração válida foi mantida."}>
        <input value={exceptions} placeholder="Ex.: 47 ou 47+ ou 10-15, 47" aria-invalid={!exceptionsValid} onChange={(e) => { setExceptions(e.target.value); if (validTableExceptions(e.target.value)) save({ excludedTables: e.target.value }); }} />
      </SettingsField>
    </SettingsBlock>
    <SettingsBlock title="Fechar sem lembrete" description="Para quando a comanda já foi retirada na hora do fechamento: a conta fecha sem lembrete em nenhum computador e já conta como OK.">
      <SettingsField label="Fechar conta sem lembrete">
        <select aria-label="Fechar conta sem lembrete" value={preferences.skipReminderKey} onChange={(e) => save({ skipReminderKey: e.target.value as LocalTablePreferences["skipReminderKey"] })}>
          <option value="bracket">Tecla ] º (ao lado do Enter) em vez do Enter</option><option value="shift">Segurar Shift ao finalizar</option><option value="ctrl">Segurar Ctrl ao finalizar</option><option value="off">Desativado</option>
        </select>
      </SettingsField>
    </SettingsBlock>
    <SettingsBlock title="Aparência dos lembretes" description="Tamanho do quadro no canto da tela. Em telas pequenas, como 1300 ou 1366, o Compacto ou o Pequeno atrapalham menos.">
      <SettingsField label="Tamanho dos lembretes">
        <select aria-label="Tamanho dos lembretes" value={preferences.reminderSize} onChange={(e) => save({ reminderSize: e.target.value as LocalTablePreferences["reminderSize"] })}>
          <option value="normal">Normal</option><option value="compact">Compacto</option><option value="small">Pequeno</option>
        </select>
      </SettingsField>
      <SettingsField label="Lembretes visíveis antes de rolar">
        <select aria-label="Lembretes visíveis antes de rolar" value={preferences.visibleLimit} onChange={(e) => save({ visibleLimit: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </SettingsField>
    </SettingsBlock>
  </div>;
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
export function TableCloseReminders({ client, deviceName, hidden, loadAcks, children }: { client: boolean; /** Nome deste aparelho como cliente, para reconhecer os proprios fechamentos que voltam pela rede. */ deviceName?: string; hidden: boolean; /** OKs ja dados em qualquer computador, guardados no servidor. */ loadAcks?: () => Promise<string[]>; children?: ReactNode }) {
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
      // "Só nos outros": ignora o que foi fechado aqui.
      if (preferences.reminderSource === "others" && closedHere(notice, source, client, deviceName)) return;
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
    // Quem estava desconectado quando o OK foi dado confere a lista do servidor ao abrir, a cada 10 s e ao voltar a janela.
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
    const ackTimer = window.setInterval(syncAcks, 10000);
    window.addEventListener("focus", syncAcks);
    const offAck = window.caixa.onTableCloseAck ? window.caixa.onTableCloseAck((id) => acknowledge(id)) : () => undefined;
    return () => { disposed = true; window.clearInterval(ackTimer); window.removeEventListener("focus", syncAcks); off(); offAck(); window.removeEventListener("table-closed-notice", listener); window.removeEventListener("table-close-ack", ackListener); };
  }, [key, seenKey, client, deviceName, loadAcks]);
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
    // 0.4.24: o OK sempre remove dos outros computadores (antes dependia de uma opcao por computador,
    // e com ela desmarcada no servidor o lembrete ficava no cliente).
    window.dispatchEvent(new CustomEvent(TABLE_CLOSE_ACK_REQUEST, { detail: notice.id }));
  };
  const showReminders = !hidden && preferences.reminders !== "off" && notices.length > 0;
  if (!showReminders && !children) return null;
  return <div className="notification-dock">
    {children}
    {showReminders && <aside className={`table-close-reminders ${collapsed ? "is-collapsed" : ""} size-${preferences.reminderSize}`} aria-label="Comandas a retirar" aria-live="polite" style={{ "--reminder-limit": preferences.visibleLimit } as CSSProperties}>
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
