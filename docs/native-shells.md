# Native shells (Capacitor + Tauri)

How to create and maintain **thin native wrappers** around the hosted BitBudget web app for store and desktop distribution.

| Platform | Tool | Repo path (scaffold) |
|----------|------|----------------------|
| Android, iOS | [Capacitor](https://capacitorjs.com/) 6 | [`shells/bitbudget-mobile/`](../shells/bitbudget-mobile/) |
| Windows, macOS | [Tauri](https://tauri.app/) 2 | [`shells/bitbudget-desktop/`](../shells/bitbudget-desktop/) |

Strategy: [commercial-clients-proposal.md](./commercial-clients-proposal.md). Billing: [entitlement-api.md](./entitlement-api.md).

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Native shell (Kotlin/Swift/Rust thin)   │
│  - IAP plugin                            │
│  - Push notifications                    │
│  - Deep links                            │
│  - Optional: biometric → web bridge      │
└─────────────────┬───────────────────────┘
                  │ WebView loads:
                  ▼
        https://app.bitbudget.io
        (same Next.js app as browser)
```

**Do not** bundle a fork of the UI in the shell for v1. The production URL keeps one deployment, one encryption build, and one entitlement backend.

**Development:** point `server.url` at `http://LAN_IP:3000` or emulator loopback.

---

## Mobile: Capacitor (`shells/bitbudget-mobile`)

### First-time setup (when starting implementation)

From repo root:

```bash
mkdir -p shells/bitbudget-mobile
cd shells/bitbudget-mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "BitBudget" io.bitbudget.app --web-dir dist
```

Create `capacitor.config.ts`:

```typescript
import type { CapacitorConfig } from "@capacitor/cli"

const productionUrl = "https://app.bitbudget.io"

const config: CapacitorConfig = {
  appId: "io.bitbudget.app",
  appName: "BitBudget",
  webDir: "dist",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? productionUrl,
    cleartext: process.env.CAPACITOR_ALLOW_CLEARTEXT === "true",
    androidScheme: "https",
  },
  plugins: {
    // Purchases: @revenuecat/purchases-capacitor or custom StoreKit / Play Billing bridge
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
}

export default config
```

For **remote URL mode**, `webDir` is unused at runtime but still required by CLI; use a minimal `dist/index.html` redirect or placeholder.

```bash
npx cap add android
npx cap add ios
npx cap sync
```

Open Android Studio / Xcode, configure signing, permissions (camera for receipts, network).

### Deep links

| Scheme / host | Purpose |
|---------------|---------|
| `bitbudget://auth/callback` | OAuth return (if used in WebView) |
| `https://app.bitbudget.io/ref/*` | App links / universal links for referrals |
| Plaid redirect URI | Register platform-specific redirect in Plaid dashboard |

### Store IAP flow

1. User taps Upgrade in web UI (or native paywall screen that posts message to WebView).
2. Shell runs native purchase (RevenueCat recommended).
3. Shell `POST /api/billing/store/sync` with session cookie from WebView (see [entitlement-api.md](./entitlement-api.md)).
4. Web app refetches `GET /api/user/settings` or listens for `bitbudget-entitlement-updated`.

### Session cookies in WebView

- Hosted app must use `Secure`, `SameSite=Lax` or `None` (if cross-site) — test login persistence on iOS WKWebView after background.
- Auth URL env on server must match WebView origin exactly.

### Nostr

Browser extensions **do not** run in WebView. Commercial mobile onboarding should emphasize **email OTP** or **PIN/passphrase** encryption setup (existing paths).

---

## Desktop: Tauri (`shells/bitbudget-desktop`)

### First-time setup (when starting implementation)

```bash
mkdir -p shells/bitbudget-desktop
cd shells/bitbudget-desktop
npm create tauri-app@latest . -- --template vanilla-ts
```

Configure `tauri.conf.json` to load remote URL:

```json
{
  "build": {
    "devUrl": "http://localhost:3000",
    "frontendDist": "../dist-placeholder"
  },
  "app": {
    "windows": [
      {
        "title": "BitBudget",
        "width": 1280,
        "height": 800,
        "url": "https://app.bitbudget.io"
      }
    ]
  }
}
```

(Tauri 2 remote URL syntax — verify against current Tauri docs when scaffolding.)

### Desktop billing

Use **Stripe** in the embedded web view (Checkout / Portal) — no Microsoft/Apple 30% on desktop. See [entitlement-api.md](./entitlement-api.md).

### Distribution

| Channel | Notes |
|---------|--------|
| Direct download | Signed `.msi` (Windows), notarized `.dmg` (macOS) |
| Microsoft Store / Mac App Store | Optional; longer review |

Enable Tauri updater for direct channel only.

---

## Environment matrix

| Variable | Mobile | Desktop |
|----------|--------|---------|
| `CAPACITOR_SERVER_URL` | `https://app.bitbudget.io` prod | — |
| `TAURI_DEV_URL` | — | `http://localhost:3000` |
| Store API keys | App Store Connect, Play Console | — |

---

## CI (outline)

1. Web deploy to `app.bitbudget.io` (existing pipeline).
2. Mobile: `cap sync` → `gradlew bundleRelease` / `xcodebuild archive` on tag.
3. Desktop: `tauri build` on tag matrix `windows-latest`, `macos-latest`.
4. Upload artifacts to Play / TestFlight / GitHub Releases.

Versioning: shell `versionName` / Tauri `version` aligned with web app SemVer for support.

---

## Related

- [shells/README.md](../shells/README.md)
- [commercial-clients-proposal.md](./commercial-clients-proposal.md)
- [self-hosting.md](./self-hosting.md) — community edition does not use store shells by default
