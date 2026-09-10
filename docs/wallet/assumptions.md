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

## Slice: PR #127 full wallet on top of the accounting layer (2026-09-10)

### B1. Custody wallets are just another `WatchSource`
`runSync()` in `lib/wallets/xpub-sync.ts` now accepts a `WatchSource`
(`{ id, nickname, gapLimit, defaultEnvelopeId, receiveMode, explorerBaseUrl,
ledgerSource, deriveAddress(chain, index) }`) instead of only a `StoredWallet`.
Xpub wallets are adapted by `xpubWatchSource()`; custody wallets by
`openCustodyWatchSource()` (`lib/wallet/watch-source.ts`), which derives
addresses from the sealed watch seed and zeroes it on `dispose()`. Reasoning:
scanning, self-transfer netting, cross-wallet txid dedup, ledger routing and
the receive-mode setting are identical for both tiers; duplicating them was
the main reason #127 drifted from #36. Custody cache ids are namespaced
`custody:<walletId>` so they cannot collide with xpub ids.

### B2. New `TransactionSource` `"onchain_wallet"`
Rows imported from a BitBudget wallet carry `source: "onchain_wallet"`; xpub
rows keep `"onchain_xpub"`. Both are sat-native (`SAT_NATIVE_SOURCES` in the
transactions POST route), both count as cash inflows, neither counts as
Monthly Income (see A4). Review inbox label: "BitBudget wallet". Distinguishing
the two lets analytics and support tell "you spent from your wallet" from
"a wallet you only watch moved coins" without decrypting anything.

### B3. Wallet ledger settings are device-local and encrypted, not server-synced yet
`lib/wallet/ledger-settings.ts` stores `{ defaultEnvelopeId, receiveMode,
explorerBaseUrl, gapLimit, lastSyncAt }` per wallet in `localStorage`, encrypted
with the privacy key (`encryptField`/`decryptField`). The plan called for an
encrypted watch bundle synced via the server; that API is **not** in this slice.
Consequence: a user who opens the wallet on a second device must re-pick the
envelope and explorer there until the bundle sync lands. The watch seed
itself already lives in the recovery file and the custody IndexedDB record,
so nothing custodial depends on this.

### B4. Default explorer per network
mainnet `https://mempool.space`, signet `/signet`, testnet `/testnet`,
testnet4 `/testnet4`, regtest `http://127.0.0.1:3002`. The user can override
with any `https://` origin (or `http://` loopback). The explorer sees the
wallet's addresses; the Security tab says so. `mempool.space` is the default
because the existing xpub layer already uses it and it serves every network
the wallet supports.

### B5. Single-round-trip FROST co-sign protocol, device commits first
Serverless functions cannot hold FROST round-1 nonce state between requests,
so the protocol is:
1. browser plans and serialises the unsigned tx (`lib/wallet/spend-builder.ts`);
2. browser computes `spendRequestDigest` (`lib/wallet/spend-request.ts`), a
   domain-separated SHA-256 over account, wallet, network, lineage,
   sha256(tx), sha256(spent outputs) and every per-input tweak;
3. passkey authentication with `operation: "sign"` bound to `{ walletId,
   lineage, digest }` issues a single-use grant;
4. browser generates participant-1 nonces/commitments per input and POSTs
   `{ request, grantId, aCommitmentsHex[] }` to `/api/wallets/[id]/sign`;
5. server recomputes the digest, requires the matching grant, checks every
   spent `scriptPubKey` equals `5120 || tweaked child key`, **burns the grant and
   the device commitments** (`WalletNonceUse`), then generates its own nonces
   and returns `{ bCommitmentHex, bSignatureHex }` per input;
6. browser rebuilds each session with both commitments, signs, aggregates,
   verifies the Schnorr signature, finalises the witness and broadcasts via
   the user's explorer.

Nonces are never persisted on either side. Reusing existing `WalletGrant` /
`WalletNonceUse` tables means **no schema migration** for this slice. Known
trade-off: the server learns the device commitments before revealing its own
(the browser never sees B's commitment before committing), which is the
correct direction for a co-signer that must not be tricked into signing with
an adaptively chosen counterpart nonce.

### B6. Spend limits and coin selection
`MAX_SPEND_INPUTS = 40` keeps the worst-case commit body under the 32 KiB
wallet API limit. Coin selection (`selectCoins`): confirmed coins first;
prefer spending change-branch coins alone when they cover the amount (they
are already linked to prior spends, so this avoids merging fresh receive
addresses with change); otherwise largest-first. Change below 330 sats (P2TR
dust) is absorbed into the fee and shown as such. Fee rate is clamped to
1–2000 sat/vB; a fee above 50% of the amount **and** above 10 000 sats is a
`fee-too-high` planning error. The fee estimate comes from the explorer
(`/api/fee-estimates`, target 3 blocks, fallback 2 sat/vB). None of these
constants are user-configurable yet.

### B7. Change address reservation happens at confirm, not preview
Preview derives the *next* change address without reserving it; Confirm
reserves it via `reserveAddressIndices(walletId, "change", 1)` and aborts if
the reserved index differs from the previewed one (another tab reserved in
between). Change outputs are system-labelled and shown with an orange
"Change" pill in Receive/Activity. Toxic-change coin selection (B6) is the
first pass at the maintainer's toxic-change-aware requirement; there is no
per-coin freeze UI yet.

### B8. Signing is sha256d-only in the UI for now
The send pane always passes `lineage: "sha256d"`. The dual-lineage machinery
(`blake2b` lineage, replay-output markers, indexer connection) stays intact
underneath, but the Send tab does not expose a lineage choice until a
Blake2b-side indexer is actually connected; a placeholder toggle would be
pretend readiness.

### B9. Tier gate covers the co-sign path too
`requireCustodyTier` now guards `POST /api/wallets/[id]/sign` and the passkey
authentication options/verify routes **only when `operation === "sign"`**.
Unlock/export authentication, status, recovery and `GET /api/wallets` remain
ungated (A7): a lapsed subscription blocks new spends through BitBudget's
co-signer but never blocks recovery or export.

### B10. Deferred from this slice, with reasons
- **Backup cross-platform passkey / platform-first enrolment / passkey
  replace flow (P0):** needs a second `WalletCredential` per wallet and a
  re-wrap of Share A for the new PRF output. Not started; the existing single
  PRF credential path is unchanged. Product decision (platform first, plain-
  English degraded-security opt-in) stands as the target.
- **B+C lost-device recovery and new-device enrolment:** requires a server flow
  that re-shares to a fresh device without ever holding two shares at once.
  Design intent: the recovery file (C) plus a fresh passkey on the new device
  run a *re-DKG* with the server (B) as the second honest participant; the old
  A share is revoked by rotating the group key. Not built; the Security tab
  says recovery currently means "import the recovery file into a wallet that
  supports it".
- **Lineage-isolation evidence for `evaluateTransactionIsolation`:** still
  policy-only. The single-lineage coin evidence check shipped instead (B12);
  a Blake2b-side indexer is a prerequisite for the isolation validator and
  none is connected yet.
- **Encrypted watch bundle API:** see B3.
- **Passphrase gate on server co-sign:** the maintainer's decision is recorded;
  this slice gates co-signing on the passkey grant only. Adding the
  passphrase (and wrapping Share A when a backup passkey exists) fits behind
  the same `operation: "sign"` grant without protocol changes.

### B12. Coin evidence is re-checked before approval and again before broadcast
`lib/wallet/spend-evidence.ts` runs inside `executeSpend` before the passkey
prompt: for every planned input it asks the user's explorer whether the
outpoint is still unspent for that address, requires a confirmation (the
planner only spends confirmed coins), then fetches the **raw previous
transaction** and decodes vout locally so the amount and scriptPubKey come
from transaction bytes rather than an index entry. The chain tip is recorded;
right before broadcast the tip is re-read and, if it moved or the evidence is
older than ten minutes, the unspent check runs again. Any failure refuses the
spend with a specific code (`input-spent`, `amount-mismatch`,
`script-mismatch`, `unconfirmed-input`, `evidence-stale`,
`indexer-unavailable`) and plain-language copy in the Send tab; nothing
degrades to a warning. The `verifyEvidence: false` switch exists only for
WASM test harnesses that stub the indexer.

What this is not: it trusts the single configured explorer (a lying explorer
can still hide a spend), and it says nothing about lineage isolation. The
server co-signer does not independently consult an indexer — it verifies
structure and script ownership only (B5). A server-side indexer for
independent amount/ancestry verification is the natural follow-up and would
need its own env configuration.

### B11. Verification environment for this slice
Same constraints as A11: `wallet-mpc/pkg/` is absent locally (Docker down,
Apple clang lacks a wasm32 target; the agent did not start Docker on its own).
Everything that imports the WASM core (`lib/wallet/spend-session.ts`,
`lib/wallet/server/signing.ts`, `server/dkg.ts`) type-checks with the core as
`any` and is exercised only in CI. `lib/__tests__/wallet/spend-signing.test.ts`
mocks the core's public-package derivation with the real HMAC tweak math and
covers digest binding, schema limits, grant⇄digest rejection, spent-output
mismatch (before the grant is burned), legacy-derivation refusal, and the
burn-before-sign order. `spend-builder.test.ts` covers coin selection, fee,
dust absorption and serialisation round-trips. No real signet spend has been
executed by the agent; the Send tab should be treated as unverified end-to-end
until a maintainer runs one on signet with a locally built WASM.

**Correction to A11/B11 "CI builds the WASM":** it does not. Both GitHub
workflows (`lint.yml`, `test.yml`) are `workflow_dispatch` only and neither
builds `wallet-mpc/pkg`; the only automatic check on these PRs is the Vercel
preview build, which fails on **#36 and #127 alike** with
`Module not found: '@/wallet-mpc/pkg/wallet_mpc.js'` (pre-existing, not
introduced by this slice — `creation-session.ts` and `server/mpc.ts` fail the
same way). Until the WASM artifact is produced in the build step, the
WASM-dependent modules are verified only by a maintainer running
`pnpm wallet-mpc:build && pnpm wallet:test:core` locally.
