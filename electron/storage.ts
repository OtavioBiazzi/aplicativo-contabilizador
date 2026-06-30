import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DEFAULT_QUICK_TABS, ENTRY_TYPES, SIMPLE_COLUMNS, createDefaultSettings } from "../src/shared/defaults.js";
import { calculateCash, roundMoney } from "../src/shared/calculations.js";
import type { AppSettings, EntryDraft, EntryType, LedgerEntry, QuickTabSettings } from "../src/shared/types.js";

const SETTINGS_FILE = "settings.json";
const LEDGER_FILE = "ledger.json";

interface StorePaths {
  dataDirectory: string;
  defaultOutputDirectory: string;
}

export class LedgerStore {
  private settings: AppSettings | null = null;
  private entries: LedgerEntry[] | null = null;

  constructor(private readonly paths: StorePaths) {}

  async initialize() {
    await fs.mkdir(this.paths.dataDirectory, { recursive: true });
    await fs.mkdir(this.paths.defaultOutputDirectory, { recursive: true });
    await this.getSettings();
    await this.getEntries();
  }

  async getSettings(): Promise<AppSettings> {
    if (this.settings) {
      return this.settings;
    }

    const defaults = createDefaultSettings(this.paths.defaultOutputDirectory);
    const saved = await readJson<Partial<AppSettings>>(this.settingsPath(), {});
    this.settings = mergeSettings(defaults, saved);
    await this.saveSettings(this.settings);
    return this.settings;
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.settings = mergeSettings(createDefaultSettings(this.paths.defaultOutputDirectory), settings);
    await writeJsonAtomic(this.settingsPath(), this.settings);
    return this.settings;
  }

  async getEntries(): Promise<LedgerEntry[]> {
    if (this.entries) {
      return this.entries;
    }
    this.entries = await readJson<LedgerEntry[]>(this.ledgerPath(), []);
    return this.entries;
  }

  async addEntry(draft: EntryDraft): Promise<LedgerEntry> {
    const settings = await this.getSettings();
    const entries = await this.getEntries();
    const now = new Date().toISOString();
    const type = draft.type || settings.defaultType || "Venda";
    const people = Math.max(1, Math.floor(draft.people || settings.defaultPeople || 1));
    const originalValue = roundMoney(draft.value || draft.splitDetails?.originalValue || draft.cashDetails?.accountValue || 0);
    const split = draft.splitDetails;
    const cash = draft.cashDetails || (draft.paidWith ? calculateCash(originalValue, draft.paidWith) : undefined);
    const finalValue = roundMoney(split?.finalTotal ?? cash?.accountValue ?? originalValue);
    const description = normalizeDescription(draft.description, type, draft.tableNumber, draft.busNumber);

    const entry: LedgerEntry = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      type,
      originalValue,
      finalValue,
      people: split?.people ?? people,
      perPerson: split?.perPersonRounded ?? roundMoney(finalValue / people),
      roundingStep: split?.roundingStep ?? settings.defaultRoundingStep,
      roundingDirection: split?.roundingDirection ?? settings.defaultRoundingDirection,
      difference: split?.difference ?? 0,
      description,
      tableNumber: draft.tableNumber || extractNumber(description, "mesa"),
      busNumber: draft.busNumber || extractNumber(description, "onibus"),
      paymentMethod: draft.paymentMethod || (type === "Dinheiro/Troco" ? "Dinheiro" : "Nao informado"),
      paidWith: roundMoney(cash?.paidWith ?? draft.paidWith ?? 0),
      change: roundMoney(cash?.change ?? 0),
      observations: draft.observations || "",
      originDevice: draft.originDevice || "Este computador",
      status: "active",
      customType: draft.customType,
      splitDetails: split,
      cashDetails: cash
    };

    entries.unshift(entry);
    await this.persistEntries();
    return entry;
  }

  async updateEntry(id: string, patch: Partial<LedgerEntry>): Promise<LedgerEntry> {
    const entries = await this.getEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("Lancamento nao encontrado.");
    }

    const updated: LedgerEntry = {
      ...entries[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    };
    entries[index] = updated;
    await this.persistEntries();
    return updated;
  }

  async duplicateEntry(id: string): Promise<LedgerEntry> {
    const entries = await this.getEntries();
    const source = entries.find((entry) => entry.id === id);
    if (!source) {
      throw new Error("Lancamento nao encontrado.");
    }

    const now = new Date().toISOString();
    const copy: LedgerEntry = {
      ...source,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      observations: source.observations ? `${source.observations} (duplicado)` : "Duplicado"
    };
    entries.unshift(copy);
    await this.persistEntries();
    return copy;
  }

  async cancelEntry(id: string): Promise<LedgerEntry> {
    return this.updateEntry(id, { status: "cancelled" });
  }

  async removeEntry(id: string): Promise<void> {
    await this.updateEntry(id, { status: "deleted" });
  }

  async deleteEntry(id: string): Promise<void> {
    const entries = await this.getEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("Lancamento nao encontrado.");
    }
    entries.splice(index, 1);
    await this.persistEntries();
  }

  async previewImportEntries(importedEntries: LedgerEntry[]): Promise<{
    imported: number;
    skipped: number;
    entries: LedgerEntry[];
    items: Array<{ entry: LedgerEntry; duplicate: boolean }>;
  }> {
    const entries = await this.getEntries();
    return planImportEntries(entries, importedEntries);
  }

  async importEntries(importedEntries: LedgerEntry[]): Promise<{ imported: number; skipped: number; entries: LedgerEntry[] }> {
    const entries = await this.getEntries();
    const plan = planImportEntries(entries, importedEntries);

    if (plan.entries.length) {
      entries.unshift(...plan.entries);
      entries.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      await this.persistEntries();
    }

    return { imported: plan.imported, skipped: plan.skipped, entries: plan.entries };
  }

  private async persistEntries() {
    await writeJsonAtomic(this.ledgerPath(), this.entries || []);
  }

  private settingsPath() {
    return path.join(this.paths.dataDirectory, SETTINGS_FILE);
  }

  private ledgerPath() {
    return path.join(this.paths.dataDirectory, LEDGER_FILE);
  }
}

function planImportEntries(existingEntries: LedgerEntry[], importedEntries: LedgerEntry[]) {
  const ids = new Set(existingEntries.map((entry) => entry.id));
  const signatures = new Set(existingEntries.flatMap((entry) => [entrySignature(entry), entryLooseSignature(entry)]));
  const accepted: LedgerEntry[] = [];
  const items: Array<{ entry: LedgerEntry; duplicate: boolean }> = [];
  let skipped = 0;

  for (const incoming of importedEntries) {
    const signature = entrySignature(incoming);
    const looseSignature = entryLooseSignature(incoming);
    if ((incoming.id && ids.has(incoming.id)) || signatures.has(signature) || signatures.has(looseSignature)) {
      skipped += 1;
      items.push({ entry: incoming, duplicate: true });
      continue;
    }

    const entry = {
      ...incoming,
      id: incoming.id || randomUUID(),
      updatedAt: incoming.updatedAt || new Date().toISOString()
    };
    ids.add(entry.id);
    signatures.add(signature);
    signatures.add(looseSignature);
    accepted.push(entry);
    items.push({ entry, duplicate: false });
  }

  return { imported: accepted.length, skipped, entries: accepted, items };
}

function normalizeDescription(description: string | undefined, type: string, tableNumber?: string, busNumber?: string): string {
  const trimmed = description?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (type === "Mesa" && tableNumber) {
    return `Mesa ${tableNumber}`;
  }
  if (type === "Onibus" && busNumber) {
    return `Onibus ${busNumber}`;
  }
  return "Venda";
}

function extractNumber(description: string, kind: "mesa" | "onibus"): string {
  const pattern = kind === "mesa" ? /mesa\s*(\d+)/i : /(?:onibus|ônibus)\s*(\d+)/i;
  return description.match(pattern)?.[1] || "";
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

function mergeSettings(defaults: AppSettings, saved: Partial<AppSettings>): AppSettings {
  const merged = {
    ...defaults,
    ...saved,
    floating: {
      ...defaults.floating,
      ...saved.floating,
      visibleFields: mergeFloatingFields(defaults.floating.visibleFields, saved.floating?.visibleFields)
    },
    server: {
      ...defaults.server,
      ...saved.server,
      permissions: {
        ...defaults.server.permissions,
        ...saved.server?.permissions
      }
    },
    shortcuts: {
      ...defaults.shortcuts,
      ...saved.shortcuts
    },
    profiles: {
      ...defaults.profiles,
      ...saved.profiles
    },
    quickTabs: mergeQuickTabs(defaults.quickTabs, saved.quickTabs)
  };

  return {
    ...merged,
    visibleColumns: merged.spreadsheetMode === "simple" ? SIMPLE_COLUMNS : merged.visibleColumns
  };
}

function mergeFloatingFields(defaultFields: string[], savedFields?: string[]): string[] {
  if (!Array.isArray(savedFields) || !savedFields.length) {
    return [...defaultFields];
  }

  const fields = savedFields.filter((field) => typeof field === "string");
  const legacyFields = ["type", "value", "people", "description", "submit"];
  const isLegacyDefault =
    fields.length === legacyFields.length &&
    legacyFields.every((field) => fields.includes(field));

  if (isLegacyDefault) {
    return [...defaultFields];
  }

  return fields.includes("value") ? fields : ["value", ...fields];
}

function mergeQuickTabs(defaultTabs: QuickTabSettings[], savedTabs?: QuickTabSettings[]): QuickTabSettings[] {
  const byId = new Map(defaultTabs.map((tab) => [tab.id, tab]));
  const normalized = Array.isArray(savedTabs)
    ? savedTabs
        .filter((tab) => tab && typeof tab.id === "string")
        .map((tab) => {
          const fallback = byId.get(tab.id) || defaultTabs[0];
          return {
            ...fallback,
            ...tab,
            label: typeof tab.label === "string" && tab.label.trim() ? tab.label.trim() : fallback.label,
            enabled: tab.enabled ?? fallback.enabled,
            type: isEntryType(tab.type) ? tab.type : fallback.type,
            cashLinkedType: isEntryType(tab.cashLinkedType) ? tab.cashLinkedType : fallback.cashLinkedType,
            compact: tab.compact ?? fallback.compact
          };
        })
    : [];
  const seen = new Set(normalized.map((tab) => tab.id));
  return [...normalized, ...defaultTabs.filter((tab) => !seen.has(tab.id))];
}

function isEntryType(value: unknown): value is EntryType {
  return typeof value === "string" && ENTRY_TYPES.includes(value as EntryType);
}

function entrySignature(entry: LedgerEntry): string {
  return [
    entryTimeKey(entry.createdAt),
    entry.type,
    entry.customType || "",
    Math.round(entry.finalValue * 100),
    entry.description.trim().toLowerCase(),
    entry.tableNumber,
    entry.busNumber,
    entry.paymentMethod,
    entry.status
  ].join("|");
}

function entryLooseSignature(entry: LedgerEntry): string {
  return [
    entryTimeKey(entry.createdAt),
    entry.type,
    Math.round(entry.finalValue * 100),
    entry.description.trim().toLowerCase(),
    entry.status
  ].join("|");
}

function entryTimeKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 19);
}
