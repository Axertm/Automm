import type { Wallet } from '../entities/Wallet.js';
import type { DealId, WalletId } from '../value-objects/EntityId.js';

export interface IWalletRepository {
  save(wallet: Wallet): Promise<void>;
  findById(id: WalletId): Promise<Wallet | null>;
  findByDealId(dealId: DealId): Promise<Wallet | null>;
}
