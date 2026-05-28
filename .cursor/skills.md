# BitBudget custom Cursor skills

This repo ships project-local skills under [`.cursor/skills/`](skills/). Cursor loads them when an agent decides they match the task. You can also invoke them explicitly in chat (see examples below).

---

## [`real-steel`](skills/real-steel/SKILL.md)

**What it does:** Runs a **sequential multi-model PR review chain** on the current branch — a Copilot-style replacement that pits different models against each other. Each pass reviews the PR, posts comments, applies fixes, and challenges prior reviewers. A **closing post-mortem pass** by the first model explains any mistakes it made that later passes fixed.

**Use when:**

- You want adversarial, multi-perspective review before merge
- You invoke `/real-steel` with a model chain
- You want more than a single agent's review of a PR

**Do not use when:** The change is trivial (typo-only), or you only need merge/CI babysitting without a full review chain.

### How to invoke

```
/real-steel <alias> [<alias> ...]
```

| Alias | Model |
|-------|--------|
| `chat`, `gpt`, `chatgpt`, `codex` | ChatGPT (`gpt-5.5-medium`) |
| `sonnet`, `claude` | Claude Sonnet |
| `composer` | Composer |
| `opus` | Claude Opus |

**Example prompts:**

- **`/real-steel chat sonnet composer`** — ChatGPT reviews + fixes → Sonnet reviews ChatGPT → Composer reviews both → ChatGPT post-mortem on its own earlier mistakes
- *"Run real-steel on this PR: chat sonnet composer"*
- *"/real-steel sonnet"* — single Sonnet pass only
- *"/real-steel chat composer chat"* — explicit closing ChatGPT post-mortem (no auto-append)

**Typical output:** Commits per pass (`real-steel(ChatGPT): …`) with **code/test changes only**, PR review comments on GitHub, local run log at `.cursor/real-steel/pr-<n>-<date>.md` (not committed), lint/test runs, final summary for the maintainer.

---

## [`feature-slice`](skills/feature-slice/SKILL.md)

**What it does:** Plans and ships a **large feature as a stack of small, reviewable PR slices** instead of one mega-diff. It defines a fixed slice order (pure `lib/` helpers → schema/server → API → AppContext → UI surfaces one at a time → cron → AGENTS.md → e2e when needed), PR description templates, plan-doc conventions, and anti-patterns to avoid.

**Use when:**

- A change spans schema, server logic, API routes, UI, and/or onboarding
- You expect to touch more than ~5 files across `lib/`, `app/api/`, and `components/`
- Examples from the skill: PayPeriod/BudgetPeriod split, income importer rebuild, new integration, new cron path

**Do not use when:** A single bug fix, one-file refactor, or copy-only change.

### How to invoke

Mention that you want **feature slicing** or **stacked PRs**, and point at the feature. The agent should read the skill and follow the slice order before writing code.

**Example prompts:**

- *"We're rebuilding the income importer. Use the feature-slice skill to plan slices and start with lib/ helpers only."*
- *"This touches schema, API, and settings UI — slice it per `.cursor/skills/feature-slice` and write a plan doc first."*
- *"Don't one-shot this integration. Break it into reviewable PRs following our feature-slice skill; slice 1 should be pure lib/ + Vitest."*
- *"What's the next slice after the API routes land? Follow feature-slice ordering."*

**Typical output:** A plan under `.cursor/plans/`, an ordered slice list, and work scoped to one layer at a time (e.g. "no UI until server helpers and tests exist").

---

## [`ledger-feature`](skills/ledger-feature/SKILL.md)

**What it does:** Guardrails and implementation checklist for anything that touches **envelopes, Savings, funding, sweeps, goals, dashboard metrics, or cron**. It encodes non-negotiables from AGENTS.md (ledger always on, Savings as its own UI primitive, remaining vs current-month balance scope, sweep policies, pay cadence, encryption, pre-PR grep audit, and required tests).

**Use when:**

- Adding or changing ledger logic, balance helpers, sweep policy, payday cadence, savings goals, achievements
- Building UI that shows **"$X left"**, **Remaining**, or **Savings totals**
- Editing envelope funding cron, irregular income, or server-side balance batch helpers

**Do not use when:** The change has no envelope/Savings/funding/sweep/goal surface (e.g. auth-only, receipt scan, CSV import with no ledger rules).

### How to invoke

Ask the agent to **follow the ledger-feature skill** or to **read AGENTS.md Savings/ledger rules** before implementing.

**Example prompts:**

- *"Add a dashboard tile for discretionary remaining totals. Use the ledger-feature skill — all-time balance only."*
- *"Implement carry-forward sweep UI. Follow ledger-feature for `suggestedManualSweepAmount` and policy gating."*
- *"New payday branch for quarterly cadence — one helper in payday-cadence.ts per ledger-feature; add Vitest."*
- *"Before you PR this settings card change, run the ledger-feature pre-PR self-audit greps."*
- *"Fix the envelope card showing wrong Remaining after carry-forward. Ledger-feature: remaining must use getEnvelopeBalanceAllTime."*

**Typical output:** Correct balance scope (all-time vs month), `discretionaryEnvelopes` vs Savings hero, gated narrative/BTC UI, encrypted server legs, and targeted tests under `lib/__tests__/`.

---

## Using skills together

| Situation | Skills |
|-----------|--------|
| Large ledger feature | **feature-slice** to plan PRs + **ledger-feature** per slice |
| Pre-merge quality gate | **real-steel** multi-model review on the PR branch |
| Large + ledger + review | Slice first, then **real-steel** on each slice PR (or final integration PR) |

The feature-slice skill links to ledger-feature for envelope/Savings/funding slices.
