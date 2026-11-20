-- Verum schema. Spec: Agent.Md §5.2, with the changes decided on 19 Nov 2026:
--   * txs primary key includes `contract`: one internal call / QUSDC transfer between two tracked
--     contracts appears in both contracts' explorer lists and must be kept for both.
--   * txs.origin_addr: top-level tx sender for internal rows (from the parent tx, via JSON-RPC).
--     §5.4 unique wallets count it for int txs. ext rows: = from_addr. int rows: null until resolved.
--     token rows: null (§5.4 counts the transfer sender, from_addr).
--   * sync_progress: per-contract sync status for GET /v1/projects/:slug/sync (§8).
-- All addresses are stored lowercase (§12). All times are UTC.

create table projects (
  id                 serial primary key,
  slug               text unique not null,
  name               text not null,
  track              smallint,
  owner_address      text,
  onchain_project_id bigint unique,
  claimed            bool not null default false,
  website            text,
  repo               text,
  logo_url           text,
  created_at         timestamptz not null default now()
);

create table contracts (
  address           text primary key check (address ~ '^0x[0-9a-f]{40}$'),
  project_id        int references projects on delete set null,
  label             text,
  creator_address   text,
  verified          bool,
  first_block       bigint,
  last_synced_block bigint
);
create index on contracts (project_id);

create table txs (
  hash         text not null,
  kind         text not null check (kind in ('ext', 'int', 'token')),
  log_index    int not null default -1,
  contract     text not null references contracts (address) on delete cascade,
  block        bigint not null,
  ts           timestamptz not null,
  from_addr    text not null,
  to_addr      text,
  origin_addr  text,
  selector     text,
  value_wei    numeric not null default 0,
  token        text,
  token_amount numeric,
  success      bool not null,
  gas_used     bigint,
  primary key (hash, kind, log_index, contract)
);
create index on txs (contract, ts);
create index on txs (contract, block);
create index on txs (from_addr);
create index on txs (origin_addr);
-- internal rows still waiting for their top-level sender
create index txs_origin_pending on txs (contract) where kind = 'int' and origin_addr is null;

create table wallet_flags (
  address    text not null,
  project_id int not null references projects on delete cascade,
  flag       text not null check (flag in ('team', 'bot', 'burst', 'fresh_single')),
  reason     text not null,
  primary key (address, project_id, flag)
);

create table daily_metrics (
  project_id        int not null references projects on delete cascade,
  day               date not null,
  raw_dau           int not null,
  organic_dau       int not null,
  new_wallets       int not null,
  returning_wallets int not null,
  tx_count          int not null,
  success_rate      real,
  qie_volume        numeric not null default 0,
  usd_volume        numeric not null default 0,
  qusdc_volume      numeric not null default 0,
  primary key (project_id, day)
);

create table cohorts (
  project_id int not null references projects on delete cascade,
  cohort_day date not null,
  d1         real,
  d7         real,
  d30        real,
  primary key (project_id, cohort_day)
);

create table snapshots (
  project_id   int not null references projects on delete cascade,
  period_end   date not null,
  metrics_hash text not null,
  tx_hash      text,
  payload      jsonb not null,
  primary key (project_id, period_end)
);

create table milestones (
  project_id  int not null references projects on delete cascade,
  idx         smallint not null check (idx between 0 and 2),
  metric      text not null,
  op          text not null default '>=',
  target      numeric not null,
  window_days int not null,
  reached_at  timestamptz,
  reached_tx  text,
  primary key (project_id, idx)
);

create table price_ticks (
  ts      timestamptz primary key,
  qie_usd numeric not null,
  source  text not null check (source in ('oracle', 'explorer'))
);

create table sync_progress (
  contract     text primary key references contracts (address) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'backfilling', 'synced', 'error')),
  cursor_block bigint,
  head_block   bigint,
  progress     real not null default 0 check (progress between 0 and 1),
  error        text,
  updated_at   timestamptz not null default now()
);

-- Supabase exposes every `public` table through its REST API (PostgREST) to anyone holding the
-- project's anon key, which is public by design. RLS on with NO policies = that API can't read or
-- write anything. The worker and api connect as the table owner, which bypasses RLS.
-- Every number Verum serves comes from our own /v1 API, never from Supabase's REST API.
alter table schema_migrations enable row level security;
alter table projects          enable row level security;
alter table contracts         enable row level security;
alter table txs               enable row level security;
alter table wallet_flags      enable row level security;
alter table daily_metrics     enable row level security;
alter table cohorts           enable row level security;
alter table snapshots         enable row level security;
alter table milestones        enable row level security;
alter table price_ticks       enable row level security;
alter table sync_progress     enable row level security;
