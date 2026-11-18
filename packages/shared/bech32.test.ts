import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QIE_BECH32_VALOPER_PREFIX,
  fromQieBech32,
  isQieBech32Address,
  normalizeQieAddress,
  toQieBech32,
} from './bech32';
import { qieAddressInputSchema } from './schemas';

// Verified on QIE mainnet 18 Nov 2026: identical balance via Cosmos REST (qie1…) and eth_getBalance (0x…).
const EVM = '0xe1acec6312eb701D4A14De700CCec8DeE17a8D28';
const NATIVE = 'qie1uxkwcccjadcp6js5mecqenkgmmsh4rfg4kzdsf';

test('0x -> qie1 matches the on-chain verified pair (any input case)', () => {
  assert.equal(toQieBech32(EVM), NATIVE);
  assert.equal(toQieBech32(EVM.toLowerCase()), NATIVE);
});

test('qie1 -> checksummed 0x', () => {
  assert.equal(fromQieBech32(NATIVE), EVM);
  assert.equal(fromQieBech32(NATIVE.toUpperCase()), EVM); // bech32 allows all-uppercase
});

test('real validator operator address decodes with its own prefix', () => {
  // From validators.qie.digital/cosmos/staking/v1beta1/validators
  const valoper = 'qievaloper1pjgznulqvjdqwm3w2dql26d2zzuusgl6wn230y';
  assert.equal(fromQieBech32(valoper, QIE_BECH32_VALOPER_PREFIX).toLowerCase(), '0x0c9029f3e0649a076e2e5341f569aa10b9c823fa');
  assert.throws(() => fromQieBech32(valoper)); // not an account address
});

test('rejects bad checksum, wrong prefix and bad 0x checksum', () => {
  assert.throws(() => fromQieBech32(NATIVE.slice(0, -1) + 'q'));
  assert.throws(() => fromQieBech32('qied19y2ul696lc6lz640pldete7h7jzdc0xj32wt6j')); // docs sample: invalid checksum
  assert.throws(() => fromQieBech32(toQieBech32(EVM, 'cosmos')));
  assert.throws(() => toQieBech32('0xE1acec6312eb701D4A14De700CCec8DeE17a8D28')); // case flipped -> bad EIP-55
  assert.equal(isQieBech32Address(NATIVE), true);
  assert.equal(isQieBech32Address(EVM), false);
});

test('normalizeQieAddress / qieAddressInputSchema accept both forms', () => {
  const lc = EVM.toLowerCase();
  assert.equal(normalizeQieAddress(EVM), lc);
  assert.equal(normalizeQieAddress(`  ${NATIVE} `), lc);
  assert.equal(normalizeQieAddress('hello'), null);
  assert.equal(normalizeQieAddress('0xE1acec6312eb701D4A14De700CCec8DeE17a8D28'), null); // bad EIP-55
  assert.equal(qieAddressInputSchema.parse(NATIVE), lc);
  assert.ok(!qieAddressInputSchema.safeParse('qie1notreal').success);
});
