/**
 * Daily metrics, retention cohorts and the project summary (§5.3–5.4 + IMPLEMENTATION_NOTES).
 * Pure: everything is a function of (txs, flags, prices, asOf).
 */
import {
  ACTIVE_WINDOW_DAYS,
  CONCENTRATION_TOP_N,
  QUSDC,
  RETENTION_WINDOWS,
  SCORE_WINDOW_DAYS,
  VERUM_SCORE_WEIGHTS,
  isOrganic,
  type WalletFlag,
} from '@verum/shared';
import { formatUnits } from 'viem';
import type { WalletFlags } from './flags';
import { DAY_MS, dayIndex, dayKey, type ProjectTx } from './model';
import type { DayPrice } from './prices';

const WEI_DECIMALS = 18;

export const organicSet = (txs: readonly ProjectTx[], flags: WalletFlags): Set<string> => {
  const s = new Set<string>();
  for (const t of txs) for (const w of t.wallets) if (isOrganic(flags.get(w)?.keys() ?? [])) s.add(w);
  return s;
};

/** USD for one tx, or null when it moved native QIE on a day without a price. */
const txUsd = (t: ProjectTx, price: DayPrice | null | undefined): number | null => {
  const qusdc = Number(formatUnits(t.qusdcInRaw, QUSDC.decimals));
  if (t.nativeInWei === 0n) return qusdc;
  if (!price) return null;
  return Number(formatUnits(t.nativeInWei, WEI_DECIMALS)) * price.qieUsd + qusdc;
};

// ---------------------------------------------------------------- daily_metrics

export interface DailyRow {
  day: string;
  raw_dau: number;
  organic_dau: number;
  new_wallets: number;
  returning_wallets: number;
  tx_count: number;
  success_rate: number | null;
  qie_volume: string;
  qusdc_volume: string;
  usd_volume: string | null;
  qie_usd: string | null;
  price_source: 'oracle' | 'explorer' | null;
  price_day: string | null;
}

/** One row per UTC day from the project's first tx through asOf's day (zero days included). */
export const dailyMetrics = (
  txs: readonly ProjectTx[],
  organic: ReadonlySet<string>,
  prices: ReadonlyMap<number, DayPrice | null>,
  asOf: number,
): DailyRow[] => {
  if (txs.length === 0) return [];
  const firstDay = new Map<string, number>();
  for (const t of txs) for (const w of t.wallets) if (!firstDay.has(w)) firstDay.set(w, t.day);

  const byDay = new Map<number, ProjectTx[]>();
  for (const t of txs) (byDay.get(t.day) ?? byDay.set(t.day, []).get(t.day)!).push(t);

  const rows: DailyRow[] = [];
  for (let d = txs[0]!.day; d <= dayIndex(asOf); d++) {
    const list = byDay.get(d) ?? [];
    const wallets = new Set(list.flatMap((t) => t.wallets));
    const newW = [...wallets].filter((w) => firstDay.get(w) === d).length;
    const native = list.reduce((s, t) => s + t.nativeInWei, 0n);
    const qusdc = list.reduce((s, t) => s + t.qusdcInRaw, 0n);
    const price = prices.get(d) ?? null;
    const usd = native === 0n || price ? list.reduce((s, t) => s + (txUsd(t, price) ?? 0), 0) : null;
    rows.push({
      day: dayKey(d),
      raw_dau: wallets.size,
      organic_dau: [...wallets].filter((w) => organic.has(w)).length,
      new_wallets: newW,
      returning_wallets: wallets.size - newW,
      tx_count: list.length,
      success_rate: list.length ? list.filter((t) => t.success).length / list.length : null,
      qie_volume: formatUnits(native, WEI_DECIMALS),
      qusdc_volume: formatUnits(qusdc, QUSDC.decimals),
      usd_volume: usd === null ? null : usd.toFixed(6),
      qie_usd: price ? String(price.qieUsd) : null,
      price_source: price?.source ?? null,
      price_day: price ? dayKey(price.fromDay) : null,
    });
  }
  return rows;
};

// ---------------------------------------------------------------- cohorts (organic)

export interface CohortRow {
  cohort_day: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

/**
 * Organic wallets grouped by their first day with the project. Dn = share active again on any day
 * of its window; null until the whole window lies before asOf's (still partial) day.
 */
export const cohorts = (txs: readonly ProjectTx[], organic: ReadonlySet<string>, asOf: number): CohortRow[] => {
  const activeDays = new Map<string, Set<number>>();
  for (const t of txs) for (const w of t.wallets) if (organic.has(w)) (activeDays.get(w) ?? activeDays.set(w, new Set()).get(w)!).add(t.day);

  const groups = new Map<number, string[]>();
  for (const [w, days] of activeDays) {
    const first = Math.min(...days);
    (groups.get(first) ?? groups.set(first, []).get(first)!).push(w);
  }

  const today = dayIndex(asOf);
  const rate = (c: number, members: string[], win: { fromDay: number; toDayExclusive: number }) => {
    if (c + win.toDayExclusive > today) return null; // window not over yet
    const back = members.filter((w) => {
      const days = activeDays.get(w)!;
      for (let d = c + win.fromDay; d < c + win.toDayExclusive; d++) if (days.has(d)) return true;
      return false;
    }).length;
    return back / members.length;
  };

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([c, members]) => ({
      cohort_day: dayKey(c),
      size: members.length,
      d1: rate(c, members, RETENTION_WINDOWS.d1),
      d7: rate(c, members, RETENTION_WINDOWS.d7),
      d30: rate(c, members, RETENTION_WINDOWS.d30),
    }));
};

// ---------------------------------------------------------------- summary (project_stats)

export interface ProjectSummary {
  raw_dau: number;
  organic_dau: number;
  raw_wau: number;
  organic_wau: number;
  raw_mau: number;
  organic_mau: number;
  organic_wau_prev: number;
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
  score_provisional: boolean;
  flag_counts: Record<WalletFlag, number>;
  top_methods: { method: string; count: number }[];
}

export const summarize = (
  txs: readonly ProjectTx[],
  flags: WalletFlags,
  organic: ReadonlySet<string>,
  cohortRows: readonly CohortRow[],
  prices: ReadonlyMap<number, DayPrice | null>,
  asOf: number,
): ProjectSummary => {
  /** Txs in the rolling window (asOf − n days, asOf], or (asOf − to, asOf − from] with an offset. */
  const inWindow = (days: number, offsetDays = 0) =>
    txs.filter((t) => t.ts > asOf - (days + offsetDays) * DAY_MS && t.ts <= asOf - offsetDays * DAY_MS);
  const walletsOf = (list: readonly ProjectTx[]) => new Set(list.flatMap((t) => t.wallets));
  const countOrganic = (ws: Set<string>) => [...ws].filter((w) => organic.has(w)).length;

  const d = walletsOf(inWindow(ACTIVE_WINDOW_DAYS.dau));
  const w = walletsOf(inWindow(ACTIVE_WINDOW_DAYS.wau));
  const m = walletsOf(inWindow(ACTIVE_WINDOW_DAYS.mau));
  const wPrev = walletsOf(inWindow(ACTIVE_WINDOW_DAYS.wau, ACTIVE_WINDOW_DAYS.wau));
  const organicWau = countOrganic(w);
  const organicWauPrev = countOrganic(wPrev);
  const all = walletsOf(txs);

  const win = inWindow(SCORE_WINDOW_DAYS);
  const winWallets = walletsOf(win);
  const native = win.reduce((s, t) => s + t.nativeInWei, 0n);
  const qusdc = win.reduce((s, t) => s + t.qusdcInRaw, 0n);
  const usdParts = win.map((t) => txUsd(t, prices.get(t.day)));
  const usd = usdParts.some((x) => x === null) ? null : usdParts.reduce<number>((s, x) => s + (x ?? 0), 0);

  // concentration: share of the window's txs from its top 10 wallets (by primary wallet)
  const perWallet = new Map<string, number>();
  for (const t of win) perWallet.set(t.primary, (perWallet.get(t.primary) ?? 0) + 1);
  const top10 = [...perWallet.values()].sort((a, b) => b - a).slice(0, CONCENTRATION_TOP_N).reduce((s, x) => s + x, 0);
  const top10Share = win.length ? top10 / win.length : null;

  const fresh = [...winWallets].filter((x) => flags.get(x)?.has('fresh_single')).length;
  const freshShare = winWallets.size ? fresh / winWallets.size : null;
  const organicShare = winWallets.size ? countOrganic(winWallets) / winWallets.size : null;

  // D7: size-weighted mean over organic cohorts in the window whose day 7–13 has passed
  const today = dayIndex(asOf);
  const done = cohortRows.filter((c) => c.d7 !== null && Date.parse(`${c.cohort_day}T00:00:00Z`) / DAY_MS > today - SCORE_WINDOW_DAYS);
  const doneSize = done.reduce((s, c) => s + c.size, 0);
  const d7 = doneSize ? done.reduce((s, c) => s + c.d7! * c.size, 0) / doneSize : null;

  let score: number | null = null;
  let provisional = false;
  if (organicShare !== null && top10Share !== null && freshShare !== null) {
    const W = VERUM_SCORE_WEIGHTS;
    const base = W.organicShare * organicShare + W.oneMinusTop10TxShare * (1 - top10Share) + W.oneMinusFreshSingleShare * (1 - freshShare);
    if (d7 === null) {
      provisional = true;
      score = (base * 100) / (W.organicShare + W.oneMinusTop10TxShare + W.oneMinusFreshSingleShare);
    } else {
      score = base + W.d7Retention * d7;
    }
    score = Math.min(100, Math.max(0, score));
  }

  const flagCounts = { team: 0, bot: 0, burst: 0, fresh_single: 0 } as Record<WalletFlag, number>;
  for (const f of flags.values()) for (const k of f.keys()) flagCounts[k]++;

  const methods = new Map<string, number>();
  for (const t of txs) if (t.method) methods.set(t.method, (methods.get(t.method) ?? 0) + 1);

  return {
    raw_dau: d.size,
    organic_dau: countOrganic(d),
    raw_wau: w.size,
    organic_wau: organicWau,
    raw_mau: m.size,
    organic_mau: countOrganic(m),
    organic_wau_prev: organicWauPrev,
    growth_7d: organicWauPrev ? (organicWau - organicWauPrev) / organicWauPrev : null,
    cumulative_wallets: all.size,
    cumulative_organic: countOrganic(all),
    tx_count_30d: win.length,
    success_rate_30d: win.length ? win.filter((t) => t.success).length / win.length : null,
    qie_volume_30d: formatUnits(native, WEI_DECIMALS),
    qusdc_volume_30d: formatUnits(qusdc, QUSDC.decimals),
    usd_volume_30d: usd === null ? null : usd.toFixed(6),
    organic_share_30d: organicShare,
    d7_retention_30d: d7,
    top10_share_30d: top10Share,
    fresh_single_share_30d: freshShare,
    verum_score: score,
    score_provisional: provisional,
    flag_counts: flagCounts,
    top_methods: [...methods.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([method, count]) => ({ method, count })),
  };
};
