# VERUM

**What's real on QIE.** Real users, on the record.

Verum is a public traction ledger for QIE mainnet projects. A team registers its contract addresses in one
wallet transaction. Verum indexes every interaction from the QIE explorer and computes **Recorded** (raw) and
**Verum** (organic) usage, filtering bots, the team's own wallets and wash patterns. It then publishes a
shareable dashboard, a README badge and **Seals**: hashed daily metric checkpoints written to a registry
contract on QIE mainnet.

> QIE Blockchain Hackathon 3.0 (Mainnet Edition) · Track 5: Developer Infrastructure & Tooling

**Status:** Day 2. `VerumRegistry` is live and verified on testnet; mainnet deploy is Day 9.

| Network | VerumRegistry |
|---|---|
| Testnet (1983) | [`0xF5B151fCcf3C4b79345643f634f29A584d461390`](https://testnet.qie.digital/address/0xF5B151fCcf3C4b79345643f634f29A584d461390) (verified) |
| Mainnet (1990) | _TBD_ |

---

## Architecture

```
            ┌──────────────────────────── QIE mainnet (chain 1990) ────────────────────────────┐
            │  Blockscout explorer API (v1 + v2)   JSON-RPC rpc1..5   Oracles   QUSDC   Registry │
            └───────────────▲──────────────────────────▲────────────────▲──────────────▲───────┘
                            │ txlist / logs / counters  │ eth_call        │ events        │ attest()
                     ┌──────┴──────────────────────────┴─────────────────┴──────┐         │
                     │  worker (Node 20, TypeScript)                            │─────────┘
                     │  • backfill + incremental sync (cron 2 min)              │
                     │  • metrics rollups (cron 10 min)                         │
                     │  • daily snapshot attester (cron 00:05 UTC)              │
                     │  • registry event listener                               │
                     └──────────────┬───────────────────────────────────────────┘
                                    │ SQL
                              ┌─────▼─────┐
                              │ Postgres  │
                              └─────▲─────┘
                     ┌──────────────┴──────────────┐
                     │ api (Hono on Node)          │  /v1/*  public JSON, cached 60 s
                     └──────────────▲──────────────┘
                     ┌──────────────┴──────────────┐
                     │ web (Vite + React + TS)     │
                     └─────────────────────────────┘
```

## Repository layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: `VerumRegistry.sol`, tests, deploy script |
| `worker/` | Indexer, rollups, attester, registry listener |
| `api/` | Hono routes (`/v1/*`, `/badge/:slug.svg`) |
| `web/` | React app |
| `packages/shared/` | Chain config, known addresses, metric definitions, zod schemas |

## Getting started

Requirements: Node ≥ 20, pnpm, [Foundry](https://getfoundry.sh).

```sh
pnpm install
cp .env.example .env          # fill in DATABASE_URL, ATTESTER_PK, …
git submodule update --init   # contracts/lib/forge-std

pnpm typecheck                # strict TS across all packages
pnpm test                     # shared unit tests + forge tests
pnpm dev:web | dev:api | dev:worker
```

### Worker (indexer)

```sh
pnpm --filter @verum/worker migrate                         # apply worker/migrations/*.sql
pnpm --filter @verum/worker track <0x…|qie1…> [--project <slug> --name "Name"] [--label x]
pnpm --filter @verum/worker start --once                    # sync (waits for backfills), prices, rollup
pnpm --filter @verum/worker start                           # sync every 2 min; prices + rollup every 10 min
pnpm --filter @verum/worker rollup [--force]                # prices + metrics only (--force: even if unchanged)
```

All explorer calls go through one client: at most 3 req/s globally, 3 retries with jittered exponential
backoff, 30 s timeout, one log line per request. Pages start at 10,000 rows. On a timeout or 5xx the page
halves (down to 500) and the same block is read again, then grows back once the explorer recovers. New contracts backfill first (max 2 at once). After that,
each pass re-reads the last 20 blocks inside a single transaction to absorb re-orgs. The top-level senders of
internal transactions come from batched JSON-RPC calls spread across rpc1–5.

### Contracts

```sh
cd contracts
forge build && forge test
# testnet first (chain 1983), then mainnet (chain 1990). Use a keystore, not a raw key.
# PowerShell (run inside contracts/):
$env:ATTESTER_ADDRESS = "0x…"
forge script script/DeployVerumRegistry.s.sol --rpc-url qie_testnet --account verum-deployer `
  --broadcast --verify --verifier blockscout --verifier-url https://testnet.qie.digital/api/
```

Forge reads `.env` only from `contracts/`, so set `ATTESTER_ADDRESS` in the shell. The testnet faucet wants
the deployer's native `qie1…` address. It's the same account as the `0x…` one, so convert it with
`toQieBech32` from `@verum/shared`.

QIE supports the **Shanghai** EVM (PUSH0) but **not Cancun** (TSTORE/MCOPY), so `foundry.toml` pins
`evm_version = "shanghai"`.

## QIE network

| | Mainnet | Testnet (dev only) |
|---|---|---|
| Chain ID | `1990` | `1983` |
| RPC | `https://rpc{1..5}mainnet.qie.digital/` | `https://rpc1testnet.qie.digital/` |
| Explorer (Blockscout) | https://mainnet.qie.digital | https://testnet.qie.digital |

Known mainnet contracts (all in [`packages/shared/addresses.ts`](packages/shared/addresses.ts)): QIE Oracles
(7 AggregatorV3 feeds), QUSDC `0x3F43…5DA5`, QIEDEX router `0x08cd…53Ef` / factory `0x8E23…398C`, WQIE `0x0087…9139`.

### QIE Wallet

Detected via EIP-6963 (`rdns: me.qiewallet`), falling back to `window.qie`. `isMetaMask` is never used to
identify it. `accountsChanged([])` means disconnected. Testnet needs the in-wallet testnet toggle; otherwise a
chain switch fails with `4902`. QIE ID names are a stretch goal because there's no public resolver.

## Metric definitions

The source of truth is [`packages/shared/metrics.ts`](packages/shared/metrics.ts). The worker, the API docs
page and the dashboard all read from it.

- **Unique wallets**: distinct `from_addr` on ext txs to the project's contracts, plus distinct `from_addr` on int txs where the top-level tx sender is an EOA. Token transfers *to* the contract count the sender.
- **DAU / WAU / MAU**: rolling 1 / 7 / 30-day unique wallets (raw and organic).
- **New vs returning**: a wallet is new on its first day with the project.
- **Retention Dn**: share of a cohort's wallets active again on day 1 (D1), days 7–13 (D7), days 30–36 (D30).
- **Volume**: sum of native `value` (QIE → USD at that day's price) + QUSDC token amounts.
- **Success rate**: successful txs / all txs.
- **Concentration**: share of txs from the top 10 wallets.

How these are computed for multi-contract projects (tx count, inflow volume, day prices, the 30-day score
window, cohort basis) is listed in `IMPLEMENTATION_NOTES` in the same file. Every metric has a test
against real mainnet data, with expected values from independent SQL (`worker/test/metrics-mainnet.test.ts`).

### Organic filter

| Flag | Rule |
|---|---|
| `team` | Contract creator, project owner, or a self-declared team wallet |
| `bot` | ≥ 200 txs in any 24 h, or inter-tx interval CV < 0.1 over ≥ 50 txs |
| `burst` | ≥ 20 first-ever-tx wallets in the same 10-min window, all hitting this contract |
| `fresh_single` | Only chain activity ever is one tx to this project (soft flag) |

**Organic wallet** = not `team`, not `bot`, not `burst`.

### Verum score (0–100)

```
40·(organic/raw unique wallets) + 25·D7 retention + 20·(1 − top-10 wallet tx share) + 15·(1 − fresh_single share)
```

## Public API

_Lands on Day 5._ `GET /v1/projects`, `/v1/projects/:slug{,/metrics,/cohorts,/flags,/milestones,/snapshots,/snapshots/:date,/sync}`,
`/v1/chain/pulse`, `/badge/:slug.svg`. Responses: `{data, meta:{generated_at, price_source}}`.

## QIE components used

- [ ] QIE Wallet: primary connect option
- [ ] QIE Oracles: QIE/USDT for USD volume, with staleness fallback; oracle health panel
- [ ] QUSDC: stablecoin volume per project
- [ ] Explorer / Blockscout: verification status, creator ownership proof
- [ ] `VerumRegistry` mainnet address: _TBD (verified on mainnet.qie.digital)_

## License

MIT
