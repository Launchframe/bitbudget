# Low-Friction Transaction Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add layered transaction capture mechanisms (voice, shortcuts, receipt improvements, SMS, email, Plaid) with a review inbox, admin system, and asymmetric encryption for backend-created transactions.

**Architecture:** All auto-captured transactions flow through a confidence router. High-confidence results become live Transactions; low-confidence results become PendingTransactions in a review inbox. Backend-created transactions are encrypted with the user's public key (asymmetric). An admin system manages receipt sender curation. Free-tier features are privacy-preserving; paid-tier features carry explicit privacy disclosures.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma/PostgreSQL, NextAuth 5, Web Speech API, OpenAI GPT-4o-mini, Twilio, SendGrid/Mailgun, Plaid, Web Push API, tweetnacl/libsodium (X25519), Vitest + Testing Library.

**Design doc:** `docs/plans/2026-03-16-low-friction-transaction-capture-design.md`

---

## Phase 1: Foundation Infrastructure

Everything else depends on these schema changes, the encryption migration, and the admin guard.

---

### Task 1.1: Vitest Configuration

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json` (add `test` script)

**Step 1: Create vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest"
```

**Step 2: Add test script to package.json**

Add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`

**Step 3: Run `npx vitest run` to verify config**

Expected: "No test files found" (clean exit).

**Step 4: Commit**

```bash
git add vitest.config.ts vitest.setup.ts package.json
git commit -m "chore: configure vitest with jsdom and testing-library"
```

---

### Task 1.2: Prisma Schema Changes

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add `role` and `publicKey` fields to User model**

```prisma
model User {
  // ... existing fields ...
  role              String?   @default("user")
  publicKey         String?
  // ... existing relations ...
}
```

**Step 2: Add `source` field to Transaction model**

```prisma
model Transaction {
  // ... existing fields ...
  source      String    @default("manual")
  // ... existing relations ...
}
```

**Step 3: Add PendingTransaction model**

```prisma
model PendingTransaction {
  id                  String    @id @default(cuid())
  userId              String
  source              String
  payee               String
  amount              Float
  date                DateTime
  notes               String?
  suggestedEnvelopeId String?
  confidence          Float
  rawInput            String?
  tags                String?
  createdAt           DateTime  @default(now())

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  envelope Envelope? @relation(fields: [suggestedEnvelopeId], references: [id])

  @@index([userId])
  @@index([userId, createdAt])
}
```

**Step 4: Add TransactionShortcut model**

```prisma
model TransactionShortcut {
  id            String   @id @default(cuid())
  userId        String
  payee         String
  defaultAmount Float?
  envelopeId    String
  label         String?
  usageCount    Int      @default(0)
  createdAt     DateTime @default(now())

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  envelope Envelope @relation(fields: [envelopeId], references: [id])

  @@index([userId])
}
```

**Step 5: Add ApprovedReceiptSender model**

```prisma
model ApprovedReceiptSender {
  id            String   @id @default(cuid())
  senderPattern String   @unique
  displayName   String
  addedBy       String
  createdAt     DateTime @default(now())

  admin User @relation("ApprovedSenderAdmin", fields: [addedBy], references: [id])
}
```

**Step 6: Add PendingSenderReview model**

```prisma
model PendingSenderReview {
  id              String   @id @default(cuid())
  senderAddress   String
  samplePayee     String?
  sampleAmount    Float?
  occurrenceCount Int      @default(1)
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  status          String   @default("pending")
}
```

**Step 7: Add AuditLog model**

```prisma
model AuditLog {
  id          String   @id @default(cuid())
  adminUserId String
  action      String
  targetType  String?
  targetId    String?
  metadata    Json?
  createdAt   DateTime @default(now())

  admin User @relation("AuditLogAdmin", fields: [adminUserId], references: [id])

  @@index([adminUserId])
  @@index([action])
  @@index([createdAt])
}
```

**Step 8: Add PlaidItem and PlaidAccount models**

```prisma
model PlaidItem {
  id               String   @id @default(cuid())
  userId           String
  accessToken      String
  institutionName  String?
  consentTimestamp DateTime @default(now())
  createdAt        DateTime @default(now())

  user     User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  accounts PlaidAccount[]

  @@index([userId])
}

model PlaidAccount {
  id          String @id @default(cuid())
  plaidItemId String
  accountName String
  mask        String?
  type        String

  plaidItem PlaidItem @relation(fields: [plaidItemId], references: [id], onDelete: Cascade)
}
```

**Step 9: Add reverse relations to User and Envelope models**

On User, add:
```prisma
  pendingTransactions PendingTransaction[]
  shortcuts           TransactionShortcut[]
  approvedSenders     ApprovedReceiptSender[] @relation("ApprovedSenderAdmin")
  auditLogs           AuditLog[]              @relation("AuditLogAdmin")
  plaidItems          PlaidItem[]
```

On Envelope, add:
```prisma
  pendingTransactions PendingTransaction[]
  shortcuts           TransactionShortcut[]
```

**Step 10: Generate migration and apply**

```bash
npx prisma migrate dev --name add-low-friction-capture-models
```

**Step 11: Commit**

```bash
git add prisma/
git commit -m "feat: add schema for pending transactions, shortcuts, admin, plaid"
```

---

### Task 1.3: Admin Middleware Guard

**Files:**
- Create: `lib/admin.ts`
- Modify: `middleware.ts`

**Step 1: Write test for admin check utility**

Create: `lib/__tests__/admin.test.ts`

```ts
import { describe, it, expect } from "vitest"
import { isAdmin } from "../admin"

describe("isAdmin", () => {
  it("returns true for admin role", () => {
    expect(isAdmin({ role: "admin" })).toBe(true)
  })

  it("returns false for user role", () => {
    expect(isAdmin({ role: "user" })).toBe(false)
  })

  it("returns false for null/undefined", () => {
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run lib/__tests__/admin.test.ts
```

Expected: FAIL — `isAdmin` not found.

**Step 3: Implement admin utility**

```ts
// lib/admin.ts
import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "admin"
}

export async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  })

  if (!isAdmin(user)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null }
  }

  return { error: null, user: { ...session.user, role: user!.role } }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run lib/__tests__/admin.test.ts
```

**Step 5: Commit**

```bash
git add lib/admin.ts lib/__tests__/admin.test.ts
git commit -m "feat: add admin check utility and middleware guard"
```

---

### Task 1.4: Admin Seed Script

**Files:**
- Create: `prisma/seed-admin.ts`

**Step 1: Create seed script**

```ts
// prisma/seed-admin.ts
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const adminEmails = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim()) ?? []

  if (adminEmails.length === 0) {
    console.log("No ADMIN_EMAILS set. Skipping admin seed.")
    return
  }

  for (const email of adminEmails) {
    const user = await prisma.user.updateMany({
      where: { email },
      data: { role: "admin" },
    })
    console.log(`Set admin role for ${email}: ${user.count} user(s) updated`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

**Step 2: Add script to package.json**

Add: `"db:seed-admin": "npx tsx prisma/seed-admin.ts"`

**Step 3: Commit**

```bash
git add prisma/seed-admin.ts package.json
git commit -m "feat: add admin seed script driven by ADMIN_EMAILS env var"
```

---

### Task 1.5: Asymmetric Encryption

**Files:**
- Modify: `lib/crypto.ts`
- Create: `lib/__tests__/crypto-asymmetric.test.ts`

This task extends the existing `lib/crypto.ts` with X25519 asymmetric encryption. The existing symmetric functions are preserved for backward compatibility.

**Step 1: Install tweetnacl**

```bash
npm install tweetnacl tweetnacl-util
```

**Step 2: Write tests**

```ts
// lib/__tests__/crypto-asymmetric.test.ts
import { describe, it, expect } from "vitest"
import {
  generateKeyPairFromSeed,
  deriveAsymmetricSeed,
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
} from "../crypto"

describe("asymmetric encryption", () => {
  it("derives a deterministic key pair from passphrase + salt", async () => {
    const salt = "test-salt-value"
    const seed1 = await deriveAsymmetricSeed("my-passphrase", salt)
    const seed2 = await deriveAsymmetricSeed("my-passphrase", salt)
    expect(seed1).toEqual(seed2)
  })

  it("generates different seeds for different passphrases", async () => {
    const salt = "test-salt"
    const seed1 = await deriveAsymmetricSeed("passphrase-a", salt)
    const seed2 = await deriveAsymmetricSeed("passphrase-b", salt)
    expect(seed1).not.toEqual(seed2)
  })

  it("encrypts and decrypts a field with key pair", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const plaintext = "Trader Joe's"
    const encrypted = encryptFieldAsymmetric(plaintext, publicKey)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decryptFieldAsymmetric(encrypted, secretKey)
    expect(decrypted).toBe(plaintext)
  })

  it("produces different ciphertext each time (random nonce)", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey } = generateKeyPairFromSeed(seed)
    const a = encryptFieldAsymmetric("hello", publicKey)
    const b = encryptFieldAsymmetric("hello", publicKey)
    expect(a).not.toBe(b)
  })
})
```

**Step 3: Run tests to verify they fail**

```bash
npx vitest run lib/__tests__/crypto-asymmetric.test.ts
```

**Step 4: Implement asymmetric encryption functions in `lib/crypto.ts`**

Add to the existing file (do not remove existing symmetric functions):

```ts
import nacl from "tweetnacl"
import naclUtil from "tweetnacl-util"

export async function deriveAsymmetricSeed(
  passphrase: string,
  salt: string
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 600000, hash: "SHA-256" },
    keyMaterial,
    256
  )
  return new Uint8Array(bits)
}

export function generateKeyPairFromSeed(
  seed: Uint8Array
): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair.fromSecretKey(seed)
}

export function encryptFieldAsymmetric(
  plaintext: string,
  recipientPublicKey: Uint8Array
): string {
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const messageBytes = naclUtil.decodeUTF8(plaintext)
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey)
  if (!encrypted) throw new Error("Encryption failed")
  const combined = new Uint8Array([
    ...ephemeral.publicKey,
    ...nonce,
    ...encrypted,
  ])
  return naclUtil.encodeBase64(combined)
}

export function decryptFieldAsymmetric(
  ciphertext: string,
  recipientSecretKey: Uint8Array
): string {
  const combined = naclUtil.decodeBase64(ciphertext)
  const ephemeralPublicKey = combined.slice(0, nacl.box.publicKeyLength)
  const nonce = combined.slice(
    nacl.box.publicKeyLength,
    nacl.box.publicKeyLength + nacl.box.nonceLength
  )
  const encrypted = combined.slice(nacl.box.publicKeyLength + nacl.box.nonceLength)
  const decrypted = nacl.box.open(encrypted, nonce, ephemeralPublicKey, recipientSecretKey)
  if (!decrypted) throw new Error("Decryption failed")
  return naclUtil.decodeUTF8(decrypted)
}

export function publicKeyToHex(key: Uint8Array): string {
  return uint8ToHex(key)
}

export function hexToPublicKey(hex: string): Uint8Array {
  return hexToUint8(hex)
}
```

Note: this uses **sealed box style** encryption (ephemeral sender key pair) so the server can encrypt without having its own persistent key pair.

**Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/__tests__/crypto-asymmetric.test.ts
```

**Step 6: Commit**

```bash
git add lib/crypto.ts lib/__tests__/crypto-asymmetric.test.ts package.json package-lock.json
git commit -m "feat: add asymmetric encryption (X25519) for backend-created transactions"
```

---

### Task 1.6: Public Key Upload API

**Files:**
- Create: `app/api/user/public-key/route.ts`

**Step 1: Create the endpoint**

```ts
// app/api/user/public-key/route.ts
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { publicKey: true },
  })

  return NextResponse.json({ publicKey: user?.publicKey ?? null })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { publicKey } = await req.json()
  if (!publicKey || typeof publicKey !== "string") {
    return NextResponse.json({ error: "publicKey is required" }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { publicKey },
  })

  return NextResponse.json({ success: true })
}
```

**Step 2: Update client-side encryption setup**

In the onboarding flow (`app/onboarding/page.tsx`) and PIN setup, after deriving the symmetric privacy key, also derive the asymmetric key pair and upload the public key:

```ts
const asymSeed = await deriveAsymmetricSeed(pin, salt)
const { publicKey } = generateKeyPairFromSeed(asymSeed)
await fetch("/api/user/public-key", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: publicKeyToHex(publicKey) }),
})
```

For Nostr users, upload the npub-derived public key during the Nostr auth flow.

**Step 3: Commit**

```bash
git add app/api/user/public-key/route.ts
git commit -m "feat: add public key upload endpoint for asymmetric encryption"
```

---

### Task 1.7: Server-Side Encryption Helper

**Files:**
- Create: `lib/server-encrypt.ts`
- Create: `lib/__tests__/server-encrypt.test.ts`

A server-side utility that encrypts fields with a user's public key. Used by all backend transaction creation paths.

**Step 1: Write test**

```ts
// lib/__tests__/server-encrypt.test.ts
import { describe, it, expect } from "vitest"
import {
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  deriveAsymmetricSeed,
  hexToPublicKey,
  publicKeyToHex,
} from "../crypto"
import { encryptFieldForUser } from "../server-encrypt"

describe("encryptFieldForUser", () => {
  it("returns null when publicKeyHex is null", () => {
    expect(encryptFieldForUser("hello", null)).toBeNull()
  })

  it("returns null when plaintext is null", () => {
    expect(encryptFieldForUser(null, "aabbcc")).toBeNull()
  })

  it("encrypts and is decryptable by the user's secret key", async () => {
    const seed = await deriveAsymmetricSeed("pass", "salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const hex = publicKeyToHex(publicKey)
    const encrypted = encryptFieldForUser("Starbucks", hex)
    expect(encrypted).not.toBeNull()
    expect(encrypted).not.toBe("Starbucks")
    const decrypted = decryptFieldAsymmetric(encrypted!, secretKey)
    expect(decrypted).toBe("Starbucks")
  })
})
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

```ts
// lib/server-encrypt.ts
import { encryptFieldAsymmetric, hexToPublicKey } from "./crypto"

export function encryptFieldForUser(
  plaintext: string | null | undefined,
  publicKeyHex: string | null | undefined
): string | null {
  if (!plaintext || !publicKeyHex) return null
  const publicKey = hexToPublicKey(publicKeyHex)
  return encryptFieldAsymmetric(plaintext, publicKey)
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add lib/server-encrypt.ts lib/__tests__/server-encrypt.test.ts
git commit -m "feat: add server-side encryption helper for backend transaction creation"
```

---

### Task 1.8: Confidence Router & Audit Logger

**Files:**
- Create: `lib/confidence-router.ts`
- Create: `lib/audit-log.ts`
- Create: `lib/__tests__/confidence-router.test.ts`

**Step 1: Write confidence router test**

```ts
// lib/__tests__/confidence-router.test.ts
import { describe, it, expect } from "vitest"
import { routeByConfidence } from "../confidence-router"

describe("routeByConfidence", () => {
  it("routes high confidence to live transaction", () => {
    expect(routeByConfidence(0.85)).toBe("live")
  })

  it("routes low confidence to pending", () => {
    expect(routeByConfidence(0.5)).toBe("pending")
  })

  it("routes very low confidence to pending", () => {
    expect(routeByConfidence(0.2)).toBe("pending")
  })

  it("treats threshold as high confidence", () => {
    expect(routeByConfidence(0.75)).toBe("live")
  })
})
```

**Step 2: Implement**

```ts
// lib/confidence-router.ts
import { prisma } from "./prisma"
import { encryptFieldForUser } from "./server-encrypt"

const HIGH_CONFIDENCE_THRESHOLD = 0.75

export function routeByConfidence(confidence: number): "live" | "pending" {
  return confidence >= HIGH_CONFIDENCE_THRESHOLD ? "live" : "pending"
}

interface ParsedTransaction {
  payee: string
  amount: number
  date: Date
  notes?: string | null
  suggestedEnvelopeId?: string | null
  confidence: number
  source: string
  rawInput?: string | null
  tags?: string | null
}

export async function routeTransaction(
  userId: string,
  parsed: ParsedTransaction
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })

  const encryptedPayee = encryptFieldForUser(parsed.payee, user?.publicKey) ?? parsed.payee
  const encryptedNotes = encryptFieldForUser(parsed.notes, user?.publicKey)

  const route = routeByConfidence(parsed.confidence)

  if (route === "live") {
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        envelopeId: parsed.suggestedEnvelopeId!,
        date: parsed.date,
        payee: encryptedPayee,
        amount: parsed.amount,
        type: "expense",
        source: parsed.source,
        notes: encryptedNotes,
        tags: parsed.tags,
      },
    })
    return { route: "live" as const, id: transaction.id }
  }

  const pending = await prisma.pendingTransaction.create({
    data: {
      userId,
      source: parsed.source,
      payee: encryptedPayee,
      amount: parsed.amount,
      date: parsed.date,
      notes: encryptedNotes,
      suggestedEnvelopeId: parsed.suggestedEnvelopeId,
      confidence: parsed.confidence,
      rawInput: parsed.rawInput,
      tags: parsed.tags,
    },
  })
  return { route: "pending" as const, id: pending.id }
}
```

```ts
// lib/audit-log.ts
import { prisma } from "./prisma"

export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: { adminUserId, action, targetType, targetId, metadata: metadata ?? undefined },
  })
}
```

**Step 3: Run tests**

**Step 4: Commit**

```bash
git add lib/confidence-router.ts lib/audit-log.ts lib/__tests__/confidence-router.test.ts
git commit -m "feat: add confidence router for auto-captured transactions and audit logger"
```

---

## Phase 2: Review Inbox

Depends on: Phase 1 (PendingTransaction model, confidence router).

---

### Task 2.1: Pending Transaction API Routes

**Files:**
- Create: `app/api/pending-transactions/route.ts`

**Step 1: Create CRUD endpoint**

Follows the same pattern as `app/api/transactions/route.ts`.

- **GET:** Fetch all pending transactions for the authenticated user, ordered by `createdAt DESC`.
- **POST (confirm):** Accept `{ id, envelopeId? }`. Move the PendingTransaction to the Transaction table. If `envelopeId` is provided, override the suggested envelope. Delete the PendingTransaction.
- **POST (confirm-all):** Accept `{ action: "confirm-all" }`. Confirm all pending transactions that have a `suggestedEnvelopeId`.
- **DELETE:** Accept `{ id }`. Dismiss a PendingTransaction.

**Step 2: Create confirm endpoint**

- Create: `app/api/pending-transactions/confirm/route.ts`
- **POST:** Takes `{ id, envelopeId? }`. Finds PendingTransaction by id and userId. Creates Transaction. Deletes PendingTransaction. Returns the new Transaction.

**Step 3: Create bulk confirm endpoint**

- Create: `app/api/pending-transactions/confirm-all/route.ts`
- **POST:** Finds all PendingTransactions for user where `suggestedEnvelopeId IS NOT NULL`. Creates Transactions. Deletes PendingTransactions. Returns count.

**Step 4: Commit**

```bash
git add app/api/pending-transactions/
git commit -m "feat: add pending transaction CRUD, confirm, and bulk confirm endpoints"
```

---

### Task 2.2: "Added Since Last Visit" API

**Files:**
- Modify: `prisma/schema.prisma` — add `lastVisitedAt DateTime?` to User
- Create: `app/api/transactions/recent/route.ts`

**Step 1: Add `lastVisitedAt` to User**

```prisma
model User {
  // ... existing fields ...
  lastVisitedAt     DateTime?
}
```

Run: `npx prisma migrate dev --name add-last-visited-at`

**Step 2: Create recent transactions endpoint**

- **GET:** Returns transactions where `createdAt > user.lastVisitedAt` and `source != "manual"`.
- **POST:** Updates `lastVisitedAt` to `now()` (called when user views the page).

**Step 3: Commit**

```bash
git add prisma/ app/api/transactions/recent/
git commit -m "feat: add 'added since last visit' endpoint with lastVisitedAt tracking"
```

---

### Task 2.3: Review Inbox Component

**Files:**
- Create: `components/review-inbox.tsx`
- Modify: `components/sidebar.tsx` — add "Review Inbox" nav item with badge
- Modify: `app/page.tsx` — add `review-inbox` hash route
- Modify: `lib/app-context.tsx` — add pending transaction state and fetch

**Step 1: Add pending transaction state to AppContext**

In `lib/app-context.tsx`, add to state:
- `pendingTransactions: PendingTransaction[]`
- `pendingCount: number`
- `recentAutoCount: number` (transactions added since last visit)

Add to `refreshData`:
- Fetch `GET /api/pending-transactions`
- Fetch `GET /api/transactions/recent`

Add functions:
- `confirmPending(id, envelopeId?)`
- `dismissPending(id)`
- `confirmAllPending()`

**Step 2: Create review inbox component**

`components/review-inbox.tsx`:
- Fetches pending transactions from app context
- Each item: source icon, payee, amount, date, suggested envelope with confidence bar, Confirm/Edit/Dismiss buttons
- "Confirm All" button at top when items exist
- Empty state: "All caught up!"

Source icon mapping:
- `voice` → Mic icon
- `receipt_scan` → Camera icon
- `sms` → MessageSquare icon
- `email_forward` / `email_scan` → Mail icon
- `plaid` → Building2 icon (bank)

**Step 3: Add to sidebar**

In `components/sidebar.tsx`, add nav item:
```tsx
{ id: "review-inbox", label: "Review Inbox", icon: InboxIcon }
```

Show badge with `pendingCount + recentAutoCount` when > 0.

**Step 4: Add hash route**

In `app/page.tsx`, add case for `review-inbox` that renders `<ReviewInbox />`.

**Step 5: Commit**

```bash
git add components/review-inbox.tsx components/sidebar.tsx app/page.tsx lib/app-context.tsx
git commit -m "feat: add review inbox UI with sidebar badge and confidence indicators"
```

---

### Task 2.4: Notification Banner

**Files:**
- Create: `components/notification-banner.tsx`
- Modify: `app/page.tsx` — render banner above content

**Step 1: Create banner component**

Shows when `pendingCount > 0` or `recentAutoCount > 0`:
- "X new transactions added" → links to `#/review-inbox` (recent auto page)
- "Y transactions need your review" → links to `#/review-inbox`
- Dismissible (stores dismissed timestamp in localStorage)

**Step 2: Commit**

```bash
git add components/notification-banner.tsx app/page.tsx
git commit -m "feat: add notification banner for pending and recently auto-added transactions"
```

---

### Task 2.5: Envelope Auto-Assignment Utility

**Files:**
- Create: `lib/envelope-matcher.ts`
- Create: `lib/__tests__/envelope-matcher.test.ts`

**Step 1: Write tests**

Test the three-pass strategy:
- Exact payee match returns high confidence
- Unknown payee with no history falls through to LLM
- Result below threshold returns null

**Step 2: Implement**

```ts
// lib/envelope-matcher.ts
import { prisma } from "./prisma"
import OpenAI from "openai"

interface MatchResult {
  envelopeId: string
  confidence: number
}

export async function matchEnvelope(
  userId: string,
  payee: string,
  plaidCategoryId?: string
): Promise<MatchResult | null> {
  // Pass 1: Exact payee history match
  const historyMatch = await matchByHistory(userId, payee)
  if (historyMatch) return historyMatch

  // Pass 2: Plaid category mapping (if available)
  if (plaidCategoryId) {
    const categoryMatch = await matchByCategory(userId, plaidCategoryId)
    if (categoryMatch) return categoryMatch
  }

  // Pass 3: LLM fallback
  return matchByLLM(userId, payee)
}
```

Implement each pass as a separate function. `matchByHistory` queries the Transaction table grouped by envelopeId for the given payee, returns the most frequent. `matchByLLM` calls GPT-4o-mini with the payee and the user's envelope list.

**Step 3: Run tests, commit**

```bash
git add lib/envelope-matcher.ts lib/__tests__/envelope-matcher.test.ts
git commit -m "feat: add three-pass envelope auto-assignment (history, category, LLM)"
```

---

## Phase 3: Free Tier Features

These tasks are largely independent and can be built in any order.

---

### Task 3.1: Quick-Entry Shortcuts

**Files:**
- Create: `app/api/shortcuts/route.ts` — CRUD for TransactionShortcut
- Create: `components/shortcuts-panel.tsx` — pill/chip UI
- Modify: `components/new-transaction-dialog.tsx` — add shortcuts panel at top

**Step 1:** API route following existing patterns. GET (list), POST (create), PUT (update), DELETE.

**Step 2:** `shortcuts-panel.tsx`: Horizontal scrollable row of pills. Each shows label (or payee) and default amount. Tap one → calls `openNewTransaction({ payee, amount, envelopeId })` with shortcut values. Long-press → edit/delete.

**Step 3:** In `new-transaction-dialog.tsx`, add a "Save as shortcut" checkbox at the bottom of the form. When checked and the form is submitted, also POST to `/api/shortcuts`.

**Step 4:** Add "Create shortcut from transaction" option in transaction row context menu.

**Step 5:** Commit per sub-step.

---

### Task 3.2: Voice Dictation

**Files:**
- Create: `components/voice-dictation-button.tsx`
- Create: `components/voice-confirmation-card.tsx`
- Create: `app/api/voice/parse/route.ts`
- Modify: `components/sidebar.tsx` — add mic button
- Modify: `lib/app-context.tsx` — add voice flow state

**Step 1: Create parse endpoint**

`app/api/voice/parse/route.ts`:
- **POST:** Accepts `{ transcript: string }`.
- Fetches user's envelope names and recent payees.
- Calls GPT-4o-mini with structured prompt:

```
Extract transaction details from: "${transcript}"

Available envelopes: ${envelopeNames.join(", ")}
Recent payees: ${recentPayees.join(", ")}

Return JSON: { "payee": string, "amount": number, "envelope": string | null, "date": string (YYYY-MM-DD) | null }

If the user doesn't specify a date, use today. Match envelope and payee names fuzzily to the lists provided.
```

- Returns parsed JSON + confidence score (1.0 if all fields filled, lower proportionally for missing fields).

**Step 2: Create voice dictation button**

`components/voice-dictation-button.tsx`:
- Uses `webkitSpeechRecognition` / `SpeechRecognition` API.
- States: idle → listening (pulsing mic icon) → processing (spinner) → result.
- On speech end: POST transcript to `/api/voice/parse`.
- On result: show `VoiceConfirmationCard`.
- Feature detection: hide button if `SpeechRecognition` is not available.

**Step 3: Create confirmation card**

`components/voice-confirmation-card.tsx`:
- Compact card (not full dialog): shows parsed payee, amount, envelope, date.
- Each field is editable inline.
- Confirm button → routes through confidence router (or directly calls `addTransaction` if user confirmed).
- Cancel button → dismiss.

**Step 4: Add mic button to sidebar**

Next to existing "New Transaction" and "Scan Receipt" buttons.

**Step 5: Commit**

```bash
git add components/voice-dictation-button.tsx components/voice-confirmation-card.tsx app/api/voice/parse/route.ts components/sidebar.tsx
git commit -m "feat: add voice dictation with Web Speech API and LLM parsing"
```

---

### Task 3.3: Enhanced Receipt Scanning

**Files:**
- Modify: `app/api/receipts/scan/route.ts` — add envelope suggestion to response
- Modify: `components/scan-receipt-dialog.tsx` — add batch mode
- Modify: `public/manifest.json` (create if needed) — Web Share Target

**Step 1: Add envelope suggestion to scan response**

After extracting payee/amount/date, call `matchEnvelope(userId, payee)` and include `{ suggestedEnvelope, confidence }` in the response.

**Step 2: Batch mode in scan dialog**

Add a "Scan Another" button after each successful scan. Scanned receipts accumulate in a list within the dialog. When done, user reviews all at once (mini review inbox within the dialog). Confirm all or edit individually.

**Step 3: Web Share Target**

Create `public/manifest.json` with share_target config. Add `<link rel="manifest">` to `app/layout.tsx`. Handle shared files via a route that opens the receipt scanner.

**Step 4: Commit per sub-step**

---

### Task 3.4: Smart Reminders (Web Push)

**Files:**
- Create: `public/sw.js` — service worker for push notifications
- Create: `lib/push-subscription.ts` — client-side push subscription helper
- Create: `app/api/push/subscribe/route.ts` — store push subscription
- Create: `app/api/push/send/route.ts` — send push notification
- Create: `app/api/cron/reminders/route.ts` — daily cron job
- Modify: `prisma/schema.prisma` — add PushSubscription model
- Modify: `components/settings-page.tsx` — add reminder toggle and time picker

**Step 1: Add PushSubscription model**

```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

Add `reminderTime String? @default("20:00")` and `remindersEnabled Boolean @default(false)` to User.

**Step 2: Implement service worker, subscription, and cron**

The cron job (`app/api/cron/reminders/route.ts`):
- Runs daily via Vercel Cron.
- For each user with `remindersEnabled` and current time matching `reminderTime` (±15 min window):
  - Check if user logged any transactions today. If yes, skip.
  - Send web push: "Log today's spending?" with action URL `/#/transactions`.

**Step 3: Settings UI**

In settings, add toggle for reminders and time picker. On enable, trigger push subscription flow (browser permission prompt → POST subscription to `/api/push/subscribe`).

**Step 4: Commit per sub-step**

---

## Phase 4: Admin Portal

Depends on: Phase 1 (admin guard, audit log, approved sender models).

---

### Task 4.1: Admin Layout & Navigation

**Files:**
- Create: `app/admin/layout.tsx` — admin layout with sidebar nav
- Create: `app/admin/page.tsx` — admin dashboard (redirect to users)
- Create: `components/admin/admin-sidebar.tsx`

**Step 1: Create admin layout**

```tsx
// app/admin/layout.tsx
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { AdminSidebar } from "@/components/admin/admin-sidebar"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== "admin") redirect("/")

  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
```

**Step 2: Admin sidebar**

Nav items: Users, Receipt Senders, Sender Review Queue, Audit Log.

**Step 3: Commit**

```bash
git add app/admin/ components/admin/
git commit -m "feat: add admin layout with role-gated access"
```

---

### Task 4.2: Admin Users Page

**Files:**
- Create: `app/admin/users/page.tsx`
- Create: `app/api/admin/users/route.ts`

**Step 1: Create API**

GET: Returns all users with aggregated transaction count, last login (from Session table or `lastVisitedAt`), created date. Requires admin auth via `requireAdmin()`. Supports `?search=` query param.

**Step 2: Create page**

Server component that fetches from the API. Table with columns: email, name, transaction count, last login, created. Search input. Paginated.

**Step 3: Commit**

---

### Task 4.3: Approved Receipt Senders CRUD

**Files:**
- Create: `app/admin/senders/page.tsx`
- Create: `app/api/admin/senders/route.ts`

**Step 1: Create API**

- GET: List all approved senders.
- POST: Create `{ senderPattern, displayName }`. Log audit action.
- DELETE: Remove by id. Log audit action.

All routes use `requireAdmin()`.

**Step 2: Create page**

Table: sender pattern, display name, added by, date. Add form at top. Delete button per row with confirmation.

**Step 3: Commit**

---

### Task 4.4: Sender Review Queue

**Files:**
- Create: `app/admin/sender-review/page.tsx`
- Create: `app/api/admin/sender-review/route.ts`

**Step 1: Create API**

- GET: List all pending sender reviews (status = "pending"), ordered by occurrence count DESC.
- POST (approve): Accept `{ id, displayName }`. Create ApprovedReceiptSender. Update PendingSenderReview status to "approved". Log audit action.
- POST (dismiss): Accept `{ id }`. Update status to "dismissed". Log audit action.

**Step 2: Create page**

Each card: sender address, sample parsed transaction, occurrence count, first/last seen. Approve (opens inline form for display name) or Dismiss buttons.

**Step 3: Commit**

---

### Task 4.5: Audit Log Page

**Files:**
- Create: `app/admin/audit-log/page.tsx`
- Create: `app/api/admin/audit-log/route.ts`

**Step 1:** API: GET with pagination, ordered by createdAt DESC.

**Step 2:** Page: Table with timestamp, admin, action, target, metadata. Filter by action type.

**Step 3: Commit**

---

## Phase 5: Paid Tier — Email Systems

Depends on: Phase 1 (schema), Phase 2 (review inbox, confidence router), Phase 4 (admin sender management).

---

### Task 5.1: Email Forwarding Ingest

**Files:**
- Create: `app/api/webhooks/inbound-email/route.ts`

**Step 1: Implement inbound email webhook**

Route receives POST from SendGrid/Mailgun inbound parse webhook. Extract:
- `from` (the forwarding user's email — used to look up userId)
- `headers` or body for original sender ("forwarded from" address)
- `text` / `html` body

**Step 2: Parse receipt**

Reuse the OpenAI receipt parsing logic from `app/api/receipts/scan/route.ts` (extract into a shared `lib/receipt-parser.ts` utility). Pass the email body text.

**Step 3: Route through confidence router**

Call `matchEnvelope` for the parsed payee. Call `routeTransaction` with the result.

**Step 4: Check sender against approved list**

Query `ApprovedReceiptSender` for the original sender address. If not found, upsert `PendingSenderReview` (increment `occurrenceCount`, update `lastSeenAt`).

**Step 5: Commit**

```bash
git add app/api/webhooks/inbound-email/route.ts lib/receipt-parser.ts
git commit -m "feat: add inbound email webhook for receipt forwarding"
```

---

### Task 5.2: Connected Email Scanning (OAuth + Cron)

**Files:**
- Create: `app/api/email/connect/route.ts` — OAuth flow for Gmail/Outlook
- Create: `app/api/cron/email-scan/route.ts` — background scan job
- Modify: `prisma/schema.prisma` — add ConnectedEmailAccount model

**Step 1: Add model**

```prisma
model ConnectedEmailAccount {
  id            String   @id @default(cuid())
  userId        String
  provider      String
  accessToken   String
  refreshToken  String?
  email         String
  lastScanAt    DateTime?
  createdAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

**Step 2: OAuth connect endpoint**

Redirect to Gmail/Outlook OAuth. On callback, store tokens in ConnectedEmailAccount.

**Step 3: Cron job**

`app/api/cron/email-scan/route.ts`:
- For each ConnectedEmailAccount:
  - Query inbox for emails from approved senders since `lastScanAt`.
  - For each matching email, parse with `lib/receipt-parser.ts`.
  - Route through confidence router.
  - Update `lastScanAt`.

Configure in `vercel.json` cron schedule (e.g., every 6 hours).

**Step 4: Commit**

---

## Phase 6: Paid Tier — SMS & Plaid

Depends on: Phase 1 (schema), Phase 2 (review inbox, confidence router).

---

### Task 6.1: SMS Parsing via Twilio

**Files:**
- Create: `app/api/webhooks/sms/route.ts`

**Step 1: Implement Twilio webhook**

- Receives POST from Twilio with `Body` (SMS text) and `From` (user's phone).
- Look up user by phone number (add `phone` field to User if needed, or use a mapping table).
- Parse SMS body with GPT-4o-mini (similar prompt to voice parsing).
- Route through confidence router.

**Step 2: Validate Twilio signature**

Use `twilio` npm package to validate the `X-Twilio-Signature` header.

**Step 3: Commit**

---

### Task 6.2: Plaid Integration

**Files:**
- Create: `app/api/plaid/create-link-token/route.ts`
- Create: `app/api/plaid/exchange-token/route.ts`
- Create: `app/api/webhooks/plaid/route.ts`
- Create: `app/api/plaid/sync/route.ts`
- Create: `components/plaid-link-button.tsx`
- Create: `components/connected-accounts.tsx`

**Step 1: Install Plaid SDK**

```bash
npm install plaid
```

**Step 2: Link token creation**

`/api/plaid/create-link-token`: Create a Plaid Link token for the authenticated user.

**Step 3: Token exchange**

`/api/plaid/exchange-token`: After user completes Plaid Link, exchange public token for access token. Create PlaidItem and PlaidAccount records.

**Step 4: Webhook handler**

`/api/webhooks/plaid`: Handle `TRANSACTIONS` webhook type. On `SYNC_UPDATES_AVAILABLE`, call sync endpoint.

**Step 5: Sync endpoint**

`/api/plaid/sync`: Call Plaid `/transactions/sync`. For each new transaction:
- Call `matchEnvelope` (pass Plaid's `personal_finance_category` for pass 2).
- Route through confidence router.

**Step 6: Plaid Link button component**

Uses `react-plaid-link`. Fetches link token, renders the Link button, handles success callback.

**Step 7: Connected accounts page**

In settings: list connected PlaidItems with institution name, accounts, last sync time. Disconnect button (revokes access token via Plaid API, deletes PlaidItem).

**Step 8: Commit per sub-step**

---

## Phase 7: Upgrade Flow & Paid Feature Gating

**Files:**
- Create: `lib/subscription.ts` — check user's subscription tier
- Create: `components/upgrade-modal.tsx` — privacy disclosure + upgrade prompt
- Modify: paid feature entry points — gate behind subscription check

This phase integrates with your payment provider (Stripe, etc.) to check subscription status. Each paid feature's entry point checks `hasActiveSubscription(userId)` and shows the upgrade modal if not subscribed.

The upgrade modal content varies per feature:
- **SMS:** "Forward your bank's SMS alerts to a dedicated number. Twilio will receive and parse your bank texts."
- **Email scanning:** "We'll scan your connected inbox for receipts from known merchants. We only read receipt-like emails."
- **Plaid:** "Plaid connects to your bank. Plaid and bitbudget will have read access to your transaction history."

---

## Implementation Order Summary

```
Phase 1: Foundation (schema, encryption, admin guard, confidence router)
    ↓
Phase 2: Review Inbox (pending API, inbox UI, notification banner, envelope matcher)
    ↓
Phase 3: Free Tier (shortcuts, voice, receipt improvements, reminders) — parallelizable
    ↓
Phase 4: Admin Portal (users, senders CRUD, review queue, audit log) — parallelizable with Phase 3
    ↓
Phase 5: Email Systems (forwarding ingest, connected scanning)
    ↓
Phase 6: SMS & Plaid
    ↓
Phase 7: Upgrade Flow & Gating
```

Phases 3 and 4 can be built in parallel. Phases 5 and 6 can also be parallelized once Phase 2 is complete.
