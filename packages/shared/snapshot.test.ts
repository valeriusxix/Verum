import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, stringToBytes } from 'viem';
import { canonicalJson, metricsHash } from './snapshot';

test('canonical JSON: sorted keys at every depth, no whitespace, undefined dropped', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: null, y: true }], c: 'x' }, u: undefined }),
    '{"a":{"c":"x","d":[3,{"y":true,"z":null}]},"b":1}');
});

test('key order and formatting of the input never change the hash', () => {
  const a = metricsHash({ raw_dau: 5, day: '2026-11-20', usd_volume: '12.5' });
  const b = metricsHash({ usd_volume: '12.5', day: '2026-11-20', raw_dau: 5 });
  assert.equal(a, b);
  assert.equal(a, keccak256(stringToBytes('{"day":"2026-11-20","raw_dau":5,"usd_volume":"12.5"}')));
});

test('strings are JSON-escaped; non-finite numbers are rejected', () => {
  assert.equal(canonicalJson({ s: 'a"b\\cé' }), '{"s":"a\\"b\\\\cé"}');
  assert.throws(() => canonicalJson({ x: Number.NaN }));
  assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }));
});
