import type { PrismaClient } from '@prisma/client';
import type {
  BackupAccountRecord,
  IBackupAccountRepository,
} from '../../domain/repositories/IBackupAccountRepository.js';

export class PrismaBackupAccountRepository implements IBackupAccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(ownerDiscordId: string, backupDiscordId: string): Promise<void> {
    await this.prisma.backupAccount.upsert({
      where: { ownerDiscordId_backupDiscordId: { ownerDiscordId, backupDiscordId } },
      create: { ownerDiscordId, backupDiscordId },
      update: {},
    });
  }

  async remove(ownerDiscordId: string, backupDiscordId: string): Promise<void> {
    await this.prisma.backupAccount.deleteMany({ where: { ownerDiscordId, backupDiscordId } });
  }

  async findByOwner(ownerDiscordId: string): Promise<BackupAccountRecord[]> {
    const rows = await this.prisma.backupAccount.findMany({ where: { ownerDiscordId } });
    return rows.map((row) => ({ ownerDiscordId: row.ownerDiscordId, backupDiscordId: row.backupDiscordId }));
  }

  async findByBackup(backupDiscordId: string): Promise<BackupAccountRecord[]> {
    const rows = await this.prisma.backupAccount.findMany({ where: { backupDiscordId } });
    return rows.map((row) => ({ ownerDiscordId: row.ownerDiscordId, backupDiscordId: row.backupDiscordId }));
  }
}
