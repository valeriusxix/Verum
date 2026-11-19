import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { QIE_MAINNET_EXPLORER } from '@verum/shared';
import { ExplorerClient, ExplorerError } from '../src/explorer/client';
import { RateLimiter } from '../src/explorer/throttle';
import { FakeClock, silentLog } from './fakes';

const schema = z.object({ ok: z.literal(true) });

const setup = (responses: Array<number | Error | { status: number; body: unknown }>) => {
  const clock = new FakeClock();
  const calls: string[] = [];
  const fetchFake = (async (url: string) => {
    calls.push(String(url));
    const r = responses.shift();
    if (r === undefined) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    const { status, body } = typeof r === 'number' ? { status: r, body: { ok: true } } : r;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const client = new ExplorerClient({
    explorer: QIE_MAINNET_EXPLORER,
    limiter: new RateLimiter(1000, clock),
    fetch: fetchFake,
    clock,
    random: () => 1, // deterministic: full backoff cap
    log: silentLog,
  });
  return { client, calls, clock };
};

test('retries 5xx / 429 with exponential backoff, then succeeds', async () => {
  const { client, calls, clock } = setup([500, 429, 503, 200]);
  assert.deepEqual(await client.v2('stats', schema), { ok: true });
  assert.equal(calls.length, 4);
  const backoffs = clock.sleeps.filter((ms) => ms >= 100);
  assert.deepEqual(backoffs, [500, 1000, 2000]);
});

test('gives up after 3 retries (4 attempts)', async () => {
  const { client, calls } = setup([500, 500, 500, 500, 200]);
  await assert.rejects(client.v2('stats', schema), (e: unknown) => e instanceof ExplorerError && e.status === 500);
  assert.equal(calls.length, 4);
});

test('does not retry 4xx or a changed response shape', async () => {
  const a = setup([404]);
  await assert.rejects(a.client.v2('stats', schema), /HTTP 404/);
  assert.equal(a.calls.length, 1);

  const b = setup([{ status: 200, body: { ok: 'yes' } }]);
  await assert.rejects(b.client.v2('stats', schema), /unexpected response shape/);
  assert.equal(b.calls.length, 1);
});

test('retries timeouts and network errors', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { client, calls } = setup([timeout, new TypeError('fetch failed'), 200]);
  assert.deepEqual(await client.v2('stats', schema), { ok: true });
  assert.equal(calls.length, 3);
});

test('builds v1 and v2 URLs', async () => {
  const { client, calls } = setup([200, 200]);
  await client.v1({ module: 'account', action: 'txlist', address: '0xabc', skip: undefined }, schema);
  await client.v2('/blocks', schema, { type: 'block' });
  assert.equal(calls[0], 'https://mainnet.qie.digital/api?module=account&action=txlist&address=0xabc');
  assert.equal(calls[1], 'https://mainnet.qie.digital/api/v2/blocks?type=block');
});

test('backoff is capped and jittered', () => {
  const clock = new FakeClock();
  const c = new ExplorerClient({ explorer: QIE_MAINNET_EXPLORER, clock, random: () => 0.5, log: silentLog });
  assert.equal(c.backoffMs(0), 250);
  assert.equal(c.backoffMs(10), 7500); // cap 15 s · 0.5
});
