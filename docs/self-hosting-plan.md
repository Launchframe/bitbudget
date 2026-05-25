# Self-hosting plan: open source + Docker

Roadmap for publishing BitBudget as open source and running it on a home PC or server. **StartOS packaging is deferred** — see [startos-packaging.md](./startos-packaging.md). **Near-term path:** OSS + Docker ([self-hosting.md](./self-hosting.md)).

> Not legal advice. IP notes: [startos-packaging.md § Open source, trust, and intellectual property](./startos-packaging.md#open-source-trust-and-intellectual-property).

## End goal

1. Obtain — clone/build or pull container image  
2. Configure — `.env` with `AUTH_URL` / `NEXT_PUBLIC_APP_URL` matching how users reach the server  
3. Run — `docker compose up`  
4. Use — LAN or **VPN into home** from phone ([self-hosting.md § VPN](./self-hosting.md#remote-access-vpn-into-home))

## Implemented in repo

| Deliverable | Path |
|-------------|------|
| Dockerfile + compose | [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml) |
| Operator guide | [self-hosting.md](./self-hosting.md) |
| Env template | [`.env.docker.example`](../.env.docker.example) |
| Cron example | [`scripts/cron-self-host.example`](../scripts/cron-self-host.example) |
| Offline queue (v1) | `lib/offline-queue.ts`, `lib/offline-sync.ts` |
| PWA | `public/manifest.webmanifest`, `public/sw.js` |

## Phase 1 — Open source

- [ ] Choose license (AGPL / Apache-2.0 / MIT)
- [ ] Add `LICENSE`, `SECURITY.md`, contributor README
- [ ] Set `package.json` `"private": false` when ready
- [ ] Document minimal vs full feature matrix (Plaid/webhooks need public HTTPS)

## Phase 2 — Docker (largely done)

- [x] Standalone Next image, Postgres sidecar, health endpoint
- [ ] CI: `docker build` on release tags → GHCR
- [ ] Optional `docker-compose.proxy.yml` (Caddy + TLS)

## Phase 3 — Remote access

Primary: **Tailscale / WireGuard** — see [self-hosting.md](./self-hosting.md).  
Optional: reverse proxy or Cloudflare Tunnel for OAuth/webhooks.

## Phase 4 — Commercial split

Same codebase; commercial = hosted `bitbudget.io` + store shells — [commercial-clients-proposal.md](./commercial-clients-proposal.md).

## Open decisions

- [ ] License choice  
- [ ] `COMMERCIAL_BILLING_ENABLED` on self-host (disable Stripe/IAP routes)  
- [ ] Analytics opt-out on self-host  

## Related

- [docs/README.md](./README.md)
- [commercial-clients-proposal.md](./commercial-clients-proposal.md)
