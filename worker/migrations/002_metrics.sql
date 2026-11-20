-- Day 4 (20 Nov 2026): metrics rollups, organic filter, cohorts, prices.

-- Nonce of the top-level tx, as sent by origin_addr: ext rows from txlist, int rows from the RPC
-- origin lookup, token rows null. nonce = 0 marks that wallet's first-ever chain tx (§5.3 burst /
-- fresh_single).
alter table txs add column nonce bigint;
create index txs_top_level_pending on txs (contract) where kind in ('ext', 'int') and nonce is null;

-- A day without a reliable price has NO USD volume (null), never a false $0 (decided 20 Nov).
alter table daily_metrics alter column usd_volume drop not null;
alter table daily_metrics alter column usd_volume drop default;
alter table daily_metrics add column qie_usd numeric;          -- price used for that day
alter table daily_metrics add column price_source text check (price_source in ('oracle', 'explorer'));
alter table daily_metrics add column price_day date;           -- day the price came from (carry-forward)

-- Cohort size, for the heatmap and the size-weighted D7 in the Verum score.
alter table cohorts add column size int not null default 0;

-- Oracle ticks carry their round, so history backfill and live polling never double-insert.
alter table price_ticks add column round_id bigint;
create unique index price_ticks_round on price_ticks (round_id) where round_id is not null;

-- Chain-wide sent-tx count per wallet (eth_getTransactionCount), for fresh_single. Cached.
create table wallet_chain_stats (
  address    text primary key,
  tx_count   bigint not null,
  checked_at timestamptz not null default now()
);

-- Current headline numbers per project (leaderboard + KPI row), rewritten by every rollup.
create table project_stats (
  project_id          int primary key references projects on delete cascade,
  as_of               timestamptz not null,
  last_block          bigint,
  raw_dau             int not null,
  organic_dau         int not null,
  raw_wau             int not null,
  organic_wau         int not null,
  raw_mau             int not null,
  organic_mau         int not null,
  organic_wau_prev    int not null,       -- organic WAU for the 7 days before the current week
  growth_7d           real,               -- null when organic_wau_prev = 0
  cumulative_wallets  int not null,       -- all-time raw
  cumulative_organic  int not null,       -- all-time organic
  tx_count_30d        int not null,
  success_rate_30d    real,
  qie_volume_30d      numeric not null,
  qusdc_volume_30d    numeric not null,
  usd_volume_30d      numeric,            -- null if native volume in the window has no price
  organic_share_30d   real,
  d7_retention_30d    real,               -- null until a cohort's day 7–13 window has passed
  top10_share_30d     real,
  fresh_single_share_30d real,
  verum_score         real,
  score_provisional   bool not null default false,
  flag_counts         jsonb not null default '{}',
  top_methods         jsonb not null default '[]'
);

alter table wallet_chain_stats enable row level security;
alter table project_stats      enable row level security;
