# Discord Crypto Escrow Bot

A production-ready Discord bot that runs peer-to-peer escrow deals for **Litecoin (LTC)**, **Solana (SOL)**, and **USDT (Polygon)**, built with TypeScript, Discord.js v14, Prisma, and Clean Architecture / DDD / dependency-injection patterns. Every dependency is free/open-source; blockchain access uses free-tier APIs (Tatum, public Solana RPC, public Polygon RPC) with automatic failover.

> **⚠️ This bot is configured for Litecoin/Solana/Polygon mainnet by default and custodies real private keys.** It has been built with security as a priority (two-party confirmation gates, defense-in-depth authorization, audit trail) but **has not undergone an independent professional security audit**. Get one before pointing it at real funds at any meaningful scale. Start with small amounts and a small trusted community while you build confidence in the deployment.

## Prerequisites

Gather these before running the bot:

**1. Software**
- Node.js 22+
- Git

**2. A Discord bot application**
- Create one at https://discord.com/developers/applications
- Add a bot to it → copy the bot token (`DISCORD_TOKEN`)
- Copy the Application ID (`DISCORD_CLIENT_ID`)
- Enable the bot's Guilds and Guild Members intents
- Invite the bot to your server with permission to manage channels, roles, and send messages
- Copy your server's ID (`DISCORD_GUILD_ID`) — enable Developer Mode, then right-click the server icon → Copy Server ID

**3. Three crypto wallets you control**
- An LTC address to receive escrow fees (`LTC_FEE_WALLET_ADDRESS`)
- A SOL address to receive escrow fees (`SOL_FEE_WALLET_ADDRESS`)
- A Polygon address to receive escrow fees in USDT (`USDT_FEE_WALLET_ADDRESS`) — same address format as any EVM chain (MetaMask etc.)
- The bot only ever pays *into* these — it never signs from them

**4. Free API accounts** (takes under a minute, no approval wait)
- Tatum API key: https://tatum.io (dashboard → API key) (`TATUM_API_KEY`) — required; this is the sole Litecoin chain-data provider (address lookups, UTXOs, fee estimation, broadcast). Free tier is a shared 3 req/s budget
- Solana works against the public RPC out of the box; a fallback RPC (e.g. Helius's free tier) is optional but recommended
- Polygon works against the public RPC out of the box; a fallback RPC (e.g. Alchemy/Infura's free tier) is optional but recommended

**5. A database**
- Nothing to set up for local testing — SQLite is provisioned automatically by `npm run dev`
- For a real deployment, use PostgreSQL (`DATABASE_URL`) — SQLite is dev/CI convenience only, see "Database" below

## Quick start

```bash
npm install
cp .env.example .env
# edit .env: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID,
# LTC_FEE_WALLET_ADDRESS, SOL_FEE_WALLET_ADDRESS, USDT_FEE_WALLET_ADDRESS (see "Environment variables" below)
npm run dev
```

`npm run dev` provisions a local SQLite database automatically (via `db:sqlite:setup`) and starts the bot with hot reload — no separate database setup needed for local development. Slash commands register to your configured guild on startup (near-instant, vs. up to an hour for global commands).

Once it's running, post the public panel with `/escrow-panel` (admin-only) in whatever channel you want it in — clicking **Create Escrow** on that panel is how users start a deal. See "Starting a deal" below.

## Starting a deal — the ticket wizard

Deals are no longer created via a slash command with options — everything happens inside a private ticket, step by step, with explicit confirmation at every step:

1. An admin posts the panel once with `/escrow-panel`. Anyone clicks **Create Escrow** on it.
2. A private ticket channel `escrow-<dealId>` is created immediately (visible to the clicking user + admins + the bot only) with a short, human-friendly 6-digit Deal ID (e.g. `escrow-482913`) — generated before anything else about the deal is known.
3. Inside the ticket, a guided 5-step wizard runs entirely on buttons/select-menus/modals: **1)** the initiator picks who else is involved (Discord user-select menu, just the other participant — not a role) → confirm/**Wrong Selection**, **2)** both participants each press **I am the Buyer** / **I am the Seller** themselves to claim their own role (only the two participants may press; a role can only be claimed once, and nobody can claim both), **3)** select the currency (LTC/SOL/USDT) → confirm/**Wrong Selection**, **4)** enter the amount via modal → shows amount/fee/seller-receives breakdown → confirm/**Wrong Amount** (reopens the modal), **5)** a final summary requiring **both** buyer and seller to independently click **Confirm Deal** (or either can **Cancel Deal**).
4. Only after both final confirmations does anything real happen: the Deal is persisted, a brand-new wallet is generated, the QR/deposit-address embed is posted, and the 2-minute deposit scanner picks it up automatically.
5. Every step's progress is shown as `Step X/5 ✅/⏳/⬜ ...` in the embed. Choosing "wrong" at any step only resets that one step — the rest of the wizard state (already-claimed roles, etc.) is untouched.

Wizard progress lives in memory only (`src/presentation/discord/wizard/DealWizardState.ts`), scoped per ticket channel — nothing is written to the database until step 6 finalizes, since no real deal (and no funds) exist before that. A bot restart mid-wizard loses that in-progress ticket's state; the user just clicks **Create Escrow** again.

## Scripts

| Command                           | Description                                                       |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                     | Local dev server (SQLite, hot reload)                             |
| `npm run build`                   | Compile TypeScript against the canonical (Postgres) Prisma schema |
| `npm start`                       | Run the compiled build (`dist/index.js`)                          |
| `npm test`                        | Run the full Vitest suite (against SQLite)                        |
| `npm run lint` / `lint:fix`       | ESLint                                                            |
| `npm run format` / `format:check` | Prettier                                                          |
| `npm run typecheck`               | `tsc --noEmit`                                                    |
| `npm run docker:up`               | Build + run bot + Postgres via docker-compose                     |

## Architecture

Clean Architecture / DDD layering — dependency rule: `presentation → application → domain`, `infrastructure → application ports + domain interfaces`, never the reverse.

```
src/
├── domain/            # Entities (Deal, Wallet, Transaction, Party, AuditEntry), value objects
│                       # (Money, Currency, Address, branded IDs), the Deal state machine,
│                       # repository interfaces. Zero external deps except zod/bitcoinjs-lib/
│                       # @solana/web3.js used purely for I/O-free value-object validation.
├── application/        # Use cases (one class per business operation), ports (IBlockchainService,
│                       # IDiscordNotifier, IClock, IFeeWalletProvider), DTOs.
├── infrastructure/      # Prisma repositories, LitecoinService/SolanaService/UsdtPolygonService, Pino logging,
│                       # node-cron scheduler, qrcode generator, rate-limit/failover.
├── presentation/discord/ # Slash commands, buttons/selects/modals, interaction router, ticket
│                       # channel service, embeds. Never imports Prisma or a chain SDK directly.
├── config/              # Zod-validated env schema, constants
└── shared/               # Result<T,E> pattern
```

Composition happens once, in `src/bootstrap.ts` — a manual dependency-injection composition root (no DI framework needed at this scale; every use case is constructor-injected with interfaces, never a concrete Prisma client or discord.js object).

### Deal state machine

```
CREATED → AWAITING_DEPOSIT → PARTIALLY_FUNDED → FUNDED → RELEASE_REQUESTED
   → AWAITING_PAYOUT_CONFIRMATION → PAYOUT_IN_PROGRESS → COMPLETED
```

Off-ramps: `FROZEN` (from any pre-payout state, admin-only, restores the prior state on unfreeze), `REFUNDED` (from any funded state), `CANCELLED` (only from `CREATED`/`AWAITING_DEPOSIT` — a funded deal must go through `REFUNDED` instead, enforced by the state machine). See `src/domain/state-machine/DealStateMachine.ts` for the full transition table and `tests/unit/domain/DealStateMachine.test.ts` for its exhaustive test coverage.

### The BlockchainService abstraction

Everything outside `infrastructure/blockchain/**` depends solely on `IBlockchainService` (`src/application/ports/IBlockchainService.ts`). `LitecoinService`, `SolanaService`, and `UsdtPolygonService` are the only implementations — this is what makes the whole use-case layer testable via `tests/fakes/FakeBlockchainService.ts` without ever touching a real chain, and what let USDT get added without touching escrow domain logic.

- **Litecoin**: `bitcoinjs-lib` + `bip39`/`bip32` + `tiny-secp256k1`/`ecpair`. Every deposit wallet is derived from a **fresh, independent BIP39 mnemonic generated and immediately discarded** at wallet-creation time — deliberately not from one shared master seed across deals, so compromising one wallet's stored key can never expose any other deal's funds. Chain data comes from `TatumProvider` (via [Tatum](https://tatum.io)'s Litecoin API), wrapped in `FailoverUtxoProvider`: rate limiting (token bucket), retry with exponential backoff + jitter, a short TTL cache, a broadcast that pushes to both of `FailoverUtxoProvider`'s provider slots for redundancy, and a structured `provider_failover` log on every failover.
- **Solana**: `@solana/web3.js` + `@solana/spl-token`, against the configured `SOLANA_RPC_URL` (default: public mainnet-beta) with an optional `SOLANA_RPC_URL_FALLBACK` (e.g. a free Helius endpoint) through the same retry wrapper.
- **USDT (Polygon)**: `ethers` v6 against an ERC-20 contract (`USDT_CONTRACT_ADDRESS`, defaults to the real Polygon USDT deployment) over `POLYGON_RPC_URL` (+ optional `POLYGON_RPC_URL_FALLBACK`), same retry wrapper as Solana. Structurally different from LTC/SOL: an ERC-20 transfer needs the wallet to hold native POL to pay gas, and USDT can't pay its own gas. **The buyer sends a small amount of POL alongside their USDT deposit** (the wallet-generation message says so explicitly) — the bot never pre-funds deal wallets itself, keeping every deposit wallet self-contained exactly like LTC/SOL. `estimateFee()` always returns zero USDT (gas is paid from that pre-funded POL, never carved from the escrowed USDT); `sendPayout()` checks the wallet's POL balance before every transfer and fails with a clear, actionable error (recoverable via `/retry-payout` once topped up) if it's short. One other consequence of ERC-20's one-recipient-per-call model: a fee cut and seller remainder to *different* addresses require two separate on-chain transactions (collapsed to one when they coincide, same as LTC) — only the second transaction's hash is recorded against the deal, though both are logged for manual audit (see `UsdtPolygonService.sendPayout`).

### Security-critical design

- **Never logged**: Pino is configured with `redact` paths for private keys/mnemonics as defense-in-depth (`src/infrastructure/logging/PinoLogger.ts`), on top of the hard coding convention that no code ever logs a whole `Wallet` entity or raw provider response — only explicitly allow-listed fields.
- **Two-party confirmation gate**: `payoutAddressConfirmedBySeller` and `buyerReleaseConfirmed` are two independent flags, both required before `PAYOUT_IN_PROGRESS` — enforced inside `Deal.startPayout()` itself (`src/domain/entities/Deal.ts`), not just at the Discord layer, so no entrypoint can bypass it.
- **Admin payout-address override** (`AdminOverridePayoutAddressUseCase`) is the single highest-risk admin action — it can redirect funds away from the seller-confirmed address. It requires a mandatory reason, is distinctly audited (`ADMIN_OVERRIDE_PAYOUT_ADDRESS`), is gated behind extra-scrutiny confirmation UI, and deliberately still requires the buyer's own release confirmation (only the seller's confirmation is admin-substituted).
- **Confirmation-step pattern**: every fund/state-mutating Discord action — release, freeze, unfreeze, refund, cancel, override, and every step of the deal-creation wizard — renders a preview embed with Confirm/Cancel (or "Wrong X") buttons first; only the `confirm` handler ever invokes a use case (`src/presentation/discord/components/buttons/confirmation.ts`). Every button/select/modal `custom_id` is `"<namespace>:<action>:<dealId>[:extra]"` (`src/presentation/discord/interaction-router/CustomId.ts`) — `encodeConfirm`/`encodeCancel` build the action as `confirm_<action>`/`cancel_<action>` with an **underscore**, not a colon, specifically because the whole ID is later split on `:`; an earlier version of this joined them with `:` and silently shifted every field after it, breaking every confirm/cancel button in the bot with no test catching it. `tests/unit/presentation/CustomId.test.ts` locks in the correct round-trip behavior.
- **Authorization**: buyer/seller identity is enforced inside the `Deal` entity itself (an actor ID mismatch throws `UnauthorizedActorError`, verifiable independent of Discord). Admin role membership genuinely lives in Discord (who has which role), not in this bot's database, so admin gating reads the interacting member's live role cache against `ADMIN_ROLE_IDS` (`src/presentation/discord/commands/admin/adminAuth.ts`) — this is the honest, correct place for that check, not a DB lookup pretending to verify something only Discord actually knows.

### Scheduler

`DepositScanScheduler` (`src/infrastructure/scheduler/DepositScanScheduler.ts`) runs two independent loops: incoming-deposit scanning on `node-cron` at `DEPOSIT_SCAN_CRON` (default `*/2 * * * *`), and payout-confirmation polling on its own fixed 15-second interval — decoupled so a broadcast payout gets checked far more often than deposits need to be scanned for, without needing DEPOSIT_SCAN_CRON itself to run that fast. Each loop has its own in-process overlap guard (skips a tick if the previous one is still running), batches deals per-currency into independently concurrency-limited queues so one chain's slowness never blocks the other, and wraps each deal in its own try/catch so one bad deal never aborts the rest of the tick.

## Database: SQLite (dev) / PostgreSQL (prod)

Prisma requires a single static `provider` per generated client — it cannot be swapped via environment variable. `prisma/schema.prisma` is the **canonical, hand-edited source of truth** (PostgreSQL). `prisma/schema.sqlite.prisma` is **mechanically derived** from it by `scripts/generate-sqlite-schema.mjs` (run automatically by `npm run dev` / `npm test` / `postinstall`) — never edit that file by hand.

Every enum-like column (`Deal.state`, `Transaction.direction`, etc.) is a plain Prisma `String`, validated by Zod/branded domain types at the repository boundary, rather than Prisma's native `enum` — SQLite doesn't support native enums at all, so this is the only way one schema genuinely serves both providers. Money/amount fields are decimal strings for the same reason (and to avoid JS float precision loss), converted to the domain `Money` value object's internal `bigint` at the repository boundary.

SQLite is **dev/CI convenience only, not perfect parity** with Postgres (case-sensitivity in filters, `Json` querying, and a few other edges differ). CI runs the full suite against SQLite by default (fast) plus an optional job against a real Postgres service container (`.github/workflows/ci.yml`, job `postgres-compat`) to catch provider-specific issues before they hit production.

## Environment variables

See `.env.example` for the full list with descriptions. Nothing sensitive is ever hardcoded — all config is Zod-validated at startup (`src/config/env.schema.ts`) and the process exits with a clear error if anything is missing or malformed.

Required at minimum: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `TATUM_API_KEY`, `LTC_FEE_WALLET_ADDRESS`, `SOL_FEE_WALLET_ADDRESS`, `USDT_FEE_WALLET_ADDRESS`. Everything else (`SOLANA_RPC_URL_FALLBACK`, `POLYGON_RPC_URL_FALLBACK`, `USDT_CONTRACT_ADDRESS`, `ADMIN_ROLE_IDS`, `BUYER_COMPLETED_ROLE_ID`, `SELLER_COMPLETED_ROLE_ID`, `ESCROW_CATEGORY_ID`) is optional and the bot runs correctly with all of it blank/defaulted — no code changes or extra manual setup steps are needed beyond filling in `.env`.

Note on admin commands specifically: a real Discord **Administrator** on the server can always run `/freeze /unfreeze /release /refund /cancel /override-payout /retry-payout /balance /stats /add-deal-backup /remove-deal-backup`, regardless of `ADMIN_ROLE_IDS` — you only need to set `ADMIN_ROLE_IDS` if you want to grant admin access to a role _narrower_ than full server Administrator.

## Testing

- **Unit**: domain value objects/entities/state machine (exhaustive transition-table coverage, `Money` bigint precision + fee-split rounding correctness, `Address` validation against real generated fixtures), individual blockchain services against stubbed providers (including a real signed-PSBT round trip for Litecoin).
- **Integration**: use-case flows (deposit scanning across multiple scan cycles, the full release→payout chain, admin actions) against `tests/fakes/` (in-memory repositories + `FakeBlockchainService`) and, for the persistence layer and the deposit scanner, against a real throwaway SQLite database via Prisma.
- **No test ever hits a real blockchain, real API, or broadcasts a real transaction.** `FakeBlockchainService` is the sole `IBlockchainService` implementation used under test, swappable via the same DI seam that wires in the real `LitecoinService`/`SolanaService`/`UsdtPolygonService` in production.
- **Supertest**: this bot has no public HTTP API — all user interaction is via the Discord gateway. The one legitimate HTTP surface is a minimal `/healthz` + `/readyz` server for container orchestration liveness/readiness checks (`src/infrastructure/http/healthServer.ts`), and that is the entirety of Supertest's role here (`tests/unit/infrastructure/healthServer.test.ts`) — it was deliberately not stretched further just to use the tool.

## Deploying

```bash
cp .env.example .env   # fill in real values, including POSTGRES_PASSWORD
npm run docker:up
```

This builds the bot image, starts Postgres, runs `prisma migrate deploy` once via a `migrate` service, then starts the bot — no manual database steps required beyond a filled-in `.env`.

## Admin commands

Every deal-related admin command takes an explicit **`deal_id`** option (the 6-digit ID shown in the ticket channel name and status embed) rather than inferring the deal from whichever channel the command happens to be run in — so these work from anywhere, and there's no risk of acting on the wrong deal because a command was typed in the wrong channel. All require either real Discord **Administrator** permission or a role listed in `ADMIN_ROLE_IDS`, and `resolveDealById` (`src/presentation/discord/commands/resolveDealById.ts`) returns a clear "no deal found" error for a bad ID rather than failing silently:

- `/freeze deal_id:<id>` — halts all further state changes/payouts (reason required, confirmation required); freezable from any non-terminal state, including a payout stuck in `PAYOUT_IN_PROGRESS`, and `/unfreeze` restores it to exactly that state to retry
- `/unfreeze deal_id:<id>` — restores the deal to the state it was frozen in
- `/release deal_id:<id>` — forces a release request on the buyer's behalf (seller must still confirm a payout address; buyer must still give final confirmation)
- `/refund deal_id:<id>` — refunds the buyer's confirmed deposit to a supplied address (reason + address required)
- `/cancel deal_id:<id>` — cancels a deal that has not yet received any funds
- `/override-payout deal_id:<id>` — **highest-risk action**: redirects payout to an address the seller never confirmed (reason + address required, extra-scrutiny confirmation copy)
- `/retry-payout deal_id:<id>` — re-attempts broadcasting a payout stuck in `PAYOUT_IN_PROGRESS` (e.g. the original broadcast failed and nothing retries it automatically); safe to retry since a prior successful send leaves the wallet empty, so a duplicate attempt simply fails with an insufficient-balance error instead of double-sending
- `/deal-info deal_id:<id>` — read-only status embed for a deal, viewable from anywhere
- `/balance currency:<LTC|SOL|USDT> address:<addr>` — read-only, checks the live on-chain balance of any address (not deal-specific — useful for spot-checking a deposit/fee wallet directly against the chain)
- `/transcript deal_id:<id>` — exports up to the last 500 messages of a deal's ticket channel as a downloadable `.txt` file
- `/close deal_id:<id>` — deletes a deal's ticket channel (confirmation required; extra warning if the deal isn't yet `COMPLETED`/`REFUNDED`/`CANCELLED`, since closing the channel doesn't change the deal's actual state or move any funds)
- `/stats` — read-only deal statistics for the whole server, not deal-specific (no confirmation step — moves nothing)
- `/add-deal-backup deal_id:<id> role:<buyer|seller> user:<@user>` — activates one of that party's own registered backup accounts (see below) so it can act as the buyer/seller on this specific deal; rejected if the user hasn't registered that account themselves first
- `/remove-deal-backup deal_id:<id> role:<buyer|seller>` — revokes whatever backup account is currently activated for that role on this deal

### Backup accounts

Any user can run `/backup-account add user:<@alt>` to register an alternate Discord account they control (`/backup-account list` / `/backup-account remove` manage the list). Registering one grants it nothing by itself — an admin must separately activate it on a specific deal with `/add-deal-backup`, and only for an account the real party already registered. Once activated, the backup account can request/confirm release or submit/confirm a payout address exactly as if it were the real buyer/seller, for that deal only (see `src/application/services/resolveActingDiscordId.ts`).

### Saved payout addresses

Run `/set-payout-address currency:<LTC|SOL|USDT> address:<your address>` to save a default payout address per currency (omit `address` to view what's currently saved for that currency). This is explicit-only — submitting an address on a deal never silently changes it, since a one-off address for a single deal isn't necessarily meant to become the standing default. Once set, the payout-address step on any deal in that currency offers a one-click "Use Saved Address" shortcut instead of retyping it, with a fallback to enter a different one.

Every command also re-checks the deal's current state via the domain state machine before acting (e.g. `/freeze` on an already-`COMPLETED` deal is rejected by `Deal.freeze()`'s own guard, not just a UI check) — see `src/domain/state-machine/DealStateMachine.ts`.

If `BUYER_COMPLETED_ROLE_ID` / `SELLER_COMPLETED_ROLE_ID` are set, those roles are assigned automatically to the buyer/seller the moment a deal reaches `COMPLETED` (`DiscordNotifier.awardCompletionRoles`). Leave them blank to skip this — nothing else depends on it.

## What this is not

This is a complete, working implementation of the specified architecture, ready for testing on small real amounts. It is not a substitute for: a professional security audit before scaling up, legal review of running a custodial escrow service in your jurisdiction, or load-testing before a large community rollout.
