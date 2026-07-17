import type { DealId } from '../value-objects/EntityId.js';
import type { DealActorRole } from '../entities/Deal.js';

export interface DealBackupRecord {
  dealId: DealId;
  role: Extract<DealActorRole, 'BUYER' | 'SELLER'>;
  backupDiscordId: string;
  addedByAdminId: string;
}

/** Admin-activated, per-deal grants of a party's registered backup account (see IBackupAccountRepository). */
export interface IDealBackupRepository {
  /** Upserts on (dealId, role) — activating a new backup for a role replaces any previous one. */
  upsert(record: DealBackupRecord): Promise<void>;
  remove(dealId: DealId, role: 'BUYER' | 'SELLER'): Promise<void>;
  findByDealId(dealId: DealId): Promise<DealBackupRecord[]>;
}
