/**
 * Metrics rollup (§3: every 10 min). For each project whose contracts are all synced:
 * load rows -> ProjectTx[] -> flags -> daily_metrics, cohorts, wallet_flags, project_stats,
 * written in one transaction per project so readers never see a half-updated project.
 */
import type { Address } from 'viem';
import type { Sql } from './db';
import type { TxRow } from './ingest/normalize';
import type { Logger } from './log';
import { cohorts, dailyMetrics, organicSet, summarize } from './metrics/compute';
import { computeFlags, freshSingleCandidates } from './metrics/flags';
import { buildProjectTxs, dayIndex } from './metrics/model';
import { dayPrices } from './metrics/prices';
import { loadPriceTicks } from './prices';
import type { Rpc } from './rpc';

const CHAIN_STATS_TTL_MS = 24 * 3_600_000;
/** Recompute an unchanged project at least this often, so rolling windows (WAU, 30d) move with time. */
const STALE_ROLLUP_MS = 60 * 60_000;
const WRITE_ATTEMPTS = 3;

/** Columns the metrics read: no contract / gas_used, so less data crosses the wire. */
const METRIC_COLUMNS = ['hash', 'kind', 'log_index', 'block', 'ts', 'from_addr', 'to_addr', 'origin_addr', 'nonce', 'selector',
  'value_wei', 'token', 'token_amount', 'success'] as const;

const isConnectionError = (err: unknown) =>
  /CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|ECONNRESET|EPIPE|ETIMEDOUT/.test(err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : String(err));

export interface RollupDeps {
  sql: Sql;
  rpc: Rpc;
  log: Logger;
}

/** Chain-wide sent-tx counts for fresh_single candidates, cached for 24 h in wallet_chain_stats. */
const chainTxCounts = async (d: RollupDeps, wallets: string[], nowMs: number): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  if (wallets.length === 0) return out;
  const cached = await d.sql<{ address: string; tx_count: string; checked_at: Date }[]>`
    select address, tx_count::text, checked_at from wallet_chain_stats where address in ${d.sql(wallets)}`;
  for (const c of cached) if (nowMs - c.checked_at.getTime() < CHAIN_STATS_TTL_MS) out.set(c.address, Number(c.tx_count));

  const todo = wallets.filter((w) => !out.has(w));
  const pool = d.rpc.pool;
  const fresh: { address: string; tx_count: number }[] = [];
  for (let i = 0; i < todo.length; i += 25 * pool.length) {
    const chunk = todo.slice(i, i + 25 * pool.length);
    const counts = await Promise.all(
      chunk.map((w, j) => pool[j % pool.length]!.getTransactionCount({ address: w as Address }).catch(() => null)),
    );
    counts.forEach((n, j) => {
      if (n === null) return; // lookup failed: not fresh_single this round, retried next rollup
      out.set(chunk[j]!, n);
      fresh.push({ address: chunk[j]!, tx_count: n });
    });
  }
  if (fresh.length) {
    await d.sql`
      insert into wallet_chain_stats ${d.sql(fresh, 'address', 'tx_count')}
      on conflict (address) do update set tx_count = excluded.tx_count, checked_at = now()`;
  }
  return out;
};

/**
 * Run one DB step, retrying on a dropped connection (postgres.js discards the broken connection, so
 * the retry gets a fresh one). Every step here is safe to repeat: reads are idempotent and the
 * write is a single transaction. Seen 20 Nov on a slow link: after a long load, the NEXT query —
 * read or write — could hit a closed connection.
 */
const withConnRetry = async <T,>(d: RollupDeps, step: string, fn: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= WRITE_ATTEMPTS || !isConnectionError(err)) throw err;
      d.log.warn('rollup: connection dropped; retrying', { step, attempt });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
};

const LOAD_CHUNK = 3000;

/**
 * A project's rows, de-duplicated across its contracts (the same internal call / transfer is stored
 * once per tracked contract), loaded in short keyset pages. One long transfer kept dying ~70 s in on
 * a slow link (20 Nov); short pages are each retried on their own, so a drop costs one page.
 */
const loadRows = async (d: RollupDeps, addresses: string[]): Promise<TxRow[]> => {
  const out: TxRow[] = [];
  let after: [string, string, number] | null = null;
  for (;;) {
    const cursor = after;
    const page = (await withConnRetry(d, 'load', () =>
      d.sql.unsafe(
        `select distinct on (hash, kind, log_index) ${METRIC_COLUMNS.join(', ')} from txs
         where contract = any($1) ${cursor ? 'and (hash, kind, log_index) > ($2, $3, $4)' : ''}
         order by hash, kind, log_index limit ${LOAD_CHUNK}`,
        cursor ? [addresses, ...cursor] : [addresses],
      ),
    )) as unknown as TxRow[];
    out.push(...page);
    if (page.length < LOAD_CHUNK) return out;
    const last = page[page.length - 1]!;
    after = [last.hash, last.kind, last.log_index];
  }
};

export const rollupProject = async (d: RollupDeps, projectId: number, nowMs = Date.now(), opts: { force?: boolean } = {}) => {
  const contracts = await d.sql<{ address: string; creator_address: string | null; last_synced_block: string | null }[]>`
    select address, creator_address, last_synced_block::text from contracts where project_id = ${projectId}`;
  if (contracts.length === 0 || contracts.some((c) => c.last_synced_block === null)) return null; // still backfilling
  const [project] = await d.sql<{ owner_address: string | null; slug: string }[]>`
    select owner_address, slug from projects where id = ${projectId}`;
  const lastBlock = Math.max(...contracts.map((c) => Number(c.last_synced_block)));

  // Skip if nothing new was synced and the last rollup is recent (the windows barely moved).
  const [prev] = await d.sql<{ last_block: string | null; as_of: Date }[]>`
    select last_block::text, as_of from project_stats where project_id = ${projectId}`;
  if (!opts.force && prev && Number(prev.last_block) === lastBlock && nowMs - prev.as_of.getTime() < STALE_ROLLUP_MS) {
    return null;
  }

  const addresses = contracts.map((c) => c.address);
  // The same internal call / transfer is stored once per tracked contract: de-dupe in SQL.
  const rows = await loadRows(d, addresses);
  const txs = buildProjectTxs(
    rows.map((r) => ({ ...r, block: Number(r.block), nonce: r.nonce === null ? null : Number(r.nonce) })),
    new Set(addresses),
  );

  const creators = new Map<string, string>();
  for (const c of contracts) if (c.creator_address) creators.set(c.creator_address, c.address);
  const chainTxCount = await withConnRetry(d, 'chain tx counts', () => chainTxCounts(d, [...new Set(freshSingleCandidates(txs))], nowMs));
  const flags = computeFlags({ txs, creators, owner: project?.owner_address ?? null, teamWallets: [], chainTxCount });
  const organic = organicSet(txs, flags);

  const firstDay = txs[0]?.day ?? dayIndex(nowMs);
  const prices = dayPrices(await withConnRetry(d, 'price ticks', () => loadPriceTicks(d.sql)), firstDay, dayIndex(nowMs));
  const daily = dailyMetrics(txs, organic, prices, nowMs);
  const cohortRows = cohorts(txs, organic, nowMs);
  const summary = summarize(txs, flags, organic, cohortRows, prices, nowMs);

  await withConnRetry(d, 'write', () => writeRollup(d, projectId, nowMs, lastBlock, daily, cohortRows, flags, summary));

  d.log.info('rollup', {
    project: project?.slug,
    txs: txs.length,
    wallets: summary.cumulative_wallets,
    organic: summary.cumulative_organic,
    score: summary.verum_score?.toFixed(1),
    provisional: summary.score_provisional,
  });
  return summary;
};

const writeRollup = async (
  d: RollupDeps,
  projectId: number,
  nowMs: number,
  lastBlock: number,
  daily: ReturnType<typeof dailyMetrics>,
  cohortRows: ReturnType<typeof cohorts>,
  flags: ReturnType<typeof computeFlags>,
  summary: ReturnType<typeof summarize>,
) => {
  await d.sql.begin(async (tx) => {
    await tx`delete from daily_metrics where project_id = ${projectId}`;
    if (daily.length) await tx`insert into daily_metrics ${tx(daily.map((r) => ({ project_id: projectId, ...r })))}`;
    await tx`delete from cohorts where project_id = ${projectId}`;
    if (cohortRows.length) await tx`insert into cohorts ${tx(cohortRows.map((r) => ({ project_id: projectId, ...r })))}`;
    await tx`delete from wallet_flags where project_id = ${projectId}`;
    const flagRows = [...flags].flatMap(([address, m]) => [...m].map(([flag, reason]) => ({ address, project_id: projectId, flag, reason })));
    for (let i = 0; i < flagRows.length; i += 2000) await tx`insert into wallet_flags ${tx(flagRows.slice(i, i + 2000))}`;
    const stats = {
      project_id: projectId,
      as_of: new Date(nowMs),
      last_block: lastBlock,
      ...summary,
      flag_counts: tx.json(summary.flag_counts),
      top_methods: tx.json(summary.top_methods),
    };
    await tx`
      insert into project_stats ${tx(stats)}
      on conflict (project_id) do update set ${tx(stats, Object.keys(stats).filter((k) => k !== 'project_id') as (keyof typeof stats)[])}`;
  });
};

export const rollupAll = async (d: RollupDeps, nowMs = Date.now(), opts: { force?: boolean } = {}) => {
  const projects = await d.sql<{ id: number }[]>`select id from projects order by id`;
  for (const p of projects) {
    try {
      await rollupProject(d, p.id, nowMs, opts);
    } catch (err) {
      d.log.error('rollup failed', { project_id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
};
