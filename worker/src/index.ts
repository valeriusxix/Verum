/**
 * Worker daemon (§3): sync every 2 min; prices + metrics rollup every 10 min.
 * Day 9: attester cron + registry listener.
 *
 *   pnpm --filter @verum/worker start          # run forever
 *   pnpm --filter @verum/worker start --once   # sync (incl. backfills), prices, rollup; then exit
 */
import { NETWORKS, ROLLUP_INTERVAL_MS, SYNC_INTERVAL_MS } from '@verum/shared';
import { createContext } from './context';
import { migrate } from './db/migrate';
import { logger } from './log';
import { syncPrices } from './prices';
import { rollupAll } from './rollup';
import { Scheduler } from './scheduler';

const log = logger('worker');
const once = process.argv.includes('--once');

const main = async () => {
  const { env, sql, api, rpc, deps } = createContext();
  const { chain, explorer } = NETWORKS[env.VERUM_NETWORK];
  log.info('starting', { chain: chain.id, explorer: explorer.url, once });

  await migrate(sql);
  const scheduler = new Scheduler(deps);

  let rolling = false;
  const rollup = async () => {
    if (rolling) return;
    rolling = true;
    try {
      await syncPrices({ sql, rpc, api, log: logger('prices') }).catch((err) =>
        log.error('price sync failed', { error: err instanceof Error ? err.message : String(err) }),
      );
      await rollupAll({ sql, rpc, log: logger('rollup') });
    } finally {
      rolling = false;
    }
  };

  await scheduler.tick();
  if (once) {
    await scheduler.drain();
    await rollup();
    await sql.end({ timeout: 5 });
    return;
  }
  void rollup();
  const syncTimer = setInterval(() => void scheduler.tick(), SYNC_INTERVAL_MS);
  const rollupTimer = setInterval(() => void rollup(), ROLLUP_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    clearInterval(syncTimer);
    clearInterval(rollupTimer);
    await scheduler.drain();
    while (rolling) await new Promise((r) => setTimeout(r, 250));
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((err) => {
  log.error('fatal', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
