import { NETWORKS, type QieNetwork } from '@verum/shared';

// Day 3: throttled explorer client, backfill + incremental sync, re-org guard.
// Day 4: rollups, organic filter, cohorts, price ticks.
// Day 9: attester cron + registry listener.

const network = (process.env.VERUM_NETWORK ?? 'mainnet') as QieNetwork;
const { chain, explorer } = NETWORKS[network];

console.log(`[worker] ${chain.name} (${chain.id}) · explorer ${explorer.url} · nothing scheduled yet (Day 1 scaffold)`);
