import type { Clock } from '../src/explorer/throttle';

/** Deterministic clock: time only moves when someone sleeps. */
export class FakeClock implements Clock {
  t = 0;
  readonly sleeps: number[] = [];
  now = () => this.t;
  sleep = async (ms: number) => {
    this.sleeps.push(ms);
    // Let already-scheduled callbacks run at the current time before time moves on.
    await new Promise((r) => setImmediate(r));
    this.t += ms;
  };
}

export const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
