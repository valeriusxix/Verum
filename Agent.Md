# Agent.md — Verum

> Product name: **Verum** (final). Wordmark option in Val's brand style: **VΣRUM**.
> Hackathon: QIE Blockchain Hackathon 3.0 (Mainnet Edition) · Track 5 — Developer Infrastructure & Tooling
> Hard deadline: **23:59 CET, 30 Nov 2026** (same clock time in Lagos, WAT = UTC+1)
> Spec date: 16 Nov 2026. Every API fact in §4 was tested against QIE mainnet on this date.

---

## 0. Name and identity

**Verum** is Latin for "the truth, the real thing". The product shows what's real about a project's usage: raw activity on one side, verified organic users on the other, with the proof written on-chain.

- **Tagline**: "What's real on QIE."
- **Hero line**: "Real users, on the record."
- **Voice**: plain, exact, a little stern, like a ledger, not a hype account. Numbers first, adjectives last. Never call a number "organic" unless it passed the filter in §5.3.
- **Wordmark**: `VERUM` in Instrument Serif caps, wide tracking (0.18em). Optional brand-matched variant: `VΣRUM`. Use one consistently.
- **Mark**: a thin horizontal line with a small notch: the "line of truth" a measurement is read against. Works at 16px as a favicon.
- **Naming inside the product**: raw numbers are **"Recorded"**, filtered numbers are **"Verum"** (e.g. "Verum WAU 412 · Recorded WAU 1,980"). Snapshots are **"Seals"**. The credibility score is called the **"Verum score"**.

Before committing, check X handle, domain and GitHub org availability (e.g. `verum.qie`, `verumqie`, `getverum`, `useverum`).

---

## 1. Product in one paragraph

Verum is a public traction ledger for QIE mainnet projects. A team registers its contract addresses (one wallet transaction). Verum indexes every interaction from the QIE explorer, computes **raw** and **organic** usage (filtering bots, the team's own wallets and wash patterns), and publishes a shareable dashboard, a README badge and **on-chain traction snapshots**: hashed metric checkpoints written to a registry contract on QIE mainnet. Judges get one link per project instead of screenshots. Teams get a live tracker for the three 90-day milestones that unlock the second half of their prize. Anyone can paste an address and peek at a contract with no wallet needed.

### Who it serves
1. **Hackathon builders** (primary): prove traction to judges by 1–5 Dec, then track the 90-day milestones.
2. **Judges / QIE team**: compare projects on organic numbers; verify claims against on-chain snapshots.
3. **Users and investors**: a leaderboard of what is actually being used on QIE.
4. **Developers** (Track 5 credibility): a public JSON API and embeddable badge.

### Why this wins on the judging criteria
- **Originality**: nothing on QIE separates organic traction from noise, or anchors traction claims on-chain.
- **Real-world usefulness**: every team in this hackathon has a 90-day milestone obligation. This tool serves it directly.
- **Product quality / UX**: answer in under 15 s from page load (see §7.1).
- **QIE integration**: QIE Wallet, QIE Oracles, QUSDC, the explorer API, plus QIE ID if a resolver is confirmed (§5.6).
- **Adoption potential**: QIE runs several hackathons a year; each wave is a new cohort of users.

---

## 2. Scope

### MVP (must ship by Nov 30)
- Registry contract on mainnet, verified on the explorer.
- Indexer: backfill + incremental sync of registered contracts.
- Metrics: raw/organic unique wallets (daily/weekly/monthly), tx count, success rate, new vs returning, D1/D7/D30 retention, QIE + USD volume, QUSDC volume, top methods, wallet concentration.
- Organic-signal filter (§5.3) with both numbers always shown.
- Pages: Landing (omnibox), Explore (leaderboard), Project dashboard, Register/Claim, Peek, API docs.
- On-chain snapshots (daily, by attester) + milestone tracker.
- README badge (SVG) + embed.
- Pre-indexed "unclaimed" pages for all verified mainnet contracts (§9).

### Stretch (only if MVP is done by Nov 26)
- QIE ID name display for wallets (needs a confirmed resolver).
- Websocket live feed (`/socket/v2`) instead of polling.
- Wallet-funding graph (detect wallets funded by the deployer).
- Weekly email/Telegram digest for project owners.

### Out of scope
Token launch, paid tiers, mobile app, multichain.

---

## 3. Architecture

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
                              │ Postgres  │  (Neon or Supabase)
                              └─────▲─────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │ api (Hono on Node)          │  /v1/*  public JSON, cached 60 s
                     └──────────────▲──────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │ web (Vite + React + TS)     │  Vercel
                     └─────────────────────────────┘
```

- **Hosting**: web on Vercel; api + worker as one Node service on Railway or Render (needs long-running jobs; a backfill can take minutes, which breaks serverless time limits). Postgres on Neon or Supabase free tier.
- **Monorepo** (pnpm workspaces):
  ```
  /contracts   Foundry project (VerumRegistry.sol + tests + deploy script)
  /worker      indexer, rollups, attester, listener
  /api         Hono routes
  /web         React app
  /packages/shared  types, chain config, metric definitions, zod schemas
  ```

---

## 4. Verified QIE facts (tested 16 Nov 2026)

Use these. Don't re-guess them.

### 4.1 Chain
| Item | Value |
|---|---|
| Chain ID | `1990` (RPC returns `0x7c6`) |
| RPC | `https://rpc1mainnet.qie.digital/` … `rpc5mainnet` (rpc1–3 tested, ~0.9–1.2 s per call) |
| Explorer | `https://mainnet.qie.digital` — **Blockscout backend v7.0.2** |
| Avg block time (explorer stat) | ~3.6 s |
| Native symbol | QIE (18 decimals); Cosmos base denom `aqie` |
| Stack | **Cosmos SDK + Ethermint** (CometBFT `0.38.12`, Cosmos network id `qie_1990-1`). Keys are `eth_secp256k1`. |
| Native address format | bech32 prefix **`qie`** (`qie1…`); validators use `qievaloper1…`. Source: `https://validators.qie.digital/cosmos/auth/v1beta1/bech32` → `{"bech32_prefix":"qie"}`. **`qie1…` and `0x…` are the same account from the same key**: one 20-byte address in two encodings, with an identical balance via Cosmos REST and `eth_getBalance` (verified 18 Nov). Keplr and the **testnet faucet** use the `qie1…` form, so convert; never generate a new key. Converter: `packages/shared/bech32.ts`. The docs' sample `qied1…` address has an invalid checksum and the wrong prefix; ignore it. |
| Chain activity at test time | 539,097 total txs · 158,035 addresses · ~1,600–1,800 txs/day |
| Contracts | 830 total, 140 verified |
| Testnet (dev only) | chain `1983`, `https://rpc1testnet.qie.digital/`, faucet `qie.digital/faucet`, explorer `https://testnet.qie.digital` (Blockscout v7.0.2, checked 16 Nov) |
| EVM version | **Shanghai** (PUSH0 works). **No Cancun**: TSTORE/MCOPY fail with "invalid opcode" on mainnet and testnet (eth_call probe, 16 Nov). Compile with `evm_version = "shanghai"`. |

### 4.2 Explorer API behaviour
| Endpoint | Result |
|---|---|
| `GET /api?module=account&action=txlist&address=X&startblock=N&sort=asc&page=1&offset=10000` | **Best for bulk.** 10,000 rows in ~5.7 s (~10 MB, mostly `input`). Pages past 10k work (page=3 tested), but **paginate by `startblock` cursor**, not page number. Fields: blockNumber, timeStamp, hash, from, to, value, gasUsed, gasPrice, isError, txreceipt_status, input, nonce, contractAddress. |
| `GET /api?module=account&action=txlistinternal&address=X` | Works. Needed for calls routed through proxies, Safes or routers. |
| `GET /api?module=account&action=tokentx&address=X` | Use for ERC-20 flows (QUSDC volume). |
| `GET /api?module=logs&action=getLogs&fromBlock=A&toBlock=latest&address=X` | Works (955 logs returned in one call). |
| JSON-RPC `eth_getLogs` over a 10,000-block range | Works. Use for registry events. |
| `GET /api/v2/addresses/X` | is_contract, creator_address_hash, creation_transaction_hash, is_verified, implementations. **Use `creator_address_hash` for ownership checks.** |
| `GET /api/v2/addresses/X/counters` | Exact totals (e.g. 138,617 txs). Cheap. Use for headline tx count. |
| `GET /api/v2/addresses/X/tabs-counters` | **Capped at 51.** Don't use for totals. |
| `GET /api/v2/addresses/X/transactions` | 50/page, ~1.6 s, cursor in `next_page_params`. Too slow for backfill; fine for "latest activity". |
| `GET /api/v2/smart-contracts?filter=solidity` | Verified contracts, 50/page, cursor pagination. Source for pre-indexing. |
| `GET /api/v2/smart-contracts/counters` | `{smart_contracts, verified_smart_contracts, new_*_24h}` |
| `GET /api/v2/stats` | total_transactions, transactions_today, total_addresses, `coin_price` (QIE USD fallback). |
| `GET /api/v2/stats/charts/transactions` | Chain-wide tx/day. Feeds the hero terrain (§7.4). |
| `GET /api/v2/main-page/transactions` | Latest txs. Feeds live particles. |
| `GET /api/v2/tokens/X` and `/counters` | Token meta + holders count. |
| `GET /api/v2/smart-contracts/verification/config` | Six verification modes, incl. standard-input and flattened. |
| `/socket/v2/websocket?vsn=2.0.0` | Returns 426 (upgrade required), so a websocket exists. Stretch only. |
| **CORS** | `access-control-allow-origin: *`. The browser can call the explorer directly (Peek mode). |
| **Rate limits** | No rate-limit headers. 25 sequential calls all 200 (~0.86 s avg). Still throttle the worker to **≤3 req/s** with exponential backoff on 429/5xx. |

### 4.3 QIE Oracles (AggregatorV3, 8 decimals, all verified)
| Feed | Address |
|---|---|
| QIE / USDT | `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` |
| BTC / USDT | `0x9E596d809a20A272c788726f592c0d1629755440` |
| ETH / USDT | `0x4bb7012Fbc79fE4Ae9B664228977b442b385500d` |
| SOL / USDT | `0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21` |
| XRP / USDT | `0x804582B1f8Fea73919e7c737115009f668f97528` |
| BNB / USDT | `0x775A56117Fdb8b31877E75Ceeb68C96765b031e6` |
| Gold / USD (XAUt) | `0x9aD0199a67588ee293187d26bA1BE61cb07A214c` |

**Staleness warning:** at test time the QIE/USDT feed's `updatedAt` was ~19 h old while the others were 3–5 min old. Rule: use the oracle if `updatedAt` is younger than 6 h, otherwise fall back to `/api/v2/stats.coin_price`, and show which source was used ("price via QIE Oracle" / "price via explorer").

### 4.4 Tokens
- **QUSDC (real)**: `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, 6 decimals, verified, 83 holders.
- Beware look-alikes named "QIE USDC (Mock)" (`0x88aB…ec2D`, `0xc2e4…B30`) and `qQUSDC` (QIELend receipt token). Hardcode the real address.

### 4.5 Known noise
- `0x725Ccc2C1C86c9BC31A90020128D99Ff8D351aA0` (oracle updater) alone has 138,617 txs, about a quarter of all chain history. Chain-wide numbers are dominated by bots. Always exclude known system/oracle addresses from any chain-level "real activity" figure.

### 4.6 Day 1 open questions: resolved 17 Nov 2026
- **QIE ID / QIE Pass**: there's **no public resolver**. QIE ID stays stretch; don't fake names. (Only a third-party `QieIdGatedAllowlist` `0x3142…c461` exists.)
- **QIE Wallet**: announces via **EIP-6963** with `rdns: me.qiewallet`. Fallback: legacy global `window.qie`. Rules:
  - Never identify it via `isMetaMask`.
  - Disconnect arrives as `accountsChanged` with an empty array.
  - Testnet needs the in-wallet testnet toggle; otherwise a chain switch fails with error `4902`.
- **QIEDEX** (verified on-chain: `router.factory()` and `router.WETH()` match):
  | Item | Address |
  |---|---|
  | Router | `0x08cd2e72e156D8563B4351eb4065C262A9f553Ef` |
  | Factory | `0x8E23128a5511223bE6c0d64106e2D4508C08398C` |
  | WQIE | `0x0087904D95BEe9E5F24dc8852804b547981A9139` |

---

## 5. Data and metrics

### 5.1 Ingestion (worker)
For each tracked contract:
1. **Backfill**: loop `txlist` with `startblock = lastBlock` (amended 19 Nov: **not** `+ 1`, which loses the rest of a block when a full page ends mid-block; the PK drops the re-read duplicates, and if a whole full page is one block the cursor moves to +1 with a warning), `offset=10000`, `sort=asc`, until fewer than 10,000 rows return. Same for `txlistinternal`, and `tokentx` filtered to QUSDC (`tokentx` requires `address`; filter with `contractaddress`). Strip `input` down to its 4-byte selector before storing.
   - **Adaptive page size** (decided 20 Nov): start at `offset=10000`. On a timeout, 5xx, 429 or network error, halve the page (floor 500), re-read the same `startblock` and lose nothing. After 3 good pages, double back toward 10,000. Pages above the floor aren't retried at the same size; the floor uses the normal 3 retries. A full page inside one block grows the page rather than skipping rows.
     - Why: measured 20 Nov, one request at a time, response time scales with size at about 1.6 MB/s. A 10,000-row internal-tx page is ~19.5 MB and took ~31 s (over the 30 s timeout); 2,500 rows took ~6.5 s.
     - The explorer is much slower than §4.2's Nov 16 figure, and threw bursts of 502s under load.
   - **Sync ceiling** = the explorer's indexed head (`/api/v2/blocks?type=block`, ~1 block behind the RPC), passed as `endblock` and fixed for the run. Never mark a block synced before the explorer has indexed it.
   - **Internal-tx origins** (19 Nov): `txlistinternal` rows only carry the immediate caller. Store the top-level sender in `txs.origin_addr`, fetched with batched `eth_getTransactionByHash`. All 5 RPCs accept batches but process the items serially (100-item batch: 3–13 s), so use batches of 25 spread across all 5 RPCs in parallel (100 lookups ≈ 1.8 s).
   - **Data caveat** (checked 19 Nov): `/api/v2/main-page/indexing-status` reports `finished_indexing: false`, `indexed_blocks_ratio: 0.98`. Txs in un-indexed historical blocks are missing from `txlist`. Show this caveat on the API docs page.
2. **Incremental**: every 2 min, same call from `last_synced_block + 1`.
3. **Dedup** on `(chain_tx_hash, kind, log_index)`. Handle re-orgs by re-reading the last 20 blocks each sync.
4. **Concurrency**: one global queue, max 3 req/s, max 2 contracts backfilling at once. New registrations jump the queue.
5. **Peek mode** (unregistered address): the browser calls the explorer directly (CORS is open) and reads the last 10,000 txs only. Label it "Preview — last 10k txs".

### 5.2 Schema (Postgres)
```sql
projects(id serial pk, slug text unique, name text, track smallint, owner_address text,
         onchain_project_id bigint, claimed bool default false, website text, repo text,
         logo_url text, created_at timestamptz default now())

contracts(address text pk, project_id int references projects, label text,
          creator_address text, verified bool, first_block bigint, last_synced_block bigint)

txs(hash text, kind text check (kind in ('ext','int','token')), log_index int default -1,
    contract text, block bigint, ts timestamptz, from_addr text, to_addr text,
    origin_addr text,  -- top-level tx sender: ext = from_addr, int = via RPC, token = null (19 Nov)
    selector text, value_wei numeric, token text, token_amount numeric,
    success bool, gas_used bigint,
    primary key (hash, kind, log_index, contract))
    -- 19 Nov: `contract` added to the PK. One internal call / QUSDC transfer between two tracked
    -- contracts appears in both contracts' explorer lists; without it one project loses the row.
    -- log_index = trace `index` for int rows, `logIndex` for token rows, -1 for ext.
create index on txs (contract, ts);
create index on txs (from_addr);

wallet_flags(address text, project_id int, flag text, reason text,
             primary key (address, project_id, flag))
  -- flags: 'team','bot','burst','fresh_single' (see 5.3)

daily_metrics(project_id int, day date, raw_dau int, organic_dau int, new_wallets int,
              returning_wallets int, tx_count int, success_rate real, qie_volume numeric,
              usd_volume numeric, qusdc_volume numeric, primary key (project_id, day))

cohorts(project_id int, cohort_day date, d1 real, d7 real, d30 real,
        primary key (project_id, cohort_day))

snapshots(project_id int, period_end date, metrics_hash text, tx_hash text,
          payload jsonb, primary key (project_id, period_end))

milestones(project_id int, idx smallint, metric text, op text, target numeric,
           window_days int, reached_at timestamptz, reached_tx text,
           primary key (project_id, idx))

price_ticks(ts timestamptz pk, qie_usd numeric, source text)

sync_progress(contract text pk references contracts, status text  -- queued|backfilling|synced|error
              cursor_block bigint, head_block bigint, progress real, error text, updated_at timestamptz)
  -- 19 Nov: backs GET /v1/projects/:slug/sync
```
Migrations live in `worker/migrations/*.sql` (`pnpm --filter @verum/worker migrate`).

### 5.3 Organic-signal filter (the differentiator)
Show **both** raw and organic numbers everywhere. Never hide raw. Every flagged wallet shows its reason on hover.

| Flag | Rule | Notes |
|---|---|---|
| `team` | Wallet = contract creator, project owner, or any address the owner lists as "team" during registration. | Owners will want to self-declare, because it raises their Verum score. |
| `bot` | ≥ 200 txs in any 24 h, **or** inter-tx interval coefficient of variation < 0.1 over ≥ 50 txs. | Catches cron-style updaters like 4.5. |
| `burst` | ≥ 20 wallets whose **first ever chain tx** (txlist `nonce == 0` on that wallet) lands in the same 10-min window and that all hit this contract. | Catches sybil farms spun up for a demo. Check `nonce` from our own data first, then RPC `eth_getTransactionCount` at the block if needed (cache it). |
| `fresh_single` | Wallet's only chain activity ever is a single tx to this project. | Soft flag: counted, but down-weighted in the Verum score. |

**Organic wallet** = not `team`, not `bot`, not `burst`.

**Verum score (0–100)** shown per project:
`40·(organic/raw unique wallets) + 25·D7 retention + 20·(1 − top-10 wallet tx share) + 15·(1 − fresh_single share)`, clamped to 0–100.
Document the formula on the page. Transparency is the point.

### 5.4 Metric definitions (put these in `/packages/shared/metrics.ts` and on the API docs page)
- **Unique wallets**: distinct `from_addr` on ext txs to the project's contracts, plus distinct `from_addr` on int txs where the top-level tx sender is an EOA. Token transfers *to* the contract count the sender.
  - Implementation note (19 Nov): an int row's `from_addr` is the immediate caller, i.e. a contract. The wallet counted is the top-level sender, `origin_addr`. Every top-level sender is an EOA.
- **DAU / WAU / MAU**: rolling 1 / 7 / 30-day unique wallets (raw and organic).
- **New vs returning**: a wallet is new on its first day with the project.
- **Retention Dn**: share of a cohort's wallets active again on any day in `[cohort_day+n, cohort_day+n+1)` for D1, and within days 7–13 for D7, days 30–36 for D30.
- **Volume**: sum of native `value` (QIE → USD at that day's price) + QUSDC token amounts.
- **Success rate**: successful txs / all txs.
- **Concentration**: share of txs from the top 10 wallets.

### 5.5 Milestones
Owners set up to 3 milestones at registration, matching the hackathon's examples:
`metric ∈ {organic_wau, organic_mau, cumulative_wallets, tx_count_30d, usd_volume_30d, d7_retention}` · `op ∈ {>=}` · `target` · `window_days`.
When the attester sees a milestone crossed, it calls `markMilestone` on-chain (§6). The UI shows a 90-day clock from the winners' date (10 Dec 2026) with progress bars.

### 5.6 QIE ecosystem integration checklist (judging bonus)
- [x] **QIE Wallet**: primary connect option (wagmi injected / EIP-6963), shown first and labelled.
- [x] **QIE Oracles**: QIE/USDT for USD volume, with staleness fallback. Also an "oracle health" mini panel on the landing page (7 feeds, age of each). This is useful to every QIE dev and shows integration depth.
- [x] **QUSDC**: stablecoin volume metric per project.
- [x] **Explorer / Blockscout**: verification status, creator ownership proof.
- [ ] **QIE ID / Pass**: stretch only. §4.6 confirmed there's no public resolver.

---

## 6. Smart contract — `VerumRegistry.sol`

Small, auditable, holds no funds. Solidity ^0.8.24, Foundry.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VerumRegistry {
    struct Project {
        address owner;
        string slug;          // unique, lowercase, 3–32 chars [a-z0-9-]
        string metadataURI;   // JSON: name, track, repo, site, logo, team wallets
        uint64 createdAt;
    }
    struct Milestone { bytes32 metric; uint256 target; uint32 windowDays; uint64 reachedAt; }

    address public attester;                       // Verum backend key
    address public admin;
    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(bytes32 => uint256) public slugToId;   // keccak(slug) => id
    mapping(uint256 => address[]) internal _contracts;
    mapping(uint256 => Milestone[3]) internal _milestones;
    mapping(address => mapping(uint256 => bool)) public watching;
    mapping(uint256 => uint64) public lastPeriodEnd;  // latest Seal per project (added 17 Nov)

    event ProjectRegistered(uint256 indexed id, address indexed owner, string slug, string metadataURI);
    event ContractsAdded(uint256 indexed id, address[] contracts);
    event MetadataUpdated(uint256 indexed id, string metadataURI);
    event MilestonesSet(uint256 indexed id, Milestone[3] milestones);
    event MilestoneReached(uint256 indexed id, uint8 indexed idx, uint256 value, uint64 at);
    event Snapshot(uint256 indexed id, uint64 indexed periodEnd, bytes32 metricsHash,
                   uint32 organicWallets, uint32 rawWallets, uint32 txCount);
    event Watched(uint256 indexed id, address indexed user, bool on);
    event OwnershipTransferred(uint256 indexed id, address indexed previousOwner, address indexed newOwner); // added 17 Nov

    constructor(address attester_);  // admin = msg.sender (decided 17 Nov)

    // views (added 17 Nov): getContracts(id) -> address[], getMilestones(id) -> Milestone[3]
    // registerFull(slug, metadataURI, contracts[], milestones[3]) — register + addContracts + setMilestones
    //   in ONE tx, so onboarding is a single wallet signature (used by /register)
    // owner functions: register, addContracts, updateMetadata, setMilestones, transferOwnership
    // attester functions: snapshot(id, periodEnd, metricsHash, organic, raw, txCount), markMilestone(id, idx, value)
    // anyone: watch(id, on) — on-chain watchlist (each watch is a real user tx)
    // admin: setAttester(addr)
}
```

Rules:
- `register` reverts on duplicate slug or bad slug format. Max 20 contracts per project.
- `Milestone.metric` = the plain metric name as bytes32 (UTF-8, zero right-padded), e.g. `"organic_wau"`, so it reads straight off the explorer. `bytes32(0)` = unset slot (decided 17 Nov).
- **Ownership is proven off-chain**: after `ContractsAdded`, the worker checks `creator_address_hash` (explorer) for each contract. If the creator ≠ project owner, the contract is listed as "unverified claim" until the owner signs an EIP-191 message *from the creator wallet*. Don't do this on-chain.
- `periodEnd` = unix seconds at 00:00 UTC of the snapshot's `period_end` date (multiple of 86400). `snapshot` reverts unless `periodEnd` is a non-zero UTC midnight, not in the future, and strictly greater than `lastPeriodEnd[id]`, so there are no duplicate or backdated Seals. It also reverts if `organicWallets > rawWallets` (decided 17 Nov).
- `markMilestone` is strict: it reverts if `idx >= 3`, the slot is unset, the slot is already reached, or `value < target` (op is always `>=`) (decided 17 Nov).
- `setMilestones` ignores the caller's `reachedAt`. A slot keeps its `reachedAt` only if metric/target/windowDays are unchanged; an edited slot resets to 0. `MilestoneReached` events stay on-chain either way (decided 17 Nov).
- `snapshot` is called once per project per day (UTC). `metricsHash = keccak256(canonical JSON of that day's daily_metrics row + cohort row)`. The payload is stored in Postgres and served at `/v1/projects/:slug/snapshots/:date` so anyone can recompute the hash.
- Write Foundry tests: register/duplicate slug, only-owner, only-attester, milestone bounds, watch toggle, events.
- Deploy on testnet first, then mainnet (`--chain-id 1990`). Verify with `forge verify-contract --verifier blockscout --verifier-url https://mainnet.qie.digital/api/`.
- The attester key needs a little mainnet QIE for gas. Budget roughly 100 projects × 1 snapshot/day × 14 days. Fees are tiny but check the balance daily; alert below a threshold.

---

## 7. Frontend

### 7.1 Non-negotiable UX budget
The product must be usable **within 10–15 s of landing**, on a mid-range Android over 4G.

| Budget | Target |
|---|---|
| Omnibox interactive (type an address or slug) | **< 2 s** |
| LCP | < 2.5 s |
| Indexed project dashboard: first numbers on screen | < 4 s from navigation |
| Peek (unindexed address): first partial results | < 10 s |
| Initial JS (gzip), excluding the lazy 3D chunk | ≤ 180 KB |
| 3D chunk (three + scene), lazy | ≤ 220 KB gzip, loaded after `requestIdleCallback` or 1.5 s |
| Long tasks during first 3 s | none > 200 ms |

Hard rules:
- **No preloader, no intro animation, no scroll-jacking.** The hero is server-meaningful HTML: headline, omnibox and live stats render before any WebGL.
- WebGL **enhances** a page that already works. If WebGL fails, is slow, or reduced motion is on, the page looks intentional with a static fallback (an SVG contour image generated at build time).
- No animation ever gates a click. Elements must be clickable while animating.
- Content never starts hidden in HTML. Reveal classes are added by JS only after `document.documentElement.classList.add('js-motion')`, so no-JS and slow-JS users see everything.
- App routes (`/p/*`, `/explore`, `/register`, `/api-docs`) are tools: the motion budget there is micro-interactions only (≤ 250 ms), no ScrollTrigger sequences.

### 7.2 Stack
- Vite + React 18 + TypeScript, React Router, TanStack Query (stale-while-revalidate, 60 s).
- wagmi v2 + viem, custom chain `qie` (id 1990, rpc1–5 via `fallback()` transport).
- three.js (vanilla, one module, lazy). No React Three Fiber: one background scene doesn't justify the weight.
- GSAP + ScrollTrigger (landing only), Lenis (landing + project page; disabled under reduced motion; `data-lenis-prevent` on tables, modals and code blocks).
- Charts: custom SVG with `d3-scale` + `d3-shape` (small, fully styleable, glow via SVG filter). Cohort heatmap as an HTML grid.
- Styling: CSS Modules + CSS custom properties (tokens below). No UI kit.
- Fonts: **Instrument Serif** (display headlines and big numerals), **Geist** (UI), **Geist Mono** (addresses, hashes, tables; tabular numbers). Self-host, `font-display: swap`, preload only Geist 400/500.

### 7.3 Visual language — "the instrument of truth"
The theme comes from the name: a precision instrument built from Roman materials (basalt, marble, bronze patina, gold, cinnabar) running a modern operating system. It separates noise from truth in front of you. Think engraved measurement plates and a lab instrument, not "crypto neon" and not a toga costume. No columns, laurels or fake Latin filler.

**Palette (dark only for MVP)**. Every color is a real Roman material, which keeps it coherent and non-generic.
| Token | Hex | Material | Use |
|---|---|---|---|
| `--nox` | `#08090B` | night | page background |
| `--basalt` | `#121417` | basalt | glass panel base (at 55% alpha) |
| `--slab` | `#1A1D21` | dark stone | solid panel fallback, inputs, tables |
| `--marble` | `#ECE6DA` | marble | primary text |
| `--ash` | `#858A90` | ash | secondary text, gridlines |
| `--verdigris` | `#4FD6B0` | bronze patina | **Verum** (organic) data, healthy, live |
| `--aurum` | `#E8B04A` | gold | Seals (on-chain proof), milestones, primary CTA |
| `--cinnabar` | `#C8553D` | Roman red pigment | flagged / bot / error |
| `--hairline` | `rgba(236,230,218,0.08)` | — | 1px borders |

Color meaning is fixed: **verdigris = real, ash = recorded/raw, cinnabar = noise, gold = proven on-chain.** Never use them decoratively. No purple, no gradient text, no emoji labels. Gold appears in at most two places per screen.

**Engraved details** (sparingly; these carry the identity):
- Section labels in small caps Geist Mono with a hairline rule: `— RECORDED · VERUM · SEALED —`.
- Each Seal is shown as a small gold circular stamp with the date and the first 6 chars of its hash, engraved style (SVG, 1px strokes).
- Tick marks on chart axes look like ruler engravings (major/minor ticks), not default gridlines.

**Glass panels**: `background: rgb(18 20 23 / .55); backdrop-filter: blur(14px) saturate(120%); border: 1px solid var(--hairline); border-radius: 14px`.
- At most **6 blurred panels on screen**. Tables and long lists use solid `--slab`, never blur (readability and mobile GPU).
- `@supports not (backdrop-filter: blur(1px))`: solid `--slab`.

**Floating grid system**: a 12-col grid with a faint 8px dot lattice behind content (CSS `radial-gradient`, not WebGL). Panels "float" with a 1px offset shadow plus a tiny parallax (≤ 6px) on landing only.

**Type scale**: 12 / 14 / 16 / 20 / 28 / 44 / 72. Big KPI numerals in Instrument Serif 44–72 with Geist Mono units. Tabular-nums everywhere numbers align.

### 7.4 WebGL scene (one scene, real data, lazy)
The 3D is a **data surface**, not decoration:
The scene shows the product's core idea literally: **noise goes in, truth comes out.**
1. **The Sieve**: a horizontal wireframe lattice plane floating mid-scene (thin `--ash` lines, glowing faintly). It represents the organic filter.
2. **Recorded particles (above the Sieve)**: `Points` (max 1,500 desktop / 400 mobile). Each new tx from `/api/v2/main-page/transactions` (polled every 10 s) spawns a particle that drifts down toward the Sieve. Particles from known bot/system addresses (§4.5, plus wallets flagged `bot`) hit the lattice, flash `--cinnabar` and dissolve. Everything else passes through and turns `--verdigris`. Additive blending, size attenuation.
3. **The Record (below the Sieve)**: a wireframe ridge surface, `PlaneGeometry(160, 60, 180, 60)` displaced in the vertex shader. Heights come from the last 90 days of chain-wide tx/day (`/api/v2/stats/charts/transactions`) **with the oracle-bot address subtracted**, so it's the real shape of activity. Iso-lines via `fract(height * k)` in `--ash`, peaks tinted `--verdigris`. Particles that pass the Sieve settle onto it.
4. **The Line**: a single thin `--aurum` line across the ridge at the height of the organic share (chain-wide on landing; that project's Verum score on a project page). This is the brand mark rendered in 3D.
5. **Live pulse**: each new Seal (on-chain snapshot) sends one slow gold ring across the Record. Rare by design, so it means something.

**Camera**: slow drift (amplitude ≤ 2 units, 40 s loop). On the landing page, ScrollTrigger scrubs the camera through 3 keyframes as the visitor scrolls the 3 short sections: (1) wide view, particles raining through the Sieve → (2) close to the Sieve, watching noise burn off → (3) top-down on the Record with the gold Line. Disable under reduced motion.

**Performance rules**: `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`; `powerPreference: 'low-power'` on mobile; stop the rAF loop when the tab is hidden or the canvas is offscreen (IntersectionObserver); dispose on route change. **Low-power detection**: no WebGL2, or `hardwareConcurrency ≤ 4 && deviceMemory ≤ 4`, or reduced motion → static SVG fallback. Measure the first 60 frames; if average > 22 ms, drop to 400 particles and halve terrain segments.

### 7.5 Motion (GSAP + ScrollTrigger + Lenis)
- **Lenis**: `lerp 0.1`, `smoothWheel true`, touch uses native. Sync with ScrollTrigger (`lenis.on('scroll', ScrollTrigger.update)`; drive Lenis from `gsap.ticker`).
- **Section reveals (landing only)**: each section's panels rise 24px and fade from 0 → 1 over 0.6 s, stagger 0.06, `once: true`, `start: 'top 80%'`. Never reverse on scroll-up.
- **Layered parallax**: three depths (WebGL terrain, dot grid, glass panels) at 0.2 / 0.5 / 1.0 scroll speed. Max offset 40px.
- **Numbers**: KPI tiles count up over 0.8 s on first view only; on data refresh they cross-fade, not recount.
- **Reduced motion**: no Lenis, no parallax, no count-up, no camera scrub; WebGL renders one static frame.

### 7.6 Pages

**`/` Landing** (short: hero + 3 sections + footer; under 3 screens on desktop)
- **Hero (above the fold, interactive at once)**: headline in Instrument Serif ("Real users, on the record."), one line of subcopy ("Paste any QIE contract. See what's recorded, what's real, and what's sealed on-chain."), and the **omnibox**: paste a contract address or type a project name. Autocomplete from registered projects, and routes `0x…` to `/p/:slug` if indexed, otherwise `/peek/:address`. Autofocus on desktop. Below it, a live strip: chain txs today · organic share · projects tracked · oracle health (7 dots). Secondary buttons: "Register your project", "Explore leaderboard".
- **Section 1 — "Recorded vs Verum"**: one live example project with both numbers side by side and the flag reasons. Camera keyframe 2.
- **Section 2 — "Sealed on-chain"**: the latest Seals (snapshots) across all projects, each linking to its explorer tx. Camera keyframe 3.
- **Section 3 — "For builders and judges"**: three panels (Builders: track your 90-day milestones · Judges: one link per project · Devs: public API + badge) with the badge snippet copyable.
- Footer: registry contract address (copy + explorer link), API docs, GitHub, X.

**`/explore` Leaderboard**
Solid table (no blur): rank, project, track, Verum WAU, 7-day growth, D7 retention, Verum score, claimed badge. Sort by any column; filter by track; search. Unclaimed rows show "Unclaimed — is this yours?" Virtualize after 100 rows. Mobile: cards.

**`/p/:slug` Project dashboard**
Order by what a judge reads first:
1. Header: logo, name, track, claimed/verified badges, repo/site links, **Share** (copy link) and **Badge** (copy README snippet), **Watch** (on-chain tx).
2. KPI row (glass): Verum WAU · Recorded WAU · Total wallets · Txs (30d) · USD volume (30d) · Verum score with a hover formula.
3. Main chart: Verum vs Recorded daily wallets (two lines, `--verdigris` solid, `--ash` dashed), a tx-count area behind, range toggle 7d/30d/90d/all.
4. Milestone tracker: three bars toward target with a 90-day clock; reached milestones link to their on-chain tx.
5. Signal panel: counts per flag with an expandable list of flagged wallets and reasons.
6. Retention cohort heatmap (weekly cohorts × D1/D7/D30).
7. Top methods (decoded name if verified ABI, else selector) and concentration.
8. Seals table (snapshots): date, Verum wallets, Recorded wallets, txs, hash, explorer link, "recompute" button (fetches the payload, hashes in-browser, shows ✓ match).
9. Contracts list with verification and ownership status.
Loading: skeletons sized to final layout (no layout shift). Data comes from cache, so it should be under 1 s after the API responds.

**`/register` (and `/claim/:slug`)**
Steps in one page, no wizard pages: connect QIE Wallet → slug + name + track + links → contract addresses (validated live: is_contract, creator shown, ✓ if creator = connected wallet) → optional team wallets → three milestones (presets matching the hackathon examples) → review → one tx (`register` + `addContracts` + `setMilestones` via a multicall-style `registerFull` helper in the contract to keep it to **one signature**). After the tx confirms, redirect to the dashboard with a "backfilling…" progress bar (polls `/v1/projects/:slug/sync`).

**`/peek/:address`**
Client-side: explorer calls straight from the browser, last 10k txs, raw metrics only, banner "Preview. Register to unlock organic filtering, history and on-chain proof." with a Register CTA.

**`/api-docs`**
Static page listing endpoints, metric definitions, the Verum score formula and the badge URL format.

### 7.7 Accessibility
- WCAG AA contrast against `--nox` (check `--ash` on glass; bump if needed).
- Keyboard: the omnibox is the first tab stop; every chart has a "View as table" toggle; focus rings in `--aurum`.
- Canvas is `aria-hidden`; all data shown in WebGL also exists in DOM text.

---

## 8. Public API (`/v1`, JSON, CORS open, cached 60 s)
```
GET /v1/projects?track=&sort=organic_wau&limit=50&cursor=
GET /v1/projects/:slug
GET /v1/projects/:slug/metrics?range=30d          -> daily_metrics rows
GET /v1/projects/:slug/cohorts
GET /v1/projects/:slug/flags?flag=bot
GET /v1/projects/:slug/milestones
GET /v1/projects/:slug/snapshots
GET /v1/projects/:slug/snapshots/:date            -> canonical payload (hashable)
GET /v1/projects/:slug/sync                       -> {status, last_synced_block, progress}
GET /v1/chain/pulse                               -> txs today, organic share, oracle health
GET /badge/:slug.svg?metric=organic_wau           -> README badge (SVG, cached 10 min)
```
Validate params with zod. Return `{data, meta:{generated_at, price_source}}`.

---

## 9. Traction plan (built into the product)
1. **Day the registry hits mainnet**: pre-index every verified mainnet contract (`/api/v2/smart-contracts`, 140 at test time) as **unclaimed** pages, grouped by creator address. The leaderboard is full on day one.
2. Post in the QIE developer Telegram: "Your project already has a traction page. Claim it." Link to `/explore`.
3. DM creators of the most active unclaimed contracts with their page link.
4. **Badge loop**: each claimed project gets a README badge. Judges reviewing GitHub repos see "Verum" on every one that uses it.
5. **Watch button**: users and judges follow projects with an on-chain tx, and Verum shows its own metrics on its own page (`/p/verum`). Eat your own cooking.
6. Ask QIE in the Telegram whether judges would accept Verum links in submissions. If yes, everyone in the hackathon is an incentivised user.

Verum's own traction metrics to report: projects claimed, contracts tracked, registry txs (register, watch, snapshot, milestone), unique wallets interacting with the registry, API/badge requests.

**Integrity**: Verum never generates its own fake activity. Snapshots are attester txs and are counted separately from user txs on Verum's own page.

---

## 10. Build plan (Nov 16 → Nov 30)

| Day | Date | Deliverable |
|---|---|---|
| 1 | Mon 16 | Monorepo, chain config, Foundry project. Ask the §4.6 questions in Telegram. Get mainnet QIE for gas. Test QIE Wallet connect. |
| 2 | Tue 17 | `VerumRegistry` + tests. Deploy and verify on **testnet**. |
| 3 | Wed 18 | Worker: backfill + incremental sync into Postgres; throttled client; re-org guard. |
| 4 | Thu 19 | Metrics rollups, organic filter, cohorts, price ticks (oracle + fallback). |
| 5 | Fri 20 | API routes + badge SVG. Seed with 5 real mainnet contracts and check numbers by hand against the explorer. |
| 6 | Sat 21 | Web: tokens, layout, omnibox, Explore table, Project dashboard (no WebGL yet). |
| 7 | Sun 22 | Register/claim flow with wagmi; ownership checks; sync progress. |
| 8 | Mon 23 | WebGL scene + fallback, GSAP/Lenis on landing; performance pass against §7.1. |
| 9 | Tue 24 | **Mainnet deploy + verify.** Attester cron live. Pre-index verified contracts. Launch post in Telegram. |
| 10–13 | Wed 25 – Sat 28 | Outreach, claim support, bug fixes, stretch items only if stable. Daily snapshots running. |
| 14 | Sun 29 | Demo video (≤ 3 min), README, submission draft. Freeze features. |
| 15 | Mon 30 | Submit **well before 23:59 CET**. Leave a 6-hour buffer. |

Commit at least daily with real messages. The rules ban recycled code and "AI-generated projects with minimal developer effort", so a visible, steady history is your evidence.

---

## 11. Submission checklist
- [ ] Public GitHub repo (monorepo), clear README with architecture diagram and metric definitions
- [ ] Live URL (Vercel) + API URL
- [ ] `VerumRegistry` mainnet address, **verified** on mainnet.qie.digital
- [ ] Track: **Developer Infrastructure & Tooling**
- [ ] Demo video: problem (screenshots of traction) → paste address → organic vs raw → claim → milestone → on-chain snapshot recompute ✓
- [ ] Traction evidence: projects claimed, registry txs, unique wallets, links to `/p/verum`
- [ ] List of QIE components used (Wallet, Oracles, QUSDC, Explorer, + QIE ID if done)

---

## 12. Engineering rules for the coding agent
- TypeScript strict everywhere; shared types in `/packages/shared`.
- Every explorer call goes through one client with throttle (3 req/s), retry (3×, exponential backoff with jitter), timeout 30 s, and request logging.
- Never trust the client for metrics; the API reads only from Postgres.
- Secrets (`ATTESTER_PK`, `DATABASE_URL`) only in env. Never commit `.env`. Ship `.env.example`.
- Postgres (decided 20 Nov):
  - **TLS is always required.** postgres.js v4 defaults to `ssl: false`, i.e. unencrypted. Supabase's pooler certificate chains to Supabase's own CA, so full verification needs `DATABASE_CA_CERT`.
  - **RLS is enabled on every table, with no policies.** Supabase's REST API exposes `public` tables to the public anon key. The worker and api connect as the owner, which bypasses RLS. New tables must enable RLS in the same migration.
  - Use the Supabase **Session pooler** URL (5432, IPv4).
- Addresses: store lowercase, display checksummed (viem `getAddress`), truncated `0x1234…abcd` with copy on click.
  - Validate with strict `isAddress`: viem's `getAddress` silently re-checksums a bad mixed-case address instead of rejecting it.
  - Inputs (omnibox, register form) accept both `0x…` and `qie1…` (`qieAddressInputSchema`); storage and the API stay 0x.
- Time: store UTC; display in the viewer's local time with UTC on hover.
- Each metric has a unit test with a fixture of real txs (save a JSON fixture from mainnet on day 3).
- Lighthouse mobile ≥ 85 performance on `/` and `/p/:slug` before Nov 24.
- If any number on the dashboard can't be explained by the metric definitions in §5.4, it's a bug.