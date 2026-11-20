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

// ---------------------------------------------------------------- implementation rules (20 Nov 2026)
// Shown on the API docs page next to §5.4. Every rule here was settled by the project owner on
// 20 Nov 2026: tx count + volume, price history, score window and cohort basis were chosen up front;
// wallet attribution, success, filter scope, nonce use and the provisional score were proposed while
// building and then confirmed.

/** Verum score, organic share, concentration and fresh_single share use the last 30 days. */
export const SCORE_WINDOW_DAYS = 30;

/**
 * Oracle history is used from this UTC day on. Earlier, the QIE/USDT feed has a malfunction
 * (24 Jun – 8 Jul 2026, ~0.02 vs a real ~0.13–0.16) and doesn't exist before 27 Aug 2025.
 * Days before this have no USD volume (null), never a guessed one.
 */
export const PRICE_HISTORY_START_DAY = '2026-10-01';
/** First QIE/USDT round on/after PRICE_HISTORY_START_DAY (2026-10-01T06:26:43Z), verified on-chain. */
export const PRICE_HISTORY_START_ROUND = 19_993;
/** A day with no price tick reuses the most recent earlier day's price for at most this many days. */
export const PRICE_CARRY_FORWARD_DAYS = 7;

export const IMPLEMENTATION_NOTES = [
  {
    id: 'wallet_attribution',
    basis: 'owner',
    text:
      'Every tx touching the project counts for its top-level sender (the wallet that signed it): for an ext tx that is ' +
      'its sender; for an internal call or a token transfer it is looked up via RPC, since those rows come from contracts. ' +
      'A QUSDC transfer into the project from outside also counts for the transfer sender (§5.4).',
  },
  {
    id: 'tx_count',
    basis: 'owner',
    text: 'Tx count = distinct transaction hashes touching any of the project’s contracts (one swap through router → pair counts once).',
  },
  {
    id: 'success',
    basis: 'owner',
    text: 'A tx succeeds if its ext row(s) succeeded; for txs reaching the project only via internal calls or transfers, if any of those rows succeeded.',
  },
  {
    id: 'volume',
    basis: 'owner',
    text:
      'Native volume = QIE entering the project from outside: successful ext value to a project contract plus successful internal ' +
      'value from a non-project address. QUSDC volume = QUSDC transferred into the project from outside. Each swap counts once, on its input side.',
  },
  {
    id: 'price',
    basis: 'owner',
    text:
      "A day's QIE price = median of that day's QIE Oracle rounds; if none, median of explorer price ticks; if none, the most recent " +
      `earlier day's price for up to ${PRICE_CARRY_FORWARD_DAYS} days. No price before ${PRICE_HISTORY_START_DAY}. USD volume = QIE × price + QUSDC; ` +
      'a day with native volume but no price has no USD volume.',
  },
  {
    id: 'cohorts',
    basis: 'owner',
    text:
      'Retention cohorts use organic wallets; a wallet’s cohort is its first day with the project. Dn stays empty until its whole window has passed. ' +
      'New vs returning use all wallets, so new + returning = Recorded DAU.',
  },
  {
    id: 'score',
    basis: 'owner',
    text:
      `Verum score inputs cover the last ${SCORE_WINDOW_DAYS} days; D7 is the cohort-size-weighted mean over cohorts whose day 7–13 window has passed.`,
  },
  {
    id: 'score_without_d7',
    basis: 'owner',
    text:
      'Until a D7 window has passed the score is provisional: the other three terms rescaled to 0–100, always shown ' +
      'with a "provisional" badge (it can rank above a project whose D7 was measured).',
  },
  {
    id: 'organic_filter_scope',
    basis: 'owner',
    text:
      'Bot and burst rules look at the wallet’s activity with this project. Burst and fresh_single use the top-level tx nonce: nonce 0 = the wallet’s first-ever chain tx.',
  },
] as const;

// ---------------------------------------------------------------- naming (§0)

/** Raw numbers are "Recorded", filtered numbers are "Verum". Snapshots are "Seals". */
export const LABELS = {
  raw: 'Recorded',
  organic: 'Verum',
  snapshot: 'Seal',
  score: 'Verum score',
} as const;
