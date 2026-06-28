import type { AppSettings, AppSnapshot, EntryDraft, ExportStatus, LedgerEntry, ServerState } from "./shared/types";

export interface CaixaApi {
  getSnapshot: () => Promise<AppSnapshot>;
  addEntry: (draft: EntryDraft) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  updateEntry: (id: string, patch: Partial<LedgerEntry>) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  removeEntry: (id: string) => Promise<{ exportStatus: ExportStatus }>;
  duplicateEntry: (id: string) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  cancelEntry: (id: string) => Promise<{ entry: LedgerEntry; exportStatus: ExportStatus }>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  chooseOutputDirectory: () => Promise<string | null>;
  exportNow: () => Promise<ExportStatus>;
  startServer: (port: number, password: string) => Promise<ServerState>;
  stopServer: () => Promise<ServerState>;
  disconnectDevice: (id: string) => Promise<ServerState>;
  setPinned: (pinned: boolean, options?: { opacity?: number; borderless?: boolean; lockPosition?: boolean }) => Promise<boolean>;
  getPinned: () => Promise<boolean>;
  onEntriesChanged: (callback: () => void) => () => void;
  onServerChanged: (callback: (state: ServerState) => void) => () => void;
  onPinnedChanged: (callback: (pinned: boolean) => void) => () => void;
}

declare global {
  interface Window {
    caixa: CaixaApi;
  }
}
