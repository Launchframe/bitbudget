# StartOS v0.4.0 — Operator Guide

Reference for running BitBudget's self-hosted infrastructure on a StartOS 0.4.0 server. Covers the 0.3.x → 0.4.0 upgrade, clearnet networking via StartTunnel, BTCPay Server integration, LNbits, Bolt Cards, and Lightning Address setup. Keep this doc updated as the setup evolves.

---

## Table of Contents

1. [Upgrade from 0.3.x to 0.4.0](#1-upgrade-from-03x-to-040)
2. [Networking in 0.4.0 — StartTunnel](#2-networking-in-040--starttunnel)
3. [BTCPay Server — BitBudget Integration](#3-btcpay-server--bitbudget-integration)
4. [Lightning Address and Nostr Zaps](#4-lightning-address-and-nostr-zaps)
5. [LNbits — Clearnet Exposure and Security](#5-lnbits--clearnet-exposure-and-security)
6. [Bolt Cards](#6-bolt-cards)
7. [Legacy: VPS Reverse Proxy (StartOS 0.3.x)](#7-legacy-vps-reverse-proxy-startos-03x)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Reference Links](#9-reference-links)

---

## 1. Upgrade from 0.3.x to 0.4.0

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
| **Embassy Pages** | Retired → replaced by **Start9 Pages**. Survives the upgrade but won't get updates. After upgrading: uninstall Embassy Pages, install Start9 Pages, re-add content. |
| **Ghost** | Completely redesigned; incompatible with old version. **Before upgrading:** Ghost admin → built-in Export → download content. **After upgrading:** install new Ghost from marketplace → built-in Import → restore. |
| **Synapse** | Old version was Tor-only; new version is clearnet-only. No migration path — treat as a fresh install. |

### Upgrade procedure

1. Download the 0.4.0-beta ISO from the [GitHub releases page](https://github.com/Start9Labs/start-os/releases):
   - x86\_64 servers (Server One 2023, generic hardware): **x86\_64 (AMD64)**
   - Server Pure: **x86\_64 (AMD64) Slim (FOSS-only)**
   - Raspberry Pi: not yet available for 0.4.0
2. Flash the ISO to a USB drive.
3. Shut down the server through the StartOS UI.
4. Insert the USB drive and power on.
5. Boot from USB — installer becomes available at `http://start.local`. (If normal StartOS boots instead, enter BIOS and change Boot Option #1 to the USB drive. Server One: press ESC repeatedly at boot until BIOS appears.)
6. In the installer: select language → select OS drive and data drive → **select "Preserve"** to keep existing data → optionally set a new password.
7. **Wait.** Migration can take hours. Progress will sit at **68% for a long time** while installed packages are being migrated — this is normal, the installer is not stuck. Do not power off or unplug.
8. When complete, remove the USB drive and reboot per the on-screen instructions.
9. **Update all services again** — every installed service will have a 0.4.0 marketplace update (repackaged for the new system). Update all of them, including Bitcoin, before starting anything.
10. Start all services; confirm they are running correctly.
11. **Create a new backup** to a separate location from your 0.3.5 backup.

### LAN address change

In 0.3.x, each service had its own `.local` address (e.g. `longpublickey.local`). In 0.4.0, services share one `adjective-noun.local` hostname and are differentiated by port (e.g. `adjective-noun.local:4545`). **Old per-service `.local` URLs stop working after migration.** Update any saved passwords or bookmarks.

### Post-migration Tor cleanup

During migration, the Tor service is automatically installed and all existing onion addresses are preserved. Tor is rarely needed in 0.4.0 — most services are better served by StartTunnel or LAN. Review your service interfaces and delete Tor addresses you don't intend to keep. BTCPay can keep its Tor address as a fallback, but the StartTunnel URL is what BitBudget uses.

---

## 2. Networking in 0.4.0 — StartTunnel

StartTunnel is 0.4.0's built-in clearnet proxy. It replaces the entire VPS + nginx + socat + Tor approach required on 0.3.x (see [Section 7](#7-legacy-vps-reverse-proxy-startos-03x) for that legacy method).

**To expose any service to clearnet on 0.4.0:**
1. Open the service in the StartOS UI.
2. Go to **Service Interfaces**.
3. Click **Add Public Domain**.
4. Follow the prompts — StartOS handles TLS via Let's Encrypt automatically.

The resulting `https://yourservice.yourdomain.com` URL is immediately reachable from the public internet. No VPS, no nginx, no manual certificate renewal. Users in the community (May 2026) report getting this working in under 5 minutes.

**Webhook delivery (BTCPay → Vercel):** Tor allows outbound clearnet connections through exit nodes by default. Even on a Tor-primary setup, BTCPay's webhooks reach clearnet URLs like your Vercel deployment without any special configuration.

---

## 3. BTCPay Server — BitBudget Integration

### Clearnet setup

1. Open BTCPay Server in the StartOS UI → **Service Interfaces** → **Add Public Domain**.
2. Assign your domain (e.g. `btcpay.yourdomain.com`). StartOS provisions TLS automatically.
3. Confirm you can log in at `https://btcpay.yourdomain.com` — this becomes `BTCPAY_BASE_URL`.

### Store configuration

1. In BTCPay, create a store (or use an existing one). Note the **Store ID** → set as `BTCPAY_STORE_ID`.
2. Store Settings → **Default currency**: set to **USD** so invoices are USD-denominated (BTCPay converts to BTC at payment time).
3. Enable payment methods:
   - Store Settings → **Lightning** → connect to your LND node
   - Store Settings → **On-chain** → confirm your Bitcoin wallet is configured

### Greenfield API key

BTCPay → Account → **Manage Account** → **API Keys** → **Generate Key**

Required permissions:
- `btcpay.store.cancreateinvoice`
- `btcpay.store.canviewinvoices`

Set the generated key as `BTCPAY_API_KEY`.

### Webhook setup

BTCPay → Store Settings → **Webhooks** → **Add Webhook**

| Field | Value |
|-------|-------|
| Payload URL | `https://your-bitbudget-domain.com/api/webhooks/btcpay` |
| Events | `InvoiceSettled`, `InvoiceExpired`, `InvoiceInvalid` |
| Automatic redelivery | Enabled |

Copy the generated webhook secret → set as `BTCPAY_WEBHOOK_SECRET`.

### Local dev / test mode

When `BTCPAY_BASE_URL` is unset, `lib/btcpay.ts` returns mock invoice data so the checkout UI can be built and tested locally. Set `BTCPAY_TEST_MODE=true` in `.env.local` to force mock mode even when the URL is configured.

### Tor latency note

If BTCPay is still routing through Tor (e.g. using the onion address internally), invoice generation can take a few extra seconds on bad Tor days. Some custodial wallets and Nostr clients time out if they don't receive an invoice within ~2 seconds. This is a client-side limitation; StartTunnel's direct HTTPS path avoids this entirely.

---

## 4. Lightning Address and Nostr Zaps

Once BTCPay is on clearnet via StartTunnel, you can set up a Lightning Address (`you@yourdomain.com`) and enable self-custody Nostr zaps.

### Lightning Address

1. Log in to BTCPay over your clearnet URL.
2. In the sidebar, click **Lightning Address** → **Add an Address**.
3. Done — from any Lightning wallet that supports Lightning addressing, you can now receive sats at `you@btcpay.yourdomain.com` (or a custom subdomain).

### Nostr zaps (self-custody)

1. In your Nostr client, add your Lightning address. Most clients will pick this up automatically.
2. If you have issues, install the legacy Nostr plugin in BTCPay: **Manage Plugins** → find and install **Nostr**.
3. In the Nostr plugin: add your Lightning address, add your `npub`, add your `nsec` so BTCPay can publish zap receipt events as you, and add your preferred relays (including your StartOS Nostr relay if you run one).

Zaps from Nostr clients will now go directly to your LND node balance rather than a custodial account.

---

## 5. LNbits — Clearnet Exposure and Security

LNbits lets you create segregated Lightning wallets on top of your LND node — useful for Bolt Cards, friends/family wallets, and Point of Sale plugins.

### Clearnet exposure (0.4.0)

Same as BTCPay: LNbits Service Interfaces → **Add Public Domain** → `https://lnbits.yourdomain.com`.

### Security lockdown (important — LNbits is now publicly reachable)

After exposing LNbits to clearnet, prevent strangers from creating wallets on your instance:

1. In LNbits, go to StartOS UI → LNbits → **Properties** to find your Superuser wallet URL. The secret user ID is the `usr=xxx` part.
2. Open LNbits via its clearnet URL as your superuser.
3. **Manage Server** → **Users** tab → **Allowed Users** → paste each authorized user ID and add them. This prevents new account creation by anyone not on the list.
4. **Manage Server** → **Security** tab — if you have known fixed IPs, consider restricting access to those.

### Accessing your wallet

- Direct URL: `https://lnbits.yourdomain.com/wallet?usr=YOUR_USER_ID`
- Save this securely (password manager, not in the URL bar bookmarks).

---

## 6. Bolt Cards

Bolt Cards are NFC payment cards linked to a LNbits wallet. Tapping the card against a Lightning POS generates and pays an invoice automatically — like a contactless debit card for sats. Requires a clearnet LNbits URL (Section 5) so card tap callbacks work outside your LAN.

**Hardware requirements:**
- An **NFC-compatible Android phone** with Chrome (Chrome can talk to NFC hardware without extra config; Firefox support is coming)
- Physical Bolt Cards ([CoinCorner](https://coincorner.com), [Laser Eyes Bolt Cards](https://lasereyescards.com), or compatible NXP NTAG424 DNA cards)
- The **Bolt Card NFC app** by Ones and Zeros Technology (Google Play or F-Droid)

### Setup procedure

**On desktop (LNbits via clearnet URL):**
1. Log in to your LNbits wallet and add some sats to test with.
2. Go to **Extensions** → find, install, and enable **Bolt Cards**.
3. Open the Bolt Cards extension.

**On Android phone (LNbits via clearnet URL, in Chrome):**
1. Open your LNbits wallet on your phone. Easiest: use **Export to Phone** (QR code on the right-hand panel on desktop) to get the wallet URL on your phone.
2. Go to **Extensions** → enable **Bolt Cards**.
3. Open the Bolt Cards extension on your phone.
4. Tap **+** to add a new card → select your wallet → set spending limits → give the card a name.
5. Tap the NFC chip icon → tap the physical card to the back of your phone. This reads the card's unique ID into the form.
6. Tap **Create Card**.

**Write the card:**
1. Back on desktop, in the Bolt Cards extension, click the **QR code icon** next to your newly created card. Keep this QR code open.
2. On your phone, open the **Bolt Card NFC app** → **Create Bolt Card** → **Scan QR Code** → scan the desktop QR.
3. Confirm the clearnet domain name appears in the scanned details.
4. Tap **Write Card Now** → tap the physical card to the back of your phone.

The card is now configured. Test by opening a Lightning wallet (Breeze, Wallet of Satoshi, etc.), creating an invoice, then tapping the Bolt Card to pay it.

### Troubleshooting

- **Card not responding:** Make sure you're using Chrome on Android, not Firefox. NFC WebAPI support is Chrome-only for now.
- **Tap fails outside home network:** Confirm LNbits is reachable over clearnet (Section 5) and the URL written to the card is the clearnet domain, not an `.onion` or `.local` address.
- **Spending limits:** Set conservative limits per-card as a safety measure. You can raise them later in the Bolt Cards extension.

---

## 7. Legacy: VPS Reverse Proxy (StartOS 0.3.x)

> **This section is only needed if you are still on StartOS 0.3.x or cannot use StartTunnel.** On 0.4.0, use StartTunnel (Section 2) instead — it is dramatically simpler.

The VPS proxy method creates a clearnet-to-Tor bridge: a cheap VPS running nginx + socat forwards HTTPS traffic from a public domain to your StartOS service's `.onion` address.

### Architecture

```
Clearnet client → VPS (nginx:443) → socat (localhost:9081) → Tor (SOCKS5:9050) → BTCPay .onion:80
```

Each service gets its own socat listener on a unique local port (BTCPay: 9081, LNbits: 9082, etc.).

### VPS and domain setup

1. **VPS provider:** Lunanode (accepts Bitcoin; cheap). Create a Debian 12 VM. Note the external IP.
2. **Domain:** Namecheap (accepts Lightning). Create DNS A records:
   - `btcpay.yourdomain.com` → VPS IP
   - `lnbits.yourdomain.com` → VPS IP
   - `yourdomain.com` → VPS IP (optional root)

### VPS configuration

SSH into the VPS and install dependencies:

```bash
sudo su -
apt update && apt install -y certbot nginx socat tor
```

Create the socat service template:

```bash
nano /etc/systemd/system/http-to-socks-proxy@.service
```

```ini
[Unit]
Description=HTTP-to-SOCKS proxy
After=network.target

[Service]
EnvironmentFile=/etc/http-to-socks-proxy/%i.conf
ExecStart=/usr/bin/socat tcp4-LISTEN:${LOCAL_PORT},reuseaddr,fork,keepalive,bind=127.0.0.1 SOCKS4A:${PROXY_HOST}:${REMOTE_HOST}:${REMOTE_PORT},socksport=${PROXY_PORT}

[Install]
WantedBy=multi-user.target
```

Create per-service config files:

```bash
mkdir /etc/http-to-socks-proxy

# BTCPay Server
nano /etc/http-to-socks-proxy/btcpayserver.conf
```

```
PROXY_HOST=127.0.0.1
PROXY_PORT=9050
LOCAL_PORT=9081
REMOTE_HOST=your-btcpay-onion-address.onion
REMOTE_PORT=80
```

```bash
# LNbits
nano /etc/http-to-socks-proxy/lnbits.conf
```

```
PROXY_HOST=127.0.0.1
PROXY_PORT=9050
LOCAL_PORT=9082
REMOTE_HOST=your-lnbits-onion-address.onion
REMOTE_PORT=80
```

> **Common mistake:** Do not include `http://` in `REMOTE_HOST` — it must be the bare `.onion` hostname only (this is the most common cause of 502 errors).

Enable and start the services:

```bash
ln -s /etc/systemd/system/http-to-socks-proxy@.service /etc/systemd/system/multi-user.target.wants/http-to-socks-proxy@btcpayserver.service
ln -s /etc/systemd/system/http-to-socks-proxy@.service /etc/systemd/system/multi-user.target.wants/http-to-socks-proxy@lnbits.service
systemctl start http-to-socks-proxy@btcpayserver
systemctl start http-to-socks-proxy@lnbits
```

Verify tunnels are active:

```bash
netstat -tulpn | grep socat
# Should show listeners on 9081 and 9082
```

### nginx + TLS setup (one-time)

```bash
openssl dhparam -out /etc/ssl/certs/dhparam.pem 4096
mkdir -p /var/lib/letsencrypt/.well-known
chgrp www-data /var/lib/letsencrypt
chmod g+s /var/lib/letsencrypt

nano /etc/nginx/conf.d/map.conf
```

```nginx
map $http_x_forwarded_proto $proxy_x_forwarded_proto {
  default $http_x_forwarded_proto;
  '' $scheme;
}
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}
```

### nginx config per service (repeat for each)

Create `/etc/nginx/sites-available/btcpayserver.conf`:

```nginx
server {
  listen 80;
  server_name btcpay.yourdomain.com;
  location ^~ /.well-known/acme-challenge/ {
    allow all;
    root /var/lib/letsencrypt/;
    default_type "text/plain";
    try_files $uri =404;
  }
  location / { return 301 https://$server_name$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name btcpay.yourdomain.com;
  ssl_certificate /etc/letsencrypt/live/btcpay.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/btcpay.yourdomain.com/privkey.pem;
  ssl_dhparam /etc/ssl/certs/dhparam.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;
  ssl_stapling on;
  ssl_stapling_verify on;
  ssl_session_timeout 1d;
  ssl_session_cache shared:SSL:10m;
  ssl_session_tickets off;
  resolver 8.8.8.8 8.8.4.4 valid=300s;
  resolver_timeout 30s;
  add_header Strict-Transport-Security "max-age=63072000" always;
  add_header Content-Security-Policy "frame-ancestors 'self';";
  add_header X-Content-Type-Options nosniff;
  location / {
    proxy_pass http://127.0.0.1:9081/;   # match LOCAL_PORT for this service
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/btcpayserver.conf /etc/nginx/sites-enabled/
systemctl restart nginx
certbot certonly --agree-tos --email you@yourdomain.com --webroot -w /var/lib/letsencrypt/ -d btcpay.yourdomain.com
systemctl restart nginx
```

Repeat with a new config file for LNbits (use `LOCAL_PORT=9082` in the proxy_pass line).

> **SSL certificate renewal:** Let's Encrypt certificates expire after 90 days. Set a calendar reminder for day 89. Run the same `certbot certonly` command to renew. Consider `certbot renew --dry-run` and a cron job for auto-renewal.

### Troubleshooting (from community)

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| 502 Bad Gateway | `REMOTE_HOST` has `http://` prefix | Remove `http://` — use bare `.onion` address |
| 504 Gateway Timeout | Tor daemon on VPS is too old (Debian 10 / Tor pre-2024) | Rebuild VPS on **Debian 12** |
| socat not listening | Service not started or symlink wrong | `systemctl status http-to-socks-proxy@btcpayserver`; check symlink |
| nginx config error on restart | Typo in config | `sudo nginx -t` to check before restarting |
| Works locally, fails remotely | nginx restarted but changes not applied | `systemctl restart nginx` after every config change |

---

## 8. Environment Variables Reference

See `.env.example` for full documentation. Key vars for BTCPay integration:

```
BTCPAY_BASE_URL=https://btcpay.yourdomain.com   # StartTunnel clearnet URL (or VPS proxy URL)
BTCPAY_API_KEY=...                               # Greenfield API key (store-scoped)
BTCPAY_STORE_ID=...                              # BTCPay store ID
BTCPAY_WEBHOOK_SECRET=...                        # Webhook HMAC secret from BTCPay
BTCPAY_TEST_MODE=true                            # Local dev only: use mock invoices
```

---

## 9. Reference Links

**BitBudget docs**

- [bolt-card-platform.md](bolt-card-platform.md) — Product architecture: manufacturing, activation, virtual ledger, premium tap
- [lightning-nostr-operations.md](lightning-nostr-operations.md) — Merchant liquidity, swaps, NIP-57 / Bolt / NWC payment rails

**External**

- [StartOS 0.4.0 upgrade guide](https://docs.start9.com/start-os/0.4.0.x/update-040.html)
- [BTCPay Greenfield API docs](https://docs.btcpayserver.org/API/Greenfield/v1/)
- [BTCPay webhook reference](https://docs.btcpayserver.org/Development/GreenfieldExample/)
- [StuPleb reverse proxy + Bolt Cards guide](https://community.start9.com/t/guide-bolt-cards-lightning-address-and-reverse-proxy-all-the-things/675) — original source for VPS proxy, Lightning Address, and Bolt Cards sections above
- [cloudflared-startos](https://github.com/remcoros/cloudflared-startos) — Cloudflare Tunnel alternative for older StartOS
- [Bolt Card NFC app](https://play.google.com/store/apps/details?id=com.boltcard.boltcard) — Ones and Zeros Technology (Android)
- [CoinCorner Bolt Cards](https://coincorner.com) / [Laser Eyes Bolt Cards](https://lasereyescards.com) — card sources
