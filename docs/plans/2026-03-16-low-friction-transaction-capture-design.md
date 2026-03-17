# Low-Friction Transaction Capture

## Problem

Friction is the most common complaint from budgeting app users. Manually entering every transaction is too much effort for the average person. Bitbudget needs mechanisms that capture transactions with minimal to no user input, while respecting its privacy-first design.

## Approach: Layered Capture

A tiered system where users opt into the level of convenience and privacy trade-off that fits them. Free-tier methods are privacy-preserving. Paid-tier methods use third-party integrations with explicit privacy disclosures during the upgrade flow.

---

## Tier Structure

### Free Tier (privacy-preserving, no third-party data sharing)

| Feature | User effort | Description |
|---|---|---|
| Voice dictation | ~5 sec | Natural language via Web Speech API, parsed by LLM |
| Quick-entry shortcuts | ~3 sec | Tap a saved favorite/template, confirm amount |
| Enhanced receipt scanning | ~10 sec | Existing feature + auto-envelope suggestion + batch mode |
| Smart reminders | ~15 sec | Web push at user-configured time, links to quick-entry |

### Paid Tier (third-party integrations, privacy disclosures required)

| Feature | User effort | Description |
|---|---|---|
| SMS bank alert parsing | ~0 sec after setup | Forward bank texts to Twilio number |
| Email receipt forwarding | ~0 sec after setup | Forward receipts to dedicated address |
| Connected email scanning | ~0 sec after setup | OAuth Gmail/Outlook, scans for approved senders |
| Plaid bank sync | ~0 sec after setup | Connect bank/card accounts via Plaid Link |

### Upgrade Flow

When a user taps a paid feature, a modal presents:
1. What the feature does.
2. What data is shared and with whom.
3. A clear opt-in button that starts the subscription.

---

## Free Tier Features

### Voice Dictation

User taps a microphone button (sidebar and transaction list page). The Web Speech API transcribes in real time. The utterance is sent to a server-side endpoint that calls GPT-4o-mini with the user's envelope names and recent payees. The LLM returns structured JSON: `{ payee, amount, envelope, date }`.

A compact confirmation card (not the full transaction dialog) shows the parsed result. User taps confirm or edits. Under 10 seconds for the common case.

Rule-based regex parsing (`spent/paid X at Y on Z`) serves as an offline fallback.

### Quick-Entry Shortcuts

Users save favorite transactions — purchases that happen frequently but not on a fixed schedule. Each shortcut stores payee, default amount, and envelope.

A "Shortcuts" panel at the top of the New Transaction dialog shows each shortcut as a pill/chip. Tap one, confirm or adjust the amount, done. Two taps for the common case.

### Enhanced Receipt Scanning

Improvements over the existing receipt scan:
- **Auto-envelope suggestion:** Match extracted payee against transaction history. If "Trader Joe's" was filed under "Groceries" 15 times, suggest that.
- **Batch mode:** Snap multiple receipts in sequence, then review/confirm each in a list view.
- **Share intake:** Register as a Web Share Target so users can share images from camera roll or other apps into the scanner.

### Smart Reminders

Web Push Notifications (Push API). Default schedule: one notification at a user-configured time (default 8pm): "Log today's spending?" Tapping opens the app to quick-entry.

Smart suppression: if the user already logged transactions today, skip the reminder.

---

## Paid Tier Features

### SMS Bank Alert Parsing

User receives a dedicated Twilio phone number during setup. They configure their bank to send transaction alerts via SMS and forward them to that number.

Incoming SMS hits a Twilio webhook → Next.js API route. GPT-4o-mini extracts amount, payee, and date. The parsed transaction is routed through the confidence-based flow (see Review Inbox below).

Limitations communicated to users: not all banks support per-transaction SMS alerts, international format support is inconsistent at launch, and this is a supplement rather than a primary capture method.

### Email Receipt Systems

Two independent systems share the admin-curated approved senders list:

**System A: Email Forwarding** — User forwards receipts to `receipts@bitbudget.com`. This always processes the email regardless of whether the sender is on the approved list. The user made the effort, so the system honors it.

Flow:
1. Inbound email webhook (SendGrid/Mailgun) hits API route.
2. Spam and irrelevance filtering.
3. GPT-4o-mini parses payee, amount, date.
4. Result is routed through the confidence-based flow (see Review Inbox).
5. Side effect: if the receipt's original sender ("forwarded from" address) is not in the approved senders list, the sender and parsed output are surfaced in the admin sender review queue.

**System B: Connected Email Scanning** — Paid users connect Gmail/Outlook via OAuth (read-only message scope). A background cron job queries for new emails matching the approved senders list only. Parsed results are routed through the confidence-based flow.

The connection between them: System A discovers new senders. When an admin approves one from the review queue, System B picks up receipts from that sender across all connected accounts.

### Plaid Bank Sync

User goes through the Plaid Link flow to connect one or more bank/card accounts.

- **Initial sync:** Pull the last 30 days via `/transactions/sync`.
- **Ongoing sync:** Plaid webhooks notify when new transactions are available. API route fetches and routes through the confidence-based flow.
- **Categorization:** Three-pass envelope matching (see Envelope Auto-Assignment below).

---

## Review Inbox & Notification System

Every auto-captured transaction is routed through a confidence check:

**High confidence** → Auto-created as a live `Transaction` with `source` tag. User is notified via web push or in-app banner: "New transactions added since your last visit." Tapping leads to an "Added since you last visited" page where they can inspect and correct active transactions.

**Low confidence** → Created as a `PendingTransaction` in the review inbox. User is notified similarly; tapping leads to the review inbox.

### Review Inbox UX

A top-level sidebar view with a badge count. Each item shows:
- Source icon (mic, camera, SMS, email, bank).
- Payee, amount, date as parsed.
- Suggested envelope with confidence indicator.
- Confirm / Edit / Dismiss actions.

**Batch confirm:** "Confirm All" for users who trust the suggestions.

**Staleness:** Items older than 30 days are auto-dismissed with notification.

### Envelope Auto-Assignment

Three-pass strategy applied to every auto-captured transaction:

1. **Exact payee match:** User's transaction history. Most frequent envelope for that payee. Confidence 0.9+.
2. **Category mapping (Plaid only):** Merchant category codes mapped to envelope names. Admin-customizable defaults. Confidence 0.6–0.8.
3. **LLM fallback:** Payee name + user's envelope list sent to GPT-4o-mini. Confidence 0.4–0.7.

Below 0.4 confidence, the envelope is left blank for manual assignment.

User corrections feed back into pass 1, so accuracy improves over time.

---

## Asymmetric Encryption for Backend-Created Transactions

### Problem

The existing E2E encryption model is client-encrypts-before-upload. Backend-driven transaction creation (webhooks, cron jobs) cannot use this model because the server never has the user's private key.

### Solution

Asymmetric encryption. The server holds each user's public key and encrypts payee/notes at the moment of persistence. Only the client can decrypt with the private key.

| User type | Public key source | Private key source |
|---|---|---|
| Nostr | npub (already stored on server) | nsec (user manages across clients) |
| Email/SSO | Derived from passphrase, uploaded to server at setup | Derived from passphrase on client |

### Key Derivation for Non-Nostr Users

User creates a passphrase (same flow as today). Instead of deriving a symmetric key, the system derives an asymmetric key pair:

1. Passphrase → PBKDF2/scrypt → 32-byte seed.
2. Seed becomes the private key. Public key is computed from it.
3. Public key is uploaded to the server. Private key never leaves the client.
4. On a new device, user enters passphrase → identical key pair is re-derived → can decrypt immediately.

From the user's perspective, the flow is unchanged.

### Encryption Lifecycle

1. Backend receives raw transaction data (from Plaid webhook, email parse, etc.).
2. Payee and notes are encrypted with the user's public key.
3. Encrypted transaction is persisted. Plaintext is discarded.
4. Client fetches transaction, decrypts with private key, displays.

The server can write ciphertext it can never read back.

---

## Admin System

### Authentication

A `role` field on `User` (default `"user"`). Admin users are designated via a seed script or `ADMIN_EMAILS` environment variable. No self-service role assignment.

### Middleware Guard

Admin routes (`/admin/*`) check `session.user.role === "admin"`. Non-admins receive 403.

### Audit Logging

All admin actions are recorded: sender approvals/dismissals, user lookups, and future admin operations.

### Admin Portal Pages

**Users** — List of all users: email, transaction count, last login, created date. Search and filter. Read-only.

**Approved Receipt Senders** — CRUD list of approved email sender addresses/domains (e.g., `receipts@amazon.com`, `*@uber.com`). Each entry: sender pattern, display name, date added, added-by.

**Sender Review Queue** — When a forwarded receipt's original sender is not in the approved list, it appears here with: sender address, sample parsed transaction, occurrence count, first/last seen. Admin can Approve (adds to approved list) or Dismiss.

---

## Data Model Changes

### New Models

**PendingTransaction**
- id, userId, source (voice | receipt_scan | sms | email_forward | email_scan | plaid), payee (encrypted), amount, date, notes (encrypted), suggestedEnvelopeId, confidence (0–1), rawInput, tags, createdAt.
- On confirm → move to Transaction, delete PendingTransaction. On dismiss → delete.

**TransactionShortcut**
- id, userId, payee (encrypted), defaultAmount (nullable), envelopeId, label, usageCount.

**ApprovedReceiptSender**
- id, senderPattern, displayName, addedBy (admin userId), createdAt.

**PendingSenderReview**
- id, senderAddress, samplePayee, sampleAmount, occurrenceCount, firstSeenAt, lastSeenAt, status (pending | approved | dismissed).

**PlaidItem**
- id, userId, accessToken (encrypted), institutionName, consentTimestamp.

**PlaidAccount**
- id, plaidItemId, accountName, mask (last 4), type (checking | credit | savings).

**AuditLog**
- id, adminUserId, action, targetType, targetId, metadata (JSON), createdAt.

### Changes to Existing Models

**User** — Add `role` (String, default "user"), `publicKey` (String, nullable, for asymmetric encryption).

**Transaction** — Add `source` (String, default "manual"; options: manual, voice, receipt_scan, sms, email_forward, email_scan, plaid).

---

## Architecture

```
User inputs:
  Manual entry ──────────────────────┐
  Voice dictation ──► Parse (LLM) ──►├──► Confidence check
  Receipt scan ─────► Parse (LLM) ──►│     │
  SMS forward ──────► Parse (LLM) ──►│     ├─ High ──► Transaction (live, encrypted)
  Email forward ────► Parse (LLM) ──►│     │            + notify user
  Email scan (cron) ► Parse (LLM) ──►│     └─ Low ───► PendingTransaction (encrypted)
  Plaid webhook ────────────────────►┘                   + notify user
                                                              │
                                     ┌─ Unknown sender? ──► PendingSenderReview
                                     │                       (admin queue)
                                     │
                          Review inbox ◄── user reviews ──► Transaction (live)
```

All encrypted fields use the user's public key. Decryption happens client-side only.
