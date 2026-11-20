import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createDb } from './db';
import { loadEnv } from './env';
import { createPgRepo } from './repo';

const env = loadEnv();
const sql = createDb(env.DATABASE_URL, env.DATABASE_CA_CERT);
const app = createApp(createPgRepo(sql));

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
