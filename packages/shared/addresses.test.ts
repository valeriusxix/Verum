import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { KNOWN_SYSTEM_ADDRESSES, ORACLES, QUSDC, isKnownSystemAddress } from './addresses';

const all = [...Object.values(ORACLES), QUSDC.address, ...KNOWN_SYSTEM_ADDRESSES];

test('every hardcoded address carries a valid EIP-55 checksum (catches typos)', () => {
  for (const a of all) assert.equal(getAddress(a), a);
});

test('system address lookup is case-insensitive', () => {
  assert.ok(isKnownSystemAddress('0x725ccc2c1c86c9bc31a90020128d99ff8d351aa0'));
  assert.ok(!isKnownSystemAddress(QUSDC.address));
});
