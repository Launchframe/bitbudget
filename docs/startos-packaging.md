# StartOS packaging

Knowledge base for packaging BitBudget as StartOS `.s9pk` services, plus open-source / IP notes. Official reference: [Start9 Service Packaging (0.4.x)](https://docs.start9.com/packaging/0.4.0.x/).

## Project status

**Deferred.** Near-term distribution: **[self-hosting.md](./self-hosting.md)** (Docker + VPN). Revisit StartOS when **0.4.x** networking (WireGuard, clearnet, StartTunnel) is production-ready — [Future: StartOS 0.4 networking](#future-startos-04-networking).

Tor-only 0.3.x remote access is a poor fit for OAuth, Plaid, and mobile browser UX.

---

## Goals

- Run on user-owned hardware with verifiable open source ([Open source, trust, and IP](#open-source-trust-and-intellectual-property)).
- Optional Start9 Community Registry later (`submissions@start9.com`).

Package would live in a separate `bitbudget-startos` repo from [hello-world-startos](https://github.com/Start9Labs/hello-world-startos).

---

## Open source, trust, and intellectual property

> Not legal advice.

| Mechanism | Role |
|-----------|------|
| **Open source** | Verify encryption, ledger, server ciphertext |
| **License** (TBD) | AGPL / Apache / MIT — no `LICENSE` in repo yet |
| **Patents** | Nothing clearly mandates filing; counsel review optional — see inventory in prior internal notes |
| **Trademark / hosted SaaS** | Commercial moat alongside community self-host |

Community registry expects a **public GitHub repo**.

---

## Packaging summary (when resumed)

| Step | Action |
|------|--------|
| Build | `make` → `.s9pk` |
| Test | Sideload on StartOS device |
| Self registry | `start-cli s9pk publish --url=...` |
| Community | Email Start9 → fork → PR → alpha/beta/prod promotion |

Updates: ExVer versions, `startos/versions/*` migrations, git tags `v{upstream}_{downstream}`.

---

## Future: StartOS 0.4 networking

WireGuard VPN gateways, clearnet + Let’s Encrypt, **StartTunnel** — same problem class as [self-hosting VPN](./self-hosting.md#remote-access-vpn-into-home). Full BitBudget still needs public URLs for Plaid/webhooks unless features are disabled.

---

## Related

- [self-hosting.md](./self-hosting.md), [self-hosting-plan.md](./self-hosting-plan.md)
- [commercial-clients-proposal.md](./commercial-clients-proposal.md)
- [docs/README.md](./README.md)
