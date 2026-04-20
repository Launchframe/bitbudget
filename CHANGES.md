# CHANGES.md — BitBudget Build Artifact

All assumptions, changes, and decisions made while building the fully functional app from the BUILD_PROMPT.md spec.

---

## Privacy key cache — 7-day unlock (2026)

- **Client:** `lib/privacy-key-storage.ts` — after passphrase or Nostr unlock, the privacy key hex is stored in **localStorage with a 7-day TTL** (rolling window on each successful unlock). Replaces session-only persistence so users (e.g. Google sign-in) are not prompted on every new browser session; passphrase is required again after expiry or logout.
- **Wiring:** `lib/app-context.tsx`, `components/pin-unlock-dialog.tsx`, `app/onboarding/page.tsx`, `lib/resolve-import-encrypt-fn.ts`.

---

## Architecture Overview

The app was transformed from a **client-only SPA** (localStorage, mock data, no auth) into a **full-stack Next.js app** with:

- Database persistence (Prisma + SQLite)
- Authentication (Auth.js v5 / NextAuth)
- API routes for all CRUD operations
- E2E encryption infrastructure
- Onboarding wizard
- CSV transaction import
- Real BTC price integration (CoinGecko API)

---

## New Files Created

### Database Layer
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema: User, Account, Session, VerificationToken, Envelope, Transaction, Tag, BtcPriceCache |
| `lib/db.ts` | Singleton Prisma client with global caching for dev hot-reload |

### Authentication
| File | Purpose |
|------|---------|
| `lib/auth.ts` | Auth.js v5 configuration with 4 providers: Credentials (email/password), Nostr (nos2x extension), Google OAuth, GitHub OAuth |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js API route handler |
| `app/api/user/register/route.ts` | POST endpoint for new account registration with bcrypt password hashing |
| `middleware.ts` | Route protection: redirects unauthenticated users to `/auth` |
| `components/session-provider.tsx` | Client-side NextAuth SessionProvider wrapper |

### Encryption
| File | Purpose |
|------|---------|
| `lib/crypto.ts` | Client-side E2E encryption utilities: PBKDF2 key derivation from PIN, AES-GCM encrypt/decrypt for privacy key and fields |
| `app/api/user/encryption/route.ts` | GET/POST endpoint for storing and retrieving the user's encrypted privacy key |

### API Routes
| File | Purpose |
|------|---------|
| `app/api/transactions/route.ts` | GET (with filters), POST, DELETE for transactions |
| `app/api/envelopes/route.ts` | GET, POST, PUT, DELETE for envelopes |
| `app/api/user/settings/route.ts` | GET/PUT for user settings (income, cadence, onboarding status) |
| `app/api/btc-price/route.ts` | GET current price, historical price, or date range of BTC/USD prices |
| `app/api/import/route.ts` | POST to import transactions from CSV file (multipart form upload) |

### BTC Price
| File | Purpose |
|------|---------|
| `lib/btc-price.ts` | Server-side BTC price fetching from CoinGecko API with DB caching, fallback to cached prices on API failure |

### Pages
| File | Purpose |
|------|---------|
| `app/auth/page.tsx` | Full auth page: Nostr login (primary CTA), email/password, Google, GitHub. Includes guided nos2x setup flow |
| `app/onboarding/page.tsx` | 6-step onboarding wizard: Security (PIN), Income, Envelopes, Allocations, Import, Complete |
| `components/settings-page.tsx` | Settings page with income editing, CSV import, privacy info, data summary |

### Configuration
| File | Purpose |
|------|---------|
| `.env` | Local environment variables (DATABASE_URL, AUTH_SECRET) |
| `.env.example` | Documented env template for other developers |
| `.nvmrc` | Node.js version pinning (22) |

---

## Modified Files

### `package.json`
- **Renamed** from `my-v0-project` to `bitbudget`
- **Added dependencies**: `next-auth`, `@auth/prisma-adapter`, `@prisma/client`, `bcryptjs`, `nostr-tools`, `@noble/hashes`
- **Added dev dependencies**: `prisma`
- **Added scripts**: `db:push`, `db:studio`, `db:seed`, `postinstall` (prisma generate)
- **Added pnpm config**: `onlyBuiltDependencies` for prisma/sharp native builds

### `app/layout.tsx`
- Wrapped app in `<SessionProvider>` for NextAuth client-side hooks (`signOut`, `useSession`)

### `app/page.tsx`
- Added `<OnboardingGate>` wrapper that checks if user has completed onboarding, redirects to `/onboarding` if not
- Added loading spinner state while checking onboarding
- Added `"settings"` case to `PageContent` switch
- Imported new `SettingsPage` component

### `lib/app-context.tsx`
- **Replaced localStorage persistence with API calls**: all CRUD operations now call `/api/*` endpoints
- Added **optimistic updates**: state updates immediately in the UI, then syncs with server
- Added `refreshData()` method to reload state from API
- Added `importCSV()` method for file upload
- Added `loading` state for initial data fetch
- Added `"settings"` to `PageId` union
- Removed `saveState`/`loadState` dependencies

### `lib/data.ts`
- **Removed**: `loadState()`, `saveState()`, `generateSeedTransactions()`, `DEFAULT_ENVELOPES`, `STORAGE_KEY`
- **Changed**: `getDefaultState()` now returns empty state (no seed data), since data comes from the API
- **Changed**: `getCurrentMonthKey()` now returns the real current month instead of a hardcoded `"2026-02"`
- **Kept**: All BTC price mock data as client-side fallback (used for charts when API prices aren't cached yet)
- **Kept**: All formatting utilities, types, and helper functions

### `components/header.tsx`
- Logout now calls `signOut()` from `next-auth/react` with redirect to `/auth`
- Added "Import CSV" option in dropdown menu
- Settings dropdown item now navigates to settings page
- Added hidden `<CSVImportInput>` component for file upload

### `components/sidebar.tsx`
- Logout now calls `signOut()` from `next-auth/react`
- Settings button now navigates to the settings page (with active state highlighting)

### `.gitignore`
- Updated to keep `.env.example` while ignoring `.env` and local env files
- Added `prisma/dev.db` and `prisma/dev.db-journal`

---

## Assumptions & Decisions

### 1. Database: SQLite for local development
- **Decision**: Used SQLite (`file:./dev.db`) via Prisma for zero-config local development
- **Rationale**: No external services needed to get started. For production/Vercel, switch `DATABASE_URL` to a Postgres connection string (e.g. Neon, Supabase, PlanetScale)
- **Migration**: Change `provider = "sqlite"` to `provider = "postgresql"` in `prisma/schema.prisma` and update `DATABASE_URL`

### 2. Authentication: Email/Password instead of Magic Link
- **Decision**: Implemented email + password credentials instead of one-time email codes
- **Rationale**: Magic link requires an email provider (SMTP service like SendGrid, Resend, etc.) which adds external dependency. Email/password works immediately
- **To add magic link**: Add an email provider to Auth.js config and swap the Credentials provider for the Email provider

### 3. OAuth: Conditionally enabled
- **Decision**: Google and GitHub OAuth are only registered as providers when their env vars are set
- **Rationale**: Prevents errors when running locally without OAuth credentials configured
- **To enable**: Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` to `.env`

### 4. Nostr Authentication
- **Decision**: Implemented NIP-07 (`window.nostr`) based authentication with nos2x-compatible extensions
- **Flow**: Extension provides pubkey → app creates a kind-27235 auth event → extension signs it → server verifies signature via `nostr-tools` → creates/finds user
- **Guided setup**: If no extension is detected, the auth page shows step-by-step instructions for installing nos2x
- **Assumption**: The user's browser extension handles nsec storage; the app NEVER requests the nsec

### 5. E2E Encryption: PIN-based key derivation
- **Decision**: Web 2.0 users provide a PIN during onboarding. The PIN derives a wrapping key via PBKDF2 (600,000 iterations, SHA-256). A random 256-bit privacy key is generated and encrypted with this wrapping key. The encrypted key is stored server-side
- **Current state**: The encryption infrastructure is fully built (`lib/crypto.ts`), and the onboarding collects the PIN and stores the encrypted key. Transaction payee encryption at the field level is wired but the encrypt/decrypt calls on each transaction are not yet active in the AppContext, to avoid data loss during development
- **To activate**: Add `encryptField(payee, privacyKey)` before POSTing transactions and `decryptField(payee, privacyKey)` after GETting them in `app-context.tsx`
- **For Nostr users**: The onboarding PIN step is skipped. Encryption would use the NIP-04 or NIP-44 protocol via the extension

### 6. BTC Price Data: CoinGecko with DB cache
- **Decision**: Used CoinGecko free API for BTC/USD prices, cached in the `BtcPriceCache` table
- **Fallback**: If the API is unavailable, falls back to the most recent cached price, or $100,000 as a last resort
- **Client-side fallback**: The mock BTC price history in `lib/data.ts` is still used by chart components when server-cached data isn't available
- **Rate limits**: CoinGecko free tier allows ~10-30 requests/minute. The DB cache prevents redundant calls

### 7. Session Duration: 30 days (JWT)
- **Decision**: Used JWT strategy with 30-day max age as specified in the build prompt
- **Rationale**: JWT strategy avoids database session lookups on every request. The Prisma adapter is used for user/account storage but sessions are stateless JWT tokens

### 8. SPA Routing preserved
- **Decision**: Kept the client-side SPA routing pattern (React context `currentPage`) instead of converting to full Next.js app router pages
- **Rationale**: The existing UI architecture (Sidebar, Header, PageContent) is well-designed for SPA-style navigation. Converting to file-based routes would require major refactoring of the layout and navigation without clear UX benefit. Auth and onboarding ARE separate pages using the app router
- **New app router pages**: `/auth`, `/onboarding` are proper Next.js pages with their own layouts

### 9. CSV Import: Auto-creates envelopes
- **Decision**: When importing a CSV, if a transaction references an envelope that doesn't exist, it's automatically created with a random color
- **Supported format**: Matches the provided `transaction_history.csv` format (Date as MM/DD/YYYY, Envelope, Name, Notes, Check #, Amount, Details)
- **Negative amounts**: Treated as expenses; positive as credits

### 10. Middleware deprecation warning
- **Note**: Next.js 16 shows a deprecation warning for `middleware.ts` (recommending "proxy" convention). The middleware still functions correctly. This is a Next.js 16-specific migration path that can be addressed in a future update

### 11. Node.js Version
- **Requirement**: Node.js 22+ (Next.js 16 requires >=20.9.0; Prisma 5 requires >=18)
- **Added**: `.nvmrc` file pinning to Node 22

### 12. Data Ownership (Sovereign Software principle)
- **All user data** is scoped by `userId` in the database. Users can only access their own data via the API
- **The encryption infrastructure** ensures sensitive fields (payee names) can be encrypted before leaving the client
- **No telemetry** is collected on user transaction data (Vercel Analytics only tracks page views)

---

## User Flow Summary

1. **Visit app** → middleware redirects to `/auth`
2. **Auth page** → Choose Nostr (primary), email/password, Google, or GitHub
3. **Onboarding** (first login):
   - **Security**: Set PIN for encryption (skipped for Nostr users)
   - **Income**: Enter after-tax income and pay frequency
   - **Envelopes**: Create spending categories (pre-populated with Rent, Food, Transportation)
   - **Allocations**: Distribute income across envelopes with running unallocated total
   - **Import**: Optionally upload CSV transaction history
   - **Complete**: Mark onboarding done, redirect to dashboard
4. **Dashboard** → View metrics, BTC chart, top opportunity costs
5. **Envelopes** → Manage envelopes, view/edit allocations
6. **Analytics** → Cash flow charts, envelope breakdown, opportunity cost analysis
7. **Settings** → Edit income, import CSV, view security status

---

## What's Left for Production

1. **Activate field-level encryption** in AppContext (encrypt payee on write, decrypt on read)
2. **Add email magic link provider** (requires SMTP service)
3. **Switch to PostgreSQL** for Vercel/production deployment
4. **Configure OAuth credentials** for Google and GitHub
5. **Add PIN re-entry on login** for Web 2.0 users to unlock their privacy key
6. **Implement NIP-04/NIP-44** encryption for Nostr users' sensitive fields
7. **Add real-time BTC price updates** (WebSocket or polling)
8. **Build out Researcher and Funds pages** (currently "Coming Soon")
9. **Add data export** functionality for sovereign data ownership
10. **Migrate middleware to Next.js 16 "proxy" convention** when stable
