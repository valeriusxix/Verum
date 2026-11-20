/**
 * Hand-computed cases for each rule at its threshold (§5.3, §5.4, IMPLEMENTATION_NOTES).
 * Expected values are worked out by hand in the comments, not taken from the code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohorts, organicSet, summarize } from '../src/metrics/compute';
import { computeFlags, intervalCv, maxInWindow } from '../src/metrics/flags';
import { DAY_MS, buildProjectTxs, dayFromKey, type ProjectTx } from '../src/metrics/model';
import { dayPrices, type PriceTick } from '../src/metrics/prices';
import type { TxRow } from '../src/ingest/normalize';

const T0 = Date.parse('2026-11-01T00:00:00Z');
const MIN = 60_000;
const H = 3_600_000;
const POOL = '0x000000000000000000000000000000000000aaaa';
const ROUTER = '0x000000000000000000000000000000000000bbbb';
const OUTSIDE = '0x000000000000000000000000000000000000cccc';
const QUSDC = '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5';
const w = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;

let n = 0;
const row = (p: Partial<TxRow>): TxRow => ({
  hash: `0x${(++n).toString(16).padStart(64, '0')}`,
  kind: 'ext',
  log_index: -1,
  contract: POOL,
  block: n,
  ts: new Date(T0),
  from_addr: w(1),
  to_addr: POOL,
  origin_addr: w(1),
  nonce: 5,
  selector: '0x12345678',
  value_wei: '0',
  token: null,
  token_amount: null,
  success: true,
  gas_used: null,
  ...p,
});

/** One tx per (wallet, ts). */
const tx = (wallet: string, ts: number, extra: Partial<ProjectTx> = {}): ProjectTx => ({
  hash: `0x${(++n).toString(16).padStart(64, '0')}`,
  ts,
  day: Math.floor(ts / DAY_MS),
  block: n,
  wallets: [wallet],
  primary: wallet,
  nonce: 5,
  success: true,
  method: null,
  nativeInWei: 0n,
  qusdcInRaw: 0n,
  ...extra,
});
const flagsOf = (txs: ProjectTx[], chain = new Map<string, number>()) =>
  computeFlags({ txs, creators: new Map(), owner: null, teamWallets: [], chainTxCount: chain });

// ---------------------------------------------------------------- model

test('one swap stored under two project contracts counts once, with inflow volume only', () => {
  const contracts = new Set([POOL, ROUTER]);
  const h = '0x' + 'ab'.repeat(32);
  const rows = [
    row({ hash: h, kind: 'ext', contract: ROUTER, to_addr: ROUTER, from_addr: w(7), origin_addr: w(7), value_wei: '1000' }),
    // router -> pool internal call, stored under BOTH contracts (same hash/kind/log_index)
    row({ hash: h, kind: 'int', log_index: 1, contract: ROUTER, from_addr: ROUTER, to_addr: POOL, origin_addr: w(7), value_wei: '1000' }),
    row({ hash: h, kind: 'int', log_index: 1, contract: POOL, from_addr: ROUTER, to_addr: POOL, origin_addr: w(7), value_wei: '1000' }),
  ];
  const [t, ...rest] = buildProjectTxs(rows, contracts);
  assert.equal(rest.length, 0, 'one tx');
  assert.deepEqual(t!.wallets, [w(7)]);
  // 1000 wei enters the router from outside; router -> pool is inside the project, so not again
  assert.equal(t!.nativeInWei, 1000n);
});

test('internal value from outside counts; failed rows move nothing', () => {
  const contracts = new Set([POOL]);
  const h = '0x' + 'cd'.repeat(32);
  const rows = [
    row({ hash: h, kind: 'int', log_index: 1, from_addr: OUTSIDE, to_addr: POOL, origin_addr: w(8), value_wei: '500' }),
    row({ hash: h, kind: 'int', log_index: 2, from_addr: OUTSIDE, to_addr: POOL, origin_addr: w(8), value_wei: '300', success: false }),
  ];
  const [t] = buildProjectTxs(rows, contracts);
  assert.equal(t!.nativeInWei, 500n);
  assert.equal(t!.success, true, 'no ext row: succeeds if any row succeeded');
});

test('success: an ext row decides; QUSDC into the project counts its sender too', () => {
  const contracts = new Set([POOL]);
  const h = '0x' + 'ef'.repeat(32);
  const [t] = buildProjectTxs(
    [
      row({ hash: h, kind: 'ext', success: false, from_addr: w(9), origin_addr: w(9) }),
      row({ hash: h, kind: 'token', log_index: 3, from_addr: w(10), to_addr: POOL, origin_addr: w(9), token: QUSDC, token_amount: '2500000', selector: '0x38ed1739' }),
    ],
    contracts,
  );
  assert.equal(t!.success, false);
  assert.deepEqual(t!.wallets.sort(), [w(9), w(10)].sort());
  assert.equal(t!.qusdcInRaw, 2_500_000n);
  assert.equal(t!.method, '0x12345678', 'ext selector wins over the top-level selector on other rows');
});

test('a tx touching the project only through an outbound transfer still counts (for its top-level sender)', () => {
  const contracts = new Set([POOL]);
  const [t] = buildProjectTxs(
    [row({ kind: 'token', log_index: 0, from_addr: POOL, to_addr: w(11), origin_addr: w(12), token: QUSDC, token_amount: '1', selector: '0x45fd0465' })],
    contracts,
  );
  assert.deepEqual(t!.wallets, [w(12)]);
  assert.equal(t!.qusdcInRaw, 0n, 'outbound is not inflow');
  assert.equal(t!.method, '0x45fd0465');
});

// ---------------------------------------------------------------- organic filter

test('bot: 200 txs inside 24 h is a bot; 199 is not', () => {
  // Gaps alternate 1 min and 13 min (mean 7, std 6 -> interval CV ≈ 0.86, so the clockwork rule
  // stays out of it). 200 txs span 100 × 1 + 99 × 13 = 1,387 min ≈ 23.1 h.
  const at = (k: number) => T0 + (Math.ceil(k / 2) * 1 + Math.floor(k / 2) * 13) * MIN;
  const a = Array.from({ length: 200 }, (_, k) => tx(w(20), at(k)));
  const b = Array.from({ length: 199 }, (_, k) => tx(w(21), at(k)));
  assert.ok(intervalCv(a.map((t) => t.ts)) > 0.8);
  assert.ok(a.at(-1)!.ts - a[0]!.ts < 24 * H);
  const f = flagsOf([...a, ...b]);
  assert.match(f.get(w(20))?.get('bot') ?? '', /^200 txs within 24 h/);
  assert.equal(f.get(w(21))?.has('bot') ?? false, false);
});

test('bot: clockwork timing (CV < 0.1 over ≥ 50 txs)', () => {
  // exactly 1 h apart: intervals all equal, CV = 0
  const clock = Array.from({ length: 50 }, (_, k) => tx(w(22), T0 + k * H));
  // 49 txs: too few to judge
  const few = Array.from({ length: 49 }, (_, k) => tx(w(23), T0 + k * H));
  const f = flagsOf([...clock, ...few]);
  assert.match(f.get(w(22))?.get('bot') ?? '', /interval CV 0\.000 over 50 txs/);
  assert.equal(f.get(w(23))?.has('bot') ?? false, false);
  // intervals 1 h and 3 h alternating: mean 2 h, std 1 h -> CV 0.5
  assert.ok(Math.abs(intervalCv([0, 1, 4, 5, 8].map((x) => x * H)) - 0.5) < 1e-12);
});

test('bot: sustained volume, 1,000 txs within 7 days is a bot; 999 is not (20 Nov rule)', () => {
  // Gaps alternate 60 s and 1,149.6 s: mean 604.8 s (= 7 days / 1,000), CV ≈ 0.9, and any 24 h holds
  // at most ~143 txs, so neither §5.3 rule fires. 1,000 txs span 999 gaps ≈ 6.99 days.
  const at = (k: number) => T0 + (Math.ceil(k / 2) * 60_000 + Math.floor(k / 2) * 1_149_600);
  const a = Array.from({ length: 1000 }, (_, k) => tx(w(30), at(k)));
  const b = Array.from({ length: 999 }, (_, k) => tx(w(31), at(k)));
  const times = a.map((t) => t.ts);
  assert.ok(intervalCv(times) > 0.8);
  assert.ok(maxInWindow(times, 24 * H).count < 200);
  assert.ok(times.at(-1)! - times[0]! < 7 * DAY_MS);
  const f = flagsOf([...a, ...b]);
  assert.match(f.get(w(30))?.get('bot') ?? '', /^1000 txs within 7 days/);
  assert.equal(f.get(w(31))?.has('bot') ?? false, false);
});

test('known system address is a bot', () => {
  const sys = '0x725ccc2c1c86c9bc31a90020128d99ff8d351aa0';
  assert.match(flagsOf([tx(sys, T0)]).get(sys)?.get('bot') ?? '', /system/);
});

test('burst: 20 first-ever txs within 10 min are flagged; 19 are not', () => {
  const twenty = Array.from({ length: 20 }, (_, k) => tx(w(100 + k), T0 + k * 30_000, { nonce: 0 })); // 9.5 min span
  const nineteen = Array.from({ length: 19 }, (_, k) => tx(w(200 + k), T0 + DAY_MS + k * 30_000, { nonce: 0 }));
  const f = flagsOf([...twenty, ...nineteen]);
  assert.equal([...f.values()].filter((m) => m.has('burst')).length, 20);
  assert.match(f.get(w(100))!.get('burst')!, /^one of 20 wallets/);
  assert.equal(f.get(w(200))?.has('burst') ?? false, false);
});

test('burst: 20 first-ever txs spread over just over 10 min are not a burst', () => {
  const spread = Array.from({ length: 20 }, (_, k) => tx(w(300 + k), T0 + k * 31_600, { nonce: 0 })); // 19 × 31.6 s = 10.01 min
  assert.equal([...flagsOf(spread).values()].filter((m) => m.has('burst')).length, 0);
  assert.equal(maxInWindow(spread.map((t) => t.ts), 10 * MIN).count, 19);
});

test('fresh_single needs: one tx with the project, nonce 0, and exactly 1 tx chain-wide', () => {
  const txs = [
    tx(w(400), T0, { nonce: 0 }), // only chain activity -> fresh_single
    tx(w(401), T0, { nonce: 0 }), // went on to send 3 txs elsewhere -> not
    tx(w(402), T0, { nonce: 4 }), // not their first tx -> not
    tx(w(403), T0, { nonce: 0 }),
    tx(w(403), T0 + H), // 2 txs with the project -> not
  ];
  const chain = new Map([[w(400), 1], [w(401), 3], [w(402), 1], [w(403), 2]]);
  const f = flagsOf(txs, chain);
  assert.deepEqual([...f].filter(([, m]) => m.has('fresh_single')).map(([a]) => a), [w(400)]);
  assert.ok(organicSet(txs, f).has(w(400)), 'fresh_single is a soft flag: still organic');
});

test('team: creators, owner and listed team wallets are not organic', () => {
  const txs = [tx(w(500), T0), tx(w(501), T0), tx(w(502), T0), tx(w(503), T0)];
  const f = computeFlags({
    txs,
    creators: new Map([[w(500), POOL]]),
    owner: w(501),
    teamWallets: [w(502)],
    chainTxCount: new Map(),
  });
  assert.deepEqual([...organicSet(txs, f)], [w(503)]);
});

// ---------------------------------------------------------------- prices

test('day price: oracle median wins over explorer; carry forward 7 days, not 8; nothing before Oct 1', () => {
  const d = (k: string, h = 12) => Date.parse(`${k}T${String(h).padStart(2, '0')}:00:00Z`);
  const ticks: PriceTick[] = [
    { ts: d('2026-09-30'), qieUsd: 0.5, source: 'oracle' }, // before the history start: ignored
    { ts: d('2026-10-02', 1), qieUsd: 0.1, source: 'oracle' },
    { ts: d('2026-10-02', 2), qieUsd: 0.3, source: 'oracle' },
    { ts: d('2026-10-02', 3), qieUsd: 0.2, source: 'oracle' },
    { ts: d('2026-10-02', 4), qieUsd: 9.9, source: 'explorer' }, // oracle exists that day: ignored
    { ts: d('2026-10-20'), qieUsd: 0.4, source: 'explorer' },
  ];
  const p = dayPrices(ticks, dayFromKey('2026-09-30'), dayFromKey('2026-10-20'));
  const at = (k: string) => p.get(dayFromKey(k));
  assert.equal(at('2026-09-30'), null);
  assert.equal(at('2026-10-01'), null, 'no tick yet, nothing to carry');
  assert.deepEqual(at('2026-10-02'), { qieUsd: 0.2, source: 'oracle', fromDay: dayFromKey('2026-10-02') });
  assert.equal(at('2026-10-09')?.qieUsd, 0.2, 'carried 7 days');
  assert.equal(at('2026-10-10'), null, '8 days: too stale');
  assert.equal(at('2026-10-20')?.source, 'explorer');
});

// ---------------------------------------------------------------- cohorts and score

test('retention windows: D1 = day 1, D7 = days 7–13; empty until the window has passed', () => {
  const day = (k: number) => T0 + k * DAY_MS + H;
  const txs = [tx(w(600), day(0)), tx(w(600), day(1)), tx(w(601), day(0)), tx(w(601), day(13)), tx(w(602), day(0)), tx(w(602), day(14))];
  const organic = new Set([w(600), w(601), w(602)]);
  const [c] = cohorts(txs, organic, day(30));
  assert.equal(c!.size, 3);
  assert.equal(c!.d1, 1 / 3); // only w600 on day 1
  assert.equal(c!.d7, 1 / 3); // w601 on day 13 is in; w602 on day 14 is not
  assert.equal(c!.d30, null); // day 30 is still in progress
  assert.equal(cohorts(txs, organic, day(13))[0]!.d7, null, 'day 13 still in progress');
});

test('score is provisional (3 terms rescaled) until a D7 window has passed', () => {
  // 4 organic wallets, 1 tx each, all within the last day: no completed cohort
  const now = T0 + 40 * DAY_MS;
  const txs = [0, 1, 2, 3].map((i) => tx(w(700 + i), now - H));
  const f = flagsOf(txs);
  const organic = organicSet(txs, f);
  const s = summarize(txs, f, organic, cohorts(txs, organic, now), new Map(), now);
  assert.equal(s.score_provisional, true);
  // organic share 1, top-10 share 1 (4 wallets hold all txs), fresh share 0:
  // (40·1 + 20·(1−1) + 15·(1−0)) / 75 × 100 = 73.33…
  assert.ok(Math.abs(s.verum_score! - (55 / 75) * 100) < 1e-9);
});
