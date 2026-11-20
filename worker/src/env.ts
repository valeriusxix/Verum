import { z } from 'zod';

const envSchema = z.object({
  VERUM_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  /** Optional path to Supabase's CA certificate; enables full TLS verification. */
  DATABASE_CA_CERT: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() !== '' ? s.trim() : undefined)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/** Parses process.env once; exits with a readable message instead of a stack trace. */
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`[worker] invalid environment (see .env.example):\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
};
