/**
 * Data access for the public API. Reads only from Postgres (§12): the worker computes every number;
 * nothing here recomputes metrics. Routes depend on the `Repo` interface so they can be tested
 * without a database.
 */
import {
  MILESTONE_CLOCK_DAYS,
  MILESTONE_STAT_COLUMN,
  WINNERS_DATE_UTC,
  canonicalJson,
  type CanonicalValue,
  type ChainPulseDto,
  type CohortDto,
  type ContractDto,
  type DailyMetricDto,
  type FlagDto,
  type MilestonesDto,
  type OwnershipStatus,
  type ProjectDto,
  type ProjectListItem,
  type ProjectStatsDto,
  type SnapshotDto,
  type SnapshotListItem,
  type SyncDto,
  type SyncStatus,
  type WalletFlag,
} from '@verum/shared';
import type { Sql } from './db';

export type SortKey = 'organic_wau' | 'growth_7d' | 'd7_retention' | 'verum_score';
export type Range = '7d' | '30d' | '90d' | 'all';

export interface ListParams {
  track?: number;
  sort: SortKey;
  limit: number;
  offset: number;
}

export interface Repo {
  listProjects(p: ListParams): Promise<{ items: ProjectListItem[]; hasMore: boolean }>;
  /** null when the slug doesn't exist. */
  getProject(slug: string): Promise<ProjectDto | null>;
  projectId(slug: string): Promise<number | null>;
  metrics(projectId: number, range: Range, today: string): Promise<DailyMetricDto[]>;
  cohorts(projectId: number): Promise<CohortDto[]>;
  flags(projectId: number, flag?: WalletFlag): Promise<FlagDto[]>;
  milestones(projectId: number, today: string): Promise<MilestonesDto>;
  snapshots(projectId: number): Promise<SnapshotListItem[]>;
  snapshot(projectId: number, date: string): Promise<SnapshotDto | null>;
  sync(projectId: number): Promise<SyncDto>;
  pulse(): Promise<ChainPulseDto | null>;
  /** Value of one project_stats column for the badge; undefined when the project is unknown. */
  badgeStats(slug: string): Promise<ProjectStatsDto | null | undefined>;
}

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));
const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

/** Worst status wins: error > backfilling > queued > synced. */
const SYNC_ORDER: SyncStatus[] = ['synced', 'queued', 'backfilling', 'error'];
export const combineSync = (rows: { status: SyncStatus; progress: number; last_synced_block: number | null }[]): SyncDto => {
  if (rows.length === 0) return { status: 'queued', last_synced_block: null, progress: 0 };
  const status = rows.reduce<SyncStatus>((w, r) => (SYNC_ORDER.indexOf(r.status) > SYNC_ORDER.indexOf(w) ? r.status : w), 'synced');
  const blocks = rows.map((r) => r.last_synced_block);
  return {
    status,
    last_synced_block: blocks.some((b) => b === null) ? null : Math.min(...(blocks as number[])),
    progress: rows.reduce((s, r) => s + r.progress, 0) / rows.length,
  };
};

export const ownershipOf = (creator: string | null, owner: string | null, claimed: boolean): OwnershipStatus =>
  !claimed || !owner ? 'unclaimed' : creator !== null && creator === owner ? 'owner_verified' : 'unverified_claim';

const statsDto = (s: Record<string, unknown>): ProjectStatsDto => ({
  as_of: iso(s.as_of as Date)!,
  raw_dau: Number(s.raw_dau),
  organic_dau: Number(s.organic_dau),
  raw_wau: Number(s.raw_wau),
  organic_wau: Number(s.organic_wau),
  raw_mau: Number(s.raw_mau),
  organic_mau: Number(s.organic_mau),
  growth_7d: num(s.growth_7d),
  cumulative_wallets: Number(s.cumulative_wallets),
  cumulative_organic: Number(s.cumulative_organic),
  tx_count_30d: Number(s.tx_count_30d),
  success_rate_30d: num(s.success_rate_30d),
  qie_volume_30d: String(s.qie_volume_30d),
  qusdc_volume_30d: String(s.qusdc_volume_30d),
  usd_volume_30d: s.usd_volume_30d === null ? null : String(s.usd_volume_30d),
  organic_share_30d: num(s.organic_share_30d),
  d7_retention_30d: num(s.d7_retention_30d),
  top10_share_30d: num(s.top10_share_30d),
  fresh_single_share_30d: num(s.fresh_single_share_30d),
  verum_score: num(s.verum_score),
  score_provisional: Boolean(s.score_provisional),
  flag_counts: s.flag_counts as ProjectStatsDto['flag_counts'],
  top_methods: s.top_methods as ProjectStatsDto['top_methods'],
});

const STATS_COLUMNS = `s.as_of, s.raw_dau, s.organic_dau, s.raw_wau, s.organic_wau, s.raw_mau, s.organic_mau, s.growth_7d,
  s.cumulative_wallets, s.cumulative_organic, s.tx_count_30d, s.success_rate_30d, s.qie_volume_30d::text, s.qusdc_volume_30d::text,
  s.usd_volume_30d::text, s.organic_share_30d, s.d7_retention_30d, s.top10_share_30d, s.fresh_single_share_30d, s.verum_score,
  s.score_provisional, s.flag_counts, s.top_methods`;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const createPgRepo = (sql: Sql): Repo => {
  const ORDER = {
    organic_wau: sql`s.organic_wau`,
    growth_7d: sql`s.growth_7d`,
    d7_retention: sql`s.d7_retention_30d`,
    verum_score: sql`s.verum_score`,
  } as const;

  return {
    async listProjects(p) {
      const rows = await sql`
        select p.slug, p.name, p.track, p.claimed, p.logo_url,
          (select count(*)::int from contracts c where c.project_id = p.id) as contracts,
          s.organic_wau, s.raw_wau, s.growth_7d, s.d7_retention_30d, s.verum_score, s.score_provisional
        from projects p left join project_stats s on s.project_id = p.id
        where ${p.track === undefined ? sql`true` : sql`p.track = ${p.track}`}
        order by ${ORDER[p.sort]} desc nulls last, p.id
        limit ${p.limit + 1} offset ${p.offset}`;
      const items = rows.slice(0, p.limit).map((r, i) => ({
        rank: p.offset + i + 1,
        slug: r.slug,
        name: r.name,
        track: num(r.track),
        claimed: r.claimed,
        logo_url: r.logo_url,
        contracts: r.contracts,
        organic_wau: num(r.organic_wau),
        raw_wau: num(r.raw_wau),
        growth_7d: num(r.growth_7d),
        d7_retention: num(r.d7_retention_30d),
        verum_score: num(r.verum_score),
        score_provisional: r.score_provisional ?? null,
      }));
      return { items, hasMore: rows.length > p.limit };
    },

    async getProject(slug) {
      const [p] = await sql`
        select id, slug, name, track, owner_address, onchain_project_id::text, claimed, website, repo, logo_url, created_at
        from projects where slug = ${slug}`;
      if (!p) return null;
      const contracts = await sql`
        select c.address, c.label, c.creator_address, c.verified, c.first_block::text, c.last_synced_block::text,
          coalesce(sp.status, 'queued') as status
        from contracts c left join sync_progress sp on sp.contract = c.address
        where c.project_id = ${p.id} order by c.address`;
      const [s] = await sql.unsafe(`select ${STATS_COLUMNS} from project_stats s where s.project_id = $1`, [p.id]);
      return {
        slug: p.slug,
        name: p.name,
        track: num(p.track),
        owner_address: p.owner_address,
        onchain_project_id: num(p.onchain_project_id),
        claimed: p.claimed,
        website: p.website,
        repo: p.repo,
        logo_url: p.logo_url,
        created_at: iso(p.created_at)!,
        contracts: contracts.map(
          (c): ContractDto => ({
            address: c.address,
            label: c.label,
            creator_address: c.creator_address,
            verified: c.verified,
            ownership: ownershipOf(c.creator_address, p.owner_address, p.claimed),
            first_block: num(c.first_block),
            last_synced_block: num(c.last_synced_block),
            sync_status: c.status,
          }),
        ),
        stats: s ? statsDto(s) : null,
      };
    },

    async projectId(slug) {
      const [p] = await sql`select id from projects where slug = ${slug}`;
      return p ? Number(p.id) : null;
    },

    async metrics(projectId, range, today) {
      const days = { '7d': 7, '30d': 30, '90d': 90, all: null }[range];
      const from = days === null ? '0001-01-01' : addDays(today, -(days - 1));
      const rows = await sql`
        select day::text, raw_dau, organic_dau, new_wallets, returning_wallets, tx_count, success_rate,
          qie_volume::text, usd_volume::text, qusdc_volume::text, qie_usd::text, price_source, price_day::text
        from daily_metrics where project_id = ${projectId} and day >= ${from} order by day`;
      return rows.map((r) => ({ ...r, success_rate: num(r.success_rate) }) as DailyMetricDto);
    },

    async cohorts(projectId) {
      const rows = await sql`
        select cohort_day::text, size, d1, d7, d30 from cohorts where project_id = ${projectId} order by cohort_day`;
      return rows.map((r) => ({ cohort_day: r.cohort_day, size: r.size, d1: num(r.d1), d7: num(r.d7), d30: num(r.d30) }));
    },

    async flags(projectId, flag) {
      const rows = await sql`
        select address, flag, reason from wallet_flags
        where project_id = ${projectId} ${flag ? sql`and flag = ${flag}` : sql``}
        order by flag, address`;
      return rows as unknown as FlagDto[];
    },

    async milestones(projectId, today) {
      const [s] = await sql.unsafe(`select ${STATS_COLUMNS} from project_stats s where s.project_id = $1`, [projectId]);
      const stats = s ? statsDto(s) : null;
      const rows = await sql`
        select idx, metric, op, target::text, window_days, reached_at, reached_tx
        from milestones where project_id = ${projectId} order by idx`;
      const ends = addDays(WINNERS_DATE_UTC, MILESTONE_CLOCK_DAYS);
      const left = Math.round((Date.parse(`${ends}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      return {
        clock: { starts: WINNERS_DATE_UTC, ends, days_left: Math.max(0, Math.min(MILESTONE_CLOCK_DAYS, left)) },
        items: rows.map((m) => {
          const col = MILESTONE_STAT_COLUMN[m.metric as keyof typeof MILESTONE_STAT_COLUMN];
          const raw = stats ? (stats as unknown as Record<string, unknown>)[col] : null;
          const current = raw === null || raw === undefined ? null : String(raw);
          const target = Number(m.target);
          return {
            idx: m.idx,
            metric: m.metric,
            op: m.op,
            target: m.target,
            window_days: m.window_days,
            current,
            progress: current === null || !(target > 0) ? null : Math.min(1, Number(current) / target),
            reached_at: iso(m.reached_at),
            reached_tx: m.reached_tx,
          };
        }),
      };
    },

    async snapshots(projectId) {
      return (await sql`
        select period_end::text, metrics_hash, tx_hash from snapshots
        where project_id = ${projectId} order by period_end desc`) as unknown as SnapshotListItem[];
    },

    async snapshot(projectId, date) {
      const [r] = await sql`
        select period_end::text, metrics_hash, tx_hash, payload from snapshots
        where project_id = ${projectId} and period_end = ${date}`;
      if (!r) return null;
      return { ...(r as unknown as SnapshotListItem), payload: r.payload, canonical: canonicalJson(r.payload as CanonicalValue) };
    },

    async sync(projectId) {
      const rows = await sql`
        select coalesce(sp.status, 'queued') as status, coalesce(sp.progress, 0) as progress, c.last_synced_block::text
        from contracts c left join sync_progress sp on sp.contract = c.address where c.project_id = ${projectId}`;
      return combineSync(rows.map((r) => ({ status: r.status, progress: Number(r.progress), last_synced_block: num(r.last_synced_block) })));
    },

    async pulse() {
      const [p] = await sql`
        select ts, day::text, txs_today, system_txs_today, real_share, qie_usd::text, price_source, oracle_health,
          (select count(*)::int from projects) as projects_tracked,
          (select count(*)::int from contracts where project_id is not null) as contracts_tracked
        from chain_pulse order by ts desc limit 1`;
      if (!p) return null;
      return {
        as_of: iso(p.ts)!,
        day: p.day,
        txs_today: p.txs_today,
        system_txs_today: p.system_txs_today,
        real_share: num(p.real_share),
        qie_usd: p.qie_usd,
        price_source: p.price_source,
        oracle_health: p.oracle_health,
        projects_tracked: p.projects_tracked,
        contracts_tracked: p.contracts_tracked,
      };
    },

    async badgeStats(slug) {
      const [p] = await sql`select id from projects where slug = ${slug}`;
      if (!p) return undefined;
      const [s] = await sql.unsafe(`select ${STATS_COLUMNS} from project_stats s where s.project_id = $1`, [p.id]);
      return s ? statsDto(s) : null;
    },
  };
};
