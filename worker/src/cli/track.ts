/**
 * Start tracking a contract without the registry (dev + Day 5 seeding; the registry listener
 * takes over on Day 9). Accepts 0x… or qie1… addresses.
 *
 *   pnpm --filter @verum/worker track <address> [--label <text>] [--project <slug> --name <name>]
 */
import { normalizeQieAddress, slugSchema } from '@verum/shared';
import { parseArgs } from 'node:util';
import { createContext } from '../context';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { label: { type: 'string' }, project: { type: 'string' }, name: { type: 'string' } },
});

const main = async () => {
  const address = normalizeQieAddress(positionals[0] ?? '');
  if (!address) throw new Error('usage: track <0x…|qie1…> [--label x] [--project slug --name "Name"]');

  const { sql, api } = createContext();
  try {
    const info = await api.address(address, { priority: 'high' });
    if (!info.is_contract) throw new Error(`${address} is not a contract`);

    let projectId: number | null = null;
    if (values.project) {
      const slug = slugSchema.parse(values.project);
      const [p] = await sql<{ id: number }[]>`
        insert into projects (slug, name) values (${slug}, ${values.name ?? slug})
        on conflict (slug) do update set slug = excluded.slug
        returning id`;
      projectId = p!.id;
    }

    await sql`
      insert into contracts (address, project_id, label, creator_address, verified)
      values (${address}, ${projectId}, ${values.label ?? info.name ?? null},
              ${info.creator_address_hash?.toLowerCase() ?? null}, ${info.is_verified ?? false})
      on conflict (address) do update set
        project_id = coalesce(excluded.project_id, contracts.project_id),
        label = coalesce(excluded.label, contracts.label)`;
    await sql`insert into sync_progress (contract) values (${address}) on conflict do nothing`;

    console.log(
      `tracking ${address}${info.name ? ` (${info.name})` : ''}` +
        `${projectId ? ` in project ${values.project}` : ''}; backfill starts on the next worker tick`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
