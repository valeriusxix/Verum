import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginateByBlock } from '../src/ingest/paginate';
import { silentLog } from './fakes';

type Row = { block: number; id: string };
type Call = { start: number; size: number; retries: number | undefined };

const transient = Object.assign(new Error('timeout'), { retryable: true });
const fatal = Object.assign(new Error('HTTP 404'), { retryable: false });

/**
 * Fake explorer: rows sorted asc; returns up to `size` rows with block >= start.
 * `failWhen(call)` returns an error to throw for that call, or undefined.
 */
const run = async (
  rows: Row[],
  o: { max: number; min?: number; start?: number; growAfter?: number; failWhen?: (c: Call) => Error | undefined },
) => {
  const calls: Call[] = [];
  const seen = new Map<string, Row>();
  for await (const page of paginateByBlock<Row>({
    startblock: o.start ?? 0,
    maxPageSize: o.max,
    minPageSize: o.min ?? 1,
    growAfter: o.growAfter,
    blockOf: (r) => r.block,
    log: silentLog,
    fetchPage: async (start, size, retries) => {
      const call = { start, size, retries };
      calls.push(call);
      const err = o.failWhen?.(call);
      if (err) throw err;
      return rows.filter((r) => r.block >= start).slice(0, size);
    },
  })) {
    for (const r of page) seen.set(r.id, r);
  }
  return { ids: [...seen.keys()].sort(), calls };
};

const seq = (n: number, perBlock = 1): Row[] =>
  Array.from({ length: n }, (_, i) => ({ block: Math.floor(i / perBlock) + 1, id: `r${String(i).padStart(4, '0')}` }));

test('a page boundary in the middle of a block loses nothing (re-reads the last block)', async () => {
  // max 3: page 1 = [x, y, b] ends in the middle of block 2 ('c' is on the next page)
  const rows: Row[] = [
    { block: 1, id: 'x' },
    { block: 1, id: 'y' },
    { block: 2, id: 'b' },
    { block: 2, id: 'c' },
    { block: 3, id: 'e' },
  ];
  const { ids, calls } = await run(rows, { max: 3 });
  assert.deepEqual(ids, ['b', 'c', 'e', 'x', 'y']);
  assert.deepEqual(calls.map((c) => c.start), [0, 2, 3]);
  // the spec's lastBlock + 1 would have started page 2 at block 3 and lost 'c'
});

test('stops after a short page; empty source yields nothing', async () => {
  assert.deepEqual((await run([{ block: 5, id: 'x' }], { max: 10 })).calls.length, 1);
  assert.deepEqual((await run([], { max: 10 })).ids, []);
});

test('pages above the minimum are not retried by the client (retries: 0); the minimum uses the default', async () => {
  const { calls } = await run(seq(3), { max: 4, min: 4 });
  assert.equal(calls[0]!.retries, undefined); // at min -> client default
  const b = await run(seq(3), { max: 8, min: 2 });
  assert.equal(b.calls[0]!.retries, 0);
});

test('a transient failure halves the page and re-reads the same block, losing nothing', async () => {
  const rows = seq(25);
  // pages of 8 time out; 4 works
  const { ids, calls } = await run(rows, { max: 8, min: 2, failWhen: (c) => (c.size >= 8 ? transient : undefined) });
  assert.deepEqual(ids, rows.map((r) => r.id).sort());
  assert.deepEqual(calls.slice(0, 2).map((c) => [c.start, c.size]), [[0, 8], [0, 4]]);
});

test('keeps halving down to the minimum, then gives up with the error', async () => {
  const { calls } = await run(seq(5), { max: 8, min: 2, failWhen: (c) => (c.size > 2 ? transient : undefined) });
  assert.deepEqual(calls.slice(0, 3).map((c) => c.size), [8, 4, 2]);
  await assert.rejects(run(seq(5), { max: 8, min: 2, failWhen: () => transient }), /timeout/);
});

test('non-transient errors are thrown immediately, without shrinking', async () => {
  let calls = 0;
  await assert.rejects(
    run(seq(5), { max: 8, min: 2, failWhen: () => (calls++, fatal) }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});

test('grows back toward the max after a streak of good pages', async () => {
  let failed = false;
  const rows = seq(40);
  const { ids, calls } = await run(rows, {
    max: 8,
    min: 2,
    growAfter: 2,
    failWhen: (c) => (!failed && c.size === 8 ? ((failed = true), transient) : undefined),
  });
  assert.deepEqual(ids, rows.map((r) => r.id).sort());
  const sizes = calls.map((c) => c.size);
  assert.deepEqual(sizes.slice(0, 4), [8, 4, 4, 8]); // fail -> 4, two good pages -> back to 8
});

test('a full page inside one block grows the page instead of skipping rows', async () => {
  // block 7 has 6 rows. The first 8-row page fails once, so the page shrinks to 4, and a 4-row
  // page is then full while still inside block 7.
  const rows: Row[] = [...seq(6, 6).map((r) => ({ ...r, block: 7 })), { block: 8, id: 'z' }];
  let failed = false;
  const { ids, calls } = await run(rows, {
    max: 8,
    min: 2,
    start: 7,
    failWhen: (c) => (!failed && c.size === 8 ? ((failed = true), transient) : undefined),
  });
  // fail at 8 -> 4 (full, all block 7) -> grow to 8 and re-read block 7 -> short page, done
  assert.deepEqual(calls.map((c) => [c.start, c.size]), [[7, 8], [7, 4], [7, 8]]);
  assert.deepEqual(ids, rows.map((r) => r.id).sort()); // all 6 rows of block 7 plus block 8
});

test('at the max, a full page inside one block skips ahead instead of looping', async () => {
  const rows: Row[] = [
    { block: 7, id: 'a' },
    { block: 7, id: 'b' },
    { block: 8, id: 'c' },
  ];
  const { ids, calls } = await run(rows, { max: 2, start: 7 });
  assert.deepEqual(calls.map((c) => c.start), [7, 8]);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
