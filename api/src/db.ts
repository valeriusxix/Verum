import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export type Sql = postgres.Sql;

/**
 * Same rules as the worker (§12): TLS always required (postgres.js defaults to unencrypted);
 * Supabase Session pooler; optional CA for full certificate verification. Read-only use.
 */
export const createDb = (url: string, caCertPath?: string): Sql =>
  postgres(url, {
    max: 5,
    prepare: !/:6543(\/|$)/.test(url),
    ssl: caCertPath ? { ca: readFileSync(caCertPath, 'utf8'), rejectUnauthorized: true } : 'require',
    idle_timeout: 30,
    onnotice: () => {},
    connection: { application_name: 'verum-api' },
  });
