import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Lembretes de comanda confirmados em OK. O aviso pela rede vale so para quem estava conectado na hora;
 * esta lista fica no servidor para que um computador que estava desconectado (reconectando, dormindo,
 * app fechado) tambem remova o lembrete quando voltar.
 */
export class CloseNoticeAcks {
  private ids: string[] = [];
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string, private readonly limit = 2000) {}

  private get file() { return path.join(this.dataDirectory, "close-notice-acks.json"); }

  async load(): Promise<string[]> {
    if (!this.loaded) {
      try {
        const value = JSON.parse(await fs.readFile(this.file, "utf8"));
        this.ids = Array.isArray(value) ? value.filter((id) => typeof id === "string" && id.length <= 200).slice(-this.limit) : [];
      } catch {
        this.ids = [];
      }
      this.loaded = true;
    }
    return [...this.ids];
  }

  async add(id: string): Promise<void> {
    await this.load();
    if (this.ids.includes(id)) return;
    this.ids = [...this.ids, id].slice(-this.limit);
    const snapshot = JSON.stringify(this.ids);
    // Escritas em fila e atomicas (arquivo temporario + rename) para nunca deixar o arquivo pela metade.
    this.writing = this.writing.then(async () => {
      const temp = `${this.file}.tmp`;
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, this.file);
    }).catch(() => undefined);
    await this.writing;
  }
}
