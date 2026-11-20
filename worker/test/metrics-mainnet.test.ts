/**
 * §12: each metric tested against a fixture of real mainnet txs. Expected values come from
 * INDEPENDENT SQL written from the metric definitions, run on the same frozen DB state on
 * 20 Nov 2026 (as_of 16:03:25Z), not from this code:
 *  - tx counts, wallets, windows, volumes: SQL over the raw rows;
 *  - flags: every §5.3 rule re-implemented in SQL (team, bot 24 h + interval CV + system address,
 *    burst sliding 10-min window, fresh_single with eth_getTransactionCount); 0 wallet-level differences;
 *  - organic counts and top-10 share: SQL using those SQL flags, not the rollup's.
 * The score is then checked against the §5.3 formula over those inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERUM_SCORE_WEIGHTS as W } from '@verum/shared';
import { cohorts, dailyMetrics, organicSet, summarize } from '../src/metrics/compute';
import { computeFlags } from '../src/metrics/flags';
import { buildProjectTxs, dayIndex } from '../src/metrics/model';
import { dayPrices } from '../src/metrics/prices';
import { loadMainnetFixture } from './fixtures';

const fx = loadMainnetFixture();
const asOf = Date.parse(fx.meta.as_of);

const run = (slug: string) => {
  const contracts = fx.contracts.filter((c) => c.project === slug);
  const set = new Set(contracts.map((c) => c.address));
  const txs = buildProjectTxs(fx.rows.filter((r) => set.has(r.contract)), set);
  const creators = new Map(contracts.filter((c) => c.creator_address).map((c) => [c.creator_address!, c.address]));
  const owner = fx.projects.find((p) => p.slug === slug)!.owner_address;
  const flags = computeFlags({ txs, creators, owner, teamWallets: [], chainTxCount: fx.chainTxCounts });
  const organic = organicSet(txs, flags);
  const prices = dayPrices(fx.priceTicks, txs[0]!.day, dayIndex(asOf));
  const daily = dailyMetrics(txs, organic, prices, asOf);
  const coh = cohorts(txs, organic, asOf);
  const summary = summarize(txs, flags, organic, coh, prices, asOf);
  const flagCounts = Object.fromEntries(
    Object.entries(summary.flag_counts).filter(([, n]) => n > 0),
  );
  return { txs, daily, coh, summary, flagCounts };
};

const sumBig = (xs: string[], decimals: number) =>
  xs.reduce((s, x) => {
    const [i = '0', f = ''] = x.split('.');
    return s + BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals));
  }, 0n);

// Expected values: independent SQL at the frozen state (see file header).
const EXPECTED = {
  qusdc: { txs: 648, wallets: 102, organic: 101, raw_wau: 9, organic_mau: 15, tx_30d: 42, native_wei: 0n, qusdc_raw: 0n, top10: 0.880952,
    flags: { team: 1, fresh_single: 4 } },
  qiedex: { txs: 19921, wallets: 282, organic: 251, raw_wau: 17, organic_mau: 35, tx_30d: 2406, top10: 0.976309,
    native_wei: 1_913_542_085_766_244_963_738_893n, qusdc_raw: 47_354_477_417n,
    flags: { team: 2, bot: 10, burst: 20, fresh_single: 4 } },
} as const;

for (const slug of ['qusdc', 'qiedex'] as const) {
  const e = EXPECTED[slug];
  const r = run(slug);

  test(`${slug}: tx count = distinct tx hashes (incl. token-only txs)`, () => {
    assert.equal(r.txs.length, e.txs);
    assert.equal(r.daily.reduce((s, d) => s + d.tx_count, 0), e.txs);
  });

  test(`${slug}: unique wallets, cumulative and organic`, () => {
    assert.equal(r.summary.cumulative_wallets, e.wallets);
    assert.equal(r.summary.cumulative_organic, e.organic);
    // each wallet is "new" exactly once
    assert.equal(r.daily.reduce((s, d) => s + d.new_wallets, 0), e.wallets);
    for (const d of r.daily) assert.equal(d.new_wallets + d.returning_wallets, d.raw_dau);
  });

  test(`${slug}: rolling WAU / MAU and 30-day tx count`, () => {
    assert.equal(r.summary.raw_wau, e.raw_wau);
    assert.equal(r.summary.organic_mau, e.organic_mau);
    assert.equal(r.summary.tx_count_30d, e.tx_30d);
  });

  test(`${slug}: volume = inflow from outside the project (QIE and QUSDC)`, () => {
    assert.equal(sumBig(r.daily.map((d) => d.qie_volume), 18), e.native_wei);
    assert.equal(sumBig(r.daily.map((d) => d.qusdc_volume), 6), e.qusdc_raw);
  });

  test(`${slug}: organic-filter flag counts`, () => {
    assert.deepEqual(r.flagCounts, e.flags);
  });

  test(`${slug}: concentration = share of 30-day txs from the top 10 wallets`, () => {
    assert.ok(Math.abs(r.summary.top10_share_30d! - e.top10) < 5e-7);
  });

  test(`${slug}: Verum score follows the §5.3 formula over the 30-day inputs`, () => {
    const s = r.summary;
    assert.equal(s.score_provisional, s.d7_retention_30d === null);
    const expected = s.score_provisional
      ? ((W.organicShare * s.organic_share_30d! + W.oneMinusTop10TxShare * (1 - s.top10_share_30d!) +
          W.oneMinusFreshSingleShare * (1 - s.fresh_single_share_30d!)) * 100) / 75
      : W.organicShare * s.organic_share_30d! + W.d7Retention * s.d7_retention_30d! +
        W.oneMinusTop10TxShare * (1 - s.top10_share_30d!) + W.oneMinusFreshSingleShare * (1 - s.fresh_single_share_30d!);
    assert.ok(Math.abs(s.verum_score! - expected) < 1e-9);
    assert.ok(s.verum_score! >= 0 && s.verum_score! <= 100);
  });
}

test('USD: no price before 2026-10-01; every priced day = QIE × price + QUSDC', () => {
  const { daily } = run('qiedex');
  for (const d of daily) {
    if (d.day < '2026-10-01') assert.equal(d.qie_usd, null, d.day);
    if (d.usd_volume !== null) {
      const want = Number(d.qie_volume) * Number(d.qie_usd ?? 0) + Number(d.qusdc_volume);
      assert.ok(Math.abs(Number(d.usd_volume) - want) < 1e-4, d.day);
    } else {
      assert.ok(Number(d.qie_volume) > 0 && d.qie_usd === null, `${d.day}: USD null only when native volume had no price`);
    }
  }
  assert.equal(daily.find((d) => d.day === '2026-10-01')!.price_source, 'oracle');
});

test('retention stays empty until its window has passed', () => {
  const today = dayIndex(asOf);
  for (const c of run('qiedex').coh) {
    const day = dayIndex(Date.parse(`${c.cohort_day}T00:00:00Z`));
    assert.equal(c.d1 === null, day + 2 > today, `d1 ${c.cohort_day}`);
    assert.equal(c.d7 === null, day + 14 > today, `d7 ${c.cohort_day}`);
    assert.equal(c.d30 === null, day + 37 > today, `d30 ${c.cohort_day}`);
  }
});
