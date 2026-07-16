import { z } from 'zod';

const discordSnowflake = z.string().regex(/^\d{17,20}$/, 'must be a valid Discord snowflake ID');

const commaSeparatedSnowflakes = z
  .string()
  .optional()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const cronExpression = z
  .string()
  .regex(/^(\*|[0-9,/*-]+)(\s+(\*|[0-9,/*-]+)){4}$/, 'must be a valid 5-field cron expression');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HEALTH_CHECK_PORT: z.coerce.number().int().positive().default(3000),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: discordSnowflake,
  DISCORD_GUILD_ID: discordSnowflake,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  LTC_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  BLOCKCYPHER_API_TOKEN: z.string().optional().default(''),
  BLOCKCHAIR_API_KEY: z.string().optional().default(''),
  LTC_FEE_WALLET_ADDRESS: z.string().min(1, 'LTC_FEE_WALLET_ADDRESS is required'),
  LTC_REQUIRED_CONFIRMATIONS: z.coerce.number().int().min(1).default(3),

  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_RPC_URL_FALLBACK: z.string().url().optional().or(z.literal('')).default(''),
  SOL_FEE_WALLET_ADDRESS: z.string().min(1, 'SOL_FEE_WALLET_ADDRESS is required'),

  FEE_BASIS_POINTS: z.coerce.number().int().min(0).max(10_000).default(250),

  ADMIN_ROLE_IDS: commaSeparatedSnowflakes,
  BUYER_COMPLETED_ROLE_ID: z.string().optional().default(''),
  SELLER_COMPLETED_ROLE_ID: z.string().optional().default(''),
  ESCROW_CATEGORY_ID: z.string().optional().default(''),

  DEPOSIT_SCAN_CRON: cronExpression.default('*/2 * * * *'),

  // Directory for the JSON on-disk backup of every non-terminal deal +
  // wallet — a second, independent copy alongside the primary database, so
  // a database-level disaster (accidental wipe, corruption) is recoverable
  // via `npm run restore:backup` instead of unrecoverable. See
  // src/infrastructure/persistence/backup/JsonBackupStore.ts.
  BACKUP_DIR: z.string().optional().default('./backups'),
});

export type Env = z.infer<typeof envSchema>;
