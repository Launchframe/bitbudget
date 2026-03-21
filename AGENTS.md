# AGENTS.md — BitBudget

## Core Ethos

BitBudget is a **privacy-first, user-sovereign budgeting app**. Every change must uphold these principles:

- **User data is theirs alone.** Transaction details (payee, notes) are encrypted client-side before touching the server. The server stores ciphertext it cannot read. Encryption keys are never logged, transmitted in plaintext, or stored unencrypted on the backend.
- **Nostr users never share their nsec.** The app uses the browser extension (nos2x, Alby, Keys.band) for signing and NIP-04 encryption. The server only stores the npub.
- **Web 2.0 users derive keys from a PIN/password.** The derived key wraps a random privacy key via PBKDF2 + AES-GCM. The encrypted privacy key is stored server-side; only the client can unwrap it.
- **Backend-created transactions** (Plaid, email forwarding, SMS) encrypt sensitive fields with the user's public key (X25519 + XSalsa20-Poly1305). Only the client holding the private key can decrypt.
- **No ad-tech or cross-site tracking.** We use privacy-preserving, aggregate Vercel Analytics for basic usage and performance telemetry; no budgeting data or user identifiers are logged.

If a change would cause sensitive data to be logged, stored in plaintext, or readable by the server, **stop and redesign**.

## Project Structure

```
app/                     Next.js App Router pages and API routes
  api/                   REST endpoints (auth check → prisma → response)
  auth/                  Authentication page
  landing/               Bitcoin-focused landing page
  welcome/               Vanilla budgeting landing page
  onboarding/            Multi-step onboarding wizard
  admin/                 Admin dashboard (gated by isAdmin)
components/              React client components (all "use client")
lib/                     Shared logic — types, crypto, contexts, helpers
  app-context.tsx        Global state provider (single React context)
  btc-price-context.tsx  BTC price data provider (separate context)
  crypto.ts              Client-side E2E encryption (PBKDF2, AES-GCM, NaCl)
  data.ts                Core type definitions and formatting utilities
  constants.ts           Shared constants (used by both client and server)
prisma/                  Schema, migrations, seeds
public/                  Static assets (icons, onboarding screenshots)
styles/                  Tailwind globals
```

## Tech Stack

- **Framework:** Next.js (App Router), React, TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Auth:** Auth.js v5 (NextAuth) — Credentials, Google, GitHub, Nostr, Email OTP
- **ORM:** Prisma (PostgreSQL in prod via Neon/Vercel, SQLite locally)
- **Package manager:** pnpm
- **Runtime:** Node.js ≥ 20
- **Testing:** Vitest (unit), Playwright (e2e)
- **CI:** GitHub Actions — lint + test on PRs and pushes to main

## Code Conventions

### Imports
- Keep imports at the top of every file. No inline `import()` inside functions or render bodies.
- Use `@/` path aliases (`@/lib/...`, `@/components/...`).

### Components
- Components that use React hooks, local state, or browser-only APIs must be client components (include the `"use client"` directive at the top of the file). Purely presentational components that don't rely on client-only features can be server components.
- Page-level components live in `components/` (e.g. `dashboard-page.tsx`, `transactions-page.tsx`).
- The app uses hash-based routing managed by `AppContext` (`navigateTo`, `currentPage`), not the Next.js file-based router, for in-app navigation after auth.
- `app/page.tsx` is the shell: `OnboardingGate → AppProvider → EncryptionGate → BtcPriceProvider → layout`.

### State Management
- `AppContext` (`lib/app-context.tsx`) is the single source of truth for app state. It holds transactions, envelopes, tags, user settings, encryption state, and navigation.
- Prefer optimistic UI updates (update local state immediately, then fire the API call) with rollback on failure.
- `BtcPriceContext` is a separate provider for BTC price data. `useBtcPrices()` **should** be called within `BtcPriceProvider`. If it runs outside the provider (e.g. vanilla mode or a missing wrapper), it returns **`NOOP_PRICES`** (zeros / no-op helpers) and logs a **dev-time warning** — it does not throw. Still wrap components that need real BTC data in `BtcPriceProvider` when `opportunityCostEnabled` is on.

### React effects and `setState` (`react-hooks/set-state-in-effect`)

ESLint flags **calling `setState` synchronously inside `useEffect` or `useLayoutEffect`** (including via helpers that set state in the same tick as the effect runs). The goal is to avoid **effects whose only job is to copy props/other state into local state**, which tends to cause extra render passes, harder-to-follow data flow, and sometimes **cascading updates** (effect → setState → render → effect → …) or tight loops in Strict Mode.

**Prefer (in order):**

1. **Derive during render** — If UI can be computed from props + existing state, compute it in the render body instead of mirroring into state in an effect. For “draft” values that diverge from props, use an **overrides map** (or similar): keep only user edits in state; the displayed value is `overrides[id] ?? propValue`, so you never need a sync effect when props change.
2. **User-driven updates** — Set state in event handlers (`onClick`, `onChange`, etc.). No lint issue; the rule targets effect bodies specifically.
3. **Defer when you must measure the DOM then update** — If you need `getBoundingClientRect()`, `ResizeObserver`, etc., schedule the `setState` **outside** the synchronous effect body so the linter is satisfied and you avoid stacking updates in the same commit:
   - `requestAnimationFrame(() => { … setState(…) })` (good for layout/position after paint)
   - `setTimeout(() => { … setState(…) }, 0)` (macrotask; allows paint before heavy work)
  - Nested `requestAnimationFrame` when a second pass needs measured node size after the first paint (e.g. walkthrough tooltip positioning).
 4. **Refs for non-render values** — If a value does not need to trigger a re-render, store it in `useRef` instead of `useState` + effect.

**Avoid:** `useLayoutEffect(() => { setX(…); })` with no deferral — fix by one of the patterns above. **Examples in this repo:** `components/walkthrough-overlay.tsx` (deferred `positionTooltip` / `setTooltipPos` via nested `requestAnimationFrame`), `components/envelope-allocations-page.tsx` (draft allotments via overrides, no sync-from-props effect).

### TypeScript
- Use exhaustive `switch` handling for union types and enums (use `default` with a `never` assertion or handle all cases explicitly).
- Prefer `interface` for object shapes in `lib/data.ts`; use `type` for unions and aliases.

### Styling
- Dark theme only. Background: `#0D0D0D`, cards: `bg-[#0D0D0D] rounded-2xl`.
- Accent color: `#F7931A` (Bitcoin orange), used for CTAs, active states, and BTC-related highlights.
- Success/credit color: `#22C55E`. Blue accent: `#3B82F6`.
- BTC numeric values use `font-ibm-plex-mono` class for monospace rendering.
- Mobile-first responsive design. Use Tailwind breakpoints (`sm:`, `md:`, `lg:`).

### API Routes
- Every **user-scoped** API route starts with `const session = await auth()` and returns 401 if unauthenticated.
- All **user-scoped** Prisma queries filter by `userId: session.user.id` — never trust the client to scope user data.
- Non–user-scoped routes (webhooks, cron jobs, health checks) must use appropriate verification (shared secret, signature, or IP allowlist) instead of user sessions, and be reviewed carefully before accessing or mutating data.
- Validate all input fields explicitly (type, range, format). Do not trust client payloads.
- Use `NextResponse.json()` for all responses. Return appropriate HTTP status codes.
- Parse JSON fields (like `tags`) defensively with try/catch — database rows may contain malformed data from older versions.

### Database
- Prisma schema is the source of truth. All schema changes require a migration.
- Migrations must be **idempotent** (`ADD COLUMN IF NOT EXISTS`, etc.) to survive re-runs during deployment.
- After changing `schema.prisma`, always run `pnpm prisma generate` before testing types.
- Use `cuid()` for IDs. Dates are stored as `DateTime` and formatted as `YYYY-MM-DD` strings at the API boundary.

## Feature Gating: Opportunity Cost

Bitcoin/sats/opportunity-cost features are controlled by `User.opportunityCostEnabled` (default `false`). New users get it from **entry point**: `/welcome` or app shell `/` → off; `/landing` → on. **Premium** users can change it in Settings; free users do not see that control.

When this flag is off, the app is a **vanilla budgeting tool** — no Bitcoin mentions anywhere:

- Sidebar: BTC Price nav item hidden
- Dashboard: chart shows "Your Expenses" (cumulative spent, single line, no BTC data dependency); `RecentTransactions` replaces `TopOpportunityCosts`
- Dashboard metrics: only Monthly Income + Monthly Spend tiles
- Analytics: Opportunity Cost bar chart hidden
- Transaction tables: Amount (sats) and Opportunity Cost columns hidden
- Transaction detail dialog: BTC section hidden
- Settings: Opportunity Cost + BTC Display toggles hidden for free tier (premium-only)
- Favicon: switches dynamically between Bitcoin icon and vanilla envelope icon

When adding **any** Bitcoin, sats, or opportunity-cost content, wrap it with `state.opportunityCostEnabled`. The vanilla experience must be completely clean of BTC references.

Onboarding no longer has a separate opportunity-cost step; the flag is saved from `sessionStorage` `onboardingSource` (`btc` from `/landing`, otherwise vanilla). Premium users toggle in Settings.

## Encryption Rules

These are **non-negotiable**:

- `Transaction.payee` and `Transaction.notes` are **always encrypted** at the client before storage.
- CSV import parses and encrypts on the client side before sending to the server.
- Backend-sourced transactions (Plaid, email, SMS) encrypt sensitive fields using the user's public key via `lib/server-encrypt.ts`. These arrive as `PendingTransaction` for client-side review and decryption.
- Never add `console.log` or logging that would print decrypted user data, encryption keys, PINs, or passwords.
- The `encryptForStorage` function in `AppContext` and the `decryptFieldAsymmetric` helper used in refresh/add flows are the canonical entry points for client-side encryption and decryption.

## Privacy key custody & safeguard (expected behavior)

**Goal:** The server must never be able to decrypt user transaction fields. The **privacy key** (NaCl seed) lives only on the client; the server may store a **wrapped** copy (`User.encryptedPrivacyKey`, optional `User.privacyKeySalt` for passphrase users). Nostr accounts may also have `User.nostrPubkey`; the wrap can be NIP-04 to that pubkey or PIN-derived AES for nsec-fallback.

### `POST /api/user/encryption` — no silent overwrites

Implementation: `app/api/user/encryption/route.ts`.

- If `encryptedPrivacyKey` is already **non-empty**, the handler returns **409** with `ENCRYPTION_ALREADY_CONFIGURED` and does **not** replace the blob. This applies to **both** email/passphrase and Nostr-linked accounts (the check is before Nostr-specific branching).
- Updates use `updateMany` with `emptyKeyWhere`: only rows where `encryptedPrivacyKey` is **null or `""`** can be written. First-time setup only.
- **Do not** weaken these guards for “convenience.” Accidental re-onboarding or a bug that shows **Secure Your Data** again must **not** rotate keys through this route.

| Situation | Server replaces existing wrapped key? |
|-----------|--------------------------------------|
| User already has non-empty `encryptedPrivacyKey`; onboarding/security UI submits again | **No** — 409 |
| Nostr extension user wrongly submits PIN/passphrase on a security screen | **No** — same 409 if a key exists |
| `encryptedPrivacyKey` is **null/empty** (setup never completed) | **Yes** — first successful POST may set it (by design) |
| `encryptedPrivacyKey` is **corrupt** (non-empty garbage) | **No** in-app fix via this route; user is stuck until **recovery** (below) |

### Session vs server

- Client caches the raw privacy key hex in `sessionStorage` (`bitbudget-privacy-key`) when appropriate; import and other flows may re-hydrate via NIP-04 decrypt using the extension (`lib/resolve-import-encrypt-fn.ts`, `lib/app-context.tsx`). Stale keys: clear when `userId` mismatches.
- Losing session storage does **not** mean losing the account if the wrapped key on the server is valid and the user can still decrypt (passphrase / NIP-04).

### Recovery (product direction — not fully built)

If keys are **lost** or **mismatched** (undecryptable blob), the generic onboarding `POST` must **not** be the fix.

1. **Destructive reset** — After strong identity proof (email OTP, Nostr-signed challenge, etc.), ops or a dedicated endpoint clears `encryptedPrivacyKey` / `privacyKeySalt` and runs a **single** controlled re-setup flow. **All existing server ciphertext** for that user tied to the old privacy key becomes **unreadable**; UX must state that clearly.
2. **Re-key / rotate (non-destructive)** — User proves identity, then in-session: decrypt with old key, generate new privacy key, re-wrap for server, **batch re-encrypt** all encrypted fields (or a background job). Preserves data; heavier to build.
3. **Support / admin** — Manual repair (wrong `nostrPubkey` vs ciphertext), restore from backup, or reset flags **only** with explicit user consent.

When designing new endpoints, **never** allow replacing `encryptedPrivacyKey` without explicit recovery semantics and user understanding of data loss or migration.

## Envelope Archiving

Deleting an envelope **archives** it (`archived: true`). Archived envelopes and their transactions are filtered out of active views via `activeEnvelopes` and `activeTransactions` in `AppContext`. Users can view, restore, or permanently delete archived envelopes from the Envelopes page.

## Commit and PR Workflow

- **Commit often.** Each logical unit of work (a bug fix, a feature slice, a refactor) gets its own commit. Don't batch unrelated changes.
- **Commit messages** should be concise and describe the "what" and "why": `fix(receipts): validate file type from magic bytes, not Content-Type` or `feat: add vanilla "Your Expenses" chart for non-OC users`.
- **Run `pnpm lint` and `pnpm test` before pushing.** CI enforces both on PRs.
- **PR descriptions** should have a Summary (bullet points of what changed) and a Test Plan (checkboxes).
- **Never force-push to main.**
- **Database migrations** should be committed alongside the schema change and the code that uses the new field.

## Common Pitfalls

- **Adding a Prisma field but forgetting `pnpm prisma generate`** — TypeScript won't see the new field until the client is regenerated.
- **Calling `useBtcPrices()` outside `BtcPriceProvider`** — the hook returns **`NOOP_PRICES`** and warns in development; it does not throw. Real prices and OC math need `BtcPriceProvider`; gate Bitcoin UI with `state.opportunityCostEnabled` so vanilla mode does not depend on live BTC data.
- **Forgetting to encrypt a new sensitive field** — if you add a field to `Transaction` that contains user-identifiable data, it must be encrypted client-side before storage.
- **Non-idempotent migrations** — `ALTER TABLE ... ADD COLUMN` will fail on re-deploy if the column already exists. Always use `IF NOT EXISTS`.
- **Stale encryption keys** — switching accounts or clearing data can leave cached keys in `sessionStorage`. The `EncryptionGate` and `PinUnlockDialog` handle re-prompting; don't bypass them.
- **`POST /api/user/encryption` and existing keys** — see **Privacy key custody & safeguard**; 409 prevents overwrites. Onboarding must handle 409 in `handleSecuritySetup`. Nostr nsec storage: intent `bitbudget-nsec-onboarding-intent`, pending hex `bitbudget-pending-nsec`, encrypted blob `bitbudget-nsec` (JSON iv+ciphertext); logout clears these via `clearPendingNsec` / `clearNsecOnboardingIntent` / localStorage.
- **`colSpan` mismatch** — when conditionally rendering table columns (e.g. hiding BTC columns in vanilla mode), update the empty-state row's `colSpan` accordingly.
- **`react-hooks/set-state-in-effect`** — don’t call `setState` synchronously inside `useEffect` / `useLayoutEffect`; it triggers lint and risks extra renders or cascading updates. See **React effects and `setState`** under Code Conventions for patterns (derive during render, defer with `requestAnimationFrame` / `setTimeout(0)`, refs).
- **Resetting `onboardingComplete` for users who already have `encryptedPrivacyKey`** — never rely on onboarding to rotate keys. `PUT /api/user/settings` must not accept `encryptedPrivacyKey` / `privacyKeySalt`. Prefer **Skip onboarding** and correct step routing; corrupt keys need a **recovery** path, not a silent `POST` overwrite.
