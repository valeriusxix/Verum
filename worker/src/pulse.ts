/**
 * Chain pulse (§8 /v1/chain/pulse; definition chosen by the owner 20 Nov 2026):
 *  - txs_today: counted by the worker over RPC, block by block since 00:00 UTC, incrementally (the
 *    explorer's `transactions_today` is the PREVIOUS complete day, verified 20 Nov 2026);
 *  - real_share: share of today's txs NOT involving known system addresses (§4.5). Wallet-level
 *    organic filtering isn't possible chain-wide, so this is labelled "real-activity share";
 *  - QIE price: oracle if younger than 6 h, else explorer (§4.3), with its source;
 *  - oracle health: all 7 feeds, with age and staleness.
 */
import {
  KNOWN_SYSTEM_ADDRESSES,
  ORACLE_DECIMALS,
  ORACLE_MAX_AGE_SECONDS,
  ORACLES,
  QIE_USD_FEED,
  explorerStatsSchema,
} from '@verum/shared';
import { z } from 'zod';
import type { Sql } from './db';
import type { ExplorerApi } from './explorer/api';
import type { Logger } from './log';
import { DAY_MS, dayKey, dayIndex } from './metrics/model';
import type { Rpc } from './rpc';

const latestRoundAbi = [
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
] as const;

const blockByTimeSchema = z.object({
  status: z.literal('1'),
  result: z.object({ blockNumber: z.string().regex(/^\d+$/) }),
});

export interface OracleHealth {
  feed: string;
  address: string;
  answer: string | null;
  updated_at: string | null;
  age_seconds: number | null;
  stale: boolean;
}

export interface PulseDeps {
  sql: Sql;
  rpc: Rpc;
  api: ExplorerApi;
  log: Logger;
}

export const oracleHealth = async (rpc: Rpc, nowMs: number): Promise<OracleHealth[]> =>
  Promise.all(
    Object.entries(ORACLES).map(async ([feed, address]) => {
      try {
        const r = await rpc.client.readContract({ address, abi: latestRoundAbi, functionName: 'latestRoundData' });
        const updated = Number(r[3]);
        const age = Math.max(0, Math.round(nowMs / 1000 - updated));
        return {
          feed,
          address: address.toLowerCase(),
          answer: String(Number(r[1]) / 10 ** ORACLE_DECIMALS),
          updated_at: new Date(updated * 1000).toISOString(),
          age_seconds: age,
          stale: age > ORACLE_MAX_AGE_SECONDS,
        };
      } catch {
        return { feed, address: address.toLowerCase(), answer: null, updated_at: null, age_seconds: null, stale: true };
      }
    }),
  );

/** Sum of tx counts for blocks [from, to], spread over the RPC pool. */
const countTxs = async (rpc: Rpc, from: number, to: number): Promise<number> => {
  let total = 0;
  const pool = rpc.pool;
  for (let b = from; b <= to; b += 250) {
    const chunk = Array.from({ length: Math.min(250, to - b + 1) }, (_, i) => b + i);
    const counts = await Promise.all(chunk.map((n, j) => pool[j % pool.length]!.getBlockTransactionCount({ blockNumber: BigInt(n) })));
    total += counts.reduce((s, x) => s + x, 0);
  }
  return total;
};

export const syncPulse = async (d: PulseDeps, nowMs = Date.now()) => {
  const today = dayIndex(nowMs);
  const dayStartS = (today * DAY_MS) / 1000;

  // Both counts run to the explorer's indexed head, so they cover the same blocks.
  const head = await d.api.indexedHead();
  const [prev] = await d.sql<{ day_start_block: string; last_block: string; txs_today: number }[]>`
    select day_start_block::text, last_block::text, txs_today from chain_pulse
    where day = ${dayKey(today)} and last_block is not null order by ts desc limit 1`;
  let startblock: number;
  let txsToday: number;
  if (prev) {
    // Same UTC day: count only the blocks since the last pulse.
    startblock = Number(prev.day_start_block);
    const last = Number(prev.last_block);
    txsToday = prev.txs_today + (head > last ? await countTxs(d.rpc, last + 1, head) : 0);
  } else {
    const block = await d.api.client.v1(
      { module: 'block', action: 'getblocknobytime', timestamp: dayStartS, closest: 'after' },
      blockByTimeSchema,
    );
    startblock = Number(block.result.blockNumber);
    txsToday = await countTxs(d.rpc, startblock, head);
  }
  const stats = await d.api.client.v2('stats', explorerStatsSchema); // coin_price fallback only
  let systemTxs = 0;
  for (const addr of KNOWN_SYSTEM_ADDRESSES) {
    // ~500–700 a day: one page. Paginate anyway in case a day ever exceeds it.
    const seen = new Set<string>();
    let sb = startblock;
    for (;;) {
      const rows = await d.api.txlist(addr, { startblock: sb, endblock: head });
      rows.forEach((r) => seen.add(r.hash.toLowerCase()));
      if (rows.length < 10_000) break;
      sb = Number(rows.at(-1)!.blockNumber);
    }
    systemTxs += seen.size;
  }

  const health = await oracleHealth(d.rpc, nowMs);
  const qie = health.find((h) => h.feed === QIE_USD_FEED)!;
  const useOracle = !qie.stale && qie.answer !== null;
  const qieUsd = useOracle ? qie.answer : stats.coin_price;
  const priceSource = useOracle ? 'oracle' : stats.coin_price ? 'explorer' : null;

  const row = {
    ts: new Date(nowMs),
    day: dayKey(today),
    txs_today: txsToday,
    system_txs_today: systemTxs,
    day_start_block: startblock,
    last_block: head,
    real_share: txsToday > 0 ? Math.max(0, 1 - systemTxs / txsToday) : null,
    qie_usd: qieUsd,
    price_source: priceSource,
    oracle_health: d.sql.json(health as unknown as postgresJson),
  };
  await d.sql`insert into chain_pulse ${d.sql(row)} on conflict (ts) do nothing`;
  d.log.info('pulse', {
    txs_today: txsToday,
    system: systemTxs,
    real_share: row.real_share?.toFixed(3),
    qie_usd: qieUsd,
    price_source: priceSource,
    stale_feeds: health.filter((h) => h.stale).map((h) => h.feed).join(',') || 'none',
  });
  return row;
};

type postgresJson = Parameters<Sql['json']>[0];
