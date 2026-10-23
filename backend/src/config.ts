import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile('.env');
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./data/radar.db'),
  APP_API_KEY: z.string().min(8, 'APP_API_KEY trop courte'),
  INTERNAL_JOB_SECRET: z.string().min(12, 'INTERNAL_JOB_SECRET trop courte'),
  SCHEDULER_ENABLED: bool,
  TZ_SCHEDULE: z.string().default('Europe/Paris'),
  DAILY_CRON: z.string().default('0 6 * * *'),
  REFRESH_CRON: z.string().default('15 */3 * * *'),
  DISCOVERY_CRON: z.string().default('*/20 * * * *'),
  COINGECKO_API_KEY: z.string().optional().default(''),
  COINGECKO_PLAN: z.enum(['demo', 'pro']).default('demo'),
  COINGECKO_MARKET_PAGES: z.coerce.number().int().min(1).max(20).default(4),
  COINMARKETCAL_API_KEY: z.string().optional().default(''),
  DEX_NETWORKS: z.string().default('solana,eth,base,bsc,arbitrum'),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema> & { dexNetworks: string[]; schedulerEnabled: boolean };

let cached: Config | null = null;

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${msg}`);
  }
  const c = parsed.data;
  const cfg: Config = {
    ...c,
    schedulerEnabled: c.SCHEDULER_ENABLED ?? true,
    dexNetworks: c.DEX_NETWORKS.split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (Object.keys(overrides).length === 0) cached = cfg;
  return cfg;
}

export function resetConfigCache() {
  cached = null;
}
