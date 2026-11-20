/**
 * `startblock` cursor pagination with adaptive page size (§5.1, amended 19–20 Nov 2026).
 *
 * Cursor: the next page starts AT the last block of the previous one (the spec's `lastBlock + 1`
 * skips the rest of a block whenever a full page ends mid-block); the primary key drops the
 * re-read duplicates.
 *
 * Page size (20 Nov): starts at `maxPageSize` (the spec's 10,000). Measured 20 Nov: a full
 * 10,000-row internal-tx page is ~19.5 MB and took ~31 s, over the 30 s timeout, so it could fail
 * on every attempt. On a transient failure (timeout / 5xx / 429 / network) the page halves, down
 * to `minPageSize`, and the SAME startblock is re-read, so no data is skipped. After `growAfter`
 * good pages it doubles back toward the max. Above the minimum a failing request is not retried
 * at the same size (`retries: 0`); at the minimum the client's normal retries apply.
 *
 * A full page that lies inside one block can't make progress. Below the max the page grows and
 * the block is re-read; at the max the cursor moves to +1 and logs a warning.
 */
import type { Logger } from '../log';

export interface PaginateOptions<R> {
  /** First block to read (inclusive). */
  startblock: number;
  maxPageSize: number;
  minPageSize: number;
  /** `retries` is undefined when the client's default retry policy should apply. */
  fetchPage: (startblock: number, pageSize: number, retries: number | undefined) => Promise<R[]>;
  blockOf: (row: R) => number;
  /** Errors worth shrinking the page for. Default: `err.retryable === true` (ExplorerError). */
  isTransient?: (err: unknown) => boolean;
  /** Good pages in a row before the page size doubles again. */
  growAfter?: number;
  log?: Logger;
}

const defaultIsTransient = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { retryable?: unknown }).retryable === true;

export async function* paginateByBlock<R>(o: PaginateOptions<R>): AsyncGenerator<R[], void, void> {
  const isTransient = o.isTransient ?? defaultIsTransient;
  const growAfter = o.growAfter ?? 3;
  let start = o.startblock;
  let size = o.maxPageSize;
  let streak = 0;

  for (;;) {
    let rows: R[];
    try {
      rows = await o.fetchPage(start, size, size > o.minPageSize ? 0 : undefined);
    } catch (err) {
      if (size > o.minPageSize && isTransient(err)) {
        const next = Math.max(o.minPageSize, Math.floor(size / 2));
        o.log?.warn('page failed; shrinking', { startblock: start, from: size, to: next, error: errMsg(err) });
        size = next;
        streak = 0;
        continue;
      }
      throw err;
    }

    if (rows.length > 0) yield rows;
    if (rows.length < size) return;

    const last = o.blockOf(rows[rows.length - 1]!);
    if (last > start) {
      start = last;
    } else if (size < o.maxPageSize) {
      size = Math.min(o.maxPageSize, size * 2);
      streak = 0;
      o.log?.warn('full page within one block; growing page', { block: start, to: size });
      continue;
    } else {
      o.log?.warn('full page within one block at max size; skipping ahead', { block: start, rows: rows.length });
      start = start + 1;
    }

    if (size < o.maxPageSize && ++streak >= growAfter) {
      size = Math.min(o.maxPageSize, size * 2);
      streak = 0;
    }
  }
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
