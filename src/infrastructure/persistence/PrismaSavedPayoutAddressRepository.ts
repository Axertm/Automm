import type { PrismaClient } from '@prisma/client';
import type { Currency } from '../../domain/value-objects/Currency.js';
import type { ISavedPayoutAddressRepository } from '../../domain/repositories/ISavedPayoutAddressRepository.js';

export class PrismaSavedPayoutAddressRepository implements ISavedPayoutAddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(discordUserId: string, currency: Currency, address: string): Promise<void> {
    await this.prisma.savedPayoutAddress.upsert({
      where: { discordUserId_currency: { discordUserId, currency } },
      create: { discordUserId, currency, address },
      update: { address },
    });
  }

  async find(discordUserId: string, currency: Currency): Promise<string | null> {
    const row = await this.prisma.savedPayoutAddress.findUnique({
      where: { discordUserId_currency: { discordUserId, currency } },
    });
    return row?.address ?? null;
  }
}
