/**
 * One global request queue for the explorer (§5.1): at most `ratePerSec` request starts per second,
 * two priority lanes. `high` (new registrations) always goes before `normal`, which is how new
 * registrations "jump the queue".
 */
export type Priority = 'high' | 'normal';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class RateLimiter {
  private readonly lanes: Record<Priority, Array<() => void>> = { high: [], normal: [] };
  private readonly intervalMs: number;
  private nextStartAt = 0;
  private pumping = false;

  constructor(
    ratePerSec: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (!(ratePerSec > 0)) throw new Error('ratePerSec must be > 0');
    this.intervalMs = 1000 / ratePerSec;
  }

  /** Resolves when the caller may start one request. */
  acquire(priority: Priority = 'normal'): Promise<void> {
    return new Promise((resolve) => {
      this.lanes[priority].push(resolve);
      void this.pump();
    });
  }

  get pending(): number {
    return this.lanes.high.length + this.lanes.normal.length;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending > 0) {
        const wait = this.nextStartAt - this.clock.now();
        // Sleep BEFORE picking the next waiter, so a `high` request that arrives meanwhile still wins.
        if (wait > 0) await this.clock.sleep(wait);
        const next = this.lanes.high.shift() ?? this.lanes.normal.shift();
        if (!next) break;
        this.nextStartAt = Math.max(this.clock.now(), this.nextStartAt) + this.intervalMs;
        next();
      }
    } finally {
      this.pumping = false;
    }
  }
}
