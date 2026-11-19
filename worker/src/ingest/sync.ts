/**
 * Per-contract sync (§5.1): backfill, then incremental every 2 min, with a 20-block re-org guard.
 *
 * Streams: ext (txlist), int (txlistinternal), token (tokentx, QUSDC only). Each sync reads
 * [from, head], where head = the explorer's indexed head, fixed for the whole run.
 *
 *  - backfill (never synced): stream pages straight into `txs` (ON CONFLICT DO NOTHING). Each stream
 *    resumes from its own max(block) already stored, so a crash costs one page, not the whole history.
 *  - incremental: from = last_synced_block − 19 (re-read the last 20 blocks). Rows are collected, then
 *    ONE transaction deletes this contract's rows in [from, ∞), inserts the fresh set and advances
 *    the cursor. A tx dropped by a re-org disappears; readers never see a half-applied window.
 *    Already-resolved origins are carried over, so they aren't fetched again.
 */
import { REORG_DEPTH_BLOCKS, TXLIST_PAGE_SIZE } from '@verum/shared';
import type { Db, Sql } from '../db';
import type { ExplorerApi } from '../explorer/api';
import type { Priority } from '../explorer/throttle';
import type { Logger } from '../log';
import { fetchOrigins, type Rpc } from '../rpc';
import {
  TX_COLUMNS,
  normalizeExternal,
  normalizeInternal,
  normalizeTokenTransfer,
  rowKey,
  type TxKind,
  type TxRow,
} from './normalize';
import { paginateByBlock } from './paginate';

export interface SyncDeps {
  sql: Sql;
  api: ExplorerApi;
  rpc: Rpc;
  log: Logger;
}

export interface SyncResult {
  address: string;
  mode: 'backfill' | 'incremental' | 'skipped';
  from: number;
  to: number;
  rows: number;
  originsResolved: number;
}

const INSERT_CHUNK = 1000; // 15 columns -> 15k params, well under Postgres' 65,535 limit
const ORIGIN_SCAN_LIMIT = 2000;

interface Stream {
  kind: TxKind;
  fetch: (startblock: number) => Promise<TxRow[]>;
}

const streamsFor = (api: ExplorerApi, address: string, endblock: number, priority: Priority): Stream[] => [
  {
    kind: 'ext',
    fetch: async (sb) =>
      (await api.txlist(address, { startblock: sb, endblock }, { priority })).map((r) => normalizeExternal(r, address)),
  },
  {
    kind: 'int',
    fetch: async (sb) =>
      (await api.txlistInternal(address, { startblock: sb, endblock }, { priority })).map((r) =>
        normalizeInternal(r, address),
      ),
  },
  {
    kind: 'token',
    fetch: async (sb) =>
      (await api.qusdcTransfers(address, { startblock: sb, endblock }, { priority })).map((r) =>
        normalizeTokenTransfer(r, address),
      ),
  },
];

export const insertRows = async (sql: Db, rows: readonly TxRow[]): Promise<void> => {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await sql`insert into txs ${sql(chunk as TxRow[], ...TX_COLUMNS)} on conflict do nothing`;
  }
};

const setProgress = async (
  sql: Db,
  address: string,
  p: { status: 'queued' | 'backfilling' | 'synced' | 'error'; cursor?: number | null; head?: number; progress?: number; error?: string | null },
) => {
  await sql`
    insert into sync_progress (contract, status, cursor_block, head_block, progress, error, updated_at)
    values (${address}, ${p.status}, ${p.cursor ?? null}, ${p.head ?? null}, ${p.progress ?? 0}, ${p.error ?? null}, now())
    on conflict (contract) do update set
      status = excluded.status,
      cursor_block = coalesce(excluded.cursor_block, sync_progress.cursor_block),
      head_block = coalesce(excluded.head_block, sync_progress.head_block),
      progress = excluded.progress,
      error = excluded.error,
      updated_at = now()`;
};

/** Fills creator / verified from the explorer once per contract (used for ownership checks, §6). */
const ensureMeta = async (d: SyncDeps, address: string, priority: Priority): Promise<boolean> => {
  const [c] = await d.sql<{ creator_address: string | null }[]>`
    select creator_address from contracts where address = ${address}`;
  if (c?.creator_address) return true;
  const info = await d.api.address(address, { priority });
  if (!info.is_contract) {
    await setProgress(d.sql, address, { status: 'error', error: 'address is not a contract' });
    d.log.warn('not a contract; skipping', { address });
    return false;
  }
  await d.sql`
    update contracts
    set creator_address = ${info.creator_address_hash?.toLowerCase() ?? null},
        verified = ${info.is_verified ?? false}
    where address = ${address}`;
  return true;
};

export const syncContract = async (
  d: SyncDeps,
  address: string,
  head: number,
  priority: Priority = 'normal',
): Promise<SyncResult> => {
  const [c] = await d.sql<{ last_synced_block: string | null }[]>`
    select last_synced_block from contracts where address = ${address}`;
  if (!c) throw new Error(`contract ${address} is not tracked`);
  const last = c.last_synced_block === null ? null : Number(c.last_synced_block);

  if (last !== null && last >= head) {
    return { address, mode: 'skipped', from: last, to: head, rows: 0, originsResolved: 0 };
  }
  if (!(await ensureMeta(d, address, priority))) {
    return { address, mode: 'skipped', from: 0, to: head, rows: 0, originsResolved: 0 };
  }

  const result =
    last === null ? await backfill(d, address, head, priority) : await incremental(d, address, last, head, priority);
  result.originsResolved = await resolveOrigins(d, address);
  return result;
};

const backfill = async (d: SyncDeps, address: string, head: number, priority: Priority): Promise<SyncResult> => {
  const log = d.log;
  const streams = streamsFor(d.api, address, head, priority);
  let total = 0;
  log.info('backfill start', { address, head });
  await setProgress(d.sql, address, { status: 'backfilling', head, progress: 0 });

  try {
    for (const [i, s] of streams.entries()) {
      const [{ max } = { max: null }] = await d.sql<{ max: string | null }[]>`
        select max(block)::text as max from txs where contract = ${address} and kind = ${s.kind}`;
      const resumeFrom = max === null ? 0 : Number(max); // re-read the last stored block
      let base: number | null = null; // first block this stream returns: progress is measured from here

      for await (const rows of paginateByBlock({
        startblock: resumeFrom,
        pageSize: TXLIST_PAGE_SIZE,
        fetchPage: s.fetch,
        blockOf: (r) => r.block,
        log,
      })) {
        await insertRows(d.sql, rows);
        total += rows.length;
        const cursor = rows[rows.length - 1]!.block;
        base ??= rows[0]!.block;
        // Streams run one after another: each is a third of the bar.
        const within = head > base ? (cursor - base) / (head - base) : 1;
        const progress = Math.min(0.99, (i + Math.min(1, within)) / streams.length);
        await setProgress(d.sql, address, { status: 'backfilling', cursor, head, progress });
        log.info('backfill page', { address, kind: s.kind, rows: rows.length, cursor });
      }
    }

    await d.sql.begin(async (tx) => {
      await tx`
        update contracts set
          last_synced_block = ${head},
          first_block = coalesce(first_block, (select min(block) from txs where contract = ${address}))
        where address = ${address}`;
      await setProgress(tx, address, { status: 'synced', cursor: head, head, progress: 1 });
    });
  } catch (err) {
    await setProgress(d.sql, address, { status: 'error', error: errMsg(err) });
    throw err;
  }
  log.info('backfill done', { address, rows: total, head });
  return { address, mode: 'backfill', from: 0, to: head, rows: total, originsResolved: 0 };
};

const incremental = async (
  d: SyncDeps,
  address: string,
  last: number,
  head: number,
  priority: Priority,
): Promise<SyncResult> => {
  const from = Math.max(0, last - REORG_DEPTH_BLOCKS + 1);
  const fresh = new Map<string, TxRow>();
  for (const s of streamsFor(d.api, address, head, priority)) {
    for await (const rows of paginateByBlock({
      startblock: from,
      pageSize: TXLIST_PAGE_SIZE,
      fetchPage: s.fetch,
      blockOf: (r) => r.block,
      log: d.log,
    })) {
      for (const r of rows) fresh.set(rowKey(r), r); // de-dupes re-read blocks
    }
  }

  await d.sql.begin(async (tx) => {
    // Keep origins we already paid for.
    const known = await tx<{ hash: string; origin_addr: string }[]>`
      select distinct hash, origin_addr from txs
      where contract = ${address} and kind = 'int' and block >= ${from} and origin_addr is not null`;
    const originByHash = new Map(known.map((k) => [k.hash, k.origin_addr]));
    const rows = [...fresh.values()].map((r) =>
      r.kind === 'int' && r.origin_addr === null ? { ...r, origin_addr: originByHash.get(r.hash) ?? null } : r,
    );

    await tx`delete from txs where contract = ${address} and block >= ${from}`;
    await insertRows(tx, rows);
    await tx`update contracts set last_synced_block = ${head} where address = ${address}`;
    await setProgress(tx, address, { status: 'synced', cursor: head, head, progress: 1 });
  });

  if (fresh.size > 0) d.log.info('incremental', { address, from, to: head, rows: fresh.size });
  return { address, mode: 'incremental', from, to: head, rows: fresh.size, originsResolved: 0 };
};

/**
 * Top-level senders for internal txs (decided 19 Nov 2026), via batched JSON-RPC. One lookup per
 * hash also fills every other tracked contract's rows for that tx. Failures are logged and retried
 * on the next sync; they never fail the sync itself.
 */
export const resolveOrigins = async (d: SyncDeps, address: string): Promise<number> => {
  let resolved = 0;
  try {
    for (;;) {
      const pending = await d.sql<{ hash: string }[]>`
        select distinct hash from txs
        where contract = ${address} and kind = 'int' and origin_addr is null
        limit ${ORIGIN_SCAN_LIMIT}`;
      if (pending.length === 0) break;

      const origins = await fetchOrigins(d.rpc, pending.map((p) => p.hash));
      if (origins.size === 0) {
        d.log.warn('origin lookup returned nothing', { address, pending: pending.length });
        break;
      }
      const pairs = [...origins.entries()];
      await d.sql`
        update txs set origin_addr = v.origin
        from (values ${d.sql(pairs)}) as v (hash, origin)
        where txs.hash = v.hash and txs.kind = 'int' and txs.origin_addr is null`;
      resolved += pairs.length;
      if (origins.size < pending.length) break; // unknown hashes: retry next sync, don't spin
    }
  } catch (err) {
    d.log.warn('origin lookup failed; will retry next sync', { address, error: errMsg(err) });
  }
  return resolved;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
