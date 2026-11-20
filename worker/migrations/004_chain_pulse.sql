-- Day 5 (20 Nov 2026): chain-wide pulse for GET /v1/chain/pulse. Written by the worker every 10 min
-- so the API reads only Postgres (§12). One row per measurement; the API serves the latest.
create table chain_pulse (
  ts                timestamptz primary key,
  day               date not null,            -- the UTC day the counts cover (00:00 UTC -> ts)
  txs_today         int not null,             -- explorer /api/v2/stats transactions_today
  system_txs_today  int not null,             -- txs of known system addresses (§4.5) since 00:00 UTC
  real_share        real,                     -- 1 - system/txs; null when txs_today = 0
  qie_usd           numeric,
  price_source      text check (price_source in ('oracle', 'explorer')),
  oracle_health     jsonb not null            -- 7 feeds: answer, updated_at, age_seconds, stale
);
alter table chain_pulse enable row level security;
