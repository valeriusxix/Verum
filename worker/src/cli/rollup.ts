/** One price sync + metrics rollup, without syncing transactions: `pnpm --filter @verum/worker rollup`. */
import { createContext } from '../context';
import { logger } from '../log';
import { syncPrices } from '../prices';
import { syncPulse } from '../pulse';
import { rollupAll } from '../rollup';

const { sql, api, rpc } = createContext();
try {
  await syncPrices({ sql, rpc, api, log: logger('prices') });
  await rollupAll({ sql, rpc, log: logger('rollup') }, Date.now(), { force: process.argv.includes('--force') });
  await syncPulse({ sql, rpc, api, log: logger('pulse') });
} finally {
  await sql.end({ timeout: 5 });
}
