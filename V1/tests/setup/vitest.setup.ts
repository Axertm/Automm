import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test', quiet: true });

process.env.NODE_ENV = 'test';
process.env.DISCORD_TOKEN ??= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ??= '123456789012345678';
process.env.DISCORD_GUILD_ID ??= '123456789012345678';
process.env.ENCRYPTION_MASTER_KEY ??= '0'.repeat(64);
process.env.DATABASE_URL ??= 'file:./prisma/dev.db';
process.env.SOLANA_RPC_URL ??= 'https://api.mainnet-beta.solana.com';
process.env.LTC_FEE_WALLET_ADDRESS ??= 'ltc1qtestfeewalletaddressplaceholder00';
process.env.SOL_FEE_WALLET_ADDRESS ??= '11111111111111111111111111111112';
process.env.FEE_BASIS_POINTS ??= '250';
