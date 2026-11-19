import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/explorer/throttle';
import { FakeClock } from './fakes';

test('at most 3 request starts per second', async () => {
  const clock = new FakeClock();
  const rl = new RateLimiter(3, clock);
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 7 }, () => rl.acquire().then(() => starts.push(clock.now()))));
  assert.deepEqual(
    starts.map((t) => Math.round(t)),
    [0, 333, 667, 1000, 1333, 1667, 2000],
  );
  // any 1-second window [s, s+1000) holds at most 3 starts (epsilon absorbs 1000/3 float error)
  for (const s of starts) assert.ok(starts.filter((t) => t >= s && t < s + 1000 - 1e-6).length <= 3);
});

test('high priority jumps the queue', async () => {
  const clock = new FakeClock();
  const rl = new RateLimiter(3, clock);
  const order: string[] = [];
  const p = [
    rl.acquire('normal').then(() => order.push('n1')),
    rl.acquire('normal').then(() => order.push('n2')),
    rl.acquire('normal').then(() => order.push('n3')),
    rl.acquire('high').then(() => order.push('h1')),
  ];
  await Promise.all(p);
  // n1 starts immediately; h1 was queued before the second slot opened, so it beats n2/n3.
  assert.deepEqual(order, ['n1', 'h1', 'n2', 'n3']);
});
