import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DiagnosticLogItem } from "../src/shared/types.js";

const LOG_FILE = "diagnostics.ndjson";
const MAX_LOG_ITEMS = 120;

export class DiagnosticLogger {
  private readonly filePath: string;

  constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, LOG_FILE);
  }

  async info(message: string, detail?: string) {
    await this.write("info", message, detail);
  }

  async warn(message: string, detail?: string) {
    await this.write("warn", message, detail);
  }

  async error(message: string, detail?: string) {
    await this.write("error", message, detail);
  }

  async list(limit = MAX_LOG_ITEMS): Promise<DiagnosticLogItem[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DiagnosticLogItem)
        .slice(-limit)
        .reverse();
    } catch {
      return [];
    }
  }

  private async write(level: DiagnosticLogItem["level"], message: string, detail?: string) {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    const item: DiagnosticLogItem = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      level,
      message,
      detail
    };
    await fs.appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    await this.trim();
  }

  private async trim() {
    try {
      const items = await this.list(MAX_LOG_ITEMS * 2);
      const chronological = items.reverse().slice(-MAX_LOG_ITEMS);
      await fs.writeFile(this.filePath, `${chronological.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    } catch {
      // Logging must never block caixa operations.
    }
  }
}
