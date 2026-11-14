# Pre-commit gate

Run before every commit and before every Real Steel push. A red step blocks the commit — do not skip hooks (`--no-verify`).

## Qualitative rules

- Never commit secrets, `.env` / `.env.local`, privacy keys, nsec, ingest tokens, or decrypted user data.
- Unit tests (`pnpm test`) run on **every** commit. Full Playwright does **not**.
- Known local-only reds that are **not** this change (name them in the PR if they are the only failures; do not treat a new failure in touched code as environmental):
  - Missing gitignored `wallet-mpc/pkg` — four wallet server Vitest files fail to import WASM.
  - DB integration tests (e.g. nostr auth) when the local schema lacks a column the client expects.

## Gates

### 1. Lint

```bash
pnpm lint
```

### 2. Unit tests

```bash
pnpm test
```

## PR stamp (not a gate)

Every PR must show a full e2e result for its **head SHA** before it is called merge-ready. Prefer the GitHub Actions Playwright check. Run `pnpm test:e2e` (or `pnpm test:local`) locally only when CI has not run for that SHA — and **not** while `pnpm dev` holds the Next.js build lock.

Required block in the PR description (update when HEAD moves):

```markdown
## E2E stamp
- sha: `<full HEAD>`
- result: pass | fail
- source: CI <url> | local
- command: `pnpm test:e2e`
```

A docs-only PR still gets the stamp (cite CI on that SHA). A fail blocks merge-ready. Real Steel does **not** run e2e between review passes.
