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

// Tatum's free tier is a shared 3 req/s budget across every endpoint on the
// API key. FailoverUtxoProvider runs two independent queues against this
// same account (see its constructor), so each is kept well under half that
// ceiling to leave headroom for the two queues bursting at once.
export const LTC_PROVIDER_RATE_LIMITS = {
  tatum: { requestsPerSecond: 1 },
} as const;

export const RETRY_BACKOFF_MS = [500, 1500, 4000] as const;

export const SCAN_CONCURRENCY_PER_CHAIN = 4;

// Payouts are checked for confirmation on their own short interval, decoupled
// from DEPOSIT_SCAN_CRON (which defaults to every 2 minutes) — once a payout
// is broadcast, someone is actively watching for it to complete, so it's
// worth polling read-only confirmation status much more often than deposit
// scanning needs to run. Kept with headroom under Tatum's shared free-tier
// rate limit (see LTC_PROVIDER_RATE_LIMITS) for concurrent payouts and
// deposit scanning sharing the same quota — note that limit is a real
// server-side limit, not one enforced locally (RequestQueue's
// TokenBucketLimiter only throttles the per-second rate), so nothing stops
// this loop from tripping actual 429s if pushed too fast.
export const PAYOUT_CONFIRM_INTERVAL_MS = 30_000;

// A UTXO provider can return an HTTP-level "success" for a broadcast (e.g.
// echoing back a computed txid) without the transaction ever actually being
// relayed/accepted onto the real network — this happened in production and
// left a deal stuck in PAYOUT_IN_PROGRESS with a phantom, unconfirmable
// txid. LitecoinService.sendPayout() polls transactionExists() this many
// times, this far apart, before trusting a broadcast; see verifyBroadcast().
export const BROADCAST_VERIFY_ATTEMPTS = 4;
export const BROADCAST_VERIFY_DELAY_MS = 3_000;
