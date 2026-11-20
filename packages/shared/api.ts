/**
 * Public API response shapes (§8). Every response is `{ data, meta: { generated_at, price_source } }`.
 * Exact-precision numbers (QIE, QUSDC, USD amounts, prices) travel as decimal strings.
 */
import type { MilestoneMetric, WalletFlag } from './metrics';
import type { PriceSource } from './schemas';

export interface ApiMeta {
  generated_at: string;
  price_source: PriceSource | null;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error: { code: 'bad_request' | 'not_found' | 'internal'; message: string; issues?: unknown };
}

/** Headline numbers, from the latest rollup (null until a project has been rolled up). */
export interface ProjectStatsDto {
  as_of: string;
  raw_dau: number;
  organic_dau: number;
  raw_wau: number;
  organic_wau: number;
  raw_mau: number;
  organic_mau: number;
  growth_7d: number | null;
  cumulative_wallets: number;
  cumulative_organic: number;
  tx_count_30d: number;
  success_rate_30d: number | null;
  qie_volume_30d: string;
  qusdc_volume_30d: string;
  usd_volume_30d: string | null;
  organic_share_30d: number | null;
  d7_retention_30d: number | null;
  top10_share_30d: number | null;
  fresh_single_share_30d: number | null;
  verum_score: number | null;
  /** True until a D7 window has passed: the UI must show a "provisional" badge (owner, 20 Nov). */
  score_provisional: boolean;
  flag_counts: Record<WalletFlag, number>;
  top_methods: { method: string; count: number }[];
}

export interface ProjectListItem {
  rank: number;
  slug: string;
  name: string;
  track: number | null;
  claimed: boolean;
  logo_url: string | null;
  contracts: number;
  organic_wau: number | null;
  raw_wau: number | null;
  growth_7d: number | null;
  d7_retention: number | null;
  verum_score: number | null;
  score_provisional: boolean | null;
}

export interface ProjectsPage {
  items: ProjectListItem[];
  next_cursor: string | null;
}

export type OwnershipStatus = 'owner_verified' | 'unverified_claim' | 'unclaimed';

export interface ContractDto {
  address: string;
  label: string | null;
  creator_address: string | null;
  verified: boolean | null;
  ownership: OwnershipStatus;
  first_block: number | null;
  last_synced_block: number | null;
  sync_status: SyncStatus;
}

export type SyncStatus = 'queued' | 'backfilling' | 'synced' | 'error';

export interface ProjectDto {
  slug: string;
  name: string;
  track: number | null;
  owner_address: string | null;
  onchain_project_id: number | null;
  claimed: boolean;
  website: string | null;
  repo: string | null;
  logo_url: string | null;
  created_at: string;
  contracts: ContractDto[];
  stats: ProjectStatsDto | null;
}

export interface DailyMetricDto {
  day: string;
  raw_dau: number;
  organic_dau: number;
  new_wallets: number;
  returning_wallets: number;
  tx_count: number;
  success_rate: number | null;
  qie_volume: string;
  usd_volume: string | null;
  qusdc_volume: string;
  qie_usd: string | null;
  price_source: PriceSource | null;
  price_day: string | null;
}

export interface CohortDto {
  cohort_day: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface FlagDto {
  address: string;
  flag: WalletFlag;
  reason: string;
}

export interface MilestoneDto {
  idx: number;
  metric: MilestoneMetric;
  op: '>=';
  target: string;
  window_days: number;
  current: string | null;
  progress: number | null;
  reached_at: string | null;
  reached_tx: string | null;
}

export interface MilestonesDto {
  clock: { starts: string; ends: string; days_left: number };
  items: MilestoneDto[];
}

export interface SnapshotListItem {
  period_end: string;
  metrics_hash: string;
  tx_hash: string | null;
}

export interface SnapshotDto extends SnapshotListItem {
  payload: unknown;
  /** The exact bytes that were hashed: keccak256(utf8(canonical)) must equal metrics_hash. */
  canonical: string;
}

export interface SyncDto {
  status: SyncStatus;
  last_synced_block: number | null;
  progress: number;
}

export interface ChainPulseDto {
  as_of: string;
  day: string;
  txs_today: number;
  system_txs_today: number;
  /** Share of today's txs not involving known system addresses (§4.5). */
  real_share: number | null;
  qie_usd: string | null;
  price_source: PriceSource | null;
  oracle_health: {
    feed: string;
    address: string;
    answer: string | null;
    updated_at: string | null;
    age_seconds: number | null;
    stale: boolean;
  }[];
  projects_tracked: number;
  contracts_tracked: number;
}
