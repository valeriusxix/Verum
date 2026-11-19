import { NETWORKS } from '@verum/shared';
import { createDb } from './db';
import { loadEnv } from './env';
import { ExplorerClient } from './explorer/client';
import { createExplorerApi } from './explorer/api';
import { logger, setLogLevel } from './log';
import { createRpc } from './rpc';
import type { SyncDeps } from './ingest/sync';

/** Wires env -> db, explorer (throttled), rpc. Shared by the daemon and the CLI commands. */
export const createContext = () => {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  const sql = createDb(env.DATABASE_URL);
  const api = createExplorerApi(new ExplorerClient({ explorer: NETWORKS[env.VERUM_NETWORK].explorer }));
  const rpc = createRpc(env.VERUM_NETWORK);
  const deps: SyncDeps = { sql, api, rpc, log: logger('sync') };
  return { env, sql, api, rpc, deps };
};
