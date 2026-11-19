import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginateByBlock } from '../src/ingest/paginate';
import { silentLog } from './fakes';

type Row = { block: number; id: string };

/** Fake explorer: rows sorted asc; returns up to pageSize rows with block >= startblock. */
const fakeSource = (rows: Row[], pageSize: number) => {
  const startblocks: number[] = [];
  const fetchPage = async (sb: number) => {
    startblocks.push(sb);
    return rows.filter((r) => r.block >= sb).slice(0, pageSize);
  };
  return { fetchPage, startblocks };
};

const collect = async (rows: Row[], pageSize: number, startblock = 0) => {
  const src = fakeSource(rows, pageSize);
  const seen = new Map<string, Row>();
  for await (const page of paginateByBlock({ startblock, pageSize, fetchPage: src.fetchPage, blockOf: (r) => r.block, log: silentLog })) {
    for (const r of page) seen.set(r.id, r);
  }
  return { ids: [...seen.keys()].sort(), startblocks: src.startblocks };
};

test('a page boundary in the middle of a block loses nothing (re-reads the last block)', async () => {
  // pageSize 3: page 1 = [x, y, b] ends in the middle of block 2 ('c' is on the next page)
  const rows: Row[] = [
    { block: 1, id: 'x' },
    { block: 1, id: 'y' },
    { block: 2, id: 'b' },
    { block: 2, id: 'c' },
    { block: 3, id: 'e' },
  ];
  const { ids, startblocks } = await collect(rows, 3);
  assert.deepEqual(ids, ['b', 'c', 'e', 'x', 'y']);
  assert.deepEqual(startblocks, [0, 2, 3]); // page 2 starts AT block 2; it's full, so a short page 3 follows
  // the spec's lastBlock + 1 would have started page 2 at block 3 and lost 'c'
  const plusOne = rows.filter((r) => r.block >= 3).map((r) => r.id);
  assert.ok(!plusOne.includes('c'));
});

test('stops after a short page; empty source yields nothing', async () => {
  assert.deepEqual((await collect([{ block: 5, id: 'x' }], 10)).startblocks, [0]);
  assert.deepEqual(await collect([], 10), { ids: [], startblocks: [0] });
});

test('a full page inside a single block cannot loop forever', async () => {
  const rows: Row[] = [
    { block: 7, id: 'a' },
    { block: 7, id: 'b' },
    { block: 8, id: 'c' },
  ];
  const { ids, startblocks } = await collect(rows, 2, 7);
  assert.deepEqual(startblocks, [7, 8]); // advanced past block 7 instead of re-reading it forever
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
