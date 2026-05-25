# BitBudget Mobile (Capacitor)

Android and iOS store clients for the **commercial hosted** edition.

## Status

**Not initialized yet.** This folder documents where the Capacitor project will live. Follow [docs/native-shells.md](../../docs/native-shells.md) to run `cap init` and add platforms.

## Target configuration

| Setting | Value |
|---------|--------|
| App ID | `io.bitbudget.app` |
| Production URL | `https://app.bitbudget.io` |
| Billing | App Store / Play → [entitlement API](../../docs/entitlement-api.md) `POST /api/billing/store/sync` |

## Quick start (when implementing)

```bash
cd shells/bitbudget-mobile
# After following native-shells.md setup:
npx cap sync
npx cap open android
npx cap open ios
```

## Self-host edition

Community users run Docker or a browser; they do **not** need this shell unless they configure a custom `CAPACITOR_SERVER_URL` (unsupported in commercial store builds).
