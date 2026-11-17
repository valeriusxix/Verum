import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOrganic, verumScore } from './metrics';
import { addressSchema, explorerTxlistResponseSchema, slugSchema } from './schemas';

test('verumScore: perfect and worst inputs hit the bounds', () => {
  assert.equal(verumScore({ organicShare: 1, d7Retention: 1, top10TxShare: 0, freshSingleShare: 0 }), 100);
  assert.equal(verumScore({ organicShare: 0, d7Retention: 0, top10TxShare: 1, freshSingleShare: 1 }), 0);
});

test('verumScore: weights match the published formula', () => {
  // 40·0.5 + 25·0.2 + 20·(1−0.6) + 15·(1−0.1) = 20 + 5 + 8 + 13.5
  const s = verumScore({ organicShare: 0.5, d7Retention: 0.2, top10TxShare: 0.6, freshSingleShare: 0.1 });
  assert.ok(Math.abs(s - 46.5) < 1e-9);
});

test('isOrganic: team/bot/burst exclude, fresh_single does not', () => {
  assert.equal(isOrganic([]), true);
  assert.equal(isOrganic(['fresh_single']), true);
  for (const f of ['team', 'bot', 'burst'] as const) assert.equal(isOrganic([f]), false);
});

test('schemas: slug and address rules', () => {
  assert.ok(slugSchema.safeParse('verum').success);
  assert.ok(!slugSchema.safeParse('ab').success);
  assert.ok(!slugSchema.safeParse('Verum').success);
  assert.equal(
    addressSchema.parse('0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5'),
    '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5',
  );
});

test('schemas: txlist envelope accepts the live empty and error shapes', () => {
  // Captured from mainnet.qie.digital on 16 Nov 2026.
  assert.ok(
    explorerTxlistResponseSchema.safeParse({ message: 'No transactions found', result: [], status: '0' }).success,
  );
  assert.ok(
    explorerTxlistResponseSchema.safeParse({ message: 'Invalid address format', result: null, status: '0' }).success,
  );
});
