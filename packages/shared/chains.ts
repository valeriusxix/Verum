/**
 * QIE chain config. Source: Agent.Md §4.1 (tested 16 Nov 2026).
 * Re-verified on 16 Nov 2026 during Day 1 scaffold:
 *  - rpc1–rpc5 mainnet all return eth_chainId 0x7c6 (1990).
 *  - rpc1testnet returns 0x7bf (1983).
 *  - testnet explorer https://testnet.qie.digital is Blockscout v7.0.2 (NOT in spec §4.1; added for Day 2 testnet verify).
 *  - EVM: Shanghai yes (PUSH0), Cancun no (TSTORE/MCOPY = invalid opcode). See contracts/foundry.toml.
 */
import { defineChain } from 'viem';

export const QIE_MAINNET_ID = 1990 as const;
export const QIE_TESTNET_ID = 1983 as const;

export const QIE_MAINNET_RPC_URLS = [
  'https://rpc1mainnet.qie.digital/',
  'https://rpc2mainnet.qie.digital/',
  'https://rpc3mainnet.qie.digital/',
  'https://rpc4mainnet.qie.digital/',
  'https://rpc5mainnet.qie.digital/',
] as const;

export const QIE_TESTNET_RPC_URLS = ['https://rpc1testnet.qie.digital/'] as const;

export interface ExplorerConfig {
  /** Blockscout UI + API host. */
  readonly url: string;
  /** Etherscan-compatible v1 API (`?module=…&action=…`). */
  readonly apiV1: string;
  /** Blockscout REST v2 API. */
  readonly apiV2: string;
  /** Websocket (stretch only, §2). */
  readonly socket: string;
  /** `forge verify-contract --verifier blockscout --verifier-url …` */
  readonly verifierUrl: string;
}

const explorer = (url: string): ExplorerConfig => ({
  url,
  apiV1: `${url}/api`,
  apiV2: `${url}/api/v2`,
  socket: `${url.replace(/^https:/, 'wss:')}/socket/v2/websocket?vsn=2.0.0`,
  verifierUrl: `${url}/api/`,
});

export const QIE_MAINNET_EXPLORER = explorer('https://mainnet.qie.digital');
export const QIE_TESTNET_EXPLORER = explorer('https://testnet.qie.digital');

export const QIE_TESTNET_FAUCET = 'https://qie.digital/faucet';

/** Explorer stat at spec time: ~3.6 s (re-read 16 Nov: 3626 ms). Used only for estimates. */
export const QIE_AVG_BLOCK_TIME_MS = 3600;

const nativeCurrency = { name: 'QIE', symbol: 'QIE', decimals: 18 } as const;

/** viem/wagmi chain `qie` (§7.2). Use with `fallback(QIE_MAINNET_RPC_URLS.map(http))`. */
export const qie = defineChain({
  id: QIE_MAINNET_ID,
  name: 'QIE',
  nativeCurrency,
  rpcUrls: { default: { http: QIE_MAINNET_RPC_URLS } },
  blockExplorers: {
    default: { name: 'QIE Explorer', url: QIE_MAINNET_EXPLORER.url, apiUrl: QIE_MAINNET_EXPLORER.apiV1 },
  },
});

/** Dev only (§4.1). */
export const qieTestnet = defineChain({
  id: QIE_TESTNET_ID,
  name: 'QIE Testnet',
  nativeCurrency,
  rpcUrls: { default: { http: QIE_TESTNET_RPC_URLS } },
  blockExplorers: {
    default: { name: 'QIE Testnet Explorer', url: QIE_TESTNET_EXPLORER.url, apiUrl: QIE_TESTNET_EXPLORER.apiV1 },
  },
  testnet: true,
});

export type QieNetwork = 'mainnet' | 'testnet';

export const NETWORKS = {
  mainnet: { chain: qie, rpcUrls: QIE_MAINNET_RPC_URLS, explorer: QIE_MAINNET_EXPLORER },
  testnet: { chain: qieTestnet, rpcUrls: QIE_TESTNET_RPC_URLS, explorer: QIE_TESTNET_EXPLORER },
} as const satisfies Record<QieNetwork, unknown>;
