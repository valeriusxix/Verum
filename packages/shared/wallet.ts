/**
 * QIE Wallet integration rules (§5.6: primary connect option, shown first and labelled).
 * Confirmed by the team on 17 Nov 2026 (answers the §4.6 open question). The detection code that
 * applies these rules lives in web (Day 7, wagmi v2).
 *
 *  1. Detect via EIP-6963 (`eip6963:announceProvider`) by `info.rdns === QIE_WALLET_RDNS`.
 *  2. Fallback: the legacy global `window.qie` (EIP-1193 provider).
 *  3. Never identify QIE Wallet via `isMetaMask`; other wallets set it too.
 *  4. Disconnect arrives as `accountsChanged` with an empty array; treat `[]` as disconnected.
 *  5. Testnet (1983) must be enabled with the in-wallet testnet toggle. Until then a switch request
 *     fails with error 4902 (unrecognised chain); show the user how to enable it.
 *
 * QIE ID / QIE Pass: stretch only, since there's no public resolver. Don't fake names.
 */

export const QIE_WALLET_NAME = 'QIE Wallet';

/** EIP-6963 reverse-DNS id announced by QIE Wallet. */
export const QIE_WALLET_RDNS = 'me.qiewallet';

/** Legacy injected global used when EIP-6963 announces nothing. */
export const QIE_WALLET_GLOBAL = 'qie';

/** EIP-1193 / EIP-3326 error: the wallet doesn't know this chain (testnet toggle off). */
export const WALLET_ERROR_UNRECOGNIZED_CHAIN = 4902;

/** EIP-1193 user rejected the request. */
export const WALLET_ERROR_USER_REJECTED = 4001;

export const QIE_TESTNET_TOGGLE_HINT =
  'Turn on the testnet toggle in QIE Wallet settings, then try again.';
