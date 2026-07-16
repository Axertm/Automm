import type { Wallet } from '../../../domain/entities/Wallet.js';
import type { DealId, WalletId } from '../../../domain/value-objects/EntityId.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { JsonBackupStore } from './JsonBackupStore.js';

/** Wraps the real IWalletRepository and mirrors every successful save to JsonBackupStore — see BackupDealRepository for the full rationale. */
export class BackupWalletRepository implements IWalletRepository {
  constructor(
    private readonly inner: IWalletRepository,
    private readonly backupStore: JsonBackupStore,
  ) {}

  async save(wallet: Wallet): Promise<void> {
    await this.inner.save(wallet);
    this.backupStore.saveWallet(wallet);
  }

  findById(id: WalletId): Promise<Wallet | null> {
    return this.inner.findById(id);
  }

  findByDealId(dealId: DealId): Promise<Wallet | null> {
    return this.inner.findByDealId(dealId);
  }
}
