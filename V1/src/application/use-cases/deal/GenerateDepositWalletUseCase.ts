import { randomUUID } from 'node:crypto';
import { Wallet } from '../../../domain/entities/Wallet.js';
import { asWalletId, type DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, WalletAlreadyExistsError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IClock } from '../../ports/IClock.js';
import { AuditRecorder, SYSTEM_ACTOR } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

export interface GenerateDepositWalletOutput {
  deal: Deal;
  wallet: Wallet;
}

export class GenerateDepositWalletUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: IClock,
  ) {}

  async execute(dealId: DealId): Promise<Result<GenerateDepositWalletOutput, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const existing = await this.walletRepository.findByDealId(dealId);
    if (existing) {
      return err(new WalletAlreadyExistsError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    const generated = await blockchainService.generateWallet();

    const wallet = Wallet.create({
      id: asWalletId(randomUUID()),
      dealId,
      currency: deal.currency,
      address: generated.address,
      encryptedPrivateKey: generated.encryptedPrivateKey,
      derivationPath: generated.derivationPath,
      createdAt: this.clock.now(),
    });

    await this.walletRepository.save(wallet);

    const fromState = deal.state;
    deal.markAwaitingDeposit();
    await this.dealRepository.save(deal);

    await this.auditRecorder.record({
      dealId,
      actorId: SYSTEM_ACTOR,
      action: 'WALLET_GENERATED',
      fromState,
      toState: deal.state,
      metadata: { currency: deal.currency, address: wallet.address },
    });

    return ok({ deal, wallet });
  }
}
