import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectStatsDto } from '@verum/shared';
import { createApp, encodeCursor } from '../src/app';
import { TtlCache } from '../src/cache';
import { combineSync, ownershipOf, type Repo } from '../src/repo';

const NOW = Date.parse('2026-11-20T12:00:00Z');

const stats = (over: Partial<ProjectStatsDto> = {}): ProjectStatsDto => ({
  as_of: '2026-11-20T11:50:00.000Z', raw_dau: 6, organic_dau: 6, raw_wau: 17, organic_wau: 17, raw_mau: 35, organic_mau: 35,
  growth_7d: -0.15, cumulative_wallets: 282, cumulative_organic: 251, tx_count_30d: 2406, success_rate_30d: 0.998,
  qie_volume_30d: '84255.3958', qusdc_volume_30d: '5258.222441', usd_volume_30d: '16022.473703', organic_share_30d: 1,
  d7_retention_30d: 0, top10_share_30d: 0.976, fresh_single_share_30d: 0.028, verum_score: 55.0452, score_provisional: false,
  flag_counts: { team: 2, bot: 10, burst: 20, fresh_single: 4 }, top_methods: [], ...over,
});

const calls: string[] = [];
const fakeRepo: Repo = {
  async listProjects(p) {
    calls.push(`list:${p.sort}:${p.limit}:${p.offset}:${p.track ?? '-'}`);
    const all = ['a-proj', 'b-proj', 'c-proj'].map((slug, i) => ({
      rank: i + 1, slug, name: slug, track: 5, claimed: false, logo_url: null, contracts: 1,
      organic_wau: 10 - i, raw_wau: 12, growth_7d: null, d7_retention: null, verum_score: 50, score_provisional: false,
    }));
    const items = all.slice(p.offset, p.offset + p.limit).map((x, i) => ({ ...x, rank: p.offset + i + 1 }));
    return { items, hasMore: p.offset + p.limit < all.length };
  },
  async getProject(slug) {
    return slug === 'qiedex'
      ? { project: { slug, name: 'QIEDEX', track: null, owner_address: null, onchain_project_id: null, claimed: false, website: null,
          repo: null, logo_url: null, created_at: '2026-11-19T00:00:00.000Z', contracts: [], stats: stats() }, priceSource: 'oracle' }
      : null;
  },
  async projectId(slug) {
    calls.push(`id:${slug}`);
    return slug === 'qiedex' ? 2 : null;
  },
  async metrics(_id, range, today) {
    calls.push(`metrics:${range}:${today}`);
    return [
      { day: '2026-11-19', raw_dau: 5, organic_dau: 5, new_wallets: 1, returning_wallets: 4, tx_count: 9, success_rate: 1, qie_volume: '1',
        usd_volume: '0.16', qusdc_volume: '0', qie_usd: '0.16', price_source: 'oracle', price_day: '2026-11-19' },
      { day: '2026-11-20', raw_dau: 2, organic_dau: 2, new_wallets: 0, returning_wallets: 2, tx_count: 3, success_rate: 1, qie_volume: '0',
        usd_volume: '0', qusdc_volume: '0', qie_usd: '0.164', price_source: 'explorer', price_day: '2026-11-20' },
    ];
  },
  async cohorts() { return []; },
  async flags(_id, flag) { calls.push(`flags:${flag ?? '-'}`); return [{ address: '0xabc', flag: 'bot', reason: '250 txs within 24 h' }]; },
  async milestones() { return { clock: { starts: '2026-12-10', ends: '2027-03-10', days_left: 90 }, items: [] }; },
  async snapshots() { return []; },
  async snapshot(_id, date) {
    return date === '2026-11-19'
      ? { period_end: date, metrics_hash: '0x' + '1'.repeat(64), tx_hash: null, payload: { b: 1, a: 2 }, canonical: '{"a":2,"b":1}' }
      : null;
  },
  async sync() { return { status: 'backfilling', last_synced_block: null, progress: 0.4 }; },
  async pulse() {
    return { as_of: '2026-11-20T11:50:00.000Z', day: '2026-11-20', txs_today: 1640, system_txs_today: 550, real_share: 0.665,
      qie_usd: '0.1644', price_source: 'explorer', oracle_health: [], projects_tracked: 3, contracts_tracked: 5 };
  },
  async badgeStats(slug) {
    if (slug === 'qiedex') return stats();
    if (slug === 'broq') return stats({ verum_score: 55.6, score_provisional: true });
    if (slug === 'fresh') return null;
    return undefined;
  },
};

const app = () => createApp(fakeRepo, { now: () => NOW, cache: new TtlCache(100, () => NOW), log: () => {} });
const get = async (a: ReturnType<typeof app>, path: string) => {
  const res = await a.request(`http://api.test${path}`);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* svg */ }
  return { res, text, json };
};

test('envelope: {data, meta:{generated_at, price_source}} on every success', async () => {
  const { res, json } = await get(app(), '/v1/projects/qiedex');
  assert.equal(res.status, 200);
  assert.equal(json.data.slug, 'qiedex');
  assert.deepEqual(Object.keys(json.meta).sort(), ['generated_at', 'price_source']);
  assert.equal(json.meta.generated_at, '2026-11-20T12:00:00.000Z');
  assert.equal(json.meta.price_source, 'oracle', 'project detail says which price source its USD figures use');
});

test('metrics: range validated, today passed in UTC, meta.price_source = latest priced day', async () => {
  const a = app();
  const { json } = await get(a, '/v1/projects/qiedex/metrics?range=7d');
  assert.equal(json.data.length, 2);
  assert.equal(json.meta.price_source, 'explorer');
  assert.ok(calls.includes('metrics:7d:2026-11-20'));
  const bad = await get(a, '/v1/projects/qiedex/metrics?range=1y');
  assert.equal(bad.res.status, 400);
  assert.equal(bad.json.error.code, 'bad_request');
  assert.equal(bad.json.error.issues[0].path, 'range');
});

test('bad slug -> 400; unknown project -> 404 with a JSON error', async () => {
  const a = app();
  assert.equal((await get(a, '/v1/projects/Bad_Slug')).res.status, 400);
  const nf = await get(a, '/v1/projects/nope-nope/cohorts');
  assert.equal(nf.res.status, 404);
  assert.deepEqual(nf.json, { error: { code: 'not_found', message: 'project "nope-nope" not found' } });
  assert.equal((await get(a, '/v1/nothing-here')).res.status, 404);
});

test('flags filter validated against the four §5.3 flags', async () => {
  const a = app();
  assert.equal((await get(a, '/v1/projects/qiedex/flags?flag=bot')).res.status, 200);
  assert.ok(calls.includes('flags:bot'));
  assert.equal((await get(a, '/v1/projects/qiedex/flags?flag=whale')).res.status, 400);
});

test('projects: sort/limit validated, opaque cursor pages through', async () => {
  const a = app();
  const p1 = await get(a, '/v1/projects?sort=verum_score&limit=2');
  assert.deepEqual(p1.json.data.items.map((x: any) => x.rank), [1, 2]);
  assert.equal(p1.json.data.next_cursor, encodeCursor(2));
  const p2 = await get(a, `/v1/projects?sort=verum_score&limit=2&cursor=${p1.json.data.next_cursor}`);
  assert.deepEqual(p2.json.data.items.map((x: any) => [x.rank, x.slug]), [[3, 'c-proj']]);
  assert.equal(p2.json.data.next_cursor, null);
  assert.equal((await get(a, '/v1/projects?sort=hype')).res.status, 400);
  assert.equal((await get(a, '/v1/projects?limit=1000')).res.status, 400);
  assert.equal((await get(a, '/v1/projects?cursor=garbage')).res.status, 400);
});

test('snapshot: canonical payload served; unknown date -> 404; bad date -> 400', async () => {
  const a = app();
  const s = await get(a, '/v1/projects/qiedex/snapshots/2026-11-19');
  assert.equal(s.json.data.canonical, '{"a":2,"b":1}');
  assert.equal((await get(a, '/v1/projects/qiedex/snapshots/2026-11-18')).res.status, 404);
  assert.equal((await get(a, '/v1/projects/qiedex/snapshots/yesterday')).res.status, 400);
});

test('caching: 60 s for data, 5 s for sync, 10 min for badges; second hit served from cache; errors not cached', async () => {
  const a = app();
  const first = await get(a, '/v1/projects/qiedex/cohorts');
  assert.equal(first.res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(first.res.headers.get('x-cache'), 'MISS');
  const n = calls.length;
  const second = await get(a, '/v1/projects/qiedex/cohorts');
  assert.equal(second.res.headers.get('x-cache'), 'HIT');
  assert.equal(calls.length, n, 'repo not called again');
  assert.equal(second.text, first.text);
  assert.equal((await get(a, '/v1/projects/qiedex/sync')).res.headers.get('cache-control'), 'public, max-age=5');
  assert.equal((await get(a, '/badge/qiedex.svg')).res.headers.get('cache-control'), 'public, max-age=600');
  assert.equal((await get(a, '/v1/projects/nope-nope')).res.headers.get('cache-control'), 'no-store');
});

test('CORS is open', async () => {
  const res = await app().request('http://api.test/v1/chain/pulse', { headers: { origin: 'https://example.com' } });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('pulse carries its price source into meta', async () => {
  const { json } = await get(app(), '/v1/chain/pulse');
  assert.equal(json.meta.price_source, 'explorer');
  assert.equal(json.data.real_share, 0.665);
});

test('badge: SVG for known, provisional, indexing and unknown projects', async () => {
  const a = app();
  const ok = await get(a, '/badge/qiedex.svg');
  assert.equal(ok.res.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.match(ok.text, /aria-label="Verum WAU: 17"/);
  assert.match(ok.text, /fill="#4FD6B0"/);
  const prov = await get(a, '/badge/broq.svg?metric=verum_score');
  assert.match(prov.text, /Verum score: 56 · provisional/);
  assert.match((await get(a, '/badge/fresh.svg')).text, /Verum WAU: indexing/);
  const unknown = await get(a, '/badge/nope-nope.svg');
  assert.equal(unknown.res.status, 200, 'GitHub shows a broken image for non-2xx badges');
  assert.match(unknown.text, /^<svg/);
  assert.match(unknown.text, /Verum: not found/);
  assert.equal((await get(a, '/badge/qiedex.svg?metric=hype')).res.status, 400);
  assert.equal((await get(a, '/badge/qiedex.png')).res.status, 404);
});

test('sync status: worst contract wins; block is the slowest contract', () => {
  assert.deepEqual(
    combineSync([
      { status: 'synced', progress: 1, last_synced_block: 100 },
      { status: 'backfilling', progress: 0.5, last_synced_block: null },
    ]),
    { status: 'backfilling', last_synced_block: null, progress: 0.75 },
  );
  assert.equal(combineSync([{ status: 'synced', progress: 1, last_synced_block: 100 }, { status: 'synced', progress: 1, last_synced_block: 90 }]).last_synced_block, 90);
});

test('ownership: creator = owner -> verified; otherwise unverified claim; no owner -> unclaimed', () => {
  assert.equal(ownershipOf('0xa', '0xa', true), 'owner_verified');
  assert.equal(ownershipOf('0xb', '0xa', true), 'unverified_claim');
  assert.equal(ownershipOf('0xa', null, false), 'unclaimed');
});
