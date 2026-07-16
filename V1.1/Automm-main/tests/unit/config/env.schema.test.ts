import { describe, expect, it } from 'vitest';
import { envSchema } from '../../../src/config/env.schema.js';

const validEnv = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '123456789012345678',
  DATABASE_URL: 'file:./dev.db',
  LTC_FEE_WALLET_ADDRESS: 'ltc1qsomeaddress',
  SOL_FEE_WALLET_ADDRESS: '11111111111111111111111111111112',
};

describe('envSchema', () => {
  it('accepts a fully valid configuration', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('applies documented defaults', () => {
    const result = envSchema.parse(validEnv);
    expect(result.NODE_ENV).toBe('development');
    expect(result.FEE_BASIS_POINTS).toBe(250);
    expect(result.DEPOSIT_SCAN_CRON).toBe('*/2 * * * *');
    expect(result.LTC_REQUIRED_CONFIRMATIONS).toBe(3);
  });

  it('rejects a missing Discord token', () => {
    const { DISCORD_TOKEN: _omit, ...rest } = validEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid Discord snowflake', () => {
    const result = envSchema.safeParse({ ...validEnv, DISCORD_GUILD_ID: 'not-a-snowflake' });
    expect(result.success).toBe(false);
  });

  it('parses comma-separated admin role IDs into an array', () => {
    const result = envSchema.parse({ ...validEnv, ADMIN_ROLE_IDS: '111, 222 ,333' });
    expect(result.ADMIN_ROLE_IDS).toEqual(['111', '222', '333']);
  });

  it('rejects a fee basis points value above 10000', () => {
    const result = envSchema.safeParse({ ...validEnv, FEE_BASIS_POINTS: '10001' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed cron expression', () => {
    const result = envSchema.safeParse({ ...validEnv, DEPOSIT_SCAN_CRON: 'not a cron' });
    expect(result.success).toBe(false);
  });
});
