import { bootstrap } from './bootstrap.js';
import { logger } from './infrastructure/logging/PinoLogger.js';

async function main(): Promise<void> {
  const app = await bootstrap();

  let shuttingDown = false;
  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'received_shutdown_signal');
    // Deliberately does not force-kill in-flight payout signing/broadcast
    // calls — shutdown() stops the scheduler and closes the health server
    // first, then disconnects, giving any in-flight use case a chance to
    // finish before the process exits.
    void app.shutdown().finally(() => process.exit(0));
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error({ err: (error as Error).message, stack: (error as Error).stack }, 'fatal_startup_error');
  process.exit(1);
});
