# BitBudget Desktop (Tauri)

Windows and macOS installable clients for the **commercial hosted** edition.

## Status

**Not initialized yet.** Follow [docs/native-shells.md](../../docs/native-shells.md) to scaffold Tauri 2 in this directory.

## Target configuration

| Setting | Value |
|---------|--------|
| Production URL | `https://app.bitbudget.io` |
| Billing | Stripe via web UI — [entitlement-api.md](../../docs/entitlement-api.md) |

## Quick start (when implementing)

```bash
cd shells/bitbudget-desktop
# After Tauri scaffold:
npm run tauri dev
npm run tauri build
```
