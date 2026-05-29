# Android bank notification forwarding (DIY)

BitBudget is a **web app** — it cannot read other apps’ notifications on its own. Savvy Android users can bridge **bank debit/credit app notifications** into BitBudget using a **notification listener** automation app that HTTP POSTs alert text to BitBudget’s ingest webhook.

This guide is for **maintainers**, **support agents**, **Cursor agents**, and (eventually) the in-app **troubleshoot chatbot**. Walk users through it in order; do not skip the privacy section.

## What this solves

| Path | Real-time? | BitBudget support |
|------|------------|-------------------|
| Plaid bank sync | Near real-time | Premium; bank must be supported |
| SMS / email forwarding | Minutes | Premium; bank must send SMS/email |
| Receipt scan / manual entry | On demand | Everyone |
| **Android notification forward** | Seconds (when automation runs) | Premium or trial; user-built automation |

**Not possible:** reading **toast** messages from another app (Android does not expose them). Only **posted notifications** (status bar / shade) are visible to listener apps.

## Privacy and trust (read to the user first)

1. **Notification access is powerful.** Tasker, MacroDroid, Automate, etc. can read notifications from **all** apps until the user revokes access. BitBudget does not install this listener — the user chooses a third-party automation app.
2. **What leaves the phone** is whatever the user’s automation sends in the HTTP body (typically title + text of the bank notification). That text is **parsed on the server** (OpenAI, same family as SMS/receipt parsing) and stored as **encrypted** payee/notes when the user has a public key configured.
3. **Weaker anonymity:** forwarding bank alerts ties spending to BitBudget with more identifiers than manual entry alone. Users should understand this before enabling automation.
4. **Secrets:** each user gets a private **ingest token** (like the receipt inbox token). Anyone with the token can POST fake alerts — treat it like a password; rotate if leaked (`POST /api/user/notification-ingest` with `{ "rotate": true }`).

## Prerequisites

- BitBudget **Premium** or active **Premium trial**
- User has completed **encryption setup** (public key on file for server-side encrypt of payee)
- `OPENAI_API_KEY` set on the BitBudget deployment (parsing)
- Android phone with the **bank’s official app** posting transaction notifications
- One automation app: **Tasker**, **MacroDroid**, or **Automate** (user preference)
- HTTPS webhook URL reachable from the phone (production `https://…` or dev tunnel e.g. ngrok)

## BitBudget side: token and webhook URL

### 1. Get ingest credentials (signed-in, premium)

```http
GET /api/user/notification-ingest
Authorization: Cookie session (browser) or app session
```

Response:

```json
{
  "notificationIngestToken": "32-char-hex",
  "webhookUrl": "https://bitbudget.io/api/webhooks/notification-ingest"
}
```

Token is created on first GET. To rotate after a leak:

```http
POST /api/user/notification-ingest
Content-Type: application/json

{ "rotate": true }
```

### 2. Webhook contract

**Endpoint:** `POST {origin}/api/webhooks/notification-ingest`

**Auth (required):** either header

- `Authorization: Bearer <notificationIngestToken>`
- `X-BitBudget-Ingest-Token: <notificationIngestToken>`

**Body:** `application/json`

| Field | Required | Description |
|-------|----------|-------------|
| `text` | Yes* | Full alert text to parse (recommended: `%ntitle` + newline + `%ntext` or equivalent) |
| `title` | No | Notification title (merged into `text` if `text` omitted) |
| `body` | No | Notification body |
| `package` | No | Android package name, e.g. `com.chase.sig.android` (logging / support only) |
| `postedAt` | No | ISO 8601 when the notification was posted (defaults to server now) |
| `idempotencyKey` | No | Opaque string; duplicate keys within 24h return `200` with `{ "deduplicated": true }` |

\*At least one of `text`, or both `title` and `body`, must be present.

**Success (200):**

```json
{ "success": true, "route": "live", "id": "cuid…" }
```

or `"route": "pending"` when confidence is low (Review Inbox).

**Errors:** `401` bad/missing token · `403` not premium / trial cap · `422` could not parse · `503` OpenAI rate limit

**Trial cap:** combined **email_forward**, **sms**, and **notification_forward** captures share the monthly trial limit (100/month); full premium is unlimited.

### 3. Local test with curl

Replace `TOKEN` and use a real alert snippet from the user’s bank (no live PANs in tickets).

```bash
curl -sS -X POST "http://localhost:3000/api/webhooks/notification-ingest" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Debit card purchase\n$12.34 at COFFEE SHOP on 05/27",
    "package": "com.example.bank",
    "idempotencyKey": "test-1"
  }'
```

Expect `success: true` and a new row in Review Inbox or Transactions depending on envelope match confidence.

---

## Automation apps (user setup)

Filter notifications to **only** the bank app package when possible. Copy **title + text** into the JSON `text` field.

### Tasker (recommended for power users)

1. Install **Tasker** and grant **Notification access** (Android Settings → Apps → Special app access → Notification access → Tasker).
2. Profile → **Event** → **Notification** → select the bank app (or Owner Application = bank package).
3. Optional: restrict **Text** / **Title** with regex if the bank spams marketing notifications.
4. Task → **Net** → **HTTP Request**
   - Method: `POST`
   - URL: `https://YOUR_DOMAIN/api/webhooks/notification-ingest`
   - Headers: `Authorization: Bearer YOUR_TOKEN`, `Content-Type: application/json`
   - Body (JSON):

```json
{
  "text": "%NTITLE\n%NTEXT",
  "package": "%pkgname",
  "postedAt": "%TIMES",
  "idempotencyKey": "%TIMES-%NTITLE-%NTEXT"
}
```

(Tasker variables: `%NTITLE`, `%NTEXT`, `%pkgname` — confirm in Tasker’s variable help for your version.)

5. Test with a real card purchase notification.

### MacroDroid

1. Install **MacroDroid**; enable **Notification access** for MacroDroid.
2. Trigger: **Notification Posted** → restrict **Application** to the bank app.
3. Optional: **Notification Text** or **Title** contains `purchase|debit|spent` (bank-specific).
4. Action: **HTTP Request**
   - URL: webhook URL above
   - Method: POST
   - Content type: `application/json`
   - Header: `Authorization: Bearer <token>`
   - Body template (use MacroDroid magic variables):

```json
{
  "text": "{not_title}\n{not_text}",
  "package": "{not_package_name}",
  "idempotencyKey": "{not_id}"
}
```

(Variable names differ slightly by version — use MacroDroid’s variable picker on the notification trigger.)

### Automate (LlamaLab)

1. Install **Automate**; grant notification access to the **Notification read** block (or use companion flow with AutoNotification plugin if needed).
2. Build a flow: **Notification posted** → filter package name → **HTTP request** block.
3. POST JSON with `text` built from notification title + text fields; same headers as above.

Automate flows are harder to document as static screenshots; agents should link users to Automate’s “HTTP request” and “Notification posted” block docs and mirror the same JSON body as Tasker.

---

## Troubleshooting (chatbot / support playbook)

| Symptom | Likely cause | What to check |
|---------|----------------|---------------|
| HTTP 401 | Wrong or missing token | Re-copy from `GET /api/user/notification-ingest`; no extra spaces; `Bearer ` prefix |
| HTTP 403 “premium” | Free tier | Premium or trial required |
| HTTP 403 “trial cap” | 100 captures/month | Upgrade or wait for next month |
| HTTP 422 | Parser could not find payee/amount | Ask for sample notification text; adjust automation to send full title+body; bank may hide amount in notification |
| HTTP 503 | OpenAI rate limit | Retry; check deployment `OPENAI_API_KEY` |
| Nothing in app, HTTP 200 | Routed to pending | Review Inbox; low envelope confidence |
| Duplicate transactions | Automation fires twice | Set `idempotencyKey` from stable notification id |
| Marketing notifications imported | Filter too broad | Add title/text filter in Tasker/MacroDroid |
| Works on Wi‑Fi only | Phone cannot reach URL | Use public HTTPS; avoid localhost unless ngrok |

**Information to collect (never ask for ingest token in public chat):**

- Bank app name and Android **package** (from automation variable or App info)
- Redacted sample notification title + body
- HTTP status + response body from automation’s test run
- Whether Review Inbox shows pending items

**Do not log** ingest tokens, full notification bodies, or decrypted payees in support tickets.

---

## Implementation reference (maintainers)

| Piece | Location |
|-------|----------|
| Webhook route | `app/api/webhooks/notification-ingest/route.ts` |
| User token API | `app/api/user/notification-ingest/route.ts` |
| Alert text parser | `lib/bank-alert-parser.ts` |
| Ingest + dedupe | `lib/notification-ingest.ts` |
| Transaction source | `notification_forward` in `lib/data.ts` |
| Trial/monthly cap | `lib/subscription.ts` (`PREMIUM_CAPTURE_SOURCES`) |

Future product work (not required for DIY): Settings UI surfacing webhook URL, in-app setup wizard, per-bank regex templates, optional BitBudget Android helper app.

## Related docs

- [Email forwarding setup](./email-forwarding-setup.md)
- [Outbound messaging](./outbound-messaging.md) (BitBudget → user pushes, opposite direction)
