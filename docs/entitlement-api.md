# Entitlement API (premium billing)

Specification for how **commercial premium** is represented on the server, what exists today, and what to add for **Stripe** (web/desktop) and **App Store / Play** (mobile shells).

Related: [commercial-clients-proposal.md](./commercial-clients-proposal.md), implementation in [`lib/subscription.ts`](../lib/subscription.ts).

> **Status:** **Current behavior** is live. Sections marked **(proposed)** are not implemented yet — intended contract for store clients and Stripe.

---

## Principles

1. **Server is source of truth** — Clients never send `subscriptionTier: premium` on settings PUT. Premium is granted only by payment webhooks, store receipt verification, referral activation, or admin.
2. **Effective tier** — API responses expose both stored billing tier and **resolved** tier (includes trial and gratis windows).
3. **Feature gates** — Premium-only routes call `requirePremium`, `requirePremiumOrTrial`, or specialized helpers; see [Premium-gated features](#premium-gated-features).
4. **Self-host** — Docker edition has no BitBudget billing; entitlement APIs may return 404 or are omitted when `COMMERCIAL_BILLING_ENABLED=false` (proposed env).

---

## Data model (today)

On `User` ([`prisma/schema.prisma`](../prisma/schema.prisma)):

| Field | Type | Meaning |
|-------|------|---------|
| `subscriptionTier` | `"free"` \| `"premium"` | **Paid billing** tier (Stripe/admin). Default `free`. |
| `premiumTrialUntil` | `DateTime?` | Referral / promotion trial end (e.g. after Plaid link). |
| `premiumGratisUntil` | `DateTime?` | Referrer reward window (stacking rules in `lib/referral.ts`). |
| `premiumInterestAt` | `DateTime?` | User tapped upgrade before checkout exists. |

**No** separate table for Stripe customer ID or store transactions today — add in proposed schema below.

### Effective tier resolution

```typescript
// lib/subscription.ts — resolveEffectiveTier()
// Order:
// 1. subscriptionTier === "premium"  → "premium"
// 2. premiumGratisUntil > now        → "premium" (gratis counts as full premium for gating)
// 3. premiumTrialUntil > now         → "premium-trial"
// 4. else                            → "free"
```

| Effective tier | Typical source |
|----------------|----------------|
| `premium` | Stripe subscription, admin PATCH, gratis window, Apple/Google (proposed) |
| `premium-trial` | Referral referee after bank link (time-limited) |
| `free` | Default |

---

## Client-visible API (today)

### `GET /api/user/settings`

Returns (among other fields):

| Field | Description |
|-------|-------------|
| `subscriptionTier` | Stored billing tier (`free` \| `premium`) |
| `effectiveTier` | `free` \| `premium-trial` \| `premium` |
| `premiumTrialUntil` | ISO 8601 or null |
| `premiumGratisUntil` | ISO 8601 or null |
| `referralStats` | Includes trial/gratis context for UI |

App shell uses `subscriptionTier` + `effectiveTier` for upgrade CTAs and feature visibility ([`lib/app-context.tsx`](../lib/app-context.tsx)).

### `POST /api/user/premium-interest`

Records `premiumInterestAt` when a free user taps upgrade (checkout not wired). Returns `{ recorded: true, hasEmail }`.

### Admin: `PATCH /api/admin/users/:userId/tier`

Body: `{ "subscriptionTier": "free" | "premium" }`. Audit log: `user.tier_updated`.

---

## Premium-gated features

Server checks use [`lib/subscription.ts`](../lib/subscription.ts):

| Feature | Helper | Notes |
|---------|--------|--------|
| Receipt scan API | `requirePremiumOrTrial` | OpenAI |
| Receipt inbox / inbound email | `assertPremiumTrialInboxAllowed` | Trial capped at 100 receipt/SMS per UTC month |
| SMS webhook | Premium + trial rules | |
| Voice parse | Premium | |
| Plaid link | `requirePremiumOrTrialOrReferralBankLinkPending` | Referees can link bank before full trial |
| Push subscribe | Premium paths | |

**403 shape:**

```json
{
  "error": "Forbidden",
  "message": "This feature requires a premium subscription or an active premium trial"
}
```

---

## Proposed: billing persistence

New Prisma models (names illustrative):

```prisma
model BillingAccount {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeCustomerId     String?  @unique
  revenuecatAppUserId String?  @unique  // optional if using RevenueCat
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model EntitlementEvent {
  id        String   @id @default(cuid())
  userId    String
  source    String   // stripe | apple | google | referral | admin
  productId String?  // SKU or Stripe price id
  eventType String   // subscribed | renewed | cancelled | expired | refunded
  externalId String? // invoice id, transaction id (unique per source)
  occurredAt DateTime
  raw       Json?
  @@unique([source, externalId])
  @@index([userId, occurredAt])
}
```

**Rules:**

- Updating `subscriptionTier` to `premium` for Stripe/Apple/Google must go through a single service: `applyEntitlement(userId, source, event)`.
- Never downgrade on transient webhook failures without grace period (configurable, e.g. 3 days).

---

## Proposed: Stripe (web + desktop)

### Environment

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server |
| `STRIPE_WEBHOOK_SECRET` | Verify signatures |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | Price ID |
| `STRIPE_PRICE_PREMIUM_YEARLY` | Price ID |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Checkout |

### `POST /api/billing/stripe/checkout-session` **(proposed)**

- **Auth:** session required.
- **Body:** `{ "interval": "month" | "year" }`.
- **Response:** `{ "url": "https://checkout.stripe.com/..." }`.
- Creates or reuses `BillingAccount.stripeCustomerId`, Stripe Checkout in subscription mode, success/cancel URLs on `NEXT_PUBLIC_APP_URL`.

### `POST /api/billing/stripe/portal` **(proposed)**

- **Auth:** session required.
- **Response:** `{ "url": "..." }` — Customer Portal (manage/cancel).

### `POST /api/webhooks/stripe` **(proposed)**

- **Auth:** Stripe signature (`stripe-signature`).
- Handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.
- Maps Stripe `customer` → `userId` via `BillingAccount`.
- On active subscription: `subscriptionTier = premium`.
- On cancel/expiry: set `subscriptionTier = free` after grace (or immediately per product policy).

---

## Proposed: mobile store (Apple / Google)

Prefer **RevenueCat** for v1 (server validates with RevenueCat REST API). Alternative: verify Apple JWS and Google Play Developer API directly.

### `POST /api/billing/store/sync` **(proposed)**

Called by Capacitor shell after purchase or restore.

- **Auth:** session required.
- **Body:**

```json
{
  "provider": "apple" | "google",
  "revenuecatAppUserId": "optional-if-using-rc",
  "customerInfo": {}
}
```

Or raw receipts (if not using RevenueCat):

```json
{
  "provider": "apple",
  "transactionId": "...",
  "signedTransactionInfo": "..."
}
```

- **Response:**

```json
{
  "effectiveTier": "premium",
  "subscriptionTier": "premium",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "source": "apple"
}
```

- Server verifies with store/RevenueCat, writes `EntitlementEvent`, sets `subscriptionTier` and/or `premiumGratisUntil`-style window if using subscription end date.

### `GET /api/billing/status` **(proposed)**

Lightweight poll for shells after foreground:

```json
{
  "effectiveTier": "premium-trial",
  "subscriptionTier": "free",
  "premiumTrialUntil": "...",
  "manageUrl": null,
  "storeManageHint": "ios_settings_subscriptions"
}
```

- `manageUrl`: Stripe Portal URL on web/desktop; null on mobile (user manages in OS settings).

---

## Proposed: Capacitor bridge (client, not HTTP)

Documented in [native-shells.md](./native-shells.md). Shell calls `POST /api/billing/store/sync` after native purchase; web app listens for `window` event or refetches settings.

```typescript
// Illustrative — in shell or injected bridge
window.dispatchEvent(new CustomEvent("bitbudget-entitlement-updated"))
```

---

## Referral and trial (unchanged contract)

Referral flow **does not** go through billing APIs:

- Redeem: `POST /api/referral/redeem`
- Activate on Plaid: `activateReferral` in [`lib/referral.ts`](../lib/referral.ts) sets `premiumTrialUntil` / referrer `premiumGratisUntil`

Store premium and referral trial can coexist; **effective tier** resolution order must stay documented when both apply (today: paid `premium` wins via `subscriptionTier` check first).

---

## Security

| Risk | Mitigation |
|------|------------|
| Forged store receipt | Server-only verification; never trust client JSON alone |
| Webhook replay | Idempotent `EntitlementEvent` unique on `(source, externalId)` |
| Cross-user receipt | Bind purchases to logged-in `userId` at sync time |
| Admin tier abuse | `requireAdmin` + audit log (existing) |

---

## Implementation checklist

- [ ] Prisma: `BillingAccount`, `EntitlementEvent`
- [ ] `lib/entitlement.ts` — `applyEntitlement()`, used by Stripe + store + admin
- [ ] Stripe Checkout + webhook routes
- [ ] RevenueCat webhook or `store/sync` route
- [ ] Settings UI: upgrade → Checkout; manage → Portal
- [ ] Mobile shell: purchase → `store/sync` → refresh settings
- [ ] Tests: `resolveEffectiveTier`, webhook idempotency, trial cap unchanged
- [ ] Self-host: disable billing routes when env unset

---

## Related

- [commercial-clients-proposal.md](./commercial-clients-proposal.md)
- [native-shells.md](./native-shells.md)
- [self-hosting.md](./self-hosting.md) — no commercial billing on self-host
