Here’s what you need and the fastest way to try it.

---

## Quick summary

**1. Webhook**  
Receipts are handled by:

`POST /api/webhooks/inbound-email`

with form fields: `from` (who forwarded it), `text` (email body), and optionally `subject`.

**2. Required**  
- **`OPENAI_API_KEY`** in `.env` (used to parse receipt text).  
- **Production:** **`SENDGRID_INBOUND_WEBHOOK_PUBLIC_KEY`** — base64 public key from a [SendGrid Inbound Parse security policy](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks) with **signature verification** enabled; attach that policy to your Parse hostname. Without it, the webhook returns **503** so spoofed POSTs cannot burn OpenAI credits.  
- The **`from`** address must be a **user in your DB** (we look up by email and attach the transaction to that user).

**3. Flow**  
- You (or an email provider) POST to that URL.  
- We parse the body with GPT, match an envelope, then create either a **live transaction** or a **pending** one in the Review Inbox.  
- Unknown receipt senders go to the admin Sender Review queue.

---

## Fastest way to test (local, no provider)

1. **Start the app** with `OPENAI_API_KEY` set.
2. **Use an email that exists in your app** (e.g. the one you sign in with).
3. **Call the webhook** (replace the email with that user’s):

```bash
curl -X POST http://localhost:3000/api/webhooks/inbound-email \
  -F "from=YOUREMAIL@example.com" \
  -F "subject=Amazon receipt" \
  -F "text=Amazon.com
Order total: \$24.99
Date: 2025-03-15
Thank you for your order."
```

4. In the app, open **Review** (or Transactions) and you should see the new item.

---

## Making it “real” (forward from your inbox)

To have real receipt emails hit the webhook:

1. **Use an inbound email provider** (e.g. **SendGrid Inbound Parse**).
2. **Point it at your webhook URL**  
   - Production: `https://your-domain.com/api/webhooks/inbound-email`  
   - Local: run **ngrok** (`ngrok http 3000`) and use `https://<your-id>.ngrok.io/api/webhooks/inbound-email` as the destination in SendGrid.
3. **Configure a receiving address** (e.g. `receipts@mail.yourdomain.com`) by adding the MX records SendGrid gives you.
4. **Forward receipts** to that address from the same email you use in Bitbudget; those forwards will be POSTed to your webhook and processed.

### SendGrid + ngrok: no activity in SendGrid

If DNS and Inbound Parse look correct but SendGrid never POSTs successfully:

- **ngrok Free** often serves an **HTML browser-warning page** to automated clients. SendGrid’s servers do **not** send `ngrok-skip-browser-warning`, so the POST may get HTML instead of your API → SendGrid may show failures or no useful delivery. **Fix:** point the Inbound Parse URL at **production** (`https://bitbudget.io/...`) or use **ngrok paid** / a tunnel without that interstitial.
- **`next.config.mjs`** includes **`allowedDevOrigins`** for `*.ngrok-free.app` (etc.) so the dev app can load `/_next/*` when you open the site **via the ngrok URL** in a browser.

A full step-by-step (SendGrid, Mailgun, local curl, troubleshooting) is in **`docs/email-forwarding-setup.md`**. If you tell me whether you’re testing locally only or want production (and which provider you prefer), I can give you the exact steps for that path next.