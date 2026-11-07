/** Janela movel simples para medir duracoes e tamanhos sem guardar historico grande. */
export class RollingMeter {
  private values: number[] = [];
  count = 0;
  last = 0;
  max = 0;
  lastAt?: string;

  constructor(private readonly size = 50) {}

  add(value: number) {
    this.count += 1;
    this.last = value;
    this.max = Math.max(this.max, value);
    this.lastAt = new Date().toISOString();
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
  }

  get average(): number {
    return this.values.length ? this.values.reduce((sum, value) => sum + value, 0) / this.values.length : 0;
  }
}
