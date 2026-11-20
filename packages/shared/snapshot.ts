/**
 * Seals (§6): `metricsHash = keccak256(canonical JSON of that day's daily_metrics row + cohort row)`.
 * One canonicalization shared by the attester (worker), the API (/snapshots/:date) and the browser
 * "recompute" button, so all three hash the same bytes.
 *
 * Canonical JSON here: object keys sorted by UTF-16 code unit order (as JS sort), no whitespace,
 * strings JSON-escaped, `undefined` keys dropped, numbers must be finite. Values that need exact
 * precision (wei, token amounts, USD) are kept as decimal STRINGS in payloads, so number formatting
 * never differs between languages.
 */
import { keccak256, stringToBytes, type Hex } from 'viem';

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [k: string]: CanonicalValue | undefined };

export const canonicalJson = (value: CanonicalValue): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as CanonicalValue)}`).join(',')}}`;
};

export const metricsHash = (payload: CanonicalValue): Hex => keccak256(stringToBytes(canonicalJson(payload)));
