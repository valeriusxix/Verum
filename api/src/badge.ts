/**
 * README badge (§8: GET /badge/:slug.svg?metric=…). Flat, 20 px, shields-style geometry so it sits
 * well next to other README badges, in Verum's palette (§7.3): basalt label, value in verdigris for
 * Verum (organic) numbers, ash for Recorded/other numbers and for "not found" / "provisional".
 * Pure: (stats, metric) -> SVG string.
 */
import type { BadgeMetric, ProjectStatsDto } from '@verum/shared';

const C = {
  label: '#121417', // --basalt
  labelText: '#ECE6DA', // --marble
  verum: '#4FD6B0', // --verdigris: real
  ash: '#858A90', // --ash: recorded / unknown
  valueText: '#08090B', // --nox
} as const;

/** Approximate Verdana 11px advance widths (px): enough to size the box without a font engine. */
const charWidth = (ch: string): number => {
  if (/[0-9]/.test(ch)) return 7;
  if (/[il.,:;|!'·]/.test(ch)) return 3.5;
  if (/[mwMW]/.test(ch)) return 10;
  if (/[A-Z]/.test(ch)) return 7.6;
  if (ch === ' ') return 3.6;
  if (/[$%~—]/.test(ch)) return 7.5;
  return 6.6;
};
export const textWidth = (s: string): number => [...s].reduce((w, ch) => w + charWidth(ch), 0);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const compact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString('en-US');
};

export interface BadgeContent {
  label: string;
  value: string;
  color: string;
}

export const badgeContent = (stats: ProjectStatsDto | null | undefined, metric: BadgeMetric): BadgeContent => {
  const LABELS: Record<BadgeMetric, string> = {
    organic_wau: 'Verum WAU',
    organic_mau: 'Verum MAU',
    verum_score: 'Verum score',
    cumulative_wallets: 'Verum wallets',
    tx_count_30d: 'txs 30d',
    usd_volume_30d: 'volume 30d',
    d7_retention: 'D7 retention',
  };
  const label = LABELS[metric];
  if (stats === undefined) return { label: 'Verum', value: 'not found', color: C.ash };
  if (stats === null) return { label, value: 'indexing', color: C.ash };

  switch (metric) {
    case 'organic_wau':
      return { label, value: compact(stats.organic_wau), color: C.verum };
    case 'organic_mau':
      return { label, value: compact(stats.organic_mau), color: C.verum };
    case 'cumulative_wallets':
      return { label, value: compact(stats.cumulative_organic), color: C.verum };
    case 'tx_count_30d':
      return { label, value: compact(stats.tx_count_30d), color: C.ash };
    case 'usd_volume_30d':
      return stats.usd_volume_30d === null
        ? { label, value: 'no price', color: C.ash }
        : { label, value: `$${compact(Number(stats.usd_volume_30d))}`, color: C.ash };
    case 'd7_retention':
      return stats.d7_retention_30d === null
        ? { label, value: 'not yet', color: C.ash }
        : { label, value: `${Math.round(stats.d7_retention_30d * 100)}%`, color: C.verum };
    case 'verum_score':
      if (stats.verum_score === null) return { label, value: 'n/a', color: C.ash };
      // Owner, 20 Nov: a provisional score always carries a visible "provisional" marker.
      return stats.score_provisional
        ? { label, value: `${stats.verum_score.toFixed(0)} · provisional`, color: C.ash }
        : { label, value: stats.verum_score.toFixed(0), color: C.verum };
  }
};

export const renderBadge = ({ label, value, color }: BadgeContent): string => {
  const pad = 6;
  const lw = Math.round(textWidth(label) + pad * 2);
  const vw = Math.round(textWidth(value) + pad * 2);
  const w = lw + vw;
  const title = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${lw}" height="20" fill="${C.label}"/>`,
    `<rect x="${lw}" width="${vw}" height="20" fill="${color}"/>`,
    `</g>`,
    `<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${lw / 2}" y="14" fill="${C.labelText}">${esc(label)}</text>`,
    `<text x="${lw + vw / 2}" y="14" fill="${C.valueText}">${esc(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
};
