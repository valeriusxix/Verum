/**
 * Typed explorer endpoints used by the indexer (§4.2, §5.1).
 */
import {
  QUSDC,
  TXLIST_PAGE_SIZE,
  explorerAddressSchema,
  explorerBlocksSchema,
  explorerInternalTxResponseSchema,
  explorerTokenTxResponseSchema,
  explorerTxlistResponseSchema,
  type ExplorerAddress,
  type ExplorerInternalTxRow,
  type ExplorerTokenTxRow,
  type ExplorerTxlistRow,
} from '@verum/shared';
import { ExplorerError, type ExplorerClient, type RequestOptions } from './client';

export interface BlockRange {
  startblock: number;
  endblock: number;
  /** Rows per page; defaults to the spec's 10,000. */
  offset?: number;
}

type V1Envelope<R> = { status: '0' | '1'; message: string; result: R[] | null };

/** status "0" + `result: []` is a normal empty page; status "0" + `result: null` is an error. */
const rowsOf = <R>(res: V1Envelope<R>, what: string): R[] => {
  if (res.result) return res.result;
  const transient = /timeout|rate|busy|try again/i.test(res.message);
  throw new ExplorerError(`${what}: ${res.message}`, transient);
};

const page = (address: string, r: BlockRange) => ({
  module: 'account',
  address,
  startblock: r.startblock,
  endblock: r.endblock,
  sort: 'asc',
  page: 1,
  offset: r.offset ?? TXLIST_PAGE_SIZE,
});

export const createExplorerApi = (client: ExplorerClient) => ({
  client,

  /** Newest block the explorer has indexed. */
  async indexedHead(opts?: RequestOptions): Promise<number> {
    const res = await client.v2('blocks', explorerBlocksSchema, { type: 'block' }, opts);
    return res.items[0]!.height;
  },

  async txlist(address: string, r: BlockRange, opts?: RequestOptions): Promise<ExplorerTxlistRow[]> {
    const res = await client.v1({ ...page(address, r), action: 'txlist' }, explorerTxlistResponseSchema, opts);
    return rowsOf(res, 'txlist');
  },

  async txlistInternal(address: string, r: BlockRange, opts?: RequestOptions): Promise<ExplorerInternalTxRow[]> {
    const res = await client.v1(
      { ...page(address, r), action: 'txlistinternal' },
      explorerInternalTxResponseSchema,
      opts,
    );
    return rowsOf(res, 'txlistinternal');
  },

  /** QUSDC transfers only (§5.1). */
  async qusdcTransfers(address: string, r: BlockRange, opts?: RequestOptions): Promise<ExplorerTokenTxRow[]> {
    const res = await client.v1(
      { ...page(address, r), action: 'tokentx', contractaddress: QUSDC.address },
      explorerTokenTxResponseSchema,
      opts,
    );
    return rowsOf(res, 'tokentx');
  },

  /** is_contract, creator_address_hash (ownership checks), is_verified. */
  address(address: string, opts?: RequestOptions): Promise<ExplorerAddress> {
    return client.v2(`addresses/${address}`, explorerAddressSchema, {}, opts);
  },
});

export type ExplorerApi = ReturnType<typeof createExplorerApi>;
