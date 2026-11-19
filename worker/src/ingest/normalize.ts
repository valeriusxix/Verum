/**
 * Explorer rows -> `txs` rows (§5.2). Pure; no I/O.
 * - Addresses lowercase (§12). `input` is cut to its 4-byte selector before storing (§5.1).
 * - Every field is set (null, never undefined): postgres.js aborts a transaction on `undefined`.
 */
import type { ExplorerInternalTxRow, ExplorerTokenTxRow, ExplorerTxlistRow } from '@verum/shared';

export type TxKind = 'ext' | 'int' | 'token';

export interface TxRow {
  hash: string;
  kind: TxKind;
  log_index: number;
  contract: string;
  block: number;
  ts: Date;
  from_addr: string;
  to_addr: string | null;
  /** Top-level tx sender: ext = from; int = resolved later via RPC; token = null (§5.4 counts the transfer sender). */
  origin_addr: string | null;
  selector: string | null;
  value_wei: string;
  token: string | null;
  token_amount: string | null;
  success: boolean;
  gas_used: string | null;
}

export const TX_COLUMNS = [
  'hash',
  'kind',
  'log_index',
  'contract',
  'block',
  'ts',
  'from_addr',
  'to_addr',
  'origin_addr',
  'selector',
  'value_wei',
  'token',
  'token_amount',
  'success',
  'gas_used',
] as const satisfies readonly (keyof TxRow)[];

const lc = (s: string) => s.toLowerCase();
const addrOrNull = (s: string) => (s === '' ? null : lc(s));
const tsOf = (timeStamp: string) => new Date(Number(timeStamp) * 1000);
const gasOrNull = (s: string) => (/^\d+$/.test(s) ? s : null);

/** First 4 bytes of calldata, lowercase. `0x` for empty calldata (plain value transfer). */
export const selectorOf = (input: string): string => {
  const s = lc(input);
  return /^0x[0-9a-f]{8}/.test(s) ? s.slice(0, 10) : '0x';
};

export const normalizeExternal = (r: ExplorerTxlistRow, contract: string): TxRow => {
  const creation = r.to === '';
  return {
    hash: lc(r.hash),
    kind: 'ext',
    log_index: -1,
    contract: lc(contract),
    block: Number(r.blockNumber),
    ts: tsOf(r.timeStamp),
    from_addr: lc(r.from),
    to_addr: addrOrNull(r.to),
    origin_addr: lc(r.from),
    // Creation calldata is init code, not a method call.
    selector: creation ? null : selectorOf(r.input),
    value_wei: r.value,
    token: null,
    token_amount: null,
    // txreceipt_status is "" on pre-Byzantium-style rows; isError is always present.
    success: r.isError === '0' && r.txreceipt_status !== '0',
    gas_used: gasOrNull(r.gasUsed),
  };
};

export const normalizeInternal = (r: ExplorerInternalTxRow, contract: string): TxRow => ({
  hash: lc(r.transactionHash),
  kind: 'int',
  log_index: Number(r.index),
  contract: lc(contract),
  block: Number(r.blockNumber),
  ts: tsOf(r.timeStamp),
  from_addr: lc(r.from),
  to_addr: r.to === '' ? addrOrNull(r.contractAddress) : lc(r.to),
  origin_addr: null,
  selector: r.type === 'create' ? null : selectorOf(r.input),
  value_wei: r.value,
  token: null,
  token_amount: null,
  success: r.isError === '0',
  gas_used: gasOrNull(r.gasUsed),
});

export const normalizeTokenTransfer = (r: ExplorerTokenTxRow, contract: string): TxRow => ({
  hash: lc(r.hash),
  kind: 'token',
  log_index: Number(r.logIndex),
  contract: lc(contract),
  block: Number(r.blockNumber),
  ts: tsOf(r.timeStamp),
  from_addr: lc(r.from),
  to_addr: addrOrNull(r.to),
  origin_addr: null,
  selector: selectorOf(r.input),
  value_wei: '0',
  token: lc(r.contractAddress),
  token_amount: r.value,
  success: true, // a Transfer log only exists in a successful tx
  gas_used: gasOrNull(r.gasUsed),
});

/** Identity of a row, matching the table's primary key. */
export const rowKey = (r: Pick<TxRow, 'hash' | 'kind' | 'log_index' | 'contract'>) =>
  `${r.hash}|${r.kind}|${r.log_index}|${r.contract}`;
