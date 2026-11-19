# E2EE channels roadmap

Grocery sharing ([issue 129](https://github.com/Launchframe/bitbudget/issues/129)) is the first product on a **sealed small-group** pattern: capability invites, a group content key wrapped to each member’s existing X25519 `User.publicKey`, AAD-bound ciphertext, and an append-only encrypted event log that can optionally project into the caller’s private ledger.

This document records what shipped with that backend, what the primitives actually guarantee, and where else they belong in a privacy-first budgeting app. Product UI for shopping is a follow-up; treat this as a **platform roadmap**, not a commitment to ship every idea.

**Related (contract, not product UI):** [AGENTS.md — Shared shopping lists](../AGENTS.md#shared-shopping-lists-backend).

---

## What these primitives are (and are not)

They are **not** mixnet anonymity. Claim requires a signed-in BitBudget user. The server sees `userId` membership, event timestamps, and ciphertext sizes. What stays private is **content** (aliases, list lines, receipt merchants, tab amounts) and **the invite token** (fragment + hash-only storage).

Do not market this as anonymous groups. Do market it as: two people can coordinate money without the server reading what or how much.

| Primitive | What it buys |
|-----------|----------------|
| Fragment invite + hash-only token | Share a join link without the token hitting access logs, `Referer`, or the database |
| Claim → owner wrap | Server never hands out group data to a stranger; membership is a crypto event, not a row flag |
| Per-member wrapped content key | N-person private channel using keys BitBudget already has |
| AES-GCM + AAD (`groupId`, object, type, revision, key version) | Ciphertext cannot be copied onto another list, receipt, or group |
| Out-of-band fingerprint | “Is this really my partner?” without the server vouching |
| Append-only encrypted events + derived tab | Shared money truth the server cannot read or “fix” |
| Opt-in private posting | Shared ledger ≠ personal budget |

**Metadata still leaked:** who is in which `groupId`, when events were appended, ciphertext sizes. Keep that honest in every product built on this stack. The primitives hide *what* and *how much*, not *that two BitBudget users are coordinating money*.

---

## What shipped (shopping as the first app)

Implementation lives under `lib/shopping-*.ts`, `app/api/shopping/`, and `prisma/migrations/20260909120000_shopping_share/`.

- **Group content key:** random 32-byte secret, created on the owner’s unlocked client, wrapped with `encryptFieldAsymmetric` to each member’s `User.publicKey` (`lib/shopping-crypto.ts`).
- **Shared payloads:** `sg1:` AES-GCM with canonical AAD. Fail closed on plaintext, wrong prefix, AAD mismatch, or decrypt failure.
- **Invites:** token in `/shopping-invite#…`; server stores SHA-256 only. Authenticated claim; no group data until an owner approves and wraps the key. Compare fingerprints out of band.
- **Pre-approval alias:** asymmetric ciphertext to the owner’s public key (not `sg1:`), so a claimant can introduce themselves before they have the group key.
- **Access:** session + active membership. Never authorize from a body `userId`. Preferences and postings are caller-owned.
- **Money:** pairwise tab derived from encrypted events (`lib/shopping-ledger.ts`). No three-party debt reassignment. Advances are cash movement, not personal spend; recoveries are not income.
- **Private posting:** shopping-managed `TX_SOURCE_*` rows; generic transaction POST/PUT/import cannot create or mutate them. Deleting a linked transaction **suppresses** the posting; it does not erase the shared tab.
- **Client:** `useShoppingState` polls while unlocked, caches ciphertext only, queues check-offs offline. Logout clears the shopping cache and pending invite.

Grocery lists, receipt splits, the running tab, and opt-in posting are the **first application** of this pattern, not the ceiling.

---

## The reusable platform

If shopping code is extracted one layer, BitBudget gets a generic **sealed small group**:

1. Invite capability (fragment, hash, claim, approve)
2. Content key wrap to `User.publicKey`
3. AAD-bound objects + revision / CAS
4. Append-only events
5. Optional projection into the caller’s private ledger

Grocery is app #1 on that platform. New products should add **record types and event kinds**, not a second crypto stack, unless the threat model is different (see [recovery](#trusted-contact-recovery)).

Rotation, remove-member, and archive already exist for shopping groups. Any new channel type must keep: wrap on approve, rotate on remove, fail closed on plaintext, never log keys or decrypted payloads.

---

## Where else this belongs

Ranked by fit with BitBudget’s ethos (user-sovereign, server-blind, warn before privacy is weakened).

### Highest leverage: household money

**Joint envelopes / “ours.”** Same group key, different record types: shared envelope names, allotments, and maybe only *classified* spend. Each person still posts privately into their own budget. That is the shopping posting model applied to rent, groceries, childcare — not a second ledger in the clear.

**Shared bills, not just groceries.** Rent, utilities, daycare, a vacation pot. Receipt finalize + pairwise tab already is “who paid, who owes.” A bills product is mostly UI and recurrence on the same event log.

**Yours / mine / ours.** The interesting part is the *boundary*. Shared channel holds the joint objects; personal payees and notes stay on the existing per-user privacy key. Opt-in posting is how you avoid “my coffee showed up on your Monthly Spend.”

**Shared savings goals.** A couple or roommates encrypt a target and contributions. Server stores ciphertext and sequence; the goal UI decrypts locally. Fits pay-yourself-first without a server-visible household balance.

**Kids / allowance with a narrow role.** Parent wraps a key to a child’s account with a member role that can check off or see a stipend envelope, not the full tab or receipts. Rotation on remove already exists.

### Sharing with someone who is not a co-budgeter

**Tax preparer / bookkeeper, time-boxed.** Invite → wrap a *read* key over an export snapshot (a year of decrypted-then-re-encrypted transactions), expire the invite, rotate. Server still never sees payees. Fingerprint comparison is the “yes, this CPA” step.

**Temporary support access without ops decrypting.** Today, support cannot read ciphertext — good. A user-initiated, expiring wrap to a helper (or a user-chosen support pubkey) is the honest version of “help me debug this envelope.” Must stay user-triggered and explain the privacy trade-off before proceeding.

**Encrypted backup to a second device or partner phone.** Same wrap: a sealed copy of material the owner already controls. The invite fragment is a decent pairing story if both people already have BitBudget accounts.

### Trusted-contact recovery

A wrapped *shard* of the privacy key — not the key itself — to one or two people via the same invite/wrap flow. Lost-PIN is a chronic failure mode.

This is **not** the shopping group key. Use a separate key purpose so grocery rotation cannot brick someone’s account, and so a removed roommate cannot hold a shard of a privacy key. Easy to get wrong; do not mix recovery with shopping AAD or group membership.

### Money movement and social finance (stay pairwise)

**Standing IOU / “I covered you.”** Strip the grocery list; keep events, tab, and repayment. That is peer settlement without a public payment network, and it matches the no-three-party-debt rule.

**Recurring split (rent on the 1st).** Encrypted event template + sequence. Each month a finalize-shaped event, or a cheaper repayment schedule. CAS already exists for concurrent edits.

**Settlement instructions, not balances.** Shared channel holds “Zelle to X / Lightning invoice / cash.” The tab stays derived; payout rails stay out of BitBudget.

**Gift, wedding, or trip pots.** Short-lived groups; archive and rotate when the trip ends. Shopping `lifecycle: archived` is the hook.

### Collaboration that is not a household

**Shared request list** for a trip or office snack run — lists, check-off, and offline outbox are a shared mutable ciphertext document, not grocery-specific.

**Household receipt inbox.** One person photographs; others see itemized lines after decrypt. Itemized scan + group key vs today’s personal receipt scan.

**Rules / payee mappings for a shared account.** Dangerous if automatic. Safer: encrypted *suggestions* in the channel that never overwrite the other person’s touched fields (same smart-defaults rule as CSV import).

**Accountable envelope moves.** A large “move from Savings” could require a second member’s encrypted ack event before the personal posting fires. That is policy on the event log, not a server workflow.

---

## Suggested order

Concrete next products if the shopping UI lands and the platform holds:

1. **Shared bills / joint envelopes** — same event log and posting boundary; largest everyday overlap with grocery.
2. **Time-boxed encrypted export to a preparer** — high trust, seasonal, reuses invite + wrap + expire/rotate without a live tab.
3. **Trusted-contact recovery shards** — highest user-value, separate key purpose, its own threat-model review.

Household invite copy should prefer a capability link + approve over “type your spouse’s email.” Server still learns that two `userId`s share a group; aliases and group names stay encrypted. That is the win versus typical budgeting apps.

---

## What not to stretch this into

- **Server-side household totals, credit scores, or “insights” across members.** Those require decrypt or plaintext amounts.
- **Public or large groups.** Wrapped keys, rotation, and pairwise tabs are for small N.
- **Three-way settling / “A owes C now.”** Out of contract. Keep IOUs pairwise or the tab will lie.
- **Mixing recovery keys with grocery groups.** Different threat model.
- **Support or admin bypass.** If the server can unwrap, the feature is not BitBudget.
- **Referrals.** Attribution must be server-visible; do not jam that through shopping invites.
- **Anonymous identity.** Claim is a logged-in user. Private is content and the token, not the membership graph.

---

## Privacy warnings (product)

Any flow that adds a second person, a preparer, a helper, or a recovery contact **weakens anonymity** even when ciphertext stays sealed: the server stores a group graph. Users must see a plain-language warning and a chance to cancel, consistent with the rest of the app (email link, Plaid, receipt inbox).

Fingerprint comparison is not optional decoration. If two people skip it, they are trusting the invite link and the BitBudget account graph, not the crypto.

---

## Code map (today)

| Concern | Where |
|---------|--------|
| AES-GCM + wrap/unwrap + fingerprint | `lib/shopping-crypto.ts` |
| Invite token, hash, fragment URL | `lib/shopping-invites.ts` |
| Event validation, pairwise ledger | `lib/shopping-event-validation.ts`, `lib/shopping-ledger.ts` |
| Private budget projection | `lib/shopping-budget-projection.ts` |
| Client poll / ciphertext cache / outbox | `lib/use-shopping-state.ts`, `lib/shopping-cache.ts` |
| HTTP + membership | `app/api/shopping/`, `lib/shopping-server.ts` |
| Schema | `prisma/schema.prisma` (`Shopping*` models), migration `20260909120000_shopping_share` |
