/**
 * zod schemas shared by worker, api and web.
 *  - Explorer schemas: only fields listed in Agent.Md §4.2, cross-checked against live mainnet
 *    responses on 16 Nov 2026. Objects are loose (unknown extra fields pass through).
 *  - API schemas: §8 routes + `{data, meta:{generated_at, price_source}}` envelope.
 *  - Row DTOs: mirror the Postgres schema in §5.2. `numeric` columns travel as decimal strings
 *    (no float precision loss on wei / volumes).
 */
import { isAddress } from 'viem';
import { z } from 'zod';
import { MILESTONE_METRICS, MILESTONE_OPS, WALLET_FLAGS } from './metrics';
import { API_DEFAULT_PAGE_LIMIT, MAX_CONTRACTS_PER_PROJECT, SLUG_PATTERN } from './limits';
import { normalizeQieAddress } from './bech32';

// ---------------------------------------------------------------- primitives

/**
 * 0x address: all-lowercase, all-uppercase or valid EIP-55 (a bad mixed-case checksum is rejected).
 * Outputs lowercase (store lowercase, §12).
 */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 0x-prefixed 20-byte hex address')
  .refine((s) => isAddress(s, { strict: true }), 'invalid EIP-55 checksum')
  .transform((s) => s.toLowerCase() as `0x${string}`);

/**
 * User input in either QIE form, `0x…` or native `qie1…` (Keplr, faucet). Outputs lowercase 0x.
 * Use for the omnibox / register form; keep `addressSchema` for API params and stored data.
 */
export const qieAddressInputSchema = z.string().transform((s, ctx) => {
  const a = normalizeQieAddress(s);
  if (a === null) {
    ctx.addIssue({ code: 'custom', message: 'expected a 0x… or qie1… address' });
    return z.NEVER;
  }
  return a;
});

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 0x-prefixed 32-byte hex value')
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const txHashSchema = bytes32Schema;

/** 4-byte selector we keep from `input` (§5.1). `0x` for plain transfers. */
export const selectorSchema = z.string().regex(/^0x([0-9a-f]{8})?$/);

/** Unique, lowercase, 3–32 chars [a-z0-9-] (§6). */
export const slugSchema = z.string().regex(SLUG_PATTERN, 'slug must be 3–32 chars of [a-z0-9-]');

/** UTC calendar day, `YYYY-MM-DD`. */
export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Postgres `numeric` as a non-negative decimal string. */
export const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/);

/** Explorer v1 returns every number as a decimal string. */
const uintString = z.string().regex(/^\d+$/);

/** `projects.track smallint`. Track numbering beyond "Track 5" is not in the spec yet. */
export const trackSchema = z.coerce.number().int().min(1).max(32767);

export const walletFlagSchema = z.enum(WALLET_FLAGS);
export const milestoneMetricSchema = z.enum(MILESTONE_METRICS);
export const milestoneOpSchema = z.enum(MILESTONE_OPS);

// ---------------------------------------------------------------- price source (§4.3)

export const PRICE_SOURCES = ['oracle', 'explorer'] as const;
export const priceSourceSchema = z.enum(PRICE_SOURCES);
export type PriceSource = z.infer<typeof priceSourceSchema>;
export const PRICE_SOURCE_LABELS: Readonly<Record<PriceSource, string>> = {
  oracle: 'price via QIE Oracle',
  explorer: 'price via explorer',
};

// ---------------------------------------------------------------- explorer: v1 (Etherscan-style)

/**
 * `status: "1"` with rows, or `status: "0"` with `result: []` ("No transactions found") or
 * `result: null` (errors such as "Invalid address format").
 */
export const explorerV1Envelope = <T extends z.ZodType>(row: T) =>
  z.object({
    status: z.enum(['0', '1']),
    message: z.string(),
    result: z.array(row).nullable(),
  });

/** `action=txlist` row: fields from §4.2. `to` is "" on contract creation. */
export const explorerTxlistRowSchema = z.looseObject({
  blockNumber: uintString,
  timeStamp: uintString,
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  value: uintString,
  gasUsed: uintString,
  gasPrice: uintString,
  isError: z.enum(['0', '1']),
  txreceipt_status: z.string(),
  input: z.string(),
  nonce: uintString,
  contractAddress: z.string(),
});
export type ExplorerTxlistRow = z.infer<typeof explorerTxlistRowSchema>;
export const explorerTxlistResponseSchema = explorerV1Envelope(explorerTxlistRowSchema);

// ---------------------------------------------------------------- explorer: v2 (Blockscout REST)

/** `GET /api/v2/addresses/:addr`. Use `creator_address_hash` for ownership checks (§4.2). */
export const explorerAddressSchema = z.looseObject({
  hash: z.string(),
  is_contract: z.boolean(),
  is_verified: z.boolean().nullable(),
  creator_address_hash: z.string().nullable(),
  creation_transaction_hash: z.string().nullable(),
  implementations: z.array(z.unknown()),
  name: z.string().nullable(),
});
export type ExplorerAddress = z.infer<typeof explorerAddressSchema>;

/** `GET /api/v2/addresses/:addr/counters`. Exact totals (unlike tabs-counters, capped at 51). */
export const explorerAddressCountersSchema = z.looseObject({
  transactions_count: uintString,
  token_transfers_count: uintString,
  gas_usage_count: uintString,
  validations_count: uintString,
});

/** `GET /api/v2/stats`. `coin_price` is the QIE/USD fallback (§4.3). */
export const explorerStatsSchema = z.looseObject({
  total_transactions: uintString,
  transactions_today: uintString,
  total_addresses: uintString,
  coin_price: z.string().nullable(),
  average_block_time: z.number(),
});

/** `GET /api/v2/smart-contracts/counters`. */
export const explorerSmartContractCountersSchema = z.looseObject({
  smart_contracts: uintString,
  verified_smart_contracts: uintString,
  new_smart_contracts_24h: uintString,
  new_verified_smart_contracts_24h: uintString,
});

// ---------------------------------------------------------------- registry metadataURI JSON (§6)

/** `metadataURI` JSON: name, track, repo, site, logo, team wallets. */
export const projectMetadataSchema = z.object({
  name: z.string().min(1).max(80),
  track: trackSchema,
  repo: z.url().optional(),
  site: z.url().optional(),
  logo: z.url().optional(),
  team_wallets: z.array(addressSchema).default([]),
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

// ---------------------------------------------------------------- row DTOs (§5.2)

export const projectSchema = z.object({
  id: z.number().int(),
  slug: slugSchema,
  name: z.string(),
  track: z.number().int().nullable(),
  owner_address: addressSchema.nullable(),
  onchain_project_id: z.number().int().nullable(),
  claimed: z.boolean(),
  website: z.string().nullable(),
  repo: z.string().nullable(),
  logo_url: z.string().nullable(),
  created_at: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const contractSchema = z.object({
  address: addressSchema,
  project_id: z.number().int().nullable(),
  label: z.string().nullable(),
  creator_address: addressSchema.nullable(),
  verified: z.boolean().nullable(),
  first_block: z.number().int().nullable(),
  last_synced_block: z.number().int().nullable(),
});
export type ContractRow = z.infer<typeof contractSchema>;

export const txKindSchema = z.enum(['ext', 'int', 'token']);

export const walletFlagRowSchema = z.object({
  address: addressSchema,
  project_id: z.number().int(),
  flag: walletFlagSchema,
  reason: z.string(),
});
export type WalletFlagRow = z.infer<typeof walletFlagRowSchema>;

export const dailyMetricsSchema = z.object({
  project_id: z.number().int(),
  day: isoDateSchema,
  raw_dau: z.number().int(),
  organic_dau: z.number().int(),
  new_wallets: z.number().int(),
  returning_wallets: z.number().int(),
  tx_count: z.number().int(),
  success_rate: z.number().min(0).max(1).nullable(),
  qie_volume: decimalStringSchema,
  usd_volume: decimalStringSchema,
  qusdc_volume: decimalStringSchema,
});
export type DailyMetrics = z.infer<typeof dailyMetricsSchema>;

export const cohortSchema = z.object({
  project_id: z.number().int(),
  cohort_day: isoDateSchema,
  d1: z.number().min(0).max(1).nullable(),
  d7: z.number().min(0).max(1).nullable(),
  d30: z.number().min(0).max(1).nullable(),
});
export type Cohort = z.infer<typeof cohortSchema>;

export const snapshotSchema = z.object({
  project_id: z.number().int(),
  period_end: isoDateSchema,
  metrics_hash: bytes32Schema,
  tx_hash: txHashSchema.nullable(),
  payload: z.unknown(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const milestoneSchema = z.object({
  project_id: z.number().int(),
  idx: z.number().int().min(0).max(2),
  metric: milestoneMetricSchema,
  op: milestoneOpSchema,
  target: decimalStringSchema,
  window_days: z.number().int().positive(),
  reached_at: isoDateTimeSchema.nullable(),
  reached_tx: txHashSchema.nullable(),
});
export type MilestoneRow = z.infer<typeof milestoneSchema>;

export const priceTickSchema = z.object({
  ts: isoDateTimeSchema,
  qie_usd: decimalStringSchema,
  source: priceSourceSchema,
});

// ---------------------------------------------------------------- API (§8)

export const apiMetaSchema = z.object({
  generated_at: isoDateTimeSchema,
  /** null on endpoints that don't involve a USD price. */
  price_source: priceSourceSchema.nullable(),
});

export const apiResponse = <T extends z.ZodType>(data: T) => z.object({ data, meta: apiMetaSchema });

export const slugParamSchema = z.object({ slug: slugSchema });

/** GET /v1/projects?track=&sort=organic_wau&limit=50&cursor= */
export const projectsListQuerySchema = z.object({
  track: trackSchema.optional(),
  // Only `organic_wau` is named in §8; the others map to the /explore columns (§7.6).
  sort: z.enum(['organic_wau', 'growth_7d', 'd7_retention', 'verum_score']).default('organic_wau'),
  limit: z.coerce.number().int().min(1).max(100).default(API_DEFAULT_PAGE_LIMIT),
  cursor: z.string().max(256).optional(),
});

/** GET /v1/projects/:slug/metrics?range=30d (7d/30d/90d/all as in the dashboard toggle, §7.6). */
export const METRIC_RANGES = ['7d', '30d', '90d', 'all'] as const;
export const metricsQuerySchema = z.object({ range: z.enum(METRIC_RANGES).default('30d') });

/** GET /v1/projects/:slug/flags?flag=bot */
export const flagsQuerySchema = z.object({ flag: walletFlagSchema.optional() });

/** GET /v1/projects/:slug/snapshots/:date */
export const snapshotParamsSchema = z.object({ slug: slugSchema, date: isoDateSchema });

/** GET /badge/:slug.svg?metric=organic_wau */
export const badgeQuerySchema = z.object({ metric: z.string().default('organic_wau') });

/** GET /v1/projects/:slug/sync -> {status, last_synced_block, progress} */
export const syncStatusSchema = z.object({
  status: z.string(),
  last_synced_block: z.number().int().nullable(),
  progress: z.number().min(0).max(1),
});

/** GET /v1/chain/pulse -> txs today, organic share, oracle health */
export const oracleHealthSchema = z.object({
  feed: z.string(),
  address: addressSchema,
  answer: z.string().nullable(),
  updated_at: isoDateTimeSchema.nullable(),
  age_seconds: z.number().nullable(),
  stale: z.boolean(),
});
export const chainPulseSchema = z.object({
  txs_today: z.number().int(),
  organic_share: z.number().min(0).max(1).nullable(),
  oracle_health: z.array(oracleHealthSchema),
});

// ---------------------------------------------------------------- register form (§7.6 /register)

export const milestoneInputSchema = z.object({
  metric: milestoneMetricSchema,
  op: milestoneOpSchema.default('>='),
  target: z.coerce.number().positive(),
  window_days: z.coerce.number().int().positive(),
});

export const registerInputSchema = z.object({
  slug: slugSchema,
  metadata: projectMetadataSchema,
  contracts: z.array(addressSchema).min(1).max(MAX_CONTRACTS_PER_PROJECT),
  milestones: z.array(milestoneInputSchema).max(3),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;
