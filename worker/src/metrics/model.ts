/**
 * Project rows -> one record per transaction (§5.4 + IMPLEMENTATION_NOTES in @verum/shared).
 * Pure; no I/O. All metrics are computed from `ProjectTx[]`.
 */
import { QUSDC } from '@verum/shared';
import type { TxRow } from '../ingest/normalize';

export const DAY_MS = 86_400_000;
/** UTC day number (days since 1970-01-01). */
export const dayIndex = (d: Date | number) => Math.floor((typeof d === 'number' ? d : d.getTime()) / DAY_MS);
export const dayKey = (idx: number) => new Date(idx * DAY_MS).toISOString().slice(0, 10);
export const dayFromKey = (key: string) => dayIndex(Date.parse(`${key}T00:00:00Z`));

export interface ProjectTx {
  hash: string;
  ts: number; // ms
  day: number;
  block: number;
  /** Every wallet this tx counts for (usually one). */
  wallets: string[];
  /** The wallet the tx is attributed to for concentration (top-level sender if known). */
  primary: string;
  /** Nonce of the top-level tx, if known; paired with `primary`. */
  nonce: number | null;
  success: boolean;
  /** Method the user called: the ext tx's selector, else the top-level selector stored on int/token rows. */
  method: string | null;
  nativeInWei: bigint;
  qusdcInRaw: bigint;
}

const QUSDC_LC = QUSDC.address.toLowerCase();

/**
 * @param rows     every stored row of the project's contracts (may repeat across contracts)
 * @param contracts the project's contract addresses (lowercase)
 */
export const buildProjectTxs = (rows: readonly TxRow[], contracts: ReadonlySet<string>): ProjectTx[] => {
  // The same internal call / transfer is stored once per tracked contract: dedupe within the project.
  const unique = new Map<string, TxRow>();
  for (const r of rows) unique.set(`${r.hash}|${r.kind}|${r.log_index}`, r);

  const byHash = new Map<string, TxRow[]>();
  for (const r of unique.values()) {
    const list = byHash.get(r.hash);
    if (list) list.push(r);
    else byHash.set(r.hash, [r]);
  }

  const out: ProjectTx[] = [];
  for (const [hash, list] of byHash) {
    list.sort((a, b) => a.log_index - b.log_index);
    const ext = list.filter((r) => r.kind === 'ext');
    const int = list.filter((r) => r.kind === 'int');
    const tok = list.filter((r) => r.kind === 'token');
    const inbound = (r: TxRow) => r.to_addr !== null && contracts.has(r.to_addr) && !contracts.has(r.from_addr);

    const wallets = new Set<string>();
    let primary: string | null = null;
    let nonce: number | null = null;
    for (const r of [...ext, ...int, ...tok]) {
      if (r.origin_addr) {
        wallets.add(r.origin_addr);
        primary ??= r.origin_addr;
        if (nonce === null && r.nonce !== null && r.nonce !== undefined) nonce = Number(r.nonce);
      }
    }
    const qusdcIn = tok.filter((r) => r.token === QUSDC_LC && inbound(r));
    for (const r of qusdcIn) wallets.add(r.from_addr);
    primary ??= qusdcIn[0]?.from_addr ?? null;
    if (primary === null) continue; // top-level sender not resolved yet (next sync fills it)

    const success = ext.length > 0 ? ext.every((r) => r.success) : list.some((r) => r.success);

    let nativeInWei = 0n;
    for (const r of ext) if (r.success && r.to_addr !== null && contracts.has(r.to_addr)) nativeInWei += BigInt(r.value_wei);
    for (const r of int) if (r.success && inbound(r)) nativeInWei += BigInt(r.value_wei);

    const extMethod = ext.find((r) => r.to_addr !== null && contracts.has(r.to_addr))?.selector ?? null;
    const topLevel = [...int, ...tok].find((r) => r.selector !== null)?.selector ?? null;

    const first = list[0]!;
    const ts = first.ts instanceof Date ? first.ts.getTime() : Date.parse(String(first.ts));
    out.push({
      hash,
      ts,
      day: dayIndex(ts),
      block: Number(first.block),
      wallets: [...wallets],
      primary,
      nonce,
      success,
      method: extMethod ?? topLevel,
      nativeInWei,
      qusdcInRaw: qusdcIn.reduce((s, r) => s + BigInt(r.token_amount ?? '0'), 0n),
    });
  }
  return out.sort((a, b) => a.ts - b.ts || a.hash.localeCompare(b.hash));
};
