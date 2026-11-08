# Pre-commit gate

Run before every agent commit and push (including review passes). The ordered shell commands under **Gates** must all pass on the current `HEAD`. If one fails, fix or revert in the same pass. Do not commit around a red gate, and never use `--no-verify`.

Conventions behind these rules live in [AGENTS.md](AGENTS.md); this file is the short checklist.

## Before you stage

- **Scope:** the diff matches one concern on one topic branch. No drive-by refactors, no unrelated files (see `.cursor/rules/agent-git-hygiene.mdc`).
- **No secrets or user data:** nothing from `.env*`, no nsec, privacy keys, ingest tokens, invite tokens, decrypted exports, or personal CSVs. Don't stage local review logs (`.cursor/real-steel/`, `.cursor/agentic-review/`).
- **Privacy:** no new logging of decrypted payee/notes, keys, PINs, group keys, or request bodies. New sensitive fields are encrypted on the client.
- **Tests travel with the code:** new or changed logic in `lib/`, parsers, API input handling, and regression-prone branches has Vitest coverage in the same commit.
- **Migrations:** schema changes ship with an idempotent migration folder. Never edit an applied migration.
- **User-facing copy:** plain language, no internal vocabulary (ledger, allocation legs, batch, ciphertext). Bitcoin content stays behind `opportunityCostEnabled`.
- **UI changes:** checked at 390px and 320px with no horizontal page scroll.
- **Identity:** `.identity` exists and `github-identity check` passes before commit and push.

## Gates

Run from the repo root on Node ≥ 20 (`nvm use` if the shell reports an older Node).

### 1. Lint

```bash
pnpm lint
```

### 2. Unit tests

```bash
pnpm test
```

Some tests under `lib/__tests__/*.integration.test.ts` hit Postgres. If one fails because a column or table is missing locally, apply migrations (`pnpm exec prisma migrate deploy`) and rerun. Don't treat local schema drift as a pass.

## Before marking a PR ready

Not run on every commit, but required before merge (CI runs both):

- **E2E:** `pnpm test:e2e` needs Postgres and env, and must not run alongside `pnpm dev` in the same tree. Required when the change touches auth, onboarding, referrals, transaction dialog prefill, envelopes, the income importer, or core page navigation.
- **Build / types:** `pnpm exec next build` (CI) type-checks the app. Standalone `tsc --noEmit` can report false errors from stale `.next/dev/types` after switching branches with a dev server running; ignore errors that come only from `.next/`.
