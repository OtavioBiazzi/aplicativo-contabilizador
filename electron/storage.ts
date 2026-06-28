import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createDefaultSettings } from "../src/shared/defaults.js";
import { calculateCash, roundMoney } from "../src/shared/calculations.js";
import type { AppSettings, EntryDraft, LedgerEntry } from "../src/shared/types.js";

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
  return {
    ...defaults,
    ...saved,
    floating: {
      ...defaults.floating,
      ...saved.floating
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
    }
  };
}
