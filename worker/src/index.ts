/**
 * Worker daemon. Day 3: migrations + sync loop.
 * Day 4: rollups, organic filter, cohorts, price ticks. Day 9: attester cron + registry listener.
 *
 *   pnpm --filter @verum/worker start          # run forever
 *   pnpm --filter @verum/worker start --once   # one tick, wait for backfills, exit
 */
import { NETWORKS, SYNC_INTERVAL_MS } from '@verum/shared';
import { createContext } from './context';
import { migrate } from './db/migrate';
import { logger } from './log';
import { Scheduler } from './scheduler';

const log = logger('worker');
const once = process.argv.includes('--once');

const main = async () => {
  const { env, sql, deps } = createContext();
  const { chain, explorer } = NETWORKS[env.VERUM_NETWORK];
  log.info('starting', { chain: chain.id, explorer: explorer.url, once });

  await migrate(sql);
  const scheduler = new Scheduler(deps);

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    clearInterval(timer);
    await scheduler.drain();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };

  await scheduler.tick();
  if (once) {
    await scheduler.drain();
    await sql.end({ timeout: 5 });
    return;
  }
  const timer = setInterval(() => void scheduler.tick(), SYNC_INTERVAL_MS);
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((err) => {
  log.error('fatal', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
