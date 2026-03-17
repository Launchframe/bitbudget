# Email forwarding setup (receipts → Bitbudget)

Receipts forwarded to a dedicated address are parsed and turned into transactions (or pending review items). This doc covers how to get it working.

## What you need

1. **Webhook URL** — Your app must be reachable at a URL that receives POST requests:
   - Production: `https://your-domain.com/api/webhooks/inbound-email`
   - Local: use [ngrok](https://ngrok.com) (e.g. `https://abc123.ngrok.io/api/webhooks/inbound-email`)

2. **Environment** — `OPENAI_API_KEY` must be set (used to parse receipt text).

3. **User match** — The email **from** which the receipt is forwarded must belong to a user in your database. The webhook looks up the user by that address and attaches the transaction to them.

## Webhook contract

The endpoint expects a **POST** with **multipart/form-data** (or equivalent) containing:

| Field    | Required | Description |
|----------|----------|-------------|
| `from`   | Yes      | Email of the person who forwarded (e.g. `Jane <jane@example.com>`). Used to find the Bitbudget user. |
| `text`   | Yes      | Plain-text body of the email (receipt content). |
| `subject`| No       | Subject line (stored in raw input). |

Success: **200** with `{ "success": true, "route": "live" | "pending", "id": "..." }`.  
Errors: **4xx/5xx** with `{ "error": "..." }`.

---

## Option A: SendGrid Inbound Parse

1. **SendGrid**  
   Sign up at [sendgrid.com](https://sendgrid.com) and get an API key if you use their API elsewhere (not required just for inbound).

2. **Inbound Parse**  
   In SendGrid: **Settings → Inbound Parse**.

3. **Add host & URL**
   - Add a **subdomain** or **domain** (e.g. `mail.bitbudget.com` or `receipts.bitbudget.com`).
   - In DNS for that host, add the **MX records** SendGrid gives you (they receive mail for that host).
   - Set **Destination URL** to your webhook, e.g.  
     `https://your-domain.com/api/webhooks/inbound-email`
   - Leave “Send Raw” **off** so SendGrid sends parsed fields (`from`, `to`, `subject`, `text`, etc.).

4. **Tell users the address**  
   Emails sent to that host (e.g. `anything@mail.bitbudget.com`) will be POSTed to your webhook. You can use a single inbox like `receipts@mail.bitbudget.com` and rely on `from` to identify the user.

5. **Test**  
   Forward a receipt from an email address that exists as a user in your app. Check your app’s Review Inbox (or live transactions) and server logs.

---

## Option B: Mailgun

1. Add a **domain** in Mailgun and set the DNS records they provide.
2. **Routes**: create a route that matches incoming mail (e.g. `receipts@mg.yourdomain.com`) and **forwards** to your webhook URL.  
   Mailgun can POST the message; you may need to map their payload to the expected `from` / `text` / `subject` (or add a small adapter in the route that normalizes to our format).

---

## Local testing (no inbound provider)

You can hit the webhook directly with `curl` so long as the receiving user exists in your DB.

1. **Start the app** (and ensure `OPENAI_API_KEY` is set).

2. **Create a user** in your DB (or use an existing one) and note their **email**.

3. **Send a POST** with `from` = that user’s email and `text` = receipt body:

```bash
curl -X POST http://localhost:3000/api/webhooks/inbound-email \
  -F "from=your-user@example.com" \
  -F "subject=Receipt from Amazon" \
  -F "text=Amazon.com
Order total: \$42.99
Date: 2025-03-15
Thank you for your order."
```

Replace `your-user@example.com` with an email that exists in your database. You should get a JSON response and see either a new transaction (high confidence) or an item in the Review Inbox (low confidence).

4. **With ngrok** (to test a real provider later):
   - Run `ngrok http 3000`.
   - Use the ngrok URL as the SendGrid destination, e.g. `https://abc123.ngrok.io/api/webhooks/inbound-email`.
   - Forward a real receipt to the SendGrid address and confirm it hits your app.

---

## Flow summary

1. User forwards a receipt email to your configured address (e.g. `receipts@mail.bitbudget.com`).
2. SendGrid (or Mailgun) receives it and POSTs `from` / `text` / `subject` to your webhook.
3. App finds the user by `from` → parses `text` with OpenAI → matches envelope → creates a live transaction or a pending review item.
4. If the **original** receipt sender (e.g. `receipts@amazon.com`) isn’t in the approved senders list, it’s added to the admin **Sender Review** queue.

## Troubleshooting

- **404 User not found** — The `from` address in the POST is not in your `User` table. Use an email that’s registered in the app.
- **422 Could not parse receipt** — `OPENAI_API_KEY` missing or the body text couldn’t be parsed. Check env and try a clearer receipt.
- **422 No transaction data found** — Parser didn’t find payee/amount. Try forwarding a receipt with a clear total and merchant name.
- **503 / 429 rate limit** — OpenAI "too many requests". Wait a minute and retry, or use a paid-tier key. Webhook returns 503 with `Retry-After: 60`.
