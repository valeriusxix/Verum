/**
 * Encodings between off-chain values and VerumRegistry arguments (decided 17 Nov 2026).
 *
 *  - `Milestone.metric`: plain name, UTF-8, right-padded with zeros, e.g.
 *    "organic_wau" -> 0x6f7267616e69635f776175000000…. Readable straight off the explorer.
 *  - `snapshot(periodEnd)`: unix seconds at 00:00 UTC of the snapshot's `period_end` date
 *    (a multiple of 86400). The contract requires it to be strictly increasing per project and not
 *    in the future.
 */
import { hexToString, stringToHex, type Hex } from 'viem';
import { MILESTONE_METRICS, type MilestoneMetric } from './metrics';

export const encodeMilestoneMetric = (metric: MilestoneMetric): Hex => stringToHex(metric, { size: 32 });

/** Returns null for an unknown or unset (all-zero) metric. */
export const decodeMilestoneMetric = (value: Hex): MilestoneMetric | null => {
  const name = hexToString(value, { size: 32 }).replace(/\0+$/, '');
  return (MILESTONE_METRICS as readonly string[]).includes(name) ? (name as MilestoneMetric) : null;
};

const SECONDS_PER_DAY = 86_400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` (UTC) -> on-chain `periodEnd`. */
export const periodEndFromDate = (isoDate: string): bigint => {
  if (!ISO_DATE.test(isoDate)) throw new Error(`expected YYYY-MM-DD, got ${isoDate}`);
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`invalid date ${isoDate}`);
  }
  return BigInt(ms / 1000);
};

/** On-chain `periodEnd` -> `YYYY-MM-DD` (UTC). */
export const dateFromPeriodEnd = (periodEnd: bigint | number): string => {
  const s = Number(periodEnd);
  if (!Number.isSafeInteger(s) || s % SECONDS_PER_DAY !== 0) throw new Error(`not a UTC midnight: ${periodEnd}`);
  return new Date(s * 1000).toISOString().slice(0, 10);
};
