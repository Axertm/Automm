// Disaster recovery: reads every deal/wallet JSON backup written by
// JsonBackupStore (src/infrastructure/persistence/backup/JsonBackupStore.ts)
// and upserts them back into the live database. Safe to run repeatedly —
// every write goes through the same upsert-based save() the app uses
// normally, so re-running this after partial success just re-applies the
// same rows. Run with: npx tsx scripts/restore-from-backup.ts
import { env } from '../src/config/env.js';
import { logger } from '../src/infrastructure/logging/PinoLogger.js';
import { getPrismaClient, disconnectPrisma } from '../src/infrastructure/persistence/PrismaClient.js';
import { PrismaDealRepository } from '../src/infrastructure/persistence/PrismaDealRepository.js';
import { PrismaWalletRepository } from '../src/infrastructure/persistence/PrismaWalletRepository.js';
import { JsonBackupStore } from '../src/infrastructure/persistence/backup/JsonBackupStore.js';

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const dealRepository = new PrismaDealRepository(prisma);
  const walletRepository = new PrismaWalletRepository(prisma);
  const backupStore = new JsonBackupStore(env.BACKUP_DIR, logger.child({ component: 'restore' }));

  const deals = backupStore.loadAllDeals();
  const wallets = backupStore.loadAllWallets();

  console.log(`Found ${deals.length} backed-up deal(s) and ${wallets.length} backed-up wallet(s) in ${env.BACKUP_DIR}`);

  for (const deal of deals) {
    await dealRepository.save(deal);
    console.log(`Restored deal ${deal.id} (state: ${deal.state})`);
  }
  for (const wallet of wallets) {
    await walletRepository.save(wallet);
    console.log(`Restored wallet for deal ${wallet.dealId} (address: ${wallet.address})`);
  }

  console.log('Restore complete.');
  await disconnectPrisma();
}

main().catch((error) => {
  console.error('Restore failed:', error);
  process.exit(1);
});
