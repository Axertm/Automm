import { env } from './config/env.js';
import { logger } from './infrastructure/logging/PinoLogger.js';
import { getPrismaClient, disconnectPrisma } from './infrastructure/persistence/PrismaClient.js';
import { PrismaDealRepository } from './infrastructure/persistence/PrismaDealRepository.js';
import { PrismaWalletRepository } from './infrastructure/persistence/PrismaWalletRepository.js';
import { PrismaTransactionRepository } from './infrastructure/persistence/PrismaTransactionRepository.js';
import { PrismaAuditLogRepository } from './infrastructure/persistence/PrismaAuditLogRepository.js';
import { PrismaPartyRepository } from './infrastructure/persistence/PrismaPartyRepository.js';
import { EnvFeeWalletProvider } from './infrastructure/config/EnvFeeWalletProvider.js';
import { SystemClock } from './application/ports/IClock.js';
import { AuditRecorder } from './application/services/AuditRecorder.js';
import { PayoutTrigger } from './application/services/PayoutTrigger.js';
import { KeyedMutex } from './shared/concurrency/KeyedMutex.js';

import { BlockCypherProvider } from './infrastructure/blockchain/litecoin/providers/BlockCypherProvider.js';
import { BlockchairProvider } from './infrastructure/blockchain/litecoin/providers/BlockchairProvider.js';
import { FailoverUtxoProvider } from './infrastructure/blockchain/litecoin/FailoverUtxoProvider.js';
import { LitecoinService } from './infrastructure/blockchain/litecoin/LitecoinService.js';
import { SolanaRpcClient } from './infrastructure/blockchain/solana/SolanaRpcClient.js';
import { SolanaService } from './infrastructure/blockchain/solana/SolanaService.js';
import { BlockchainServiceFactory } from './infrastructure/blockchain/BlockchainServiceFactory.js';
import { CoinGeckoPriceProvider } from './infrastructure/price/CoinGeckoPriceProvider.js';
import { JsonBackupStore } from './infrastructure/persistence/backup/JsonBackupStore.js';
import { BackupDealRepository } from './infrastructure/persistence/backup/BackupDealRepository.js';
import { BackupWalletRepository } from './infrastructure/persistence/backup/BackupWalletRepository.js';

import { CreateDealUseCase } from './application/use-cases/deal/CreateDealUseCase.js';
import { GenerateDepositWalletUseCase } from './application/use-cases/deal/GenerateDepositWalletUseCase.js';
import { ScanDepositsUseCase } from './application/use-cases/scanning/ScanDepositsUseCase.js';
import { ConfirmPayoutTransactionsUseCase } from './application/use-cases/scanning/ConfirmPayoutTransactionsUseCase.js';
import { RequestReleaseUseCase } from './application/use-cases/release/RequestReleaseUseCase.js';
import { SubmitPayoutAddressUseCase } from './application/use-cases/release/SubmitPayoutAddressUseCase.js';
import { ConfirmPayoutWalletUseCase } from './application/use-cases/release/ConfirmPayoutWalletUseCase.js';
import { ExecutePayoutUseCase } from './application/use-cases/release/ExecutePayoutUseCase.js';
import { ConfirmReleaseUseCase } from './application/use-cases/release/ConfirmReleaseUseCase.js';
import { AdminFreezeUseCase } from './application/use-cases/admin/AdminFreezeUseCase.js';
import { AdminUnfreezeUseCase } from './application/use-cases/admin/AdminUnfreezeUseCase.js';
import { AdminRefundUseCase } from './application/use-cases/admin/AdminRefundUseCase.js';
import { AdminCancelUseCase } from './application/use-cases/admin/AdminCancelUseCase.js';
import { AdminOverridePayoutAddressUseCase } from './application/use-cases/admin/AdminOverridePayoutAddressUseCase.js';
import { AdminStatsUseCase } from './application/use-cases/admin/AdminStatsUseCase.js';
import { AdminRetryPayoutUseCase } from './application/use-cases/admin/AdminRetryPayoutUseCase.js';

import { ShortDealIdGenerator } from './application/services/ShortDealIdGenerator.js';
import { DepositScanScheduler } from './infrastructure/scheduler/DepositScanScheduler.js';
import { TicketChannelService } from './presentation/discord/ticket/TicketChannelService.js';
import { PendingActionCache } from './presentation/discord/PendingActionCache.js';
import { DealWizardStore } from './presentation/discord/wizard/DealWizardState.js';
import { DiscordNotifier } from './presentation/discord/notifier/DiscordNotifier.js';
import { startDiscordBot } from './presentation/discord/client.js';
import { createHealthApp } from './infrastructure/http/healthServer.js';
import type { AppDependencies } from './presentation/discord/AppDependencies.js';

export interface App {
  dependencies: AppDependencies;
  scheduler: DepositScanScheduler;
  shutdown: () => Promise<void>;
}

export async function bootstrap(): Promise<App> {
  const prisma = getPrismaClient();

  const backupStore = new JsonBackupStore(env.BACKUP_DIR, logger.child({ component: 'backup' }));
  const dealRepository = new BackupDealRepository(new PrismaDealRepository(prisma), backupStore);
  const walletRepository = new BackupWalletRepository(new PrismaWalletRepository(prisma), backupStore);
  const transactionRepository = new PrismaTransactionRepository(prisma);
  const auditLogRepository = new PrismaAuditLogRepository(prisma);
  const partyRepository = new PrismaPartyRepository(prisma);

  const clock = new SystemClock();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const feeWalletProvider = new EnvFeeWalletProvider();

  const ltcLogger = logger.child({ component: 'litecoin' });
  const utxoProvider = new FailoverUtxoProvider(
    new BlockCypherProvider(env.BLOCKCYPHER_API_TOKEN),
    new BlockchairProvider(env.BLOCKCHAIR_API_KEY),
    ltcLogger,
  );
  const ltcService = new LitecoinService(
    utxoProvider,
    ltcLogger,
    env.LTC_REQUIRED_CONFIRMATIONS,
  );

  const solLogger = logger.child({ component: 'solana' });
  const solRpcClient = new SolanaRpcClient(
    env.SOLANA_RPC_URL,
    env.SOLANA_RPC_URL_FALLBACK || undefined,
    solLogger,
  );
  const solService = new SolanaService(solRpcClient, solLogger);

  const blockchainServiceFactory = new BlockchainServiceFactory(ltcService, solService);
  const priceProvider = new CoinGeckoPriceProvider(logger.child({ component: 'price' }));

  // discordNotifier needs the live Client, so it's wired in after startDiscordBot();
  // use cases that depend on IDiscordNotifier receive a thin proxy that forwards to
  // whichever notifier is set once the client is ready.
  let realNotifier: DiscordNotifier | null = null;
  const notifierProxy = {
    dealFunded: (...args: Parameters<DiscordNotifier['dealFunded']>) =>
      realNotifier?.dealFunded(...args) ?? Promise.resolve(),
    depositDetected: (...args: Parameters<DiscordNotifier['depositDetected']>) =>
      realNotifier?.depositDetected(...args) ?? Promise.resolve(),
    releaseRequested: (...args: Parameters<DiscordNotifier['releaseRequested']>) =>
      realNotifier?.releaseRequested(...args) ?? Promise.resolve(),
    releaseConfirmedByBuyer: (...args: Parameters<DiscordNotifier['releaseConfirmedByBuyer']>) =>
      realNotifier?.releaseConfirmedByBuyer(...args) ?? Promise.resolve(),
    payoutAddressSubmitted: (...args: Parameters<DiscordNotifier['payoutAddressSubmitted']>) =>
      realNotifier?.payoutAddressSubmitted(...args) ?? Promise.resolve(),
    payoutConfirmedBySeller: (...args: Parameters<DiscordNotifier['payoutConfirmedBySeller']>) =>
      realNotifier?.payoutConfirmedBySeller(...args) ?? Promise.resolve(),
    payoutCompleted: (...args: Parameters<DiscordNotifier['payoutCompleted']>) =>
      realNotifier?.payoutCompleted(...args) ?? Promise.resolve(),
    dealStateChanged: (...args: Parameters<DiscordNotifier['dealStateChanged']>) =>
      realNotifier?.dealStateChanged(...args) ?? Promise.resolve(),
  };

  const createDeal = new CreateDealUseCase(dealRepository, partyRepository, auditRecorder, clock);
  const generateDepositWallet = new GenerateDepositWalletUseCase(
    dealRepository,
    walletRepository,
    blockchainServiceFactory,
    auditRecorder,
    clock,
  );
  const scanDeposits = new ScanDepositsUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    blockchainServiceFactory,
    notifierProxy,
    auditRecorder,
    clock,
  );
  const confirmPayoutTransactions = new ConfirmPayoutTransactionsUseCase(
    dealRepository,
    blockchainServiceFactory,
    notifierProxy,
    auditRecorder,
  );

  const requestRelease = new RequestReleaseUseCase(dealRepository, notifierProxy, auditRecorder);
  const submitPayoutAddress = new SubmitPayoutAddressUseCase(
    dealRepository,
    blockchainServiceFactory,
    notifierProxy,
    auditRecorder,
  );
  const executePayout = new ExecutePayoutUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    blockchainServiceFactory,
    feeWalletProvider,
    notifierProxy,
    auditRecorder,
    clock,
  );
  // Shared across PayoutTrigger and AdminRetryPayoutUseCase so a manual
  // retry can never race a payout broadcast already in flight for the same
  // deal — both serialize on the same per-deal key.
  const payoutMutex = new KeyedMutex();
  const payoutTrigger = new PayoutTrigger(
    dealRepository,
    executePayout,
    auditRecorder,
    confirmPayoutTransactions,
    payoutMutex,
  );
  const adminRetryPayout = new AdminRetryPayoutUseCase(dealRepository, executePayout, auditRecorder, payoutMutex);
  const confirmPayoutWallet = new ConfirmPayoutWalletUseCase(
    dealRepository,
    notifierProxy,
    auditRecorder,
    payoutTrigger,
  );
  const confirmRelease = new ConfirmReleaseUseCase(dealRepository, notifierProxy, auditRecorder);

  const adminFreeze = new AdminFreezeUseCase(dealRepository, notifierProxy, auditRecorder);
  const adminUnfreeze = new AdminUnfreezeUseCase(dealRepository, notifierProxy, auditRecorder);
  const adminRefund = new AdminRefundUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    blockchainServiceFactory,
    notifierProxy,
    auditRecorder,
  );
  const adminCancel = new AdminCancelUseCase(dealRepository, notifierProxy, auditRecorder);
  const adminOverridePayoutAddress = new AdminOverridePayoutAddressUseCase(
    dealRepository,
    blockchainServiceFactory,
    notifierProxy,
    auditRecorder,
    payoutTrigger,
  );
  const adminStats = new AdminStatsUseCase(dealRepository);

  const dependencies: AppDependencies = {
    env,
    logger,
    dealRepository,
    walletRepository,
    partyRepository,
    auditLogRepository,
    blockchainServiceFactory,
    priceProvider,
    ticketChannelService: new TicketChannelService(env),
    pendingActionCache: new PendingActionCache(),
    shortDealIdGenerator: new ShortDealIdGenerator(dealRepository),
    dealWizardStore: new DealWizardStore(),
    createDeal,
    generateDepositWallet,
    requestRelease,
    submitPayoutAddress,
    confirmPayoutWallet,
    confirmRelease,
    adminFreeze,
    adminUnfreeze,
    adminRefund,
    adminCancel,
    adminOverridePayoutAddress,
    adminRetryPayout,
    adminStats,
  };

  const discordClient = await startDiscordBot(dependencies);
  realNotifier = new DiscordNotifier(
    discordClient,
    dealRepository,
    walletRepository,
    partyRepository,
    env,
    logger,
  );

  const scheduler = new DepositScanScheduler(
    dealRepository,
    scanDeposits,
    confirmPayoutTransactions,
    logger,
    env.DEPOSIT_SCAN_CRON,
  );
  scheduler.start();

  const healthApp = createHealthApp(discordClient, prisma);
  const healthServer = healthApp.listen(env.HEALTH_CHECK_PORT, () => {
    logger.info({ port: env.HEALTH_CHECK_PORT }, 'health_server_listening');
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting_down');
    scheduler.stop();
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    await discordClient.destroy();
    await disconnectPrisma();
  };

  return { dependencies, scheduler, shutdown };
}
