import { createDb } from '../db';
import { migrate } from '../db/migrate';
import { loadEnv } from '../env';

const env = loadEnv();
const sql = createDb(env.DATABASE_URL);
migrate(sql)
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
