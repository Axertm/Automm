import { randomUUID } from 'node:crypto';
import { Deal } from '../../../domain/entities/Deal.js';
import { Party } from '../../../domain/entities/Party.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { asDealId, asPartyId, type DealId } from '../../../domain/value-objects/EntityId.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IPartyRepository } from '../../../domain/repositories/IPartyRepository.js';
import type { IClock } from '../../ports/IClock.js';
import { AuditRecorder, SYSTEM_ACTOR } from '../../services/AuditRecorder.js';
import { createDealInputSchema, type CreateDealInput } from '../../dto/CreateDealInput.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

export class CreateDealUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly partyRepository: IPartyRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: IClock,
  ) {}

  /**
   * `presetDealId`, when provided, is used as the Deal's actual primary key
   * instead of generating a fresh one — the ticket-based wizard generates a
   * short human-friendly ID (see ShortDealIdGenerator) at ticket-creation
   * time, well before the rest of these fields are known, and needs the
   * final persisted Deal to carry that same ID.
   */
  async execute(
    rawInput: CreateDealInput,
    presetDealId?: DealId,
  ): Promise<Result<Deal, DomainError | Error>> {
    const parsed = createDealInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return err(new Error(parsed.error.issues.map((i) => i.message).join('; ')));
    }
    const input = parsed.data;

    try {
      const now = this.clock.now();
      const dealId = presetDealId ?? asDealId(randomUUID());
      const deal = Deal.create({
        id: dealId,
        guildId: input.guildId,
        ticketChannelId: input.ticketChannelId,
        currency: input.currency,
        state: 'CREATED',
        buyerDiscordId: input.buyerDiscordId,
        sellerDiscordId: input.sellerDiscordId,
        expectedAmount: Money.fromDecimalString(input.currency, input.expectedAmountDecimal),
        feeBasisPointsSnapshot: input.feeBasisPoints,
        payoutAddress: null,
        payoutAddressConfirmedBySeller: false,
        buyerReleaseConfirmed: false,
        payoutAddressOverriddenByAdmin: false,
        payoutOverrideReason: null,
        payoutOverrideByDiscordId: null,
        frozenFromState: null,
        frozenReason: null,
        frozenByDiscordId: null,
        cancelReason: null,
        refundReason: null,
        refundAddress: null,
        payoutFeeTxId: null,
        payoutMainTxId: null,
        createdAt: now,
        updatedAt: now,
        fundedAt: null,
        completedAt: null,
      });

      await this.dealRepository.save(deal);
      await this.savePartiesFor(dealId, input);
      await this.auditRecorder.record({
        dealId,
        actorId: SYSTEM_ACTOR,
        action: 'DEAL_CREATED',
        toState: 'CREATED',
        metadata: { currency: input.currency, expectedAmount: input.expectedAmountDecimal },
      });

      return ok(deal);
    } catch (error) {
      return err(error as Error);
    }
  }

  private async savePartiesFor(dealId: DealId, input: CreateDealInput): Promise<void> {
    await this.partyRepository.save(
      Party.create({
        id: asPartyId(randomUUID()),
        dealId,
        discordUserId: input.buyerDiscordId,
        role: 'BUYER',
        completedFlag: false,
      }),
    );
    await this.partyRepository.save(
      Party.create({
        id: asPartyId(randomUUID()),
        dealId,
        discordUserId: input.sellerDiscordId,
        role: 'SELLER',
        completedFlag: false,
      }),
    );
  }
}
