# CI (GitHub Actions)

Workflows:

| Workflow | What it runs |
|----------|----------------|
| [Lint](../.github/workflows/lint.yml) | `pnpm lint` (ESLint, zero warnings) |
| [Test](../.github/workflows/test.yml) | `pnpm test` (Vitest) in job **vitest**, and `pnpm test:e2e` (Playwright) in job **e2e** |

Both run on **pull requests** and **pushes to `main`**.

## Require checks before merge

GitHub does not block merges from YAML alone. In the repo:

1. **Settings** → **Branches** → **Branch protection rules** → edit rule for `main` (or add one).
2. Enable **Require status checks to pass before merging**.
3. Add these checks (names must match what appears on a PR after the first run):

   - **eslint** (job under workflow *Lint*)
   - **vitest** (job under workflow *Test*)
   - **e2e** (job under workflow *Test* — Playwright against Postgres)

If the UI shows a different name (e.g. `Lint / eslint`), use exactly that string.

Optional: enable **Require branches to be up to date before merging** so PRs re-run CI after base updates.
