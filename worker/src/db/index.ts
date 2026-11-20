import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export type Sql = postgres.Sql;
/** Anything that can run queries: the pool or a transaction handle from `sql.begin`. */
export type Db = postgres.ISql;

/**
 * Supabase: use the **Session pooler** string (port 5432, IPv4). The Transaction pooler (6543)
 * can't hold prepared statements, so prepare is switched off if that port is used.
 *
 * TLS: postgres.js v4 defaults to `ssl: false` (unencrypted), so TLS is always required here.
 * Supabase's pooler certificate chains to Supabase's own CA (checked 20 Nov 2026), not a public
 * one, so system CAs can't verify it. With `caCertPath` (the CA from Dashboard → Database
 * Settings → SSL Configuration) the certificate and hostname are verified; without it the
 * connection is encrypted but the certificate isn't checked.
 */
export const createDb = (url: string, caCertPath?: string): Sql =>
  postgres(url, {
    max: 5,
    prepare: !/:6543(\/|$)/.test(url),
    ssl: caCertPath ? { ca: readFileSync(caCertPath, 'utf8'), rejectUnauthorized: true } : 'require',
    idle_timeout: 30,
    onnotice: () => {},
    connection: { application_name: 'verum-worker' },
  });
