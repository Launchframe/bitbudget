# Bitcoin wallets (xpub integration)

BitBudget can ingest on-chain Bitcoin spending from one or more wallets the
user owns. Users provide an **xpub** (or `ypub`/`zpub`) per wallet; BitBudget
derives addresses, queries a block explorer, and writes resulting transactions
through the existing client-side encryption path so payee/notes are ciphertext
on the server.

This document covers the privacy contract, the architecture, configuration,
and the threat model. Operators and reviewers — read this whole file before
modifying anything in `lib/wallets/` or `components/bitcoin-wallets-card.tsx`.

---

## Privacy contract (must not be weakened)

| Asset | Where it lives | Touches BitBudget API? |
|---|---|---|
| Raw xpub | Memory + `localStorage` (encrypted at rest with the user's privacy key) | **Never** |
| Derived addresses | Memory + IndexedDB (`bitbudget-wallets-<userId>`) | **Never** |
| Address ↔ tx mapping | Same IndexedDB | **Never** |
| Wallet nickname / config (gap limit, default envelope, explorer URL) | Same encrypted blob | **Never** |
| Resulting BitBudget Transaction (payee/notes ciphertext, amount, date) | Server (Prisma) | Yes — payee/notes encrypted client-side first |
| `Transaction.source = "onchain_xpub"` | Server | Yes (provenance label only) |
| Block-explorer requests | Direct browser → user-chosen explorer | **Bypasses our backend entirely** |

There is **no server route that accepts an xpub, address, or txid.** Any such
route would be a privacy regression and is forbidden.

The single privacy trade-off the user accepts is documented in the Add-wallet
dialog: the chosen block explorer (default `mempool.space`, but **fully
overridable**) sees the user's IP correlated with the wallet's addresses. We
mitigate this with:

- A clear, plain-language warning in the Add-wallet dialog with an
  explicit acknowledgement checkbox before the form is shown.
- Per-wallet configurable `explorerBaseUrl`. Users with their own node
  (Umbrel, Esplora, Blockstream self-host, `.local`, `.onion`) get true
  end-to-end privacy.
- An in-app outbound allowlist: `EsploraClient` only fetches URLs whose
  origin matches the configured `baseUrl` for that wallet.
- An HTTP-scheme guard (`isAllowedExplorerBase`): plain `http://` is only
  accepted for loopback / `.local` / `.onion` / RFC1918. Public hosts must
  be `https://`.

---

## Architecture

```
┌────────────────────────────── Browser (client only) ─────────────────────────────────┐
│                                                                                       │
│   ┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐                │
│   │  Settings UI    │ ──► │   xpub-store    │     │   xpub-cache     │                │
│   │ (BitcoinWallets │     │ (localStorage,  │     │  (IndexedDB,     │                │
│   │  Card)          │     │  AES-GCM with   │     │   addresses +    │                │
│   │                 │     │  privacy key)   │     │   imported txids)│                │
│   └────────┬────────┘     └─────────────────┘     └──────────────────┘                │
│            │                                                                          │
│            │ runSync(wallet)                                                          │
│            ▼                                                                          │
│   ┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐                │
│   │   xpub-derive   │ ──► │    xpub-sync    │ ──► │  EsploraClient   │ ──► explorer  │
│   │ (HDKey, BIP44/  │     │ (gap-limit scan,│     │  (only the user- │     (mempool, │
│   │  BIP49/BIP84    │     │  net-delta math)│     │   configured     │      Esplora, │
│   │  address encode)│     │                 │     │   baseUrl)       │      Umbrel)  │
│   └─────────────────┘     └────────┬────────┘     └──────────────────┘                │
│                                    │                                                  │
│                                    │ POST /api/transactions  (payee/notes ciphertext) │
│                                    ▼                                                  │
└─────────────────────────────────── BitBudget API ─────────────────────────────────────┘
```

### Files

| Module | Responsibility |
|---|---|
| `lib/wallets/xpub-store.ts` | Encrypted-at-rest list of wallets in `localStorage`. Per-user blob `bitbudget-wallets-<userId>`. AES-GCM via `encryptField` using the unlocked privacy key. |
| `lib/wallets/xpub-cache.ts` | IndexedDB cache (`bitbudget-wallets-<userId>`) for derived addresses, imported-txid dedup index, and per-wallet sync watermarks. |
| `lib/wallets/xpub-derive.ts` | Pure derivation: parse xpub/ypub/zpub, detect kind from version bytes, encode P2PKH / P2SH-P2WPKH / native P2WPKH addresses. |
| `lib/wallets/esplora-client.ts` | Minimal typed client for Esplora-compatible APIs. Throttled, single in-flight per instance, abortable. `fetchImpl` is injectable for tests. Only ever talks to the configured `baseUrl`. |
| `lib/wallets/xpub-sync.ts` | Orchestrator: gap-limit scan both chains, compute net wallet delta per tx, classify as expense / credit / self-transfer, dedup against IndexedDB, write through `addTransaction`. |
| `components/bitcoin-wallets-card.tsx` | Settings UI: privacy-warning dialog → add-form → list with sync/remove. Gated by `state.opportunityCostEnabled`. |

### Wallet detection

Mainnet only. The 4-byte version prefix decoded from base58check determines
the wallet kind:

| Prefix | Hex | Kind | Address type | Address starts with |
|---|---|---|---|---|
| xpub | `0488b21e` | `bip44` | P2PKH | `1` |
| ypub | `049d7cb2` | `bip49` | P2SH-P2WPKH | `3` |
| zpub | `04b24746` | `bip84` | P2WPKH (native segwit v0) | `bc1q` |

Testnet (`tpub` / `upub` / `vpub`) and unknown prefixes are **rejected** —
silently treating an unknown key as `xpub` would mis-derive addresses and
fail the user with no observable cause.

### Sync algorithm

For each wallet:

1. Parse the xpub; assert the parsed kind matches the stored kind.
2. For each chain (0 = external/receive, 1 = change/internal):
   - Derive `m/<chain>/<i>` starting from the saved scan watermark minus
     `gapLimit` (first sync starts at 0). This re-checks the tail gap window
     for newly used addresses without rescanning the whole chain.
   - Query `GET /api/address/<addr>` to learn `tx_count + mempool_tx_count`.
   - If `> 0`, fetch all txs via `GET /api/address/<addr>/txs` (paginated).
   - Reset the consecutive-unused counter; mark the address as `used`.
   - If `= 0`, increment the consecutive-unused counter. Stop when it hits
     the wallet's `gapLimit` (default 20, configurable 1–200).
3. Build the set of "my" addresses (every used address across both chains).
4. For each unique txid (deduped across chains):
   - If it's a **pure self-transfer** (every input AND every output is mine):
     record the txid in the dedup cache and skip; no BitBudget transaction
     is created. The wallet only loses the network fee in these cases.
   - Otherwise compute `netSats = sum(my-vouts) − sum(my-prevout-vins)`.
     Positive → `credit`. Negative → `expense`. Zero → defensively skip.
   - Convert `|netSats|` to USD using `useBtcPrices().getPriceOnDate(date)`.
   - Build payload (payee `Bitcoin: <nickname>`, notes `On-chain tx <txid>`,
     `source: "onchain_xpub"`, explicit `satsAmount`, default envelope).
   - Call `addTransaction` (which encrypts payee/notes asymmetrically and
     POSTs to `/api/transactions`).
   - On success, record `(walletId, txid) → bitbudgetTxnId` in the dedup
     cache so re-runs are idempotent.
5. Persist the new scan watermarks + last sync timestamp.

Confirmation gating: only `status.confirmed === true` txs become BitBudget
transactions. Mempool/unconfirmed txs are observed for cache state but not
imported until they confirm — this avoids reorg ghosts.

---

## Configuration

### Default explorer

`https://mempool.space`. Esplora-compatible API endpoints used:

- `GET /api/blocks/tip/height`
- `GET /api/address/<address>`
- `GET /api/address/<address>/txs`
- `GET /api/address/<address>/txs/chain/<lastSeenTxid>` (pagination)

### Custom explorer / self-hosted node

The Add-wallet dialog has a **Block explorer URL** field. The validator
(`isAllowedExplorerBase`) accepts:

- Any `https://` URL with a non-empty host.
- `http://` only for the local-network and onion ranges:
  `localhost`, `127.0.0.1`, `::1`, `*.local`, `*.onion`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`.

Recommended self-hosted setups:

- **Umbrel / Start9**: `http://umbrel.local:3006` (LAN).
- **Esplora / Blockstream self-host**: `https://mempool.<your-domain>.com`.
- **Tor**: `http://<long-onion-hash>.onion` via Tor Browser.

### Gap limit

Default 20 (the BIP44-recommended value). Range 1–200. Increase if your
wallet has long stretches of unused receive addresses; decrease for faster
re-sync on small wallets.

---

## Threat model & known limitations

| Concern | Mitigation |
|---|---|
| Server learns wallet ↔ user link | Eliminated by design — server never sees xpub or addresses. |
| Server learns spending pattern | The encrypted `notes` field contains the txid; payee is `Bitcoin: <nickname>` (also encrypted). Amount/date/satsAmount are server-visible (same as Plaid imports). |
| Block explorer learns wallet ↔ IP | User-acknowledged. Mitigated by per-wallet custom explorer (own node / Tor). |
| XSS reading the encrypted xpub blob | The blob is opaque without the privacy key. We rely on the existing CSP-equivalent posture: `script-src 'self'`-style discipline (no `unsafe-inline`), dependency hygiene. |
| Multi-tab race writing to `localStorage` | All wallet writes use read → mutate → save inside one user action. The risk is restricted to "the last writer wins" within a single user session; data loss is bounded to the most recent un-saved change. |
| Reorg producing ghost transactions | We only import `status.confirmed === true`; unconfirmed mempool txs are excluded from BitBudget transactions. |
| Coinjoin / multi-party tx | We record the **net wallet delta** only; we do not attempt to interpret intent. |
| Self-transfers / consolidation | Skipped — recorded in dedup cache so we don't reconsider; not surfaced as spending. |

### Out of scope (v1)

- Lightning. (LNURL/LNDhub is a separate, much larger integration.)
- Coin-control / per-input categorization (one BitBudget tx per on-chain tx).
- Server-side periodic background sync — would require the server to know the
  xpub. Forbidden.
- Tor proxying inside the app. Users wanting Tor should use Tor Browser.

---

## Maintainer notes

- Any change to `xpub-sync.ts` MUST keep
  `lib/__tests__/wallets/xpub-sync.test.ts` "PRIVACY: sync only contacts the
  configured explorer" green. That test asserts no fetched URL contains the
  xpub, no API request body contains the xpub or any derived address, and
  every explorer-bound URL stays under the configured `baseUrl`.
- Address derivation is verified against the **official BIP84 test vector**
  in `lib/__tests__/wallets/xpub-derive.test.ts`. Do not lower this guard.
- The `TransactionSource` union and runtime guard in `lib/data.ts` keep the
  source enum exhaustive at compile time. New sources MUST be added in
  three places: the union, `TRANSACTION_SOURCES`, and the
  `Record<TransactionSource, …>` maps in `components/review-inbox.tsx`.
