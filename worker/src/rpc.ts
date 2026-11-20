/**
 * JSON-RPC access (rpc1–5, §7.2). Used for top-level senders of internal txs.
 *
 * Measured 19 Nov 2026: all five mainnet RPCs accept JSON-RPC batches but work through the items
 * one at a time (a 100-item batch took 3–13 s depending on the node). So origin lookups use small
 * batches spread across every RPC in parallel, instead of one big batch on one node.
 * RPC traffic doesn't count against the explorer's 3 req/s budget.
 */
import { createPublicClient, fallback, http, type Hash, type PublicClient } from 'viem';
import { NETWORKS, type QieNetwork } from '@verum/shared';
import { selectorOf } from './ingest/normalize';

export const ORIGIN_BATCH_SIZE = 25;

export interface Rpc {
  /** General-purpose client: fallback across all RPCs. */
  client: PublicClient;
  /** One batching client per RPC endpoint, for spreading bulk lookups. */
  pool: PublicClient[];
}

export const createRpc = (network: QieNetwork): Rpc => {
  const { chain, rpcUrls } = NETWORKS[network];
  const transport = (url: string) => http(url, { batch: { batchSize: ORIGIN_BATCH_SIZE }, timeout: 30_000, retryCount: 2 });
  return {
    client: createPublicClient({ chain, transport: fallback(rpcUrls.map(transport)) }) as PublicClient,
    pool: rpcUrls.map((url) => createPublicClient({ chain, transport: transport(url) }) as PublicClient),
  };
};

export interface TopLevelTx {
  from: string;
  nonce: number;
  /** 4-byte selector of the top-level calldata ('0x' for a plain transfer). */
  selector: string;
}

/**
 * hash -> lowercase `from` and `nonce` of the top-level tx. One worker per RPC pulls batches off a shared queue;
 * a batch that fails on one node is retried once by the next worker. Hashes that still fail are
 * left out (the caller retries them on the next sync).
 */
export const fetchOrigins = async (rpc: Rpc, hashes: readonly string[]): Promise<Map<string, TopLevelTx>> => {
  const out = new Map<string, TopLevelTx>();
  const queue: { hashes: string[]; tries: number }[] = [];
  for (let i = 0; i < hashes.length; i += ORIGIN_BATCH_SIZE) {
    queue.push({ hashes: hashes.slice(i, i + ORIGIN_BATCH_SIZE), tries: 0 });
  }

  const worker = async (client: PublicClient) => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // Concurrent calls in one tick are coalesced into one JSON-RPC batch by viem's http transport.
      const res = await Promise.allSettled(job.hashes.map((hash) => client.getTransaction({ hash: hash as Hash })));
      const failed: string[] = [];
      res.forEach((r, j) => {
        if (r.status === 'fulfilled') out.set(job.hashes[j]!, {
          from: r.value.from.toLowerCase(),
          nonce: r.value.nonce,
          selector: selectorOf(r.value.input),
        });
        else failed.push(job.hashes[j]!);
      });
      if (failed.length > 0 && job.tries === 0) queue.push({ hashes: failed, tries: 1 });
    }
  };

  await Promise.all(rpc.pool.map(worker));
  return out;
};
