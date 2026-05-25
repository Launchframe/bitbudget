# Self-hosting BitBudget

Run BitBudget on a home PC or server with Docker.

For **commercial** hosted + store clients (Windows, macOS, Android, iOS), see [commercial-clients-proposal.md](./commercial-clients-proposal.md).

## Prerequisites

- Docker Engine + Docker Compose v2
- A machine that stays on (or runs when you need the budget)
- For phone access away from home: a **VPN into your LAN** (recommended) — see [Remote access via VPN](#remote-access-vpn-into-home)

## Quick start

```bash
git clone https://github.com/Launchframe/bitbudget.git
cd bitbudget
cp .env.docker.example .env
```

Edit `.env`:

1. Set `POSTGRES_PASSWORD` and `AUTH_SECRET` (≥ 32 characters; `npx auth secret`).
2. Set **`AUTH_URL`**, **`NEXTAUTH_URL`**, and **`NEXT_PUBLIC_APP_URL`** to the URL you use in the browser (see VPN section below).
3. Set `CRON_SECRET` (`openssl rand -hex 32`).
4. Configure `GMAIL_USER` / `GMAIL_APP_PASSWORD` for email sign-in, or use Nostr.

```bash
docker compose up -d --build
```

Open the app at the URL you configured (e.g. `http://192.168.1.50:3000` on LAN).

Check health:

```bash
curl -s http://127.0.0.1:3000/api/health
```

## Remote access: VPN into home

The default compose file publishes port **3000** on all interfaces so devices on your **home LAN** can reach the app. The internet at large should **not** reach port 3000 unless you knowingly expose it (firewall + reverse proxy).

For the supermarket, road trip, or coffee shop:

1. Run a **mesh VPN** on your home server and phone.
2. Connect the VPN on the phone.
3. Open the same URL you put in `.env` — using the home server’s **VPN or LAN IP**.

### Tailscale (easiest for many users)

1. Install [Tailscale](https://tailscale.com/) on the Docker host and on your phone; sign in to the same tailnet.
2. Note the server’s Tailscale IP (e.g. `100.64.0.3`).
3. In `.env`:

   ```env
   AUTH_URL=http://100.64.0.3:3000
   NEXTAUTH_URL=http://100.64.0.3:3000
   NEXT_PUBLIC_APP_URL=http://100.64.0.3:3000
   ```

4. `docker compose up -d` (restart app after env changes).
5. On the phone: enable Tailscale → open `http://100.64.0.3:3000`.

Optional: use [Tailscale HTTPS](https://tailscale.com/kb/1153/enabling-https) or an MagicDNS name instead of raw IP.

### WireGuard

Same idea: peer the phone to the home network, use the home server’s WireGuard IP in the three URL variables.

### Firewall

- Block **inbound** port 3000 from the public internet on your router.
- Allow Tailscale/WireGuard (or LAN) only.

### When you need a public HTTPS URL

OAuth (Google/GitHub), Plaid, and inbound email webhooks require a **stable public URL**. VPN alone is enough for **manual** budgeting and email OTP. For webhooks, add a reverse proxy or tunnel (Cloudflare Tunnel, Caddy + domain) and set the three URL variables to `https://your.domain`.

---

## Scheduled jobs (cron)

Vercel Cron is not used on self-host. Call secured endpoints with `CRON_SECRET`:

See [scripts/cron-self-host.example](../scripts/cron-self-host.example).

Example (daily recurring at 06:00 UTC):

```bash
export BITBUDGET_BASE_URL=http://127.0.0.1:3000
export CRON_SECRET=your-secret-from-env
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$BITBUDGET_BASE_URL/api/cron/recurring"
```

---

## Offline use and installable app (PWA)

BitBudget supports **limited offline** use on the device:

| Capability | Behavior |
|------------|----------|
| **Read** | Recent transactions already in IndexedDB remain visible after unlock. |
| **Create** | New transactions queue locally when offline or when POST fails at the network; they upload when back online. |
| **Edit / delete offline** | Not queued yet — refresh after reconnect. |

### Install on your phone (Add to Home Screen)

1. Reach the app over **VPN** (or LAN).
2. In Safari (iOS) or Chrome (Android): **Add to Home Screen**.
3. The [web app manifest](../public/manifest.webmanifest) and [service worker](../public/sw.js) load the shell when connectivity is flaky; API calls still need the server when online.

A banner shows when you are offline or when transactions are waiting to sync.

### Self-host + offline

- The queue lives in the **browser** (IndexedDB), not on the Docker host.
- Each device has its own queue; sync runs when that device can reach your home server (usually via VPN).

---

## Upgrades

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on app container start (`prisma migrate deploy`).

Back up the Postgres volume before major upgrades:

```bash
docker compose exec db pg_dump -U bitbudget bitbudget > backup.sql
```

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Auth loops / sign-in fails | `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` must match the browser address exactly. |
| Phone cannot connect | VPN connected? Firewall allows tailnet/LAN? URL uses VPN IP not only `127.0.0.1`. |
| Recurring / payday funding never runs | `CRON_SECRET` and host crontab hitting `/api/cron/*`. |
| Migrations fail on start | `docker compose logs app`; ensure `db` is healthy. |
| Pending transactions never upload | Back online? Encryption unlocked? Check browser devtools → Application → IndexedDB. |

---

## Files

| File | Role |
|------|------|
| [Dockerfile](../Dockerfile) | Production image |
| [docker-compose.yml](../docker-compose.yml) | App + Postgres |
| [.env.docker.example](../.env.docker.example) | Env template |
| [scripts/docker-entrypoint.sh](../scripts/docker-entrypoint.sh) | Migrations then `node server.js` |
