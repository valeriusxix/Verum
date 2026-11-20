/**
 * Public API (§8). JSON, CORS open, `{data, meta:{generated_at, price_source}}`, params validated
 * with the shared zod schemas, responses cached (60 s; badge 10 min; sync 5 s so a backfill
 * progress bar stays live). Reads only from Postgres via `Repo`.
 */
import {
  API_CACHE_SECONDS,
  BADGE_CACHE_SECONDS,
  badgeQuerySchema,
  flagsQuerySchema,
  metricsQuerySchema,
  projectsListQuerySchema,
  slugSchema,
  snapshotParamsSchema,
  type ApiError,
  type PriceSource,
} from '@verum/shared';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { z } from 'zod';
import { badgeContent, renderBadge } from './badge';
import { TtlCache } from './cache';
import type { Repo } from './repo';

const SYNC_CACHE_SECONDS = 5;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: ApiError['error']['code'],
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

const parse = <S extends z.ZodType>(schema: S, value: unknown): z.infer<S> => {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new HttpError(400, 'bad_request', 'invalid parameters', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
};

/** Opaque list cursor: base64url({"o": offset}). */
export const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown }).o;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && o <= 1_000_000) return o;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'bad_request', 'invalid cursor');
};

export interface AppOptions {
  now?: () => number;
  cache?: TtlCache;
  log?: (msg: string) => void;
}

export const createApp = (repo: Repo, opts: AppOptions = {}) => {
  const now = opts.now ?? Date.now;
  const cache = opts.cache ?? new TtlCache();
  const log = opts.log ?? ((m: string) => console.error(m));
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const ok = <T,>(c: Context, data: T, priceSource: PriceSource | null = null) =>
    c.json({ data, meta: { generated_at: new Date(now()).toISOString(), price_source: priceSource } });
  const projectIdOr404 = async (slug: string) => {
    const id = await repo.projectId(slug);
    if (id === null) throw new HttpError(404, 'not_found', `project "${slug}" not found`);
    return id;
  };

  const app = new Hono();
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

  // Cache successful GETs by full URL; every response says how long it may be cached.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET') return next();
    const path = c.req.path;
    const ttl = path.startsWith('/badge/') ? BADGE_CACHE_SECONDS : path.endsWith('/sync') ? SYNC_CACHE_SECONDS : API_CACHE_SECONDS;
    const hit = cache.get(c.req.url);
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: {
          'content-type': hit.contentType,
          'cache-control': `public, max-age=${ttl}`,
          'access-control-allow-origin': '*',
          'x-cache': 'HIT',
        },
      });
    }
    await next();
    if (c.res.status === 200) {
      const body = await c.res.clone().text();
      cache.set(c.req.url, { status: 200, body, contentType: c.res.headers.get('content-type') ?? 'application/json' }, ttl);
      c.res.headers.set('cache-control', `public, max-age=${ttl}`);
    } else {
      c.res.headers.set('cache-control', 'no-store');
    }
    c.res.headers.set('x-cache', 'MISS');
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/', (c) =>
    c.json({
      name: 'Verum API',
      about: "What's real on QIE. Public traction ledger for QIE mainnet projects.",
      endpoints: [
        'GET /v1/projects?track=&sort=organic_wau|growth_7d|d7_retention|verum_score&limit=50&cursor=',
        'GET /v1/projects/:slug',
        'GET /v1/projects/:slug/metrics?range=7d|30d|90d|all',
        'GET /v1/projects/:slug/cohorts',
        'GET /v1/projects/:slug/flags?flag=team|bot|burst|fresh_single',
        'GET /v1/projects/:slug/milestones',
        'GET /v1/projects/:slug/snapshots',
        'GET /v1/projects/:slug/snapshots/:date',
        'GET /v1/projects/:slug/sync',
        'GET /v1/chain/pulse',
        'GET /badge/:slug.svg?metric=organic_wau|organic_mau|verum_score|cumulative_wallets|tx_count_30d|usd_volume_30d|d7_retention',
      ],
    }),
  );

  app.get('/v1/projects', async (c) => {
    const q = parse(projectsListQuerySchema, c.req.query());
    const offset = decodeCursor(q.cursor);
    const { items, hasMore } = await repo.listProjects({ track: q.track, sort: q.sort, limit: q.limit, offset });
    return ok(c, { items, next_cursor: hasMore ? encodeCursor(offset + q.limit) : null });
  });

  app.get('/v1/projects/:slug', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    const project = await repo.getProject(slug);
    if (!project) throw new HttpError(404, 'not_found', `project "${slug}" not found`);
    return ok(c, project);
  });

  app.get('/v1/projects/:slug/metrics', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    const { range } = parse(metricsQuerySchema, c.req.query());
    const rows = await repo.metrics(await projectIdOr404(slug), range, today());
    const latestPriced = [...rows].reverse().find((r) => r.price_source !== null);
    return ok(c, rows, latestPriced?.price_source ?? null);
  });

  app.get('/v1/projects/:slug/cohorts', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    return ok(c, await repo.cohorts(await projectIdOr404(slug)));
  });

  app.get('/v1/projects/:slug/flags', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    const { flag } = parse(flagsQuerySchema, c.req.query());
    return ok(c, await repo.flags(await projectIdOr404(slug), flag));
  });

  app.get('/v1/projects/:slug/milestones', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    return ok(c, await repo.milestones(await projectIdOr404(slug), today()));
  });

  app.get('/v1/projects/:slug/snapshots', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    return ok(c, await repo.snapshots(await projectIdOr404(slug)));
  });

  app.get('/v1/projects/:slug/snapshots/:date', async (c) => {
    const { slug, date } = parse(snapshotParamsSchema, { slug: c.req.param('slug'), date: c.req.param('date') });
    const snap = await repo.snapshot(await projectIdOr404(slug), date);
    if (!snap) throw new HttpError(404, 'not_found', `no Seal for "${slug}" on ${date}`);
    return ok(c, snap);
  });

  app.get('/v1/projects/:slug/sync', async (c) => {
    const slug = parse(slugSchema, c.req.param('slug'));
    return ok(c, await repo.sync(await projectIdOr404(slug)));
  });

  app.get('/v1/chain/pulse', async (c) => {
    const pulse = await repo.pulse();
    if (!pulse) throw new HttpError(404, 'not_found', 'no chain pulse recorded yet');
    return ok(c, pulse, pulse.price_source);
  });

  app.get('/badge/:file', async (c) => {
    const m = /^(.+)\.svg$/.exec(c.req.param('file'));
    if (!m) throw new HttpError(404, 'not_found', 'badge URLs end in .svg');
    const { metric } = parse(badgeQuerySchema, c.req.query());
    const slug = slugSchema.safeParse(m[1]);
    const stats = slug.success ? await repo.badgeStats(slug.data) : undefined;
    // An unknown project still gets a valid image (a README must never show a broken badge).
    const svg = renderBadge(badgeContent(stats, metric));
    return c.body(svg, stats === undefined ? 404 : 200, { 'content-type': 'image/svg+xml; charset=utf-8' });
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such endpoint' } } satisfies ApiError, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) } } satisfies ApiError, err.status);
    }
    log(`[api] ${c.req.method} ${c.req.path} failed: ${err instanceof Error ? err.stack : String(err)}`);
    return c.json({ error: { code: 'internal', message: 'internal error' } } satisfies ApiError, 500);
  });

  return app;
};
