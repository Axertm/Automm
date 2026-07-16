import type { AuditEntry } from '../entities/AuditEntry.js';
import type { DealId } from '../value-objects/EntityId.js';

export interface IAuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
  findByDealId(dealId: DealId): Promise<AuditEntry[]>;
}
