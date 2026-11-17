/**
 * Encoding between off-chain metric names and VerumRegistry's `Milestone.metric` (bytes32).
 * Decision (17 Nov 2026): plain name, UTF-8, right-padded with zeros, e.g.
 * "organic_wau" -> 0x6f7267616e69635f776175000000…. Readable straight off the explorer.
 */
import { hexToString, stringToHex, type Hex } from 'viem';
import { MILESTONE_METRICS, type MilestoneMetric } from './metrics';

export const encodeMilestoneMetric = (metric: MilestoneMetric): Hex => stringToHex(metric, { size: 32 });

/** Returns null for an unknown or unset (all-zero) metric. */
export const decodeMilestoneMetric = (value: Hex): MilestoneMetric | null => {
  const name = hexToString(value, { size: 32 }).replace(/\0+$/, '');
  return (MILESTONE_METRICS as readonly string[]).includes(name) ? (name as MilestoneMetric) : null;
};
