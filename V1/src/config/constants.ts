export const CURRENCY_METADATA = {
  LTC: {
    decimals: 8,
    smallestUnitName: 'litoshi',
    symbol: 'LTC',
  },
  SOL: {
    decimals: 9,
    smallestUnitName: 'lamport',
    symbol: 'SOL',
  },
} as const;

export const CONFIRMATION_CACHE_TTL_MS = 75_000;

export const LTC_PROVIDER_RATE_LIMITS = {
  blockcypher: { requestsPerSecond: 3, requestsPerHour: 200 },
  blockchair: { requestsPerSecond: 1, requestsPerDay: 1440 },
} as const;

export const RETRY_BACKOFF_MS = [500, 1500, 4000] as const;

export const SCAN_CONCURRENCY_PER_CHAIN = 4;
