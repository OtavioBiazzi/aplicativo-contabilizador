import { useEffect, useState } from "react";
import { DEFAULT_TABLE_PREFERENCES, shouldRemind, validTableExceptions, type LocalTablePreferences, type TableClosedNotice } from "../shared/closeReminders";

export function tablePreferencesKey(client: boolean) { return `caixa.local-tables.${client ? "client" : "server"}`; }
export function readTablePreferences(client: boolean): LocalTablePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(tablePreferencesKey(client)) || "{}");
    return {
      reminders: ["off", "always", "weekdays"].includes(value.reminders) ? value.reminders : "off",
      weekdays: Array.isArray(value.weekdays) ? value.weekdays.filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 6],
      excludedTables: typeof value.excludedTables === "string" && validTableExceptions(value.excludedTables) ? value.excludedTables : "",
      hideQuickValue: value.hideQuickValue === true
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

export function LocalQuickValueOption({ client }: { client: boolean }) {
  const preferences = useLocalTablePreferences(client);
  return <label className="pdv-switch-line"><input type="checkbox" checked={preferences.hideQuickValue} onChange={(event) => saveTablePreferences(client, { hideQuickValue: event.target.checked })} />Ocultar o botão + só neste computador</label>;
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
    <label><span>Não avisar nestas mesas</span><input value={exceptions} placeholder="Ex.: 47 ou 47+ ou 10-15, 47" aria-invalid={!validTableExceptions(exceptions)} onChange={(e) => { setExceptions(e.target.value); if (validTableExceptions(e.target.value)) save({ excludedTables: e.target.value }); }} /></label>
    <small>{validTableExceptions(exceptions) ? "47+ significa da mesa 47 em diante. O aviso fica pendente até confirmar em OK, inclusive após reabrir o app." : "Use números, intervalos como 10-15 ou 47+. A última configuração válida foi mantida."}</small>
  </section>;
}

export function dispatchTableClosed(notice: TableClosedNotice) {
  window.dispatchEvent(new CustomEvent("table-closed-notice", { detail: notice }));
}

export function TableCloseReminders({ client, hidden }: { client: boolean; hidden: boolean }) {
  const key = `${tablePreferencesKey(client)}.pending`;
  const [notices, setNotices] = useState<TableClosedNotice[]>([]);
  useEffect(() => {
    const read = (): TableClosedNotice[] => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter((n) => n && typeof n.id === "string" && Number.isInteger(n.tableNumber) && n.tableNumber > 0) : []; } catch { return []; } };
    setNotices(read());
    const receive = (notice: TableClosedNotice) => {
      if (!notice || !notice.id || !Number.isInteger(notice.tableNumber) || notice.tableNumber < 1 || !shouldRemind(readTablePreferences(client), notice)) return;
      // Seen IDs also include acknowledged notices, so network retries cannot bring them back.
      const seenKey = `${key}.seen`;
      let seen: string[] = []; try { seen = JSON.parse(localStorage.getItem(seenKey) || "[]"); if (!Array.isArray(seen)) seen = []; } catch { /* fresh list */ }
      if (seen.includes(notice.id)) return;
      const next = [...read(), notice];
      localStorage.setItem(key, JSON.stringify(next));
      localStorage.setItem(seenKey, JSON.stringify([...seen, notice.id].slice(-5000)));
      setNotices(next);
    };
    const listener = (event: Event) => receive((event as CustomEvent<TableClosedNotice>).detail);
    window.addEventListener("table-closed-notice", listener);
    const off = window.caixa.onTableClosed(receive);
    return () => { off(); window.removeEventListener("table-closed-notice", listener); };
  }, [key, client]);
  const preferences = useLocalTablePreferences(client);
  if (hidden || preferences.reminders === "off" || !notices.length) return null;
  return <aside className="table-close-reminders" aria-label="Comandas a retirar" aria-live="polite">
    {notices.map((notice) => <article key={notice.id} className={notice.subtableName ? "named" : ""}>
      <div><strong>Mesa {notice.tableNumber}</strong>{notice.subtableName ? <span>{notice.subtableName}</span> : <small>Retirar comanda</small>}</div>
      <button type="button" aria-label={`Confirmar retirada da comanda da mesa ${notice.tableNumber}${notice.subtableName ? `, ${notice.subtableName}` : ""}`} onClick={() => {
        const next = notices.filter((n) => n.id !== notice.id); localStorage.setItem(key, JSON.stringify(next)); setNotices(next);
      }}>OK</button>
    </article>)}
  </aside>;
}
