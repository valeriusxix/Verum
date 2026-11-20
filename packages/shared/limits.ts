/**
 * Operational constants for worker / api / web. Every value is from Agent.Md (section noted).
 */

// §4.2 + §12: explorer client
export const EXPLORER_MAX_REQ_PER_SEC = 3;
export const EXPLORER_RETRIES = 3;
export const EXPLORER_TIMEOUT_MS = 30_000;

// §5.1 ingestion
/** txlist `offset`. Paginate by `startblock` cursor; stop when a page returns fewer rows. */
export const TXLIST_PAGE_SIZE = 10_000;
/**
 * Floor for adaptive paging (20 Nov 2026): on timeout / 5xx the page halves down to this.
 * Measured: 10,000 internal-tx rows ≈ 19.5 MB ≈ 31 s (over the 30 s timeout); 2,500 ≈ 6.5 s.
 */
export const TXLIST_MIN_PAGE_SIZE = 500;
/** Re-read the last N blocks each sync to handle re-orgs. */
export const REORG_DEPTH_BLOCKS = 20;
export const MAX_CONCURRENT_BACKFILLS = 2;
/** Peek mode reads the last 10,000 txs only, client-side. */
export const PEEK_TX_LIMIT = 10_000;

// §3 worker schedule
export const SYNC_INTERVAL_MS = 2 * 60_000;
export const ROLLUP_INTERVAL_MS = 10 * 60_000;
/** Daily snapshot attester runs at 00:05 UTC. */
export const ATTESTER_CRON_UTC = '5 0 * * *';

// §6 registry
export const MAX_CONTRACTS_PER_PROJECT = 20;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;
export const SLUG_PATTERN = /^[a-z0-9-]{3,32}$/;

// §8 public API
export const API_CACHE_SECONDS = 60;
export const BADGE_CACHE_SECONDS = 10 * 60;
export const API_DEFAULT_PAGE_LIMIT = 50;

// §7.4 landing scene
export const LIVE_TX_POLL_MS = 10_000;
