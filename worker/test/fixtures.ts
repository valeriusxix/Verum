/**
 * Real mainnet fixture (spec §12): 23,840 normalized `txs` rows for QUSDC, the QIEDEX router, WQIE
 * and the WQIE/QUSDC pair (incl. 1,414 QUSDC transfers), exported from the worker's database on
 * 20 Nov 2026 at block 12,043,185 after a backfill whose ext/int/token counts matched the explorer
 * exactly. Metric tests (Day 4) run against this instead of the network.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { TxRow } from '../src/ingest/normalize';

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
  meta: { source: string; captured_at: string; synced_to_blocks: number[]; note: string };
  contracts: FixtureContract[];
  rows: TxRow[];
}

interface RawFixture extends Omit<MainnetFixture, 'rows'> {
  columns: (keyof TxRow)[];
  rows: unknown[][];
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
  cached = { meta: raw.meta, contracts: raw.contracts, rows };
  return cached;
};
