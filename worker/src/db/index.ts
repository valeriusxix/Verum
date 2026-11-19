import postgres from 'postgres';

export type Sql = postgres.Sql;
/** Anything that can run queries: the pool or a transaction handle from `sql.begin`. */
export type Db = postgres.ISql;

/**
 * Supabase: use the **Session pooler** string (port 5432, IPv4). The Transaction pooler (6543)
 * can't hold prepared statements, so prepare is switched off if that port is used.
 */
export const createDb = (url: string): Sql =>
  postgres(url, {
    max: 5,
    prepare: !/:6543(\/|$)/.test(url),
    idle_timeout: 30,
    onnotice: () => {},
    connection: { application_name: 'verum-worker' },
  });
