# StartOS v0.4.0 — Operator Guide

Reference for running BitBudget's self-hosted infrastructure (BTCPay Server, Lightning node, etc.) on a StartOS 0.4.0 server. Keep this doc updated as the setup evolves.

---

## Upgrade from StartOS 0.3.x to 0.4.0

> **0.4.0 is a USB flash install** (not an OTA update). Early-access beta requires flashing a drive. A normal OTA path will come later.
>
> **Backup incompatibility:** 0.3.5 and 0.4.0 backups are entirely incompatible — you cannot restore a 0.3.5 backup on 0.4.0 or vice versa. The 0.3.5 backup you create before migrating is a rollback safety net only.

### Pre-flight checklist

1. **Update to StartOS 0.3.5.1** before doing anything else. (System → Software Update.)
2. **Update every installed service** to its latest version. Work up the dependency tree — Bitcoin before LND, LND before RTL, etc. Bitcoin can stay at 28.x or 29.x; all others must be latest.
3. **Review services with special handling** (see below).
4. **Optionally add an SSH key** (System → SSH) — makes debugging a failed migration much easier.
5. **Uninstall unused services.** Every installed service must be migrated; removing unused ones reduces migration time.
6. **Stop all services** and wait for each to fully stop.
7. **Create a full system backup** — back up every service. Do not skip this.

### Services requiring manual action before upgrade

| Service | Action required |
|---------|----------------|
| **Embassy Pages** | Retired → replaced by **Start9 Pages**. It survives the upgrade but won't receive updates. After upgrading, uninstall Embassy Pages, install Start9 Pages, and re-add content. |
| **Ghost** | Completely redesigned; incompatible with old version. Before upgrading: open Ghost admin → use built-in **Export** to download content. After upgrading: install new Ghost from marketplace → use built-in **Import** to restore. |
| **Synapse** | Old version was Tor-only; new version is clearnet-only. No migration path — treat as a fresh install. |

### Upgrade procedure

1. Download the 0.4.0-beta ISO from the [GitHub releases page](https://github.com/Start9Labs/start-os/releases):
   - x86\_64 servers (Server One 2023, generic hardware): **x86\_64 (AMD64)**
   - Server Pure: **x86\_64 (AMD64) Slim (FOSS-only)**
   - Raspberry Pi: not yet available for 0.4.0
2. Flash the ISO to a USB drive.
3. Shut down the server through the StartOS UI.
4. Insert the USB drive and power on.
5. Boot from USB — the installer becomes available at `http://start.local`. (If normal StartOS boots instead, enter BIOS and change Boot Option #1 to the USB drive. Server One: press ESC repeatedly at boot.)
6. In the installer: select language → select OS drive and data drive → **select "Preserve"** to keep existing data → optionally set a new password.
7. **Wait.** Migration can take hours. Progress will sit at **68% for a long time** while installed packages are being migrated — this is normal, the installer is not stuck. Do not power off.
8. When complete, remove the USB drive and reboot per the on-screen instructions.
9. **Update all services again** — every installed service will have a 0.4.0 marketplace update available (repackaged for the new system). Update all of them, including Bitcoin, before starting anything.
10. Start all services; confirm they are running correctly.
11. **Create a new backup** to a separate location from your 0.3.5 backup.

### LAN address change (important)

In 0.3.x, each service had its own `.local` address (e.g. `longpublickey.local`). In 0.4.0, services share one `adjective-noun.local` hostname and are differentiated by port (e.g. `adjective-noun.local:4545`). **Old per-service `.local` URLs stop working after migration.** Update any saved passwords or bookmarks to the new addresses.

---

## Networking in StartOS 0.4.0

0.4.0 is a fundamentally different networking model from 0.3.x. Most users no longer need Tor for day-to-day access.

### StartTunnel (clearnet HTTPS for services)

StartTunnel is the built-in reverse-proxy / public domain feature in 0.4.0. It replaces the manual VPS + nginx + socat + Tor proxy approach described in older guides.

**To expose BTCPay Server (or any service) to clearnet:**
1. In the StartOS UI, open the service (e.g. BTCPay Server).
2. Go to **Service Interfaces**.
3. Click **Add Public Domain**.
4. Follow the prompts to assign a domain. StartOS handles TLS via Let's Encrypt automatically.

The resulting HTTPS URL is your `BTCPAY_BASE_URL` for BitBudget's environment variables.

### Tor addresses

During migration, the Tor service is automatically installed and all existing onion addresses are preserved. However, Tor is rarely needed in 0.4.0 — most services are better served by StartTunnel or LAN access.

Review your service interfaces after migration and delete any Tor addresses you do not intend to keep. For BTCPay specifically, you can keep the Tor address as a fallback, but the StartTunnel clearnet URL is what BitBudget's server uses.

---

## BTCPay Server on StartOS 0.4.0

### Initial setup for BitBudget integration

After upgrading to 0.4.0 and exposing BTCPay via StartTunnel:

1. **Get the clearnet HTTPS URL** from Service Interfaces → copy the StartTunnel domain. Set this as `BTCPAY_BASE_URL` in Vercel (or your hosting env).

2. **Create a store** in BTCPay if you don't have one, then note the Store ID → set as `BTCPAY_STORE_ID`.

3. **Generate a Greenfield API key:**
   - BTCPay → Account → Manage Account → API Keys → Generate Key
   - Required permissions: `btcpay.store.cancreateinvoice`, `btcpay.store.canviewinvoices`
   - Set as `BTCPAY_API_KEY`.

4. **Create a webhook** in BTCPay → Store Settings → Webhooks → Add Webhook:
   - Payload URL: `https://your-bitbudget-domain.com/api/webhooks/btcpay`
   - Events: `InvoiceSettled`, `InvoiceExpired`, `InvoiceInvalid`
   - Enable automatic redelivery
   - Copy the webhook secret → set as `BTCPAY_WEBHOOK_SECRET`.

5. **Configure payment methods:**
   - Lightning (BOLT11): enable in Store Settings → Lightning
   - On-chain Bitcoin: enable in Store Settings → On-chain
   - Set the store's default currency to **USD** so invoices are USD-denominated (BTCPay converts to BTC at payment time).

### Webhook delivery (Tor → clearnet)

BTCPay's outbound HTTP connections route through Tor to clearnet exit nodes by default — no special configuration needed. Webhooks from your StartOS BTCPay instance will reach your Vercel deployment's `/api/webhooks/btcpay` endpoint normally.

### Local dev / testing without a live BTCPay Server

When `BTCPAY_BASE_URL` is unset, `lib/btcpay.ts` returns mock invoice data so the checkout UI can be developed and tested locally. Set `BTCPAY_TEST_MODE=true` in `.env.local` to force mock mode even when the URL is configured.

---

## Environment variables (BitBudget ↔ BTCPay)

See `.env.example` for full documentation. Key vars:

```
BTCPAY_BASE_URL=https://btcpay.yourdomain.com     # StartTunnel clearnet URL
BTCPAY_API_KEY=...                                  # Greenfield API key (store-scoped)
BTCPAY_STORE_ID=...                                 # BTCPay store ID
BTCPAY_WEBHOOK_SECRET=...                           # Webhook HMAC secret
BTCPAY_TEST_MODE=true                               # Local dev: use mock invoices
```

---

## Reference links

- [StartOS 0.4.0 upgrade guide](https://docs.start9.com/start-os/0.4.0.x/update-040.html)
- [BTCPay Greenfield API docs](https://docs.btcpayserver.org/API/Greenfield/v1/)
- [BTCPay webhook reference](https://docs.btcpayserver.org/Development/GreenfieldExample/)
- [cloudflared-startos](https://github.com/remcoros/cloudflared-startos) — Cloudflare Tunnel alternative (older StartOS versions)
- [StuPleb reverse proxy guide](https://community.start9.com/t/guide-bolt-cards-lightning-address-and-reverse-proxy-all-the-things/675) — manual VPS + nginx + socat approach (StartOS 0.3.x fallback)
