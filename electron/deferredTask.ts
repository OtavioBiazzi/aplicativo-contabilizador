/** Coalesces derived work; durable mutations have already completed before scheduling. */
export class DeferredTask {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private running: Promise<void> | undefined;

  constructor(private readonly task: () => Promise<void>, private readonly delay = 200) {}

  schedule() {
    this.pending = true;
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delay);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) return this.running;
    const run = async () => {
      while (this.pending) {
        this.pending = false;
        await this.task();
      }
    };
    this.running = run();
    try { await this.running; }
    finally { this.running = undefined; }
  }
}
