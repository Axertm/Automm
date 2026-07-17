import type { PrismaClient } from '@prisma/client';
import { AuditEntry } from '../../domain/entities/AuditEntry.js';
import { asDealId, type DealId } from '../../domain/value-objects/EntityId.js';
import { assertDealState } from '../../domain/state-machine/DealState.js';
import type { IAuditLogRepository } from '../../domain/repositories/IAuditLogRepository.js';

export class PrismaAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditEntry): Promise<void> {
    const props = entry.toProps();
    await this.prisma.auditEntry.create({
      data: {
        id: props.id,
        dealId: props.dealId,
        actorId: props.actorId,
        action: props.action,
        fromState: props.fromState,
        toState: props.toState,
        metadata: props.metadata as never,
        createdAt: props.createdAt,
      },
    });
  }

  async findByDealId(dealId: DealId): Promise<AuditEntry[]> {
    const rows = await this.prisma.auditEntry.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) =>
      AuditEntry.create({
        id: row.id,
        dealId: row.dealId ? asDealId(row.dealId) : null,
        actorId: row.actorId,
        action: row.action,
        fromState: row.fromState ? assertDealState(row.fromState) : null,
        toState: row.toState ? assertDealState(row.toState) : null,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt,
      }),
    );
  }
}
