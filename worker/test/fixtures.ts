/**
 * Real mainnet fixture (spec §12), frozen 20 Nov 2026 at block 12,046,129: 23,846 normalized `txs`
 * rows for QUSDC, the QIEDEX router, WQIE and the WQIE/QUSDC pair, plus everything the metrics
 * pipeline reads (projects, price ticks, cached chain tx counts) and the rollup's as-of time.
 * At capture, the stored rollup output for this state matched independent SQL exactly.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { TxRow } from '../src/ingest/normalize';
import type { PriceTick } from '../src/metrics/prices';

export interface FixtureContract {
  address: string;
  label: string | null;
  creator_address: string | null;
  verified: boolean | null;
  first_block: number | null;
  last_synced_block: number;
  project: string | null;
}

export interface MainnetFixture {
  meta: { source: string; captured_at: string; as_of: string; synced_to_blocks: number[]; note: string };
  projects: { id: number; slug: string; owner_address: string | null }[];
  contracts: FixtureContract[];
  rows: TxRow[];
  priceTicks: PriceTick[];
  chainTxCounts: Map<string, number>;
}

interface RawFixture {
  meta: MainnetFixture['meta'];
  projects: MainnetFixture['projects'];
  contracts: FixtureContract[];
  columns: (keyof TxRow)[];
  rows: unknown[][];
  price_ticks: { ts: string; qie_usd: string; source: 'oracle' | 'explorer' }[];
  chain_tx_counts: Record<string, number>;
}

let cached: MainnetFixture | undefined;

export const loadMainnetFixture = (): MainnetFixture => {
  if (cached) return cached;
  const path = fileURLToPath(new URL('./fixtures/mainnet-2026-11-20.json.gz', import.meta.url));
  const raw = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as RawFixture;
  const rows = raw.rows.map((values) => {
    const r = Object.fromEntries(raw.columns.map((c, i) => [c, values[i]])) as Record<string, unknown>;
    return { ...r, block: Number(r.block), ts: new Date(r.ts as string) } as unknown as TxRow;
  });
  cached = {
    meta: raw.meta,
    projects: raw.projects,
    contracts: raw.contracts,
    rows,
    priceTicks: raw.price_ticks.map((t) => ({ ts: Date.parse(t.ts), qieUsd: Number(t.qie_usd), source: t.source })),
    chainTxCounts: new Map(Object.entries(raw.chain_tx_counts)),
  };
  return cached;
};
