# Wallet build log: assumptions and decisions made without prompting

This file records every judgment call the implementing agent made while
executing the two-tier wallet plan (PR #36 watch-only accounting layer, PR #127
full custody wallet stacked on it) so the maintainer can review, reverse, or
formalise each one. Entries are grouped by slice and dated. Product decisions
the maintainer already made are listed first as the fixed frame; everything
below them is an assumption.

## Fixed product decisions (from the maintainer)

- Two product levels on one `/#/wallet` hub: **watch-only budget/accounting
  integration on every tier**, and a **fully functional BitBudget wallet gated
  to Trial/Premium** built on top of it.
- The accounting layer imports **spends and receives** as transactions. A
  per-wallet setting controls whether receives count toward **Savings** or the
  wallet's **envelope balance directly**.
- Taproot-only; BitBudget is the only coordinator; platform passkey first with
  a backup cross-platform credential and a plain-English degraded-security
  opt-in; passphrase gate on the server co-sign (wrap Share A too only when a
  backup passkey is detected); client-side broadcast via the user's explorer;
  hot-wallet honesty on the sovereignty tab; mainnet only behind a server-only
  opt-in; share/credential migration in a later phase; Share C also stored in a
  password-manager secure note.
- The custody crypto on PR #36 (real FROST DKG/signing, PRF passkeys, encrypted
  co-signer share) is the one to keep. PR #127's stub MPC is discarded; its
  fintech UI is ported onto #36's primitives.

## Slice: PR #36 accounting layer (2026-09-10)

### A1. Receive destination default is Savings
`StoredWallet.receiveMode` defaults to `"savings"`. Rationale: matches how
every other external inflow enters the ledger (pay-yourself-first), and is the
least surprising choice for a user who has not thought about it. Reversible
per wallet via the Edit dialog.

### A2. v1 wallet blobs upgrade in memory, not by rewrite on load
`loadWallets()` fills `receiveMode: "savings"` for records missing it; the blob
is rewritten as v2 only on the next `saveWallets()`. No migration pass runs on
load, so a user who only reads never triggers a write. `WALLETS_BLOB_VERSION`
is 2; unknown `receiveMode` strings fall back to the default rather than
throwing.

### A3. No more "first available envelope" guess
Previously a wallet with no `defaultEnvelopeId` imported spends into whichever
envelope happened to be first in the list. That is a smart default overwriting
a choice the user never made. Now:
- the Add form requires a spending envelope;
- `runSync()` throws `Choose an envelope for this wallet before syncing.`
  before any network call when `importTransactions` is on and the envelope is
  unset;
- wallets migrated from v1 with a null envelope show an amber routing hint and
  an Edit button. Existing v1 users must pick an envelope once.

### A4. On-chain receives are cash inflows, not Monthly Income
`onchain_xpub` was added to `CASH_INFLOW_SOURCES` (dashboard cash-flow chart)
but **not** to `MONTHLY_INCOME_SOURCES`. Reasoning: the maintainer framed this
as an accounting layer where receives move balances; many receives are
transfers from the user's own exchange or another wallet and would inflate
"income", savings-goal math, and the setup guide's income task. If a user wants
a receive counted as income they can recategorise the row manually.

### A5. Transfers between the user's own wallets should not post as spend + receive
Added `otherWalletAddresses` to `runSync()` (used addresses of every other
watched wallet are treated as "mine" during classification) and a user-level
`txid` index in the IndexedDB cache (`hasImportedTxidAnyWallet`). A tx already
recorded by any wallet is recorded for the current wallet with
`bitbudgetTxnId: null` and never produces a second ledger row.

Known limitation, tested and documented in `xpub-sync.test.ts`: if wallet A is
synced before wallet B has ever been scanned, a move A→B posts as an expense
from A (B's addresses are unknown). B's later sync will not double-post a
credit, but the expense remains. Mitigation shipped: **Sync all** runs two
passes (scan-only for every wallet, then classify) so order no longer matters.
Per-wallet **Sync now** still uses whatever the cache knows. A future
improvement is to reclassify already-posted rows when a later scan reveals the
counterparty was the user's own wallet.

### A6. IndexedDB schema bump to v2 adds only an index
`openWalletDb` upgrades v1 databases by adding the `txid` index on the `txids`
store. No data is rewritten; no stores are dropped.

### A7. Custody creation is tier-gated at the route layer, not inside the provisioning module
`requireCustodyTier()` (`lib/wallet/server/tier.ts`) is called in the route
handlers for `POST /api/wallets`, `POST /api/wallets/[id]/dkg`, and passkey
**registration** options/verify. Reasons: keeps `startProvisioning` tests
free of subscription mocks, and keeps the gate visible next to the origin
check. `requirePremiumOrTrial` errors fail closed (treated as not allowed).

Not gated, on purpose: wallet **status**, **recovery** options/verify (finishing
an already-provisioned wallet's recovery proof), passkey **authentication**,
and `GET /api/wallets`. A lapsed subscription must never lock someone out of
recovering or exporting an existing wallet.

### A8. `custodyAllowed` is separate from `creationAvailable`
`GET /api/wallets` now returns both. `creationAvailable` is server readiness
(env, schema, WASM); `custodyAllowed` is the account's tier. The hub shows an
upgrade note when readiness is fine but tier is not. When `custodyAllowed` is
absent (older server), the hub does not lock, so the existing layout tests and
any staging server without the field keep working.

### A9. Upgrade copy is intentionally soft
"Creating a wallet is part of Premium. Wallet tracking above stays free, and
any wallet you already created here stays yours." No pricing, no link to a
billing page (none exists in the hub yet). Unfinished wallets are still listed
for free accounts with **Continue setup** disabled rather than hidden.

### A10. Hub overview restructured into two option cards
Replaced the single "Create wallet" CTA plus a bottom "Open external wallet
tracking" button with two side-by-side cards: **Track a wallet you already
have** (free) and **Create a BitBudget wallet** (Premium/Trial). The
"External wallet tracking" nav pill is unchanged. Hero copy was rewritten to
describe both levels; the test-network preview banner is retained.

### A11. Verification environment
The worktree's `node_modules` predated the branch and lacked
`@scure/btc-signer`; it was reinstalled from the lockfile. `wallet-mpc/pkg/`
(the Docker-built WASM) is not present in this worktree or the primary clone,
so the four suites that import it (`server-dkg`, `server-provisioning`,
`recovery-package`, `client-custody` via `mpc.ts`) could not run locally; all
other wallet suites (482 tests) pass. CI builds the WASM. One pre-existing
`tsc` error in `lib/wallet/server/dkg.ts` is a consequence of the missing
generated types and is not introduced by this slice.
