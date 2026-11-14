# StartOS packaging

Internal knowledge base for packaging BitBudget (and related services) as StartOS `.s9pk` services, plus **open-source and IP** considerations for trustworthy self-hosted distribution. Official packaging reference: [Start9 Service Packaging (0.4.x)](https://docs.start9.com/packaging/0.4.0.x/).

## Project status

**Deferred** — we are not actively building a `bitbudget-startos` package yet.

**Near-term path:** Standard **open source + Docker** for home PC/server installs. See **[self-hosting-plan.md](./self-hosting-plan.md)** (license, compose, cron, remote access from phone).

**Why StartOS waits:** On older StartOS (0.3.x), reaching a home server from away from home often meant **Tor-only** `.onion` URLs. That is a poor fit for BitBudget today (browser UX, OAuth redirects, Plaid/webhooks, email/SMS integrations, and routine mobile use off-LAN).

**Revisit when:** StartOS **0.4.x** networking matures (see [Future: StartOS 0.4 networking](#future-startos-04-networking) below). A WireGuard VPN back to the server, clearnet domain + TLS, or StartTunnel could make “use my budget from my phone” viable without Tor as the only path — overlapping with VPN/tunnel options in the self-hosting plan.

---

## Goals

- Run BitBudget on user-owned hardware via StartOS, with privacy/sovereignty aligned with product ethos.
- Enable **verify, don’t trust** via open source for security- and privacy-sensitive paths (see [Open source, trust, and intellectual property](#open-source-trust-and-intellectual-property)).
- Maintain a repeatable packaging workflow (build, test, publish, update).
- Support both **private distribution** (sideload / self-hosted registry) and, if we choose it, the **Start9 Community Registry**.

This repo does **not** yet contain a `*-startos` package; packaging will live in a separate repository (convention: `bitbudget-startos`) cloned from [hello-world-startos](https://github.com/Start9Labs/hello-world-startos).

Community registry submission expects a **public GitHub repo**; serious StartOS distribution aligns with **open source** so users and developers can **verify, don’t trust** privacy and security claims. See [Open source, trust, and intellectual property](#open-source-trust-and-intellectual-property) below.

---

## Open source, trust, and intellectual property

> **Not legal advice.** This section is an engineering inventory and strategic notes for internal planning. Patentability, prior art, license choice, and enforcement require qualified IP counsel reviewing the repo and business goals.

### Why open source matters here

| Goal | How open source helps |
|------|------------------------|
| StartOS / sovereign hosting | Users can audit what runs on their hardware: encryption paths, what the server stores, ledger behavior, cron/funding logic. |
| “Own your own data” | Aligns with product ethos; closed binaries on a home server do not prove claims. |
| Community registry | Start9’s pipeline is built around **public** repos; trust is social and technical. |

Open source does **not** automatically forbid patents (license terms matter). It **does** mean **trade secrets embedded in source** (prompts, thresholds, referral tuning) are exposed once published.

This application repo has **no `LICENSE` file** yet; choosing a license is a separate decision from whether to pursue patents.

### Open source vs other protection (overview)

| Mechanism | What it protects | vs open source |
|-----------|------------------|----------------|
| **Published source + reproducible builds** | Trust, auditability | Core strategy for StartOS |
| **Copyright + license** (MIT, Apache-2.0, AGPL-3.0, etc.) | Use and redistribution terms | Required choice when publishing |
| **Trademark** (“BitBudget”, logo) | Brand; not the code | Still works |
| **Hosted SaaS** | Convenience, integrations, support | “Open core” — self-host fork vs managed product |
| **Patents** | Exclude others from claimed methods (if granted/enforced) | Possible alongside OSS with patent grant in license; culture and cost often poor fit for small teams |
| **Trade secrets** | Unpublished know-how | **Lost** for anything in public repo |

**Practical bias for BitBudget:** open-source the stack users must trust; compete on brand, hosted offering, and execution—not on hiding ledger or crypto code. Do **not** delay open source solely for speculative patents unless counsel identifies a concrete, worth-the-cost claim strategy.

### Technical inventory (what is distinctive)

Below maps **implemented behavior** to primary code areas. Distinctive **product/engineering** does not imply **patent-worthy** (see next subsection).

#### Pay-yourself-first ledger, funding, sweep

| Behavior | Primary paths |
|----------|----------------|
| Income credits **system Savings** first; discretionary envelopes funded via hidden allocation legs (`excludeFromMainHistory`) | `lib/envelope-funding.ts`, `lib/constants.ts` |
| Idempotent fund/sweep batches (`EnvelopeFundingBatch`, period keys) | `prisma/schema.prisma`, `lib/envelope-funding-cron.ts` |
| Pay cadence (monthly/weekly/biweekly/daily) + **cent-exact** splits across paydays/month fractions | `lib/payday-cadence.ts`, `lib/envelope-funding-period.ts` |
| Irregular income: proportional split with floor + max-heap spare cents | `lib/irregular-income-split.ts` |
| Sweep policies (reset / carry_forward / capped) + month **pacing** for manual reset suggestions | `lib/sweep-math.ts`, `lib/envelope-sweep.ts` |
| Remaining = all-time balance vs current-month scope (UI + server alignment) | `lib/data.ts`, `lib/envelope-balance-server.ts`, `lib/savings-ui-metrics.ts` |
| Savings goals, streaks, achievements, year-end recap | `lib/savings-goal.ts`, `lib/achievements.ts`, `lib/year-end-recap.ts` |

“Pay yourself first” and envelope budgeting are **old ideas**; the combo of hidden legs, encrypted system labels, and cron idempotency is **implementation**, not a obviously broad invention.

#### Privacy and encryption

| Behavior | Primary paths |
|----------|----------------|
| Client privacy key (PBKDF2 + AES-GCM); field encryption; X25519 sealed-box for server-created rows | `lib/crypto.ts`, `lib/server-encrypt.ts` |
| `POST /api/user/encryption` — **409** if wrapped key already set (no silent rotation) | `app/api/user/encryption/route.ts` |
| Nostr: npub on server; nsec via extension / PIN-wrapped local storage only | `lib/auth.ts`, AGENTS.md |
| Payee learning: **SHA-256(payee)** on server, not merchant plaintext | `lib/envelope-matcher.ts`, `prisma` `PayeeEnvelopeMapping` |
| Confidence router: high confidence → live `Transaction`; else `PendingTransaction` inbox | `lib/confidence-router.ts` |
| Client decrypt cache (IndexedDB + privacy key TTL) | `lib/txn-cache.ts`, `lib/privacy-key-storage.ts` |

Best **verify-don’t-trust** story in the codebase. Similar hybrid encryption patterns exist elsewhere; value is **auditable correctness**, not secrecy of the approach.

#### Opportunity cost (Bitcoin layer)

| Behavior | Primary paths |
|----------|----------------|
| `satsAmount` from **BTC price on transaction date**; historical cache/backfill | `lib/btc-price.ts`, `Transaction.satsAmount` |
| OC UI gated by `opportunityCostEnabled`; savings-mode ranking on Savings inflows | `components/top-opportunity-costs.tsx`, `lib/btc-price-context.tsx` |

Unusual **product positioning** vs live fiat→BTC converters; patent outlook still uncertain (abstract-idea risk).

#### Capture pipeline (receipt, email, Plaid, voice)

| Behavior | Primary paths |
|----------|----------------|
| Magic-byte receipt validation; GPT vision/text | `lib/receipt-scan-validate.ts`, `app/api/receipts/scan/route.ts` |
| Inbound email + per-user `receiptInboxToken` | `app/api/webhooks/inbound-email/route.ts` |
| Plaid sync + dedupe claim; encrypt + confidence route | `app/api/webhooks/plaid/route.ts` |
| Recurring due-date processor | `lib/recurring.ts` |

Mostly **commodity stack** (GPT, Plaid, webhooks). Differentiation is **privacy-preserving routing**, not novel parsers.

#### Referral program

| Behavior | Primary paths |
|----------|----------------|
| Redeem window, Plaid-gated **activation**, trial/gratis stacking, OC flag inheritance | `lib/referral.ts`, `lib/subscription.ts` |

**Commercial rules**, not a technical moat; weak patent fit; weakened as trade secret if open-sourced.

#### Mostly standard (lower differentiation)

Auth.js + Prisma, envelope CRUD, CSV import (client encrypt), Tailwind UI, GPT prompts for matching/receipts — necessary, not unique IP.

### Patent candidacy (engineering view only)

Nothing in the repo clearly demands “file a provisional immediately.” Areas **counsel might** explore for **narrow** claims (still may fail prior art or §101 in the US):

1. **Integrated ledger + privacy pipeline** — mandatory Savings hub, hidden funding legs, server asymmetric encryption of system-generated labels, user-only decryption for user-authored fields, idempotent batch keys.
2. **Privacy-preserving auto-categorization** — hashed payee learning + confidence tiers + encrypted pending vs posted split without server-side merchant plaintext for learning.
3. **Historical opportunity-cost ledger** — per-txn sats from date-indexed price, tied to savings/funding transaction sources and UI modes.

Broad patents on “envelope budgeting” or “encrypting budget data” are unlikely to be viable.

### What is still worth protecting without patenting

| Asset | Notes |
|-------|--------|
| **Brand / trademark** | Product name and mark independent of license |
| **Hosted service** | Keys for Plaid, email, SMS, managed uptime — not in self-host tarball |
| **Documentation & threat model** | Public artifact; replaces “trust us” for crypto/ledger |
| **License terms** | AGPL if network copyleft desired; Apache-2.0 if permissive + patent grant preferred |

### Open decisions (record)

- [ ] **License** for app repo (and future `bitbudget-startos` repo if separate)
- [ ] **Scope** of publication: full monorepo vs exclude admin-only scripts, marketing-only assets
- [ ] **Patents:** none vs defensive publication vs provisional(s) — **counsel**
- [ ] **Open-core boundary:** which integrations remain hosted-only on start9/bitbudget SaaS if any

### Checklist before counsel review

Bring this doc plus:

- [AGENTS.md](../AGENTS.md) (privacy rules)
- `lib/envelope-funding.ts`, `lib/crypto.ts`, `app/api/user/encryption/route.ts`, `lib/envelope-matcher.ts`, `lib/confidence-router.ts`, `lib/referral.ts`
- Business intent: StartOS-only self-host vs dual SaaS + self-host

Ask counsel: license recommendation, whether any provisional is justified, and whether public repo history creates disclosure issues for filings already planned.

---

## What a StartOS package is

StartOS installs **services**, not arbitrary binaries. Each service is a **`.s9pk`** archive: TypeScript package metadata + Docker image(s) + lifecycle hooks (install, update, uninstall, health, actions, interfaces, dependencies).

The wrapper can:

- Run code on install, update, and uninstall
- Expose LAN / Tor / clearnet interfaces
- Define user-facing actions and tasks
- Declare dependencies on other StartOS services (e.g. PostgreSQL)
- Offer encrypted backups of selected volumes

Packaging is intentionally separate from the main application repo: the app is containerized; the `*-startos` repo describes how StartOS runs and upgrades it.

---

## Toolchain

| Tool | Role |
|------|------|
| [start-cli](https://github.com/Start9Labs/start-cli) | Validate, pack, publish `.s9pk` |
| Docker | Build container images embedded in the package |
| Node.js 22 (LTS) | Compile TypeScript manifest / `main` / versions |
| GNU Make + `s9pk.mk` | `make` → `.s9pk`; optional `make install` to a dev device |
| squashfs-tools | Filesystem images inside the package |
| StartOS device or VM | End-to-end install/update testing |

Install and verify per [Environment Setup](https://docs.start9.com/packaging/0.4.0.x/environment-setup.html).

Recommended AI-assisted layout (optional): workspace with `start-docs/`, `CLAUDE.md` from Start9, and your `*-startos` repo alongside—not inside—the package repo.

---

## Project layout (typical `*-startos` repo)

```
my-service-startos/
├── Makefile              # includes s9pk.mk
├── s9pk.mk               # shared build targets (from template)
├── package.json
├── docker/               # Dockerfiles
├── startos/
│   ├── manifest/         # metadata, images, release notes
│   ├── main.ts           # daemons, health, lifecycle
│   ├── versions/         # ExVer graph + migrations
│   └── init/             # setupOnInit, seed files, tasks
└── README.md             # user-facing; no version numbers in README (Start9 rule)
```

See [Project Structure](https://docs.start9.com/packaging/0.4.0.x/) and [Recipes](https://docs.start9.com/packaging/0.4.0.x/recipes.html) for patterns (dependencies, backups, interfaces, etc.).

---

## Development workflow

### 1. Bootstrap

- Create repo from [hello-world-startos](https://github.com/Start9Labs/hello-world-startos) (GitHub “Use this template” → name `something-startos`).
- Clone, `npm install`, adapt `manifest`, Dockerfiles, and `main` for your service.

### 2. Build

```bash
npm install
make              # all arches, or: make x86 | make arm | make universal
```

Produces e.g. `hello-world_x86_64.s9pk` in the project root.

### 3. Install on a dev StartOS server

**Option A — Sideload:** StartOS UI → **Sideload** → upload `.s9pk`.

**Option B — CLI install:** Configure `~/.startos/config.yaml` with `host: http://your-server.local`, then:

```bash
make install
```

### 4. Iterate

Use [Recipes](https://docs.start9.com/packaging/0.4.0.x/recipes.html) for Postgres, reverse proxy, env secrets, health checks, etc. Test install → start → UI → health green → uninstall → reinstall.

---

## Distribution: getting packages onto devices

Every `.s9pk` must be reachable through a **registry** (URL users add in StartOS). You are not required to use Start9’s registry.

### Path A — Self-hosted registry (full control)

1. Install a registry service on StartOS (e.g. from an existing registry package).
2. Expose it (LAN, Tor `.onion`, or clearnet).
3. Publish:

```bash
start-cli s9pk publish \
  --url=https://my-registry.example.com \
  myservice_x86_64.s9pk
```

4. Users add your registry URL and install/update from the catalog.

Reference: [Publishing — Self-Hosted Registry](https://docs.start9.com/packaging/0.4.0.x/publishing.html).

### Path B — Start9 Community Registry (“marketplace”)

Current process is **email + GitHub**, not self-service (developer portal planned).

| Stage | Registry URL | How builds arrive |
|-------|----------------|-------------------|
| **alpha** | `https://community-alpha-registry-x.start9.com` | **Automatic** on merge to Start9-Community fork |
| **beta** | `https://community-beta-registry.start9.com` | Request via `submissions@start9.com` or fork issue |
| **production** | `https://community-registry.start9.com` | Request after beta soak |

**Initial submission**

1. Email **submissions@start9.com** with a link to a **public** GitHub repo.
2. Start9 forks into [Start9-Community](https://github.com/Start9-Community); you address feedback via PRs to **that fork** (fork becomes upstream for the pipeline).

**Ongoing changes**

1. Open PR on the community fork.
2. On merge → CI builds, tags, publishes to **community-alpha** (no manual `start-cli publish` for that step).
3. Email/issue to promote to beta, then production.

You can run a **private alpha registry** in parallel while community builds mature.

**Pre-publish checklist** (required before community PR merge — bad merges ship straight to alpha):

1. Git tag matches [Git Tag Conventions](#git-tags-and-releases) (below).
2. `tsc --noEmit`, tests, and pack step green.
3. README matches actions, volumes, ports, dependencies (no version numbers in README).
4. Tested end-to-end on StartOS (install, update path if applicable, uninstall/reinstall).

---

## Releasing software updates to StartOS packages

This is the full loop from “new app or wrapper code” to “users can upgrade on their server.” It spans **version numbering**, **migrations**, **build/publish**, and **what happens on the device**.

### Overview

| Layer | Who acts | What happens |
|-------|----------|----------------|
| **Version & migrations** | Maintainer in `*-startos` repo | Bump ExVer, add/change `startos/versions/*`, implement `up`/`down` if data must move |
| **Build artifact** | `make` / CI | New `.s9pk` for each arch (or universal) |
| **Registry** | You or Start9 automation | New package revision indexed at registry URL |
| **User device** | Server owner | StartOS shows update when registry has newer version; user approves update (same trust model as install) |

Updating **StartOS itself** (the OS) is a separate flow from updating **installed services**. Service updates are driven by the registry + package version graph.

### Extended versioning (ExVer)

StartOS uses **Extended Versioning** so wrapper releases can move independently of upstream app releases.

Format:

```
[#flavor:]<upstream>[-upstream-prerelease]:<downstream>[-downstream-prerelease]
```

| Part | Meaning | Example |
|------|---------|---------|
| `flavor` | Optional fork identifier (not for GPU/hardware variants) | `#libre:` |
| `upstream` | Upstream app version (SemVer) | `26.0.0` |
| `upstream-prerelease` | Upstream pre-release | `-beta.1` |
| `downstream` | StartOS wrapper revision | `0`, `1`, `2` |
| `downstream-prerelease` | Wrapper pre-release | `-alpha.0`, `-beta.0` |

Examples: `26.0.0:0` (stable wrapper 0 on upstream 26.0.0), `2.3.2:1-beta.0` (wrapper 1 beta on upstream 2.3.2).

**When to bump what**

| Change type | Upstream | Downstream | Typical action |
|-------------|----------|------------|----------------|
| New upstream app release (e.g. BitBudget tag `v1.2.0`) | Bump to match | Reset to `0` | New Docker tag, submodule/tag, new version file |
| Wrapper-only (manifest, health, StartOS UX, pin) | Unchanged | Increment (`0` → `1`) | Often update version file in place (see below) |
| Alpha iteration (`-alpha.0` → `-alpha.1`) | May be unchanged | Prerelease bump | **Rename version file in place**; keep `other: []` |
| Promote alpha → beta → stable | Unchanged or bumped | Drop or advance prerelease | **New version file**; move old `current` into `other` for migration chain |

Keep **Docker image tag**, **git submodule tag** (if used), and **version file** in sync for upstream `X.Y.Z`. See [Versions](https://docs.start9.com/packaging/0.4.0.x/versions.html).

Version files live under `startos/versions/` (e.g. `v1.0.0.0.a0.ts` for `1.0.0:0-alpha.0`). `index.ts` exports `versionGraph` with `current` and `other` (historical versions that need migration edges).

### Migrations on update

When a user moves from version A → B, StartOS runs **`migrations.up`** from the version graph path. Use this only for **wrapper-owned state** (configs, volumes, StartOS stores)—not for data the upstream app migrates itself (e.g. Prisma inside the container).

```typescript
migrations: {
  up: async ({ effects }) => { /* move config, reshape files */ },
  down: IMPOSSIBLE, // or rollback when safe
}
```

Use `IMPOSSIBLE` for `down` on initial versions or irreversible changes.

**When to add a new version file vs edit in place**

- **New file:** new `up`/`down` migration, or you want prior release notes preserved in git history.
- **Edit in place:** wrapper-only bump with no migration and no need to keep old notes file; rename file to new version string and update `version` + `releaseNotes`.

### Git tags and releases

Releases are tied to **git tags**. Format ([Versions — Git Tag Conventions](https://docs.start9.com/packaging/0.4.0.x/versions.html)):

```
v{upstream}_{downstream}[-prerelease]
```

Colon in ExVer becomes underscore in the tag (tags cannot contain `:`).

| Package version | Git tag |
|-----------------|---------|
| `26.0.0:0` | `v26.0.0_0` |
| `0.13.5:0-alpha.0` | `v0.13.5_0-alpha.0` |
| `2.1.0:7-beta.5` | `v2.1.0_7-beta.5` |

Push tags explicitly: `git push origin <tag>` (avoid blind `git push --tags`).

### Release workflow by distribution channel

#### Self-hosted registry

1. Implement version bump + migrations (if any).
2. Update `releaseNotes` in the version module (localized strings in `VersionInfo`).
3. Run pre-publish checks (build, verify, README, on-device test **including upgrade from previous version**).
4. `make` (or CI) to produce `.s9pk`.
5. `start-cli s9pk publish --url=<registry> <file>.s9pk`.
6. Users with your registry configured see the new version and can update from the StartOS UI.

#### Start9 Community Registry

1. Same version/migration/README/testing work on the **Start9-Community fork**.
2. Open PR → review → **merge**.
3. Automation builds, tags, and deploys to **community-alpha** (you do not run publish yourself for that step).
4. When ready for wider exposure: email **submissions@start9.com** or open a fork issue to promote **alpha → beta → production**.

Every version bump is **another PR** through the same pipeline; merge always lands on alpha first.

### Maintainer release checklist (each version)

Use this for every release, not only the first publish:

- [ ] ExVer string and git tag aligned; Docker/submodule tags match upstream if applicable
- [ ] `releaseNotes` updated (all required locales in template)
- [ ] Migration `up` tested from **previous shipped** version (not only fresh install)
- [ ] `down` behavior understood (`IMPOSSIBLE` documented if used)
- [ ] `tsc --noEmit`, tests, pack/verify green
- [ ] README still accurate (no version numbers in README body)
- [ ] Installed on dev StartOS: upgrade path green, health checks pass, critical actions work
- [ ] Publish path executed (self-hosted `start-cli publish` or community PR merged)
- [ ] If community: note whether this build should stop at alpha or be promoted to beta/prod

### What users experience

1. Their StartOS server checks registries they trust.
2. When a **newer package version** exists for an installed service, the UI offers an **update** (user-initiated; not silent forced upgrade of the service).
3. StartOS downloads the new `.s9pk`, runs version migrations, restarts daemons per `main` / health configuration.
4. If something fails, logs and health checks surface in the service detail UI; maintainers document rollback/limitations in README and release notes.

For breaking changes, use release notes and optional manifest **alerts** to warn before or during update.

---

## BitBudget-specific considerations (draft)

Packaging BitBudget is feasible but non-trivial compared to a single-container app:

| Area | Notes |
|------|--------|
| **Stack** | Next.js + PostgreSQL + Prisma; likely app container + Postgres as StartOS **dependency** or bundled sidecar |
| **Secrets** | `AUTH_SECRET`, DB URL, encryption-related config via StartOS file models / stores—not baked into image |
| **Integrations** | Plaid, OAuth (Google/GitHub), email OTP, SMS, Nostr may need clearnet egress or documented “optional / off on StartOS” |
| **Privacy** | Client-side encryption model unchanged; server must not log decrypted fields; align with AGENTS.md |
| **Updates** | App schema via Prisma migrations inside container; wrapper migrations only for StartOS-mounted config/volumes |
| **Backups** | Define volumes for DB and any uploaded assets; test restore on `kind: 'restore'` in `setupOnInit` |

Treat **v1 StartOS** as a scoped slice (e.g. self-hosted vanilla, no Plaid) unless we explicitly design for full integration parity.

---

## Future: StartOS 0.4 networking

StartOS **0.4** is a ground-up rewrite (public beta as of 2025–2026). Tor is still supported but is an **optional plugin**; Start9’s own update copy notes that most users are better served by other options. See [Update to StartOS 0.4.0](https://docs.start9.com/start-os/0.4.0.x/update-040.html) and [v0.4.0 release notes](https://github.com/Start9Labs/start-os/blob/master/core/src/version/update_details/v0_4_0.md).

Relevant pieces for “BitBudget away from home”:

| Capability | What it gives you |
|------------|-------------------|
| **WireGuard VPN gateways** | Encrypted tunnel from phone/laptop to the server; access services on LAN-style ports without Tor Browser. |
| **LAN port forwarding + per-service ports** | Services on unique ports of the server’s main `.local` host (non-HTTP TCP supported on LAN). |
| **Private / public clearnet domains** | Built-in DNS + Let’s Encrypt for HTTPS on a domain you control. |
| **StartTunnel** | WireGuard **reverse** tunnel via a small VPS — public HTTPS without exposing home IP (similar idea to Tailscale funnel / cloudflare tunnel). |
| **Router port forward** | Direct clearnet exposure (reveals home IP to visitors). |

**Packaging implication:** Service `interfaces` in 0.4.x packages can expose **LAN, Tor, and clearnet** choices; the OS routes traffic through gateways. That is the “secure TCP/IP” direction — VPN and TLS-terminated clearnet, not only onion services.

**Still hard for full BitBudget:** Even with VPN/clearnet to *reach* the app, **third-party callbacks** (Plaid, OAuth, inbound email webhooks) need a stable public URL and outbound internet unless those features are disabled on the StartOS build. A minimal self-hosted edition (manual entry, no Plaid, limited auth) remains the realistic first package.

Watch: 0.4 is beta; backup format and services break from 0.3.5.x — any future packaging effort should target **0.4.x SDK / `.s9pk`** only.

---

## References

| Topic | URL |
|-------|-----|
| Packaging index | https://docs.start9.com/packaging/0.4.0.x/ |
| Quick start | https://docs.start9.com/packaging/0.4.0.x/quick-start.html |
| Environment setup | https://docs.start9.com/packaging/0.4.0.x/environment-setup.html |
| Publishing & community pipeline | https://docs.start9.com/packaging/0.4.0.x/publishing.html |
| Versions & migrations | https://docs.start9.com/packaging/0.4.0.x/versions.html |
| Makefile / `make install` | https://docs.start9.com/packaging/makefile.html |
| Hello World template | https://github.com/Start9Labs/hello-world-startos |
| Community submission | submissions@start9.com |

---

## Related internal docs

- [Self-hosting plan (OSS + Docker)](./self-hosting-plan.md) — primary distribution path while StartOS is deferred.
- [CI](./ci.md) — GitHub Actions for this application repo (separate from StartOS package CI on the fork).
- [AGENTS.md](../AGENTS.md) — privacy, encryption, and product constraints that apply to any StartOS build.
