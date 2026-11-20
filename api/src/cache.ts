/**
 * Tiny in-memory response cache (§8: "cached 60 s"; badge 10 min). Protects Postgres from bursts
 * (a README badge on a busy repo, a judge refreshing). Keyed by full URL; only 200s are cached.
 */
export interface CachedResponse {
  status: number;
  body: string;
  contentType: string;
  expires: number;
}

export class TtlCache {
  private readonly map = new Map<string, CachedResponse>();

  constructor(
    private readonly maxEntries = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CachedResponse | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit;
  }

  set(key: string, value: Omit<CachedResponse, 'expires'>, ttlSeconds: number): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { ...value, expires: this.now() + ttlSeconds * 1000 });
  }
}
