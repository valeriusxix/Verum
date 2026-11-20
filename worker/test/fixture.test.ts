import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowKey } from '../src/ingest/normalize';
import { loadMainnetFixture } from './fixtures';

const fx = loadMainnetFixture();
const by = (label: string) => fx.contracts.find((c) => c.label === label)!.address;
const count = (contract: string, kind: string) => fx.rows.filter((r) => r.contract === contract && r.kind === kind).length;

test('fixture matches the explorer counts verified at capture time', () => {
  // explorer txlist / txlistinternal at the same endblock, 20 Nov 2026
  assert.deepEqual([count(by('QUSDC'), 'ext'), count(by('QUSDC'), 'int')], [358, 341]);
  assert.deepEqual([count(by('Router'), 'ext'), count(by('Router'), 'int')], [2406, 311]);
  assert.deepEqual([count(by('WQIE'), 'ext'), count(by('WQIE'), 'int')], [1568, 282]);
  assert.equal(fx.rows.length, 5266);
});

test('primary keys are unique and every internal row has its top-level sender', () => {
  assert.equal(new Set(fx.rows.map(rowKey)).size, fx.rows.length);
  assert.equal(fx.rows.filter((r) => r.kind === 'int' && r.origin_addr === null).length, 0);
  for (const r of fx.rows.filter((r) => r.kind === 'ext')) assert.equal(r.origin_addr, r.from_addr);
});

test('the same internal call is kept for each tracked contract it touches', () => {
  const groups = new Map<string, Set<string>>();
  for (const r of fx.rows.filter((r) => r.kind === 'int')) {
    const k = `${r.hash}|${r.log_index}`;
    groups.set(k, (groups.get(k) ?? new Set()).add(r.contract));
  }
  assert.equal([...groups.values()].filter((s) => s.size > 1).length, 20);
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
