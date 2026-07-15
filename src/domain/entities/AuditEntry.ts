import type { DealId } from '../value-objects/EntityId.js';
import type { DealState } from '../state-machine/DealState.js';

export interface AuditEntryProps {
  id: string;
  dealId: DealId | null;
  actorId: string;
  action: string;
  fromState: DealState | null;
  toState: DealState | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export const SYSTEM_ACTOR = 'SYSTEM';

export class AuditEntry {
  private constructor(private readonly props: AuditEntryProps) {}

  static create(props: AuditEntryProps): AuditEntry {
    return new AuditEntry(props);
  }

  toProps(): Readonly<AuditEntryProps> {
    return { ...this.props };
  }
}
