import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { KNOWN_SYSTEM_ADDRESSES, ORACLES, QIEDEX, QUSDC, WQIE, isKnownSystemAddress } from './addresses';
import { REGISTRY_DEPLOYMENTS } from './deployments';

test('registry deployment addresses are valid EIP-55', () => {
  for (const d of Object.values(REGISTRY_DEPLOYMENTS)) {
    for (const a of [d.address, d.admin, d.attester]) assert.equal(getAddress(a), a);
  }
});

const all = [
  ...Object.values(ORACLES),
  QUSDC.address,
  ...Object.values(QIEDEX),
  WQIE,
  ...KNOWN_SYSTEM_ADDRESSES,
];

test('every hardcoded address carries a valid EIP-55 checksum (catches typos)', () => {
  for (const a of all) assert.equal(getAddress(a), a);
});

test('system address lookup is case-insensitive', () => {
  assert.ok(isKnownSystemAddress('0x725ccc2c1c86c9bc31a90020128d99ff8d351aa0'));
  assert.ok(!isKnownSystemAddress(QUSDC.address));
});
