import { randomUUID } from 'node:crypto';
import { AuditEntry, SYSTEM_ACTOR } from '../../domain/entities/AuditEntry.js';
import type { IAuditLogRepository } from '../../domain/repositories/IAuditLogRepository.js';
import type { DealId } from '../../domain/value-objects/EntityId.js';
import type { DealState } from '../../domain/state-machine/DealState.js';
import type { IClock } from '../ports/IClock.js';

export class AuditRecorder {
  constructor(
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly clock: IClock,
  ) {}

  async record(params: {
    dealId?: DealId | null;
    actorId: string;
    action: string;
    fromState?: DealState | null;
    toState?: DealState | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.auditLogRepository.append(
      AuditEntry.create({
        id: randomUUID(),
        dealId: params.dealId ?? null,
        actorId: params.actorId,
        action: params.action,
        fromState: params.fromState ?? null,
        toState: params.toState ?? null,
        metadata: params.metadata ?? null,
        createdAt: this.clock.now(),
      }),
    );
  }
}

export { SYSTEM_ACTOR };
