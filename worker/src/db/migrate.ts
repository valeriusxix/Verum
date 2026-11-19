/**
 * Applies worker/migrations/*.sql in filename order, each once, each in its own transaction.
 * Run: `pnpm --filter @verum/worker migrate`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { logger } from '../log';
import type { Sql } from './index';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const log = logger('migrate');

export const migrate = async (sql: Sql): Promise<string[]> => {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body); // no args -> simple protocol, multiple statements allowed
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    log.info('applied', { file });
    applied.push(file);
  }
  if (applied.length === 0) log.info('up to date', { migrations: files.length });
  return applied;
};
