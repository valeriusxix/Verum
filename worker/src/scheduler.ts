/**
 * Sync scheduler (§3, §5.1): every 2 min, sync every tracked contract.
 *  - never-synced contracts are backfills: priority `high` (new registrations jump the queue),
 *    at most MAX_CONCURRENT_BACKFILLS at once, running in the background across ticks.
 *  - synced contracts get an incremental sync each tick.
 *  - a contract is never synced twice at the same time.
 */
import { MAX_CONCURRENT_BACKFILLS } from '@verum/shared';
import { syncContract, type SyncDeps } from './ingest/sync';

export class Scheduler {
  private readonly inFlight = new Set<string>();
  private backfills = 0;
  private ticking = false;

  constructor(private readonly d: SyncDeps) {}

  /** One pass. Resolves when the incremental syncs are done; backfills keep running. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const head = await this.d.api.indexedHead({ priority: 'high' });
      const contracts = await this.d.sql<{ address: string; last_synced_block: string | null }[]>`
        select address, last_synced_block from contracts order by last_synced_block nulls first, address`;

      for (const c of contracts) {
        if (c.last_synced_block !== null || this.inFlight.has(c.address)) continue;
        if (this.backfills >= MAX_CONCURRENT_BACKFILLS) break;
        this.backfills++;
        void this.run(c.address, head, 'high').finally(() => this.backfills--);
      }

      for (const c of contracts) {
        if (c.last_synced_block === null || this.inFlight.has(c.address)) continue;
        await this.run(c.address, head, 'normal');
      }
    } catch (err) {
      this.d.log.error('tick failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.ticking = false;
    }
  }

  /** Waits for all running syncs (used by `--once` and shutdown). */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await new Promise((r) => setTimeout(r, 250));
  }

  private async run(address: string, head: number, priority: 'high' | 'normal'): Promise<void> {
    this.inFlight.add(address);
    try {
      await syncContract(this.d, address, head, priority);
    } catch (err) {
      this.d.log.error('sync failed', { address, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.inFlight.delete(address);
    }
  }
}
