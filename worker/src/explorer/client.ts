/**
 * The single explorer client (§12): every explorer call goes through here.
 * Throttle 3 req/s (shared RateLimiter) · retry 3× with exponential backoff + full jitter on
 * network errors, timeouts, 429 and 5xx · 30 s timeout · one log line per request.
 */
import type { z } from 'zod';
import {
  EXPLORER_MAX_REQ_PER_SEC,
  EXPLORER_RETRIES,
  EXPLORER_TIMEOUT_MS,
  type ExplorerConfig,
} from '@verum/shared';
import { logger, type Logger } from '../log';
import { RateLimiter, systemClock, type Clock, type Priority } from './throttle';

export class ExplorerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ExplorerError';
  }
}

export interface ExplorerClientOptions {
  explorer: ExplorerConfig;
  limiter?: RateLimiter;
  retries?: number;
  timeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetch?: typeof fetch;
  clock?: Clock;
  random?: () => number;
  log?: Logger;
}

export interface RequestOptions {
  priority?: Priority;
  /** Overrides the client's retry count for this call (adaptive paging passes 0). */
  retries?: number;
}

type Query = Record<string, string | number | undefined>;

export class ExplorerClient {
  readonly limiter: RateLimiter;
  private readonly o: Required<Omit<ExplorerClientOptions, 'limiter'>>;

  constructor(opts: ExplorerClientOptions) {
    const clock = opts.clock ?? systemClock;
    this.limiter = opts.limiter ?? new RateLimiter(EXPLORER_MAX_REQ_PER_SEC, clock);
    this.o = {
      explorer: opts.explorer,
      retries: opts.retries ?? EXPLORER_RETRIES,
      timeoutMs: opts.timeoutMs ?? EXPLORER_TIMEOUT_MS,
      baseBackoffMs: opts.baseBackoffMs ?? 500,
      maxBackoffMs: opts.maxBackoffMs ?? 15_000,
      fetch: opts.fetch ?? globalThis.fetch,
      clock,
      random: opts.random ?? Math.random,
      log: opts.log ?? logger('explorer'),
    };
  }

  /** Etherscan-style v1: `GET /api?module=…&action=…`. */
  v1<S extends z.ZodType>(query: Query, schema: S, opts?: RequestOptions): Promise<z.infer<S>> {
    return this.request(`${this.o.explorer.apiV1}?${toSearch(query)}`, schema, opts);
  }

  /** Blockscout REST v2: `GET /api/v2/<path>`. */
  v2<S extends z.ZodType>(path: string, schema: S, query: Query = {}, opts?: RequestOptions): Promise<z.infer<S>> {
    const qs = toSearch(query);
    return this.request(`${this.o.explorer.apiV2}/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`, schema, opts);
  }

  private async request<S extends z.ZodType>(url: string, schema: S, opts: RequestOptions = {}): Promise<z.infer<S>> {
    const { log, clock } = this.o;
    const label = url.replace(this.o.explorer.url, '');
    const maxRetries = opts.retries ?? this.o.retries;
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(opts.priority ?? 'normal');
      const t0 = clock.now();
      try {
        const res = await this.o.fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        const ms = clock.now() - t0;
        log.info('request', { url: label, status: res.status, ms, attempt });
        if (res.status === 429 || res.status >= 500) {
          throw new ExplorerError(`HTTP ${res.status}`, true, res.status);
        }
        if (!res.ok) throw new ExplorerError(`HTTP ${res.status}`, false, res.status);

        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) {
          // Schema drift is not transient: fail loudly instead of retrying.
          const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
          throw new ExplorerError(`unexpected response shape (${issues.join('; ')})`, false, res.status);
        }
        return parsed.data;
      } catch (err) {
        const e = toExplorerError(err);
        if (!e.retryable || attempt >= maxRetries) {
          // A deliberate no-retry call (adaptive paging) failing is expected: warn, the caller adapts.
          (maxRetries === 0 && e.retryable ? log.warn : log.error)('request failed', {
            url: label,
            attempt,
            error: e.message,
          });
          throw e;
        }
        const backoff = this.backoffMs(attempt);
        log.warn('retrying', { url: label, attempt, error: e.message, backoff_ms: backoff });
        await clock.sleep(backoff);
      }
    }
  }

  /** Full jitter: uniform in [0, min(max, base·2^attempt)]. */
  backoffMs(attempt: number): number {
    const cap = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** attempt);
    return Math.round(this.o.random() * cap);
  }
}

const toSearch = (q: Query) =>
  Object.entries(q)
    .filter((kv): kv is [string, string | number] => kv[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

const toExplorerError = (err: unknown): ExplorerError => {
  if (err instanceof ExplorerError) return err;
  if (err instanceof Error) {
    // AbortSignal.timeout -> TimeoutError; network failures -> TypeError("fetch failed").
    const transient = err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError;
    return new ExplorerError(err.name === 'TimeoutError' ? 'timeout' : err.message, transient);
  }
  return new ExplorerError(String(err), false);
};
