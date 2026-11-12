# BitBudget

Privacy-first, **Bitcoin-first** envelope budgeting on the web. Track spending, fund envelopes, and—when you want it—see the **opportunity cost** of purchases in Bitcoin terms.

- **Live app:** [bitbudget.io](https://bitbudget.io)
- **License:** [MIT](LICENSE) — you can read, run, and fork the software.
- **Source:** [github.com/Launchframe/bitbudget](https://github.com/Launchframe/bitbudget) (MIT-licensed; clone and run self-hosted or contribute via pull request).

## Free vs Premium on bitbudget.io

Core budgeting is **free**: sign-in, envelopes, manual transactions, CSV import, end-to-end encryption for payees and notes, and the savings-first ledger. No ads and no selling your budgeting data.

**Premium** (hosted only, optional) covers features that cost real infrastructure—live bank sync (Plaid), receipt capture that uses AI tokens, voice entry, SMS/email capture paths, and similar. Premium is how the hosted service stays sustainable; you never need it for basic private budgeting.

Pricing for Premium on the hosted tier is shown in-app (currently **$5/month** or **$50/year**).

## Bitcoin-first product direction

BitBudget’s public pitch leads with Bitcoin opportunity cost and sovereign budgeting. A simpler **vanilla** experience (no Bitcoin UI) remains available for users who prefer it—see [`/welcome`](https://bitbudget.io/welcome) vs the main [`/landing`](https://bitbudget.io/landing) pitch.

## Development

See [AGENTS.md](AGENTS.md) for architecture, privacy rules, testing, and contributor conventions.

Quick start (Postgres + env):

```bash
pnpm install
pnpm exec prisma migrate deploy
pnpm dev
```

Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `AUTH_SECRET` (≥ 32 characters).
