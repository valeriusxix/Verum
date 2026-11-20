/**
 * Day prices for USD volume (IMPLEMENTATION_NOTES.price, decided 20 Nov 2026). Pure.
 *  1. median of that UTC day's QIE Oracle ticks;
 *  2. else median of that day's explorer ticks;
 *  3. else the most recent earlier day's price, for up to PRICE_CARRY_FORWARD_DAYS days;
 *  never before PRICE_HISTORY_START_DAY.
 */
import { PRICE_CARRY_FORWARD_DAYS, PRICE_HISTORY_START_DAY, type PriceSource } from '@verum/shared';
import { dayFromKey, dayIndex } from './model';

export interface PriceTick {
  ts: number; // ms
  qieUsd: number;
  source: PriceSource;
}

export interface DayPrice {
  qieUsd: number;
  source: PriceSource;
  /** Day the price was measured on (differs from the day it's used for when carried forward). */
  fromDay: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Price for every day in [fromDay, toDay]; null where there is no reliable price. */
export const dayPrices = (ticks: readonly PriceTick[], fromDay: number, toDay: number): Map<number, DayPrice | null> => {
  const start = dayFromKey(PRICE_HISTORY_START_DAY);
  const perDay = new Map<number, { oracle: number[]; explorer: number[] }>();
  for (const t of ticks) {
    const d = dayIndex(t.ts);
    if (d < start || !(t.qieUsd > 0)) continue;
    const e = perDay.get(d) ?? perDay.set(d, { oracle: [], explorer: [] }).get(d)!;
    e[t.source].push(t.qieUsd);
  }

  const out = new Map<number, DayPrice | null>();
  let last: DayPrice | null = null;
  // Walk from the history start so carry-forward into `fromDay` works.
  for (let d = Math.min(start, fromDay); d <= toDay; d++) {
    const e = perDay.get(d);
    let p: DayPrice | null = null;
    if (d >= start) {
      if (e?.oracle.length) p = { qieUsd: median(e.oracle), source: 'oracle', fromDay: d };
      else if (e?.explorer.length) p = { qieUsd: median(e.explorer), source: 'explorer', fromDay: d };
      else if (last && d - last.fromDay <= PRICE_CARRY_FORWARD_DAYS) p = last;
    }
    if (p && p.fromDay === d) last = p;
    if (d >= fromDay) out.set(d, p);
  }
  return out;
};
