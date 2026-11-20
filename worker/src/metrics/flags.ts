/**
 * Organic-signal filter (§5.3). Pure. Every flag carries a human-readable reason (shown on hover).
 */
import { ORGANIC_FILTER, isKnownSystemAddress, type WalletFlag } from '@verum/shared';
import type { ProjectTx } from './model';

export interface FlagInput {
  txs: readonly ProjectTx[];
  /** Contract creators (from the explorer), lowercase. */
  creators: ReadonlyMap<string, string>; // wallet -> contract it created
  owner: string | null;
  teamWallets: readonly string[];
  /** Chain-wide sent-tx count (eth_getTransactionCount) for fresh_single candidates. */
  chainTxCount: ReadonlyMap<string, number>;
}

export type WalletFlags = Map<string, Map<WalletFlag, string>>;

const add = (out: WalletFlags, wallet: string, flag: WalletFlag, reason: string) => {
  let m = out.get(wallet);
  if (!m) out.set(wallet, (m = new Map()));
  if (!m.has(flag)) m.set(flag, reason);
};

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Per-wallet distinct-tx timestamps, ascending. */
export const walletTimes = (txs: readonly ProjectTx[]): Map<string, number[]> => {
  const m = new Map<string, number[]>();
  for (const t of txs) for (const w of t.wallets) (m.get(w) ?? m.set(w, []).get(w)!).push(t.ts);
  for (const v of m.values()) v.sort((a, b) => a - b);
  return m;
};

/** Largest number of timestamps inside any half-open window [t, t + windowMs). */
export const maxInWindow = (times: readonly number[], windowMs: number): { count: number; start: number } => {
  let best = { count: 0, start: times[0] ?? 0 };
  for (let i = 0, j = 0; i < times.length; i++) {
    while (j < times.length && times[j]! - times[i]! < windowMs) j++;
    if (j - i > best.count) best = { count: j - i, start: times[i]! };
  }
  return best;
};

/** Coefficient of variation of consecutive intervals (population std / mean). 0 if all intervals are 0. */
export const intervalCv = (times: readonly number[]): number => {
  const iv = times.slice(1).map((t, i) => t - times[i]!);
  const mean = iv.reduce((s, x) => s + x, 0) / iv.length;
  if (mean === 0) return 0;
  const variance = iv.reduce((s, x) => s + (x - mean) ** 2, 0) / iv.length;
  return Math.sqrt(variance) / mean;
};

/** Wallets that could be fresh_single: exactly one tx with the project, and it was their nonce-0 tx. */
export const freshSingleCandidates = (txs: readonly ProjectTx[]): string[] => {
  const times = walletTimes(txs);
  return txs
    .filter((t) => t.nonce === 0 && times.get(t.primary)?.length === 1)
    .map((t) => t.primary);
};

export const computeFlags = (input: FlagInput): WalletFlags => {
  const out: WalletFlags = new Map();
  const times = walletTimes(input.txs);
  const { bot, burst } = ORGANIC_FILTER;

  // team: creator, owner, self-declared team wallets
  for (const [w, contract] of input.creators) add(out, w, 'team', `created contract ${contract}`);
  if (input.owner) add(out, input.owner, 'team', 'project owner');
  for (const w of input.teamWallets) add(out, w, 'team', 'listed as team by the project owner');

  // bot
  for (const [w, t] of times) {
    if (isKnownSystemAddress(w)) add(out, w, 'bot', 'known QIE system / oracle address');
    const peak = maxInWindow(t, bot.rollingWindowHours * 3_600_000);
    if (peak.count >= bot.minTxsIn24h) add(out, w, 'bot', `${peak.count} txs within 24 h from ${utc(peak.start)}`);
    if (t.length >= bot.minTxsForCv) {
      const cv = intervalCv(t);
      if (cv < bot.maxIntervalCv) add(out, w, 'bot', `clockwork timing: interval CV ${cv.toFixed(3)} over ${t.length} txs`);
    }
  }

  // burst: first-ever chain txs (top-level nonce 0) bunched in a 10-minute window
  const firsts = input.txs
    .filter((t) => t.nonce === 0)
    .map((t) => ({ w: t.primary, ts: t.ts }))
    .sort((a, b) => a.ts - b.ts);
  const windowMs = burst.windowMinutes * 60_000;
  for (let i = 0, j = 0; i < firsts.length; i++) {
    while (j < firsts.length && firsts[j]!.ts - firsts[i]!.ts < windowMs) j++;
    const n = j - i;
    if (n >= burst.minWallets) {
      const reason = `one of ${n} wallets whose first-ever chain tx came within 10 min of ${utc(firsts[i]!.ts)}`;
      for (let k = i; k < j; k++) add(out, firsts[k]!.w, 'burst', reason);
    }
  }

  // fresh_single: the wallet's only chain activity ever is one tx to this project
  for (const w of freshSingleCandidates(input.txs)) {
    if (input.chainTxCount.get(w) === 1) add(out, w, 'fresh_single', 'only chain activity ever is one tx to this project');
  }
  return out;
};
