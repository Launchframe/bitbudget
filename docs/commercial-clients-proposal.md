# Commercial clients proposal (Windows, macOS, Android, iOS)

How to ship the **full commercial BitBudget** — **hosted backend** (paid premium, Plaid, capture integrations) plus **installable clients** on four platforms — without maintaining four separate app codebases.

> Strategy doc for planning; not a commitment to a single toolchain yet. Complements [self-hosting.md](./self-hosting.md) (open / self-hosted edition) and [AGENTS.md](../AGENTS.md) (privacy and encryption rules).

---

## Product split (two editions, one engine)

| Edition | Backend | Client | Monetization |
|---------|---------|--------|--------------|
| **Commercial** | BitBudget-hosted (`bitbudget.io` or equivalent) | Store / desktop installers | Stripe + mobile store IAP where required |
| **Community / self-host** | User’s Docker or StartOS | Browser, PWA, or same shell pointed at own URL | No BitBudget billing; optional donations |

Both editions should run the **same Next.js application logic** (ideally open-sourced). Commercial differentiation is **hosting, integrations, billing, and support** — not a secret fork of envelope or crypto code.

```
┌─────────────────────────────────────────────────────────────────┐
│                     BitBudget web app (Next.js)                    │
│  React UI · AppContext · client E2E crypto · offline queue (IDB)  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (cookies / session)
┌────────────────────────────▼────────────────────────────────────┐
│              Hosted API (same deploy as today)                     │
│  Auth.js · Prisma · Postgres · cron · Plaid · webhooks · Stripe  │
└─────────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
         │              │              │              │
    ┌────┴────┐   ┌─────┴─────┐  ┌────┴────┐   ┌─────┴─────┐
    │ Browser │   │ Capacitor │  │ Capacitor│   │ Tauri /   │
    │         │   │  Android  │  │   iOS    │   │ Electron  │
    └─────────┘   └───────────┘  └──────────┘   └───────────┘
                      Phone           Phone        Win + macOS
```

---

## Recommended approach: **hosted web app + thin native shells**

**Do not rewrite** the UI in React Native / Flutter for v1. The app is a large, stateful SPA inside Next (`AppContext`, hash routing, encryption gate, envelope ledger). A rewrite would duplicate years of product logic and break “verify don’t trust” parity.

Instead:

1. **Keep one production deployment** of the existing app (Vercel + Postgres, or equivalent cloud).
2. Ship **native wrappers** that load that origin in a **WebView** (mobile) or **WebView / system webview** (desktop), with small **bridge plugins** for store billing, push, biometrics, and secure storage.
3. Harden **mobile-first UX**, **offline queue**, and **PWA** (already started) so wrapped clients feel native enough.

This is how many privacy-forward and fintech apps ship v1 store clients while keeping one web team.

---

## Platform matrix (options)

| Approach | Windows | macOS | Android | iOS | Codebases | Store IAP | Notes |
|----------|---------|-------|---------|-----|-----------|-----------|--------|
| **A. Capacitor + Tauri** (recommended) | Tauri 2 | Tauri 2 | Capacitor 6 | Capacitor 6 | 1 web + 2 shell repos | Plugins | Best balance |
| **B. Capacitor + Electron** | Electron | Electron | Capacitor | Capacitor | 1 web + 2 shells | Plugins | Faster desktop, heavier binary |
| **C. PWA only** | Install PWA | Install PWA | Limited | Limited | 1 | No / awkward | Poor store presence; no IAP |
| **D. React Native / Expo** | — | — | RN | RN | **2+** | Native | Full rewrite; long runway |
| **E. .NET MAUI / Flutter** | ✓ | ✓ | ✓ | ✓ | **2+** | Native | Same rewrite cost |

**Recommendation:** **A** — Capacitor for phone stores, **Tauri 2** for Windows/macOS (smaller binaries, reasonable security story). Use **Electron** only if Tauri blockers appear (legacy corporate AV, specific native SDKs).

---

## Hosted backend (commercial)

No architectural change required for v1: the **commercial backend is today’s deployed monolith**.

| Layer | Responsibility |
|-------|----------------|
| **App + API** | Next.js App Router (`app/api/*`), Auth.js session cookies |
| **Database** | PostgreSQL + Prisma migrations |
| **Jobs** | Cron routes (`/api/cron/*`) — Vercel Cron or k8s/worker |
| **Integrations** | Plaid, SendGrid inbound, Twilio, OpenAI (premium paths) |
| **Billing** | `User.subscriptionTier`, trials, referral — extend with Stripe Customer Portal + webhooks |

**Production requirements for store clients:**

| Requirement | Why |
|-------------|-----|
| **Stable HTTPS origin** | `https://app.bitbudget.io` (or apex) — WebViews and Auth.js |
| **`AUTH_URL` / `NEXT_PUBLIC_APP_URL`** | Must match loaded origin in shells |
| **Webhook URLs** | Plaid, email, SMS pointed at hosted domain only |
| **Uptime + backups** | Commercial SLA; different from self-host docs |
| **CSP / cookie `Secure`** | Required for embedded WebViews |

Optional later: split API to `api.bitbudget.io` — only if scale or compliance demands it; not needed for four clients v1.

---

## Native shell responsibilities (thin layer)

Each shell repo (`bitbudget-shell-mobile`, `bitbudget-shell-desktop`) stays small:

| Capability | Android / iOS (Capacitor) | Windows / macOS (Tauri) |
|------------|---------------------------|-------------------------|
| **Load app** | `server.url` → `https://app.bitbudget.io` | Same, or bundled `file://` only for dev |
| **Deep links** | `bitbudget://` → auth, referrals, Plaid return | Custom URL scheme |
| **Secure storage** | Keychain / Keystore for privacy key backup optional | OS credential vault |
| **Biometric unlock** | Plugin → unlock PIN flow in web | WebAuthn / OS APIs |
| **Push** | FCM / APNs → existing reminder cron | Toast / system notifications (later) |
| **IAP / subscription** | Play Billing / StoreKit 2 | Stripe Checkout in web (desktop) |
| **Camera / files** | Receipt scan upload | File picker for CSV |
| **Nostr** | Extension **not** available — rely on PIN/passphrase + NIP-04 in-page | Same |

**Capacitor config sketch:**

```typescript
// capacitor.config.ts
const config = {
  appId: "io.bitbudget.app",
  appName: "BitBudget",
  server: {
    url: "https://app.bitbudget.io",
    cleartext: false,
  },
  plugins: { /* IAP, Push, Preferences */ },
}
```

**Development:** `server.url` → `http://10.0.2.2:3000` (Android emulator) or LAN IP for device testing.

---

## Premium and billing (cross-platform)

Today the server already resolves **effective tier** (`lib/subscription.ts`): `premium`, `premium-trial`, referral gratis, Plaid-gated trial.

### Proposed commercial model

| Surface | Payment rail | Notes |
|---------|--------------|--------|
| **Web (browser)** | **Stripe** Checkout + Customer Portal | Source of truth for subscription |
| **Windows / macOS** | **Stripe** (in-app browser or external browser) | Avoid Microsoft/Apple 30% on desktop |
| **Android / iOS** | **Google Play + App Store IAP** (subscriptions) | Store policy for in-app digital features |

**Hard problem:** Apple and Google expect **IAP for premium features unlocked inside the app** (Plaid, receipt inbox, unlimited capture, etc.). Common patterns:

1. **Mobile IAP + account entitlement** — Store receipt verified **server-side**; set `subscriptionTier` / `premiumGratisUntil` same as Stripe path.
2. **“Reader” / login-only** — User purchases on web, app only logs in (Apple often **rejects** if premium features are obvious in-app).
3. **Two SKUs** — Lower mobile price; web cheaper — messy UX.

**Recommendation:** Plan **server-side entitlement service** with one table:

```
EntitlementSource: stripe | apple | google | referral | admin
```

Mobile apps call `POST /api/billing/verify-store-receipt` after purchase; Stripe webhook remains for web/desktop. **Do not** trust client tier flags.

Tools: **RevenueCat** (faster) or direct StoreKit 2 / Play Billing 6 + your API (more control, more work).

### Feature gating (unchanged)

Keep gating on **server** (`requirePremium`, `requirePremiumOrTrial`, etc.). Clients only display paywalls; offline queue does not bypass premium.

---

## Encryption and trust on native clients

| Topic | Approach |
|-------|----------|
| **Privacy key** | Still client-only; prefer **Keychain/Keystore** via Capacitor Preferences (encrypted) over raw `localStorage` in WebView |
| **Nostr extension** | Not available in WebView — document **PIN / passphrase** path for mobile/desktop commercial |
| **Verify don’t trust** | Open-source app repo; commercial shells are thin; hosted server publishes transparency doc + optional reproducible Docker |
| **Certificate pinning** | Optional in shell for `app.bitbudget.io` — trade-off vs rotation complexity |

---

## Offline and “feels native” (align with self-host)

Already on branch: IndexedDB **pending transaction queue**, PWA manifest, service worker shell.

**Commercial client roadmap:**

| Phase | Deliverable |
|-------|-------------|
| **Now** | Queue creates; flush on `online`; banner |
| **+1** | Edit/delete offline; conflict rules |
| **+2** | Capacitor Background Sync / periodic flush when app backgrounded |
| **+3** | Push: “N transactions waiting to sync” |
| **+4** | Optional local encrypted backup export (user-owned file) |

Store reviewers care that the app **does something** when offline — queued creates + readable cached history is a credible v1 story.

---

## Distribution and release

| Platform | Channel | Build |
|----------|---------|-------|
| **Android** | Google Play | AAB via Capacitor + Android Studio CI |
| **iOS** | App Store | IPA via Xcode Cloud / fastlane; TestFlight |
| **Windows** | Microsoft Store (optional) + signed `.msi`/MSIX | Tauri bundler |
| **macOS** | Mac App Store (optional) + direct notarized `.dmg` | Tauri + Apple notarization |

**CI outline:**

1. `pnpm build` web (or deploy web independently).
2. Mobile: inject `CAPACITOR_SERVER_URL`, `cap sync`, gradle/xcodebuild.
3. Desktop: `tauri build` with same URL.
4. Version alignment: app shell version ↔ minimum supported API (ExVer-style `minNativeShell` in API later).

**Signing secrets:** Play Console, App Store Connect API key, Apple Developer ID, Windows EV cert — store in CI vault.

---

## Phased roadmap

### Phase 0 — Foundation (weeks, not months of rewrite)

- [ ] Public **LICENSE** + open-source app repo (per [self-hosting](./self-hosting.md) strategy).
- [ ] Production host hardening: `app.bitbudget.io`, monitoring, backup runbooks.
- [ ] **Stripe** products + webhook → `subscriptionTier` (if not complete).
- [ ] Complete offline v1 + mobile QA at 390px / 320px.

### Phase 1 — Mobile shells (first store revenue)

- [ ] `bitbudget-mobile/` Capacitor project.
- [ ] Load hosted production URL; cookie/session stable in WKWebView / Android WebView.
- [ ] Deep links: `bitbudget://auth`, Plaid OAuth return.
- [ ] **RevenueCat** or native IAP → server entitlement API.
- [ ] Play Internal Testing + TestFlight.
- [ ] App Store / Play listings (privacy nutrition, data not linked to you, encryption export).

### Phase 2 — Desktop shells

- [ ] `bitbudget-desktop/` Tauri 2 → Win x64/arm64, macOS universal.
- [ ] Stripe upgrade in web view; system tray optional.
- [ ] Auto-update channel (Tauri updater) for direct downloads.
- [ ] Optional Microsoft / Mac store (longer review).

### Phase 3 — Polish and parity

- [ ] Keychain-backed privacy key; biometric unlock bridge.
- [ ] Push notifications (reminders, sync nudges).
- [ ] Share extension / “Add expense” shortcut (iOS/Android).
- [ ] Desktop: global shortcut, CSV import drag-drop.

### Phase 4 — Optional scale-out

- [ ] Separate read replica; job worker service.
- [ ] Regional hosting (EU data residency).
- [ ] StartOS / Docker edition remains **community**; commercial stays hosted.

---

## Architecture decisions to make soon

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Shell vs rewrite | Capacitor/Tauri vs RN | **Shells** |
| Mobile billing | RevenueCat vs in-house | **RevenueCat** for v1 speed |
| Desktop billing | Stripe in-app vs external | **Stripe** (web checkout) |
| Bundle web in app vs remote URL | Offline-first needs remote or SSR bundle | **Remote URL** v1; cache via SW + IDB |
| Single app ID | `io.bitbudget.app` | One ID across stores |
| Login on self-host in commercial app | Block or allow server URL setting | **Hosted only** in commercial SKU; “Advanced server URL” for enterprise later |

---

## Risks

| Risk | Mitigation |
|------|------------|
| App Store rejection (web wrapper) | Native navigation, IAP, no broken Safari chrome; follow [Apple WKWebView guidance](https://developer.apple.com/documentation/webkit) |
| IAP vs Stripe arbitrage | One entitlement backend; clear pricing copy |
| Plaid in WebView | Test Link OAuth redirect; registered redirect URIs per platform |
| Session cookie loss in WebView | `SameSite=None; Secure`, persistent cookie, test background resume |
| Nostr users on mobile | Onboarding path without extension; Keys.band deep link if available |
| Security audit | Open crypto code; pen-test hosted API; bug bounty later |

---

## Cost and team shape (rough)

| Workstream | Skills |
|------------|--------|
| Web / API | Existing team (Next, Prisma, privacy) |
| Mobile shell | Capacitor, Kotlin/Swift thin layers, store consoles |
| Desktop shell | Tauri/Rust light, code signing |
| Billing | Stripe + RevenueCat + entitlement API |
| DevOps | CI signing, crash analytics (Sentry), hosted prod |

One senior web developer can own Capacitor v1 with a contractor for store submission checklists.

---

## Summary

**Spin the commercial product as:**

1. **Same hosted Next.js backend** you run today, with Stripe + store IAP feeding one **entitlement layer**.
2. **Capacitor** Android/iOS apps that load `https://app.bitbudget.io` (plus IAP, push, secure storage plugins).
3. **Tauri** Windows/macOS apps with the same URL and Stripe for subscriptions.
4. **Open-source app code** for trust; commercial value = hosting, integrations, billing, and store-distributed shells.
5. **Offline queue + PWA** extended so mobile store builds are usable on spotty LTE after VPN or tunnel connects.

**Not recommended for v1:** four native UI rewrites, or shipping store apps that only work against self-hosted URLs without a clear SKU split.

---

## Related docs

- [self-hosting.md](./self-hosting.md) — Docker, VPN, offline (community path)
- [AGENTS.md](../AGENTS.md) — encryption, premium gating, feature flags
