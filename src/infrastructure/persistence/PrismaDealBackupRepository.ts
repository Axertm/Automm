import type { PrismaClient } from '@prisma/client';
import { asDealId, type DealId } from '../../domain/value-objects/EntityId.js';
import type { DealBackupRecord, IDealBackupRepository } from '../../domain/repositories/IDealBackupRepository.js';

export class PrismaDealBackupRepository implements IDealBackupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(record: DealBackupRecord): Promise<void> {
    await this.prisma.dealBackup.upsert({
      where: { dealId_role: { dealId: record.dealId, role: record.role } },
      create: {
        dealId: record.dealId,
        role: record.role,
        backupDiscordId: record.backupDiscordId,
        addedByAdminId: record.addedByAdminId,
      },
      update: {
        backupDiscordId: record.backupDiscordId,
        addedByAdminId: record.addedByAdminId,
      },
    });
  }

  async remove(dealId: DealId, role: 'BUYER' | 'SELLER'): Promise<void> {
    await this.prisma.dealBackup.deleteMany({ where: { dealId, role } });
  }

  async findByDealId(dealId: DealId): Promise<DealBackupRecord[]> {
    const rows = await this.prisma.dealBackup.findMany({ where: { dealId } });
    return rows.map((row) => ({
      dealId: asDealId(row.dealId),
      role: row.role as 'BUYER' | 'SELLER',
      backupDiscordId: row.backupDiscordId,
      addedByAdminId: row.addedByAdminId,
    }));
  }
}
