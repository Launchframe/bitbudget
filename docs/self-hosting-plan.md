# Self-hosting plan: open source + Docker

Plan for publishing BitBudget as open source and running it on a home PC or server via Docker. **StartOS packaging remains deferred** ([startos-packaging.md](./startos-packaging.md)); standard OSS + containers is the near-term path and reaches a wider audience.

> **Not legal advice.** License and IP choices are summarized in [startos-packaging.md § Open source, trust, and intellectual property](./startos-packaging.md#open-source-trust-and-intellectual-property). Confirm with counsel before public release.

---

## End goal

A technical user can:

1. **Obtain** the app — clone the public repo and build, or download a pre-built container image from a registry (GitHub Container Registry, etc.).
2. **Configure** secrets and `NEXT_PUBLIC_APP_URL` for how they will reach the server.
3. **Run** `docker compose up` (app + PostgreSQL + optional reverse proxy).
4. **Use** BitBudget from home LAN and, with one of the networking options below, from a phone at the store or on a road trip.

Privacy claims remain verifiable: client-side encryption, server ciphertext, and ledger behavior are auditable in source (see [AGENTS.md](../AGENTS.md)).

---

## What we ship today (baseline)

| Component | Today | Self-host implication |
|-----------|--------|------------------------|
| Runtime | Next.js 16 (`next build` / `next start`) | Single app container; Node ≥ 20 |
| Database | PostgreSQL (Prisma) | Required sidecar or external Postgres |
| Migrations | `prisma migrate deploy` in `pnpm build` | Run on container start or one-shot init job |
| Cron | Vercel Cron → `/api/cron/*` with `CRON_SECRET` | Host **cron**, **systemd timer**, or sidecar that `curl`s endpoints |
| Auth | Auth.js v5 — email OTP, Nostr, optional Google/GitHub | `AUTH_SECRET`, `AUTH_URL` / `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` must match browser URL |
| Optional integrations | Plaid, SendGrid inbound, Twilio SMS, OpenAI, Gmail SMTP, Nostr DMs | Each needs clearnet egress and often a **public HTTPS URL** for webhooks |

There is **no Dockerfile or compose file** in the repo yet; `.env.example` is the env contract.

---

## Phase 1 — Open source the repository

### 1.1 License and legal hygiene

| Task | Notes |
|------|--------|
| Choose a license | Candidates: **AGPL-3.0** (strong copyleft for network use), **Apache-2.0** (permissive + patent grant), **MIT** (simplest). Align with [IP notes](./startos-packaging.md#open-source-trust-and-intellectual-property). |
| Add `LICENSE` | Root of repo |
| Add `NOTICE` / third-party attributions | If required by dependencies |
| Confirm no proprietary assets in `public/` | Fonts, images, trademarks |
| Scrub history (if needed) | No secrets in git; rotate any leaked keys |

### 1.2 Documentation for operators and contributors

| Document | Purpose |
|----------|---------|
| `README.md` (rewrite ops section) | Quick start: Docker, env table, link to this plan |
| `docs/self-hosting.md` | Operator guide (shorter than this plan): compose, backups, upgrades |
| `SECURITY.md` | How to report vulnerabilities; threat model summary |
| `.env.example` | Already exists — extend with `AUTH_URL`, self-host notes, feature flags |
| `CONTRIBUTING.md` | Build, test, PR expectations (`pnpm lint`, `pnpm test`) |

### 1.3 Repository hygiene

| Task | Notes |
|------|--------|
| Set `"private": false` in `package.json` when ready | Or keep private until launch day |
| CI stays public-friendly | GitHub Actions already runs lint/vitest/e2e; document required secrets for forks |
| Pre-built images | Publish `ghcr.io/<org>/bitbudget:<tag>` on release tags (Phase 2) |
| Disable or gate hosted-only features | Document which env vars are optional for **minimal** self-host |

### 1.4 Minimal vs full feature matrix (self-host)

Use this to set expectations in README and to implement `SELF_HOST_MODE` or simply “leave integrations unset.”

| Feature | Minimal self-host | Full parity (harder) |
|---------|-------------------|----------------------|
| Manual transactions + envelopes + ledger | Yes | Yes |
| Email OTP sign-in | Yes if SMTP configured | Yes |
| Nostr sign-in | Yes (extension; no server nsec) | Yes |
| Google / GitHub OAuth | Needs public HTTPS callback URL | Optional |
| Receipt scan (OpenAI) | Optional key | Optional |
| Plaid | Needs public webhook URL + Plaid dev/prod keys | Optional |
| Inbound receipt email (SendGrid) | Needs public webhook URL | Optional |
| SMS capture (Twilio) | Needs public webhook URL | Optional |
| Referral / premium crons | Optional; cron + secrets | Optional |
| Vercel Analytics | Off or noop on self-host | N/A |

**Recommended v1 self-host story:** Postgres + app + email OTP + Nostr + manual/receipt upload without inbound webhooks.

---

## Phase 2 — Dockerize the application

### 2.1 Target topology

```text
┌─────────────────────────────────────────────────────────────┐
│  Home server / PC                                            │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │   Caddy or   │    │   bitbudget  │    │  PostgreSQL   │ │
│  │   Traefik    │───▶│   (Next.js)  │───▶│  (volume)     │ │
│  │   :443       │    │   :3000      │    │  :5432        │ │
│  └──────────────┘    └──────────────┘    └───────────────┘ │
│         ▲                    ▲                               │
│         │                    │ cron (host or sidecar)        │
└─────────┼────────────────────┼───────────────────────────────┘
          │                    │
     Internet / VPN          CRON_SECRET → /api/cron/*
```

### 2.2 Deliverables (repo files to add)

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage: deps → `prisma generate` → `next build` → slim runtime with `next start` |
| `docker-compose.yml` | `app` + `db` services, volumes, healthchecks, env from `.env` |
| `docker-compose.proxy.yml` | Optional Caddy/Traefik + TLS (profile `with-proxy`) |
| `.dockerignore` | Exclude `node_modules`, `.next`, e2e artifacts |
| `scripts/docker-entrypoint.sh` | Wait for Postgres → `prisma migrate deploy` → exec `node server.js` |

### 2.3 Dockerfile design notes

- **Base image:** `node:22-bookworm-slim` (match AGENTS.md Node ≥ 20).
- **Build:** `pnpm install --frozen-lockfile`, `prisma generate`, `next build` with `output: 'standalone'` in `next.config` if not already (reduces image size).
- **Runtime env:** `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.
- **Do not bake secrets** into the image; inject via compose env file.
- **Canvas/pdf native deps:** `@napi-rs/canvas` and `pdf-parse` may need OS libraries in the image — verify in CI build.

### 2.4 Compose services

**`db`**

- Image: `postgres:16-alpine`
- Volume: `pgdata:/var/lib/postgresql/data`
- Env: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- Healthcheck: `pg_isready`

**`app`**

- Build context: `.`
- Depends on: `db` healthy
- Env: map from `.env.example` (see below)
- `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: point at `db:5432` (no SSL inside compose network)
- Ports: `3000:3000` for LAN-only; omit public bind when using reverse proxy only

**Cron (pick one)**

| Approach | Pros | Cons |
|----------|------|------|
| Host crontab | Simple | User must install curl and secret |
| `cron` sidecar in compose | Portable | Extra container |
| Built-in scheduler in app | No external cron | New code; not in plan v1 |

Document example crontab lines matching [vercel.json](../vercel.json) schedules.

### 2.5 Required environment variables (self-host)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `DATABASE_URL_UNPOOLED` | Yes | Same DB for migrations (Prisma) |
| `AUTH_SECRET` | Yes | ≥ 32 chars; `npx auth secret` |
| `AUTH_URL` | Yes | **Exact browser origin** (e.g. `https://budget.example.com`) |
| `NEXTAUTH_URL` | Yes | Same as `AUTH_URL` (Auth.js v5) |
| `NEXT_PUBLIC_APP_URL` | Yes | Same origin; referral links, OAuth redirects |
| `CRON_SECRET` | Yes for funding/recurring | Bearer token for cron routes |
| `GMAIL_*` | For email OTP | Or document alternative SMTP later |
| Integration keys | Optional | Plaid, SendGrid, Twilio, OpenAI per feature matrix |

### 2.6 Build and publish pipeline

| Step | Action |
|------|--------|
| CI job `docker build` | On PR: build only; on tag: push to GHCR |
| Tag scheme | `v0.2.0`, `latest`, optional `sha-abc123` |
| Supply chain | Generate SBOM (optional); sign images (optional later) |
| Upgrade path | `docker compose pull && docker compose up -d`; run migrations via entrypoint |

### 2.7 Backups and restore

| Data | Method |
|------|--------|
| PostgreSQL | `pg_dump` / volume snapshot of `pgdata` |
| User uploads (if any local files added later) | Volume backup |
| Operator doc | Restore = stop app → restore DB → start app |

Encryption keys are **client-side**; server backup is ciphertext + wrapped privacy keys — users still need PIN/Nostr to decrypt.

---

## Phase 3 — Remote access (home server → phone away from home)

This is the main operational difficulty for self-hosting. The app is a **web UI**; the phone needs a **reachable HTTPS (or trusted VPN) origin** that matches `NEXT_PUBLIC_APP_URL` and Auth.js cookies.

### 3.1 Requirements checklist

Whatever path you choose must satisfy:

- [ ] Browser can load the app URL (TLS strongly recommended for Secure cookies).
- [ ] `NEXT_PUBLIC_APP_URL`, `AUTH_URL`, and `NEXTAUTH_URL` equal that origin (no localhost mismatch).
- [ ] Session cookies work on mobile Safari/Chrome (SameSite defaults; HTTPS helps).
- [ ] Optional: OAuth redirect URIs registered for that host.
- [ ] Optional: Webhook URLs (Plaid, SendGrid, Twilio) point at the same host if those features are enabled.
- [ ] Client-side encryption / Nostr extension still work (no special server change).

### 3.2 Options (recommended order for home users)

#### A. VPN into home LAN (recommended default)

**How:** WireGuard, Tailscale, or similar on the home server and phone. User opens `http://100.x.x.x:3000` or `http://nas.local:3000` only while VPN is on.

| Pros | Cons |
|------|------|
| No exposure of app to public internet | Must connect VPN before use |
| Best privacy; smallest attack surface | Slightly fiddly for non-technical family |
| Works with LAN-only compose (no port 443 on router) | No inbound webhooks unless you add tunnel for webhooks only |

**Fit for BitBudget:** Supermarket and road trip use **after** one-tap VPN connect — same as accessing a home NAS. Document Tailscale/WireGuard in `docs/self-hosting.md`.

#### B. Private reverse proxy + your domain (HTTPS at home)

**How:** Caddy or Traefik on the home server; port forward 443 on router; DNS A/AAAA to home (or dynamic DNS). Let’s Encrypt HTTP-01 or DNS-01.

| Pros | Cons |
|------|------|
| Normal URL (`https://budget.example.com`) | Exposes home IP (unless using proxy/CDN) |
| OAuth and webhooks possible | Router configuration; ISP may block 443 |
| No VPN step for daily use | TLS and cert renewal ops burden |

Set all URL env vars to `https://budget.example.com`.

#### C. Outbound tunnel (no port forward)

**How:** Cloudflare Tunnel (`cloudflared`), Tailscale Funnel, ngrok, or similar — tunnel agent on home server publishes HTTPS to a hostname.

| Pros | Cons |
|------|------|
| Works behind CGNAT / no router changes | Trusts tunnel provider |
| Stable public URL for webhooks | Free tiers may have limits |
| Good for “road trip without VPN” | Traffic may traverse third party |

**Fit for BitBudget:** Strong candidate for **optional** one-command compose profile `with-tunnel` (document `cloudflared` config; don’t mandate a vendor).

#### D. StartOS 0.4-style (future)

WireGuard gateways, StartTunnel, clearnet domains on the appliance — same tradeoffs as B/C but integrated on StartOS. See [startos-packaging.md § Future: StartOS 0.4 networking](./startos-packaging.md#future-startos-04-networking). Not the first deliverable for generic Docker.

#### E. Public Wi‑Fi / cellular without VPN or tunnel

**Not supported** for pure home-LAN-only installs. If the app is not on the internet and the phone is not on VPN, there is no route to the server.

### 3.3 Decision guide (for README)

```text
                    ┌─────────────────────────────────────┐
                    │  Do you need Plaid / inbound email  │
                    │  webhooks from the public internet? │
                    └─────────────────┬───────────────────┘
                          yes         │         no
                           ▼          │          ▼
              ┌──────────────────┐   │   ┌──────────────────┐
              │ HTTPS public URL │   │   │ VPN-only is OK   │
              │ (B, C, or D)     │   │   │ (A) — simplest   │
              └──────────────────┘   │   └──────────────────┘
```

### 3.4 Mobile UX notes

- Add to home screen (PWA) is optional future work; today treat as **responsive web** in mobile browser.
- Test on LTE with VPN/tunnel: unlock flow (PIN / Nostr), new transaction, sync after refresh.
- Warn users: **public HTTP** without TLS may break auth cookies on mobile.

### 3.5 Hardening for any public exposure

| Measure | Notes |
|---------|--------|
| TLS everywhere | Caddy auto-HTTPS or tunnel |
| Strong `AUTH_SECRET` / `CRON_SECRET` | Rotate on compromise |
| Firewall | Only 443 (or tunnel egress only) |
| Fail2ban / rate limits | Optional; consider at reverse proxy |
| Disable unused integrations | Smaller webhook surface |
| No `E2E_TEST` in production | Per AGENTS.md |

---

## Phase 4 — Implementation roadmap

Ordered work streams with rough dependencies.

| # | Work | Depends on | Outcome |
|---|------|------------|---------|
| 1 | License + `SECURITY.md` + README stub | Counsel / decision | Legal clarity |
| 2 | `next.config` standalone output + Dockerfile + compose | — | `docker compose up` works locally |
| 3 | Entrypoint migrations + healthchecks | 2 | Reliable first boot |
| 4 | `docs/self-hosting.md` operator guide | 2 | VPN + env URL docs |
| 5 | Cron documentation + example script | 2 | Funding/recurring on self-host |
| 6 | CI: build/push image on release tag | 2 | Downloadable images |
| 7 | Optional `docker-compose.proxy.yml` (Caddy) | 2 | HTTPS at home |
| 8 | Optional tunnel doc (Cloudflare/Tailscale) | 4 | Road-trip without VPN |
| 9 | Feature flags / docs for disabling Plaid webhooks | 1 | Clear minimal edition |
| 10 | Public repo flip + announcement | 1–6 | Open source live |

**Suggested v1 milestone:** Complete **1–6** with **VPN (3.2 A)** as the primary documented access path; add **7–8** as optional compose profiles.

---

## Phase 5 — Testing self-host

| Test | How |
|------|-----|
| Fresh install | Empty volume → compose up → onboarding → encryption setup |
| Upgrade | Pull new image → migrate → existing user data intact |
| VPN path | Phone on LTE + Tailscale → create transaction |
| Public URL path | Tunnel or reverse proxy → OAuth (if enabled) + email OTP |
| Cron | Hit `/api/cron/recurring` with `CRON_SECRET` → seeded recurring posts |
| Security | No decrypted payees in server logs; `curl` webhooks without signature fail |

Add optional `e2e/self-host.smoke.spec.ts` later (Playwright against compose) — not blocking v1.

---

## Open questions (track here)

- [ ] **License:** AGPL vs Apache vs MIT
- [ ] **Image signing** and provenance requirements
- [ ] **SMTP:** document Gmail app password only vs generic SMTP env
- [ ] **Analytics:** disable `@vercel/analytics` on self-host or make opt-in
- [ ] **Referral/premium** on self-host: disable vs full parity
- [ ] **Single-container** Postgres + app vs separate (separate recommended)

---

## Related docs

- [startos-packaging.md](./startos-packaging.md) — deferred; OSS + Docker first
- [ci.md](./ci.md) — CI for app repo
- [AGENTS.md](../AGENTS.md) — privacy, encryption, testing
