import { JsonRpcProvider } from 'ethers';
import type { Logger } from 'pino';
import { retryWithBackoff } from '../../rate-limit/retryWithBackoff.js';
import type { IPolygonRpcClient } from './IPolygonRpcClient.js';

/**
 * Thin wrapper around ethers' JsonRpcProvider. Same primary/fallback "try
 * the other URL" shape as SolanaRpcClient — Polygon RPC endpoints are
 * interchangeable (unlike the Litecoin UTXO providers' differing response
 * shapes), so a single retry-with-backoff wrapper plus one fallback URL is
 * enough, no dedicated failover class needed.
 */
export class PolygonRpcClient implements IPolygonRpcClient {
  private readonly primaryProvider: JsonRpcProvider;
  private readonly fallbackProvider: JsonRpcProvider | null;

  constructor(
    primaryRpcUrl: string,
    fallbackRpcUrl: string | undefined,
    private readonly logger: Logger,
  ) {
    this.primaryProvider = new JsonRpcProvider(primaryRpcUrl);
    this.fallbackProvider = fallbackRpcUrl ? new JsonRpcProvider(fallbackRpcUrl) : null;
  }

  async withProvider<T>(operation: string, call: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    try {
      return await retryWithBackoff(
        () => call(this.primaryProvider),
        (attempt, error) =>
          this.logger.warn({ operation, attempt, err: (error as Error).message }, 'polygon_rpc_retry'),
      );
    } catch (primaryError) {
      if (!this.fallbackProvider) {
        throw primaryError;
      }
      this.logger.warn({ operation, err: (primaryError as Error).message }, 'polygon_rpc_failover');
      return retryWithBackoff(
        () => call(this.fallbackProvider!),
        (attempt, error) =>
          this.logger.warn({ operation, attempt, err: (error as Error).message }, 'polygon_rpc_retry_fallback'),
      );
    }
  }
}
