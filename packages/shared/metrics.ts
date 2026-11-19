/**
 * Metric definitions: the single source of truth for the worker rollups, the API docs page and
 * the dashboard tooltips. Text is copied from Agent.Md §5.3–5.5. If a number on the dashboard can't
 * be explained by these definitions, it's a bug (§12).
 */

// ---------------------------------------------------------------- §5.4 metric definitions

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
}

export const METRIC_DEFINITIONS = [
  {
    id: 'unique_wallets',
    label: 'Unique wallets',
    definition:
      "Distinct `from_addr` on ext txs to the project's contracts, plus distinct `from_addr` on int txs " +
      'where the top-level tx sender is an EOA. Token transfers *to* the contract count the sender.',
  },
  // Implementation (19 Nov 2026): for int txs the counted wallet is `txs.origin_addr`, the top-level
  // sender (always an EOA), because an int row's own `from_addr` is the calling contract.
  {
    id: 'dau_wau_mau',
    label: 'DAU / WAU / MAU',
    definition: 'Rolling 1 / 7 / 30-day unique wallets (raw and organic).',
  },
  {
    id: 'new_vs_returning',
    label: 'New vs returning',
    definition: 'A wallet is new on its first day with the project.',
  },
  {
    id: 'retention',
    label: 'Retention Dn',
    definition:
      "Share of a cohort's wallets active again on any day in `[cohort_day+n, cohort_day+n+1)` for D1, " +
      'and within days 7–13 for D7, days 30–36 for D30.',
  },
  {
    id: 'volume',
    label: 'Volume',
    definition: "Sum of native `value` (QIE → USD at that day's price) + QUSDC token amounts.",
  },
  {
    id: 'success_rate',
    label: 'Success rate',
    definition: 'Successful txs / all txs.',
  },
  {
    id: 'concentration',
    label: 'Concentration',
    definition: 'Share of txs from the top 10 wallets.',
  },
] as const satisfies readonly MetricDefinition[];

export type MetricId = (typeof METRIC_DEFINITIONS)[number]['id'];

/** Rolling active-wallet windows, in days. */
export const ACTIVE_WINDOW_DAYS = { dau: 1, wau: 7, mau: 30 } as const;

/**
 * Retention windows as day offsets from `cohort_day`, half-open `[fromDay, toDayExclusive)`.
 * D1 = day 1 · D7 = days 7–13 · D30 = days 30–36.
 */
export const RETENTION_WINDOWS = {
  d1: { fromDay: 1, toDayExclusive: 2 },
  d7: { fromDay: 7, toDayExclusive: 14 },
  d30: { fromDay: 30, toDayExclusive: 37 },
} as const;

export type RetentionKey = keyof typeof RETENTION_WINDOWS;

/** Concentration = share of txs from the top N wallets. */
export const CONCENTRATION_TOP_N = 10;

// ---------------------------------------------------------------- §5.3 organic-signal filter

export const WALLET_FLAGS = ['team', 'bot', 'burst', 'fresh_single'] as const;
export type WalletFlag = (typeof WALLET_FLAGS)[number];

export const WALLET_FLAG_RULES: Readonly<Record<WalletFlag, string>> = {
  team:
    'Wallet = contract creator, project owner, or any address the owner lists as "team" during registration.',
  bot: '≥ 200 txs in any 24 h, or inter-tx interval coefficient of variation < 0.1 over ≥ 50 txs.',
  burst:
    '≥ 20 wallets whose first ever chain tx (nonce == 0) lands in the same 10-min window and that all hit this contract.',
  fresh_single:
    "Wallet's only chain activity ever is a single tx to this project. Soft flag: counted, but down-weighted in the Verum score.",
};

export const ORGANIC_FILTER = {
  bot: {
    /** Flag if the wallet sends >= this many txs in any rolling 24 h. */
    minTxsIn24h: 200,
    rollingWindowHours: 24,
    /** Flag if inter-tx interval CV is strictly below this… */
    maxIntervalCv: 0.1,
    /** …measured over at least this many txs. */
    minTxsForCv: 50,
  },
  burst: {
    /** Flag if >= this many first-ever-tx wallets… */
    minWallets: 20,
    /** …land in the same window of this many minutes. */
    windowMinutes: 10,
  },
} as const;

/** Flags that remove a wallet from the organic set. `fresh_single` is soft: still organic. */
export const NON_ORGANIC_FLAGS = ['team', 'bot', 'burst'] as const satisfies readonly WalletFlag[];

/** Organic wallet = not `team`, not `bot`, not `burst`. */
export const isOrganic = (flags: Iterable<WalletFlag>): boolean => {
  for (const f of flags) if ((NON_ORGANIC_FLAGS as readonly WalletFlag[]).includes(f)) return false;
  return true;
};

// ---------------------------------------------------------------- Verum score (0–100)

export const VERUM_SCORE_WEIGHTS = {
  organicShare: 40,
  d7Retention: 25,
  oneMinusTop10TxShare: 20,
  oneMinusFreshSingleShare: 15,
} as const;

/** Shown verbatim on the project page and API docs. Transparency is the point. */
export const VERUM_SCORE_FORMULA =
  '40·(organic/raw unique wallets) + 25·D7 retention + 20·(1 − top-10 wallet tx share) + 15·(1 − fresh_single share), clamped to 0–100';

/** All inputs are ratios in [0, 1]. */
export interface VerumScoreInputs {
  /** organic unique wallets / raw unique wallets */
  readonly organicShare: number;
  readonly d7Retention: number;
  /** share of txs from the top 10 wallets */
  readonly top10TxShare: number;
  readonly freshSingleShare: number;
}

export const verumScore = (i: VerumScoreInputs): number => {
  const w = VERUM_SCORE_WEIGHTS;
  const raw =
    w.organicShare * i.organicShare +
    w.d7Retention * i.d7Retention +
    w.oneMinusTop10TxShare * (1 - i.top10TxShare) +
    w.oneMinusFreshSingleShare * (1 - i.freshSingleShare);
  return Math.min(100, Math.max(0, raw));
};

// ---------------------------------------------------------------- §5.5 milestones

export const MILESTONE_METRICS = [
  'organic_wau',
  'organic_mau',
  'cumulative_wallets',
  'tx_count_30d',
  'usd_volume_30d',
  'd7_retention',
] as const;
export type MilestoneMetric = (typeof MILESTONE_METRICS)[number];

export const MILESTONE_OPS = ['>='] as const;
export type MilestoneOp = (typeof MILESTONE_OPS)[number];

export const MAX_MILESTONES = 3;

/** The 90-day milestone clock starts at the winners' date. */
export const WINNERS_DATE_UTC = '2026-12-10';
export const MILESTONE_CLOCK_DAYS = 90;

// ---------------------------------------------------------------- naming (§0)

/** Raw numbers are "Recorded", filtered numbers are "Verum". Snapshots are "Seals". */
export const LABELS = {
  raw: 'Recorded',
  organic: 'Verum',
  snapshot: 'Seal',
  score: 'Verum score',
} as const;
