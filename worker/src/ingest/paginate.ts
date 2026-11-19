/**
 * `startblock` cursor pagination (§5.1, amended 19 Nov 2026).
 *
 * The spec's `startblock = lastBlock + 1` skips the rest of a block whenever a full page ends
 * mid-block. So the next page starts AT the last block and the primary key drops the duplicates.
 * If an entire full page is a single block (re-reading it can't make progress), the cursor moves
 * to +1 and logs a warning: that block has more rows than one page can hold.
 */
import type { Logger } from '../log';

export interface PaginateOptions<R> {
  /** First block to read (inclusive). */
  startblock: number;
  pageSize: number;
  fetchPage: (startblock: number) => Promise<R[]>;
  blockOf: (row: R) => number;
  log?: Logger;
}

export async function* paginateByBlock<R>(o: PaginateOptions<R>): AsyncGenerator<R[], void, void> {
  let start = o.startblock;
  for (;;) {
    const rows = await o.fetchPage(start);
    if (rows.length > 0) yield rows;
    if (rows.length < o.pageSize) return;

    const last = o.blockOf(rows[rows.length - 1]!);
    if (last > start) {
      start = last;
    } else {
      o.log?.warn('full page within one block; skipping ahead', { block: start, rows: rows.length });
      start = start + 1;
    }
  }
}
