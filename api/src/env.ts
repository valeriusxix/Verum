import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  DATABASE_CA_CERT: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() !== '' ? s.trim() : undefined)),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`[api] invalid environment (see .env.example):\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
};
