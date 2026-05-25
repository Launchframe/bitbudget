# BitBudget documentation

Internal and operator docs for the BitBudget repository.

## Distribution and product

| Doc | Audience | Summary |
|-----|----------|---------|
| [commercial-clients-proposal.md](./commercial-clients-proposal.md) | Product / engineering | Hosted commercial app on Windows, macOS, Android, iOS (Capacitor + Tauri shells) |
| [entitlement-api.md](./entitlement-api.md) | Backend / mobile | Premium billing: today’s model + proposed Stripe / store IAP API |
| [native-shells.md](./native-shells.md) | Mobile / desktop | Thin native wrapper repos (Capacitor, Tauri) |
| [self-hosting.md](./self-hosting.md) | Self-hosters | Docker Compose, VPN remote access, cron, offline/PWA |
| [self-hosting-plan.md](./self-hosting-plan.md) | Maintainers | Open-source + Docker roadmap and networking decisions |
| [startos-packaging.md](./startos-packaging.md) | Maintainers | StartOS `.s9pk` packaging (**deferred**); OSS + open-source IP notes |

## Engineering

| Doc | Summary |
|-----|---------|
| [ci.md](./ci.md) | GitHub Actions (lint, Vitest, Playwright) |
| [email-forwarding-setup.md](./email-forwarding-setup.md) | SendGrid inbound receipt forwarding |
| [testing/recurring-qa.md](./testing/recurring-qa.md) | Recurring transaction QA checklist |
| [testing/receipt-forwarding.md](./testing/receipt-forwarding.md) | Receipt forwarding tests |

## Planning (dated)

| Doc | Summary |
|-----|---------|
| [plans/2026-03-16-low-friction-transaction-capture-design.md](./plans/2026-03-16-low-friction-transaction-capture-design.md) | Transaction capture design |
| [plans/2026-03-16-low-friction-transaction-capture.md](./plans/2026-03-16-low-friction-transaction-capture.md) | Implementation plan |
| [plans/2026-03-16-ux-testing-fixes.md](./plans/2026-03-16-ux-testing-fixes.md) | UX testing fixes |

## User stories

| Doc | Summary |
|-----|---------|
| [user-stories/day-trader.md](./user-stories/day-trader.md) | Day-trader persona notes |

## Repo layout (related paths)

| Path | Role |
|------|------|
| [../Dockerfile](../Dockerfile) | Production container image |
| [../docker-compose.yml](../docker-compose.yml) | App + PostgreSQL for self-host |
| [../shells/](../shells/) | Native shell projects (scaffold; see [native-shells.md](./native-shells.md)) |
| [../AGENTS.md](../AGENTS.md) | Agent and contributor rules (privacy, testing, conventions) |
