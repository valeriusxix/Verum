import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowKey } from '../src/ingest/normalize';
import { loadMainnetFixture } from './fixtures';

const fx = loadMainnetFixture();
const by = (label: string) => fx.contracts.find((c) => c.label === label)!.address;
const count = (contract: string, kind: string) => fx.rows.filter((r) => r.contract === contract && r.kind === kind).length;

test('fixture row counts per contract and stream', () => {
  // Explorer equality (txlist / txlistinternal / tokentx(QUSDC)) was verified at block 12,043,185,
  // where the pair had 4,510 ext rows; its 6 later ext rows arrived via incremental sync.
  const counts = (label: string) => ['ext', 'int', 'token'].map((k) => count(by(label), k));
  assert.deepEqual(counts('QUSDC'), [358, 341, 0]);
  assert.deepEqual(counts('Router'), [2406, 311, 0]);
  assert.deepEqual(counts('WQIE'), [1568, 282, 0]);
  assert.deepEqual(counts('WQIE/QUSDC pair'), [4516, 12650, 1414]);
  assert.equal(fx.rows.length, 23846);
  assert.deepEqual(fx.meta.synced_to_blocks, [12046129]);
});

test('every row has its top-level sender, nonce and a real selector', () => {
  assert.equal(new Set(fx.rows.map(rowKey)).size, fx.rows.length, 'primary keys unique');
  assert.equal(fx.rows.filter((r) => r.origin_addr === null).length, 0, 'origin');
  assert.equal(fx.rows.filter((r) => r.nonce === null).length, 0, 'nonce');
  for (const r of fx.rows.filter((r) => r.kind === 'ext')) assert.equal(r.origin_addr, r.from_addr);
  // txlistinternal's `input` is not calldata; int rows carry the top-level selector instead
  assert.equal(fx.rows.filter((r) => r.kind === 'int' && (r.selector === null || r.selector === '0x00000000')).length, 0);
});

test('the same internal call is kept for each tracked contract it touches', () => {
  const groups = new Map<string, Set<string>>();
  for (const r of fx.rows.filter((r) => r.kind === 'int')) {
    const k = `${r.hash}|${r.log_index}`;
    groups.set(k, (groups.get(k) ?? new Set()).add(r.contract));
  }
  assert.equal([...groups.values()].filter((s) => s.size > 1).length, 24);
});

test('QUSDC transfers: real token, exact 6-decimal raw amounts', () => {
  const tok = fx.rows.filter((r) => r.kind === 'token');
  assert.ok(tok.every((r) => r.token === '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5'));
  const total = tok.reduce((s, r) => s + BigInt(r.token_amount!), 0n);
  assert.equal(total, 90_077_382_670n); // 90,077.38267 QUSDC
});

test('rows are well-formed: lowercase addresses, real timestamps, decimal-string values', () => {
  const hex = /^0x[0-9a-f]{40}$/;
  for (const r of fx.rows) {
    assert.match(r.contract, hex);
    assert.match(r.from_addr, hex);
    assert.ok(r.ts.getTime() > Date.parse('2025-01-01'), 'timestamp');
    assert.match(r.value_wei, /^\d+$/);
  }
});
