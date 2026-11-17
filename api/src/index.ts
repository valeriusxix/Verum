import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// §8 routes (/v1/*, /badge/:slug.svg) land on Day 5. Params validated with @verum/shared zod schemas;
// responses shaped as `{data, meta:{generated_at, price_source}}`.

const app = new Hono();
app.use('*', cors({ origin: '*' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port} (Day 1 scaffold: no routes yet)`);
});
