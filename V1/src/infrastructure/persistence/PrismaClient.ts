import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

let client: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  client ??= new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
