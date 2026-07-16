import type { DealId, PartyId } from '../value-objects/EntityId.js';

export const PARTY_ROLES = ['BUYER', 'SELLER', 'ADMIN'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export interface PartyProps {
  id: PartyId;
  dealId: DealId;
  discordUserId: string;
  role: PartyRole;
  completedFlag: boolean;
}

export class Party {
  private constructor(private props: PartyProps) {}

  static create(props: PartyProps): Party {
    return new Party(props);
  }

  get id(): PartyId {
    return this.props.id;
  }

  get dealId(): DealId {
    return this.props.dealId;
  }

  get discordUserId(): string {
    return this.props.discordUserId;
  }

  get role(): PartyRole {
    return this.props.role;
  }

  get completedFlag(): boolean {
    return this.props.completedFlag;
  }

  markCompleted(): void {
    this.props.completedFlag = true;
  }

  toProps(): Readonly<PartyProps> {
    return { ...this.props };
  }
}
