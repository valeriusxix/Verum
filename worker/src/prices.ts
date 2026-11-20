/**
 * Price ticks (§4.3, decided 20 Nov 2026).
 *  - Oracle rounds of QIE/USDT from PRICE_HISTORY_START_ROUND on are stored as ticks
 *    (ts = updatedAt, source 'oracle', round_id) — history once, then new rounds as they appear.
 *  - Every run: if the newest oracle round is older than ORACLE_MAX_AGE_SECONDS, record the
 *    explorer's `coin_price` instead (source 'explorer'), so a stale oracle never sets today's price.
 */
import {
  ORACLE_DECIMALS,
  ORACLE_MAX_AGE_SECONDS,
  ORACLES,
  PRICE_HISTORY_START_ROUND,
  QIE_USD_FEED,
  explorerStatsSchema,
} from '@verum/shared';
import type { Sql } from './db';
import type { ExplorerApi } from './explorer/api';
import type { Logger } from './log';
import type { Rpc } from './rpc';
import type { PriceTick } from './metrics/prices';

const aggregatorAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    type: 'function',
    name: 'getRoundData',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

const FEED = ORACLES[QIE_USD_FEED];
const BATCH = 25;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];
const toPrice = (answer: bigint) => Number(answer) / 10 ** ORACLE_DECIMALS;

export interface PriceDeps {
  sql: Sql;
  rpc: Rpc;
  api: ExplorerApi;
  log: Logger;
}

export const syncPrices = async (d: PriceDeps, nowMs = Date.now()): Promise<{ rounds: number; explorerTick: boolean }> => {
  const latest = (await d.rpc.client.readContract({ address: FEED, abi: aggregatorAbi, functionName: 'latestRoundData' })) as Round;
  const latestId = Number(latest[0]);

  // 1. oracle rounds not stored yet (history from Oct 1 on first run, then only new rounds)
  const [{ max } = { max: null }] = await d.sql<{ max: string | null }[]>`
    select max(round_id)::text as max from price_ticks where source = 'oracle'`;
  const from = Math.max(PRICE_HISTORY_START_ROUND, max === null ? 0 : Number(max) + 1);
  const ids = Array.from({ length: Math.max(0, latestId - from + 1) }, (_, i) => from + i);

  let stored = 0;
  for (let i = 0; i < ids.length; i += BATCH * d.rpc.pool.length) {
    const chunk = ids.slice(i, i + BATCH * d.rpc.pool.length);
    const rounds = await Promise.all(
      chunk.map((id, j) =>
        d.rpc.pool[j % d.rpc.pool.length]!
          .readContract({ address: FEED, abi: aggregatorAbi, functionName: 'getRoundData', args: [BigInt(id)] })
          .then((r) => r as Round)
          .catch(() => null),
      ),
    );
    // Store only the unbroken run before the first failed lookup: max(round_id) is the resume
    // point, so storing anything after a gap would skip the missing round forever.
    const firstGap = rounds.findIndex((r) => r === null);
    const contiguous = (firstGap === -1 ? rounds : rounds.slice(0, firstGap)) as Round[];
    const rows = contiguous
      .filter((r) => r[1] > 0n && r[3] > 0n) // a round with no answer is skipped, not a gap
      .map((r) => ({ ts: new Date(Number(r[3]) * 1000), qie_usd: String(toPrice(r[1])), source: 'oracle', round_id: Number(r[0]) }));
    if (rows.length) {
      await d.sql`insert into price_ticks ${d.sql(rows, 'ts', 'qie_usd', 'source', 'round_id')} on conflict do nothing`;
      stored += rows.length;
    }
    if (firstGap !== -1) {
      d.log.warn('oracle round lookup failed; will resume from it next run', { round: chunk[firstGap] });
      break;
    }
  }

  // 2. stale oracle -> explorer price for now
  const ageS = nowMs / 1000 - Number(latest[3]);
  let explorerTick = false;
  if (ageS > ORACLE_MAX_AGE_SECONDS) {
    const stats = await d.api.client.v2('stats', explorerStatsSchema);
    const p = Number(stats.coin_price);
    if (p > 0) {
      await d.sql`
        insert into price_ticks (ts, qie_usd, source) values (${new Date(nowMs)}, ${String(p)}, 'explorer')
        on conflict do nothing`;
      explorerTick = true;
    }
  }
  if (stored || explorerTick) {
    d.log.info('prices', { oracle_rounds: stored, oracle_age_h: (ageS / 3600).toFixed(1), explorer_tick: explorerTick });
  }
  return { rounds: stored, explorerTick };
};

export const loadPriceTicks = async (sql: Sql): Promise<PriceTick[]> =>
  (await sql<{ ts: Date; qie_usd: string; source: 'oracle' | 'explorer' }[]>`
    select ts, qie_usd::text, source from price_ticks order by ts`).map((r) => ({
    ts: r.ts.getTime(),
    qieUsd: Number(r.qie_usd),
    source: r.source,
  }));
