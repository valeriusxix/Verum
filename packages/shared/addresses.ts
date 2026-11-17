/**
 * Known QIE mainnet addresses. Source: Agent.Md §4.3–4.5. All checksummed as given in the spec;
 * `addresses.test.ts` asserts each passes viem `getAddress` (catches typos).
 * Rule (§12): store lowercase, display checksummed.
 */
import type { Address } from 'viem';

/** QIE Oracles: Chainlink AggregatorV3 interface, 8 decimals, all verified (§4.3). */
export const ORACLE_DECIMALS = 8 as const;

export const ORACLES = {
  'QIE/USDT': '0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17',
  'BTC/USDT': '0x9E596d809a20A272c788726f592c0d1629755440',
  'ETH/USDT': '0x4bb7012Fbc79fE4Ae9B664228977b442b385500d',
  'SOL/USDT': '0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21',
  'XRP/USDT': '0x804582B1f8Fea73919e7c737115009f668f97528',
  'BNB/USDT': '0x775A56117Fdb8b31877E75Ceeb68C96765b031e6',
  'XAUt/USD': '0x9aD0199a67588ee293187d26bA1BE61cb07A214c',
} as const satisfies Record<string, Address>;

export type OracleFeed = keyof typeof ORACLES;

/** Feed used for QIE → USD volume conversion. */
export const QIE_USD_FEED: OracleFeed = 'QIE/USDT';

/**
 * Use the oracle only if `updatedAt` is younger than 6 h; otherwise fall back to
 * explorer `/api/v2/stats.coin_price` and say which source was used (§4.3).
 */
export const ORACLE_MAX_AGE_SECONDS = 6 * 60 * 60;

/**
 * The real QUSDC (§4.4). Hardcoded on purpose: look-alikes exist ("QIE USDC (Mock)" at
 * 0x88aB…ec2D and 0xc2e4…B30, and qQUSDC, the QIELend receipt token). Never resolve by name/symbol.
 */
export const QUSDC = {
  address: '0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5',
  decimals: 6,
  symbol: 'QUSDC',
} as const satisfies { address: Address; decimals: number; symbol: string };

/**
 * System / oracle addresses excluded from any chain-level "real activity" figure (§4.5).
 * 0x725C…1aA0 is the oracle updater: 138,617 txs, ~a quarter of all chain history.
 */
export const KNOWN_SYSTEM_ADDRESSES = [
  '0x725Ccc2C1C86c9BC31A90020128D99Ff8D351aA0',
] as const satisfies readonly Address[];

export const KNOWN_SYSTEM_ADDRESSES_LC: ReadonlySet<string> = new Set(
  KNOWN_SYSTEM_ADDRESSES.map((a) => a.toLowerCase()),
);

export const isKnownSystemAddress = (address: string): boolean =>
  KNOWN_SYSTEM_ADDRESSES_LC.has(address.toLowerCase());
