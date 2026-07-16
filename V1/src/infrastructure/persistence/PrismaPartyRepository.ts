import type { PrismaClient } from '@prisma/client';
import { Party, type PartyRole } from '../../domain/entities/Party.js';
import { asDealId, asPartyId, type DealId } from '../../domain/value-objects/EntityId.js';
import type { IPartyRepository } from '../../domain/repositories/IPartyRepository.js';

export class PrismaPartyRepository implements IPartyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(party: Party): Promise<void> {
    const props = party.toProps();
    await this.prisma.party.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        dealId: props.dealId,
        discordUserId: props.discordUserId,
        role: props.role,
        completedFlag: props.completedFlag,
      },
      update: { completedFlag: props.completedFlag },
    });
  }

  async findByDealId(dealId: DealId): Promise<Party[]> {
    const rows = await this.prisma.party.findMany({ where: { dealId } });
    return rows.map((row) =>
      Party.create({
        id: asPartyId(row.id),
        dealId: asDealId(row.dealId),
        discordUserId: row.discordUserId,
        role: row.role as PartyRole,
        completedFlag: row.completedFlag,
      }),
    );
  }
}
