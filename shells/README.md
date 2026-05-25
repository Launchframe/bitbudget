# BitBudget native shells

Thin **Capacitor** (Android, iOS) and **Tauri** (Windows, macOS) projects that load the hosted BitBudget web application.

| Directory | Status |
|-----------|--------|
| [bitbudget-mobile/](./bitbudget-mobile/) | Scaffold / README only — run Capacitor init per [docs/native-shells.md](../docs/native-shells.md) |
| [bitbudget-desktop/](./bitbudget-desktop/) | Scaffold / README only — run Tauri init per docs |

The main application code lives in the repository root (`app/`, `components/`, `lib/`). Shells are separate packages to keep store signing and native dependencies isolated.

**Documentation:** [docs/native-shells.md](../docs/native-shells.md), [docs/commercial-clients-proposal.md](../docs/commercial-clients-proposal.md).
