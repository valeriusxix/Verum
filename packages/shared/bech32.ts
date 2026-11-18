/**
 * QIE native (bech32) <-> EVM (0x) address conversion.
 *
 * QIE is Cosmos SDK + Ethermint: one eth_secp256k1 key has one 20-byte account, shown either as
 * `0x…` (EVM) or bech32 with prefix `qie` (`qie1…`, used by Keplr and the testnet faucet). Same
 * account, same key, same balance.
 * Verified 18 Nov 2026: `validators.qie.digital/cosmos/auth/v1beta1/bech32` -> {"bech32_prefix":"qie"},
 * and 0xe1ac…8D28 / qie1uxkw…zdsf report the identical balance via Cosmos REST and eth_getBalance.
 */
import { bech32 } from '@scure/base';
import { bytesToHex, getAddress, hexToBytes, isAddress, type Address } from 'viem';

/** Account address prefix (`qie1…`). */
export const QIE_BECH32_PREFIX = 'qie' as const;
/** Validator operator prefix (`qievaloper1…`). Display only; never an EVM account. */
export const QIE_BECH32_VALOPER_PREFIX = 'qievaloper' as const;

/**
 * Valid 0x address: all-lowercase, all-uppercase, or a correct EIP-55 checksum.
 * Note: viem's `getAddress` does NOT reject a bad checksum (it silently re-checksums), so the
 * strict `isAddress` is the gate.
 */
const isValidEvmAddress = (s: string): s is Address => isAddress(s, { strict: true });

/** `0x…` -> `qie1…`. Throws on a malformed address or a bad mixed-case checksum. */
export const toQieBech32 = (address: string, prefix: string = QIE_BECH32_PREFIX): string => {
  if (!isValidEvmAddress(address)) throw new Error(`not a valid 0x address: ${address}`);
  const bytes = hexToBytes(address);
  return bech32.encode(prefix, bech32.toWords(bytes));
};

/**
 * `qie1…` -> checksummed `0x…`. Throws on a bad checksum, a wrong prefix or a payload that isn't
 * 20 bytes. Pass `expectedPrefix: null` to accept any prefix.
 */
export const fromQieBech32 = (value: string, expectedPrefix: string | null = QIE_BECH32_PREFIX): Address => {
  const { prefix, bytes } = bech32.decodeToBytes(value as `${string}1${string}`);
  if (expectedPrefix !== null && prefix !== expectedPrefix) {
    throw new Error(`expected prefix "${expectedPrefix}", got "${prefix}"`);
  }
  if (bytes.length !== 20) throw new Error(`expected a 20-byte account, got ${bytes.length} bytes`);
  return getAddress(bytesToHex(bytes));
};

export const isQieBech32Address = (value: string): boolean => {
  try {
    fromQieBech32(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Normalises user input in either form to a lowercase `0x` address (storage format, §12).
 * Returns null when the input is neither.
 */
export const normalizeQieAddress = (input: string): `0x${string}` | null => {
  const s = input.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) {
    return isValidEvmAddress(s) ? (s.toLowerCase() as `0x${string}`) : null;
  }
  try {
    return fromQieBech32(s.toLowerCase()).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
};
