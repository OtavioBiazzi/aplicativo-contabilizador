export interface TableClosedNotice {
  id: string;
  tableNumber: number;
  subtableName?: string;
  createdAt: string;
  /** Onde a mesa foi fechada: no proprio computador servidor ou por um cliente conectado. */
  originKind?: "server" | "client";
  originDevice?: string;
}

/** Como o aviso chegou a esta tela. */
export type CloseNoticeSource = "ipc" | "network" | "self";

/** Um aviso e "deste computador" quando o fechamento foi feito aqui. Avisos antigos sem origem contam como locais. */
export function isOwnCloseNotice(notice: TableClosedNotice, source: CloseNoticeSource): boolean {
  if (source === "self") return true;
  if (source === "network") return false;
  return notice.originKind !== "client";
}

export interface LocalTablePreferences {
  reminders: "off" | "always" | "weekdays";
  weekdays: number[];
  excludedTables: string;
  hideQuickValue: boolean;
  /** Avisar somente fechamentos feitos neste computador, ou de todos. */
  reminderSource: "mine" | "all";
  /** Confirmar em OK aqui tambem remove o lembrete nos outros computadores conectados. */
  syncAcknowledge: boolean;
  /** Quantos lembretes ficam visiveis antes de virar lista com rolagem. */
  visibleLimit: number;
}

export const DEFAULT_TABLE_PREFERENCES: LocalTablePreferences = {
  reminders: "off", weekdays: [0, 6], excludedTables: "", hideQuickValue: false, reminderSource: "mine", syncAcknowledge: true, visibleLimit: 4
};

/** Accepts exact numbers, closed ranges and open-ended ranges, without expanding them. */
export function validTableExceptions(value: string): boolean {
  return value.split(/[,;\s]+/).filter(Boolean).every((token) => {
    const match = /^(\d+)(?:(\+)|-(\d+))?$/.exec(token);
    return Boolean(match && Number(match[1]) > 0 && (!match[3] || Number(match[3]) >= Number(match[1])));
  });
}

export function tableIsExcluded(number: number, value: string): boolean {
  return value.split(/[,;\s]+/).filter(Boolean).some((token) => {
    const match = /^(\d+)(?:(\+)|-(\d+))?$/.exec(token);
    if (!match) return false;
    const first = Number(match[1]);
    return match[2] ? number >= first : match[3] ? number >= first && number <= Number(match[3]) : number === first;
  });
}

export function shouldRemind(preferences: LocalTablePreferences, notice: TableClosedNotice): boolean {
  if (preferences.reminders === "off" || tableIsExcluded(notice.tableNumber, preferences.excludedTables)) return false;
  const date = new Date(notice.createdAt);
  return Number.isFinite(date.getTime()) && (preferences.reminders === "always" || preferences.weekdays.includes(date.getDay()));
}
