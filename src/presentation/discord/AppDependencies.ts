import type { CreateDealUseCase } from '../../application/use-cases/deal/CreateDealUseCase.js';
import type { GenerateDepositWalletUseCase } from '../../application/use-cases/deal/GenerateDepositWalletUseCase.js';
import type { RequestReleaseUseCase } from '../../application/use-cases/release/RequestReleaseUseCase.js';
import type { SubmitPayoutAddressUseCase } from '../../application/use-cases/release/SubmitPayoutAddressUseCase.js';
import type { ConfirmPayoutWalletUseCase } from '../../application/use-cases/release/ConfirmPayoutWalletUseCase.js';
import type { ConfirmReleaseUseCase } from '../../application/use-cases/release/ConfirmReleaseUseCase.js';
import type { AdminFreezeUseCase } from '../../application/use-cases/admin/AdminFreezeUseCase.js';
import type { AdminUnfreezeUseCase } from '../../application/use-cases/admin/AdminUnfreezeUseCase.js';
import type { AdminRefundUseCase } from '../../application/use-cases/admin/AdminRefundUseCase.js';
import type { AdminCancelUseCase } from '../../application/use-cases/admin/AdminCancelUseCase.js';
import type { AdminOverridePayoutAddressUseCase } from '../../application/use-cases/admin/AdminOverridePayoutAddressUseCase.js';
import type { AdminStatsUseCase } from '../../application/use-cases/admin/AdminStatsUseCase.js';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../domain/repositories/IWalletRepository.js';
import type { IPartyRepository } from '../../domain/repositories/IPartyRepository.js';
import type { IAuditLogRepository } from '../../domain/repositories/IAuditLogRepository.js';
import type { IBlockchainServiceFactory } from '../../application/ports/IBlockchainServiceFactory.js';
import type { IPriceProvider } from '../../application/ports/IPriceProvider.js';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.schema.js';
import type { TicketChannelService } from './ticket/TicketChannelService.js';
import type { PendingActionCache } from './PendingActionCache.js';
import type { ShortDealIdGenerator } from '../../application/services/ShortDealIdGenerator.js';
import type { DealWizardStore } from './wizard/DealWizardState.js';

/**
 * Everything a slash-command / button / modal handler needs. Built once in
 * bootstrap.ts and threaded through the InteractionRouter — this is the
 * presentation layer's composition boundary, so no handler ever
 * `new`s a use case or a Prisma client directly.
 */
export interface AppDependencies {
  env: Env;
  logger: Logger;
  dealRepository: IDealRepository;
  walletRepository: IWalletRepository;
  partyRepository: IPartyRepository;
  auditLogRepository: IAuditLogRepository;
  blockchainServiceFactory: IBlockchainServiceFactory;
  priceProvider: IPriceProvider;
  ticketChannelService: TicketChannelService;
  pendingActionCache: PendingActionCache;
  shortDealIdGenerator: ShortDealIdGenerator;
  dealWizardStore: DealWizardStore;
  createDeal: CreateDealUseCase;
  generateDepositWallet: GenerateDepositWalletUseCase;
  requestRelease: RequestReleaseUseCase;
  submitPayoutAddress: SubmitPayoutAddressUseCase;
  confirmPayoutWallet: ConfirmPayoutWalletUseCase;
  confirmRelease: ConfirmReleaseUseCase;
  adminFreeze: AdminFreezeUseCase;
  adminUnfreeze: AdminUnfreezeUseCase;
  adminRefund: AdminRefundUseCase;
  adminCancel: AdminCancelUseCase;
  adminOverridePayoutAddress: AdminOverridePayoutAddressUseCase;
  adminStats: AdminStatsUseCase;
}
