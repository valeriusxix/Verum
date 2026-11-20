/**
 * The 7-day sustained-volume bot rule on real data (owner decision, 20 Nov 2026). BROQPrediction's
 * keeper sent 12,678 of 12,807 txs at ~190/day with irregular timing (interval CV 0.86): it passes
 * both original §5.3 rules and is caught only by ≥ 1,000 txs in any 7 days. Expected values come
 * from independent SQL over the same frozen state (all flags incl. the 7-day rule: 0 differences).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { organicSet, summarize, cohorts } from '../src/metrics/compute';
import { computeFlags, intervalCv, maxInWindow, walletTimes } from '../src/metrics/flags';
import { buildProjectTxs, dayIndex } from '../src/metrics/model';
import { dayPrices } from '../src/metrics/prices';
import { loadBroqFixture } from './fixtures';

const fx = loadBroqFixture();
const asOf = Date.parse(fx.meta.as_of);
const KEEPER = '0xc111e7b1ce58bf342dcafd622d40949f0b3d3792';
const set = new Set(fx.contracts.map((c) => c.address));
const txs = buildProjectTxs(fx.rows, set);
const creators = new Map(fx.contracts.filter((c) => c.creator_address).map((c) => [c.creator_address!, c.address]));
const flags = computeFlags({ txs, creators, owner: null, teamWallets: [], chainTxCount: fx.chainTxCounts });
const organic = organicSet(txs, flags);

test('BROQ: 12,807 txs, 11 wallets, 9 organic (SQL)', () => {
  assert.equal(txs.length, 12807);
  assert.equal(new Set(txs.flatMap((t) => t.wallets)).size, 11);
  assert.equal(organic.size, 9);
  const counts: Record<string, number> = {};
  for (const m of flags.values()) for (const k of m.keys()) counts[k] = (counts[k] ?? 0) + 1;
  assert.deepEqual(counts, { team: 1, bot: 1 });
});

test('the keeper passes both original §5.3 rules and is caught only by the 7-day rule', () => {
  const t = walletTimes(txs).get(KEEPER)!;
  assert.equal(t.length, 12678);
  assert.ok(maxInWindow(t, 24 * 3_600_000).count < 200, 'under 200 in any 24 h');
  assert.ok(intervalCv(t) > 0.1, 'not clockwork');
  assert.ok(maxInWindow(t, 7 * 86_400_000).count >= 1000, '≥ 1,000 in some 7 days');
  assert.match(flags.get(KEEPER)!.get('bot')!, /^\d+ txs within 7 days from /);
  assert.ok(!organic.has(KEEPER));
});

test('BROQ score is provisional (no D7 window has passed in the last 30 days) and within 0–100', () => {
  const prices = dayPrices(fx.priceTicks, txs[0]!.day, dayIndex(asOf));
  const s = summarize(txs, flags, organic, cohorts(txs, organic, asOf), prices, asOf);
  assert.equal(s.score_provisional, true);
  assert.equal(s.d7_retention_30d, null);
  assert.ok(s.verum_score! >= 0 && s.verum_score! <= 100);
  assert.equal(s.organic_wau, 0, 'only the keeper was active this week');
});
