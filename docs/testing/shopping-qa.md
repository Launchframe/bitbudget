# QA: Shared shopping lists

End-to-end check of the two-person flow: create a group, invite, join, approve, requests, receipts with item matching, the running tab, payments, and opt-in budget posting.

Use **local dev** or **staging** only. Do not run the seed script against production.

## Setup (local)

1. Apply migrations: `pnpm exec prisma migrate deploy`.
2. Seed two test users (deletes and recreates them, including any groups they own):

   ```bash
   pnpm qa:shopping:seed
   ```

   | Account | Sign-in code | Passphrase |
   |---------|--------------|------------|
   | `shopping-owner@bitbudget.test` | `424242` | `4242` |
   | `shopping-member@bitbudget.test` | `424242` | `4242` |

   Both accounts finish onboarding, have encryption set up, and have a **Groceries** envelope.

3. Start the dev server with the test sign-in code enabled (do not put these in `.env.local`):

   ```bash
   E2E_TEST=true E2E_EMAIL_CODE=424242 pnpm dev
   ```

   `E2E_TEST` also turns off outbound email and Nostr DMs.

4. Use **two separate browser sessions** (for example a normal window and a private window, or two browser profiles). Each person needs their own sign-in cookie.

`DATABASE_URL` (the app) and `DATABASE_URL_UNPOOLED` (migrations) must point at the **same** database. If they differ, the seed or the app fails with missing-column errors (Prisma `P2022`).

## Setup (staging)

The fixed sign-in code is not available on staging. Use two real accounts with encryption set up (passphrase or Nostr) and at least one spending envelope each. Both accounts must have unlocked the app once so their public key is uploaded. Joining fails without it.

## Checklist

### 1. Create a group (owner)

- [ ] Sign in as the owner and unlock. Open **Shopping**.
- [ ] **Create group** asks for a group name, an optional description, and **Your name in this group**. Create is disabled until both names are filled in.
- [ ] After creating, you land on the group page with the **Requests** tab open.

### 2. Invite (owner)

- [ ] **Members** → **Add member** → **Create invite link**. Copy the link and note **Your code** (the owner's fingerprint).
- [ ] The link looks like `/shopping-invite#<token>.<key>`. The part after `#` is never sent to the server.

### 3. Join (member)

- [ ] In the second browser, open the invite link while signed out.
- [ ] Sign in as the member and unlock. The app opens **Shopping** (not the dashboard) and shows **You have a shopping invite**.
- [ ] **Send join request** stays disabled until you enter a name.
- [ ] After sending, a short code and a fingerprint appear. Note both.
- [ ] Also check: opening the invite link while already signed in goes straight to Shopping with the banner.

### 4. Approve (owner)

- [ ] Reload the group. **Members** → **Join requests** shows **Someone asked to join** → **Review**.
- [ ] The code and fingerprint match what the member sees. Turn on **I compared this with them**, then **Add to group**.
- [ ] Both people show under **Group members** with the names they chose (neither is called "You").
- [ ] **Decline** on a second test invite removes the request. **Revoke link** cancels an open link.

### 5. Requests and check-off

- [ ] Member opens the group (now listed on Shopping) → **Add a request** (e.g. "Coffee beans").
- [ ] Owner sees the request after a refresh, labeled with the member's name.
- [ ] Checking off an item updates for the other person within about 20 seconds, or right away after a reload.
- [ ] Offline check-off (DevTools → Network → Offline): check an item, go back online, and confirm it syncs.

### 6. Receipt with item matching (owner)

- [ ] **Receipts** → **Add receipt**. Enter a merchant and a total (e.g. $40.00).
- [ ] Add an item line matched to the member's "Coffee beans" request (e.g. $12.00). Leave the rest as **Split with everyone**.
- [ ] Changing a suggested match by hand sticks: later suggestions do not overwrite it.
- [ ] **Save and split** → the matched request is checked off.
- [ ] Expected split for $40 with a $12 matched item: member owes $12 + $14 = **$26**, owner's share is $14.

### 7. Running tab and payments

- [ ] **Tab**: owner sees **Net owed to you** $26.00; member sees **You owe** $26.00.
- [ ] Member → **Tab** → **Record payment**, with **I paid them** on, $26.00. Both tabs show $0.
- [ ] A partial payment (e.g. $10) leaves the right balance on both sides.

### 8. Budget posting (each person, opt-in)

- [ ] On the group page, **Your budget** card: turn on **Add shared purchases to an envelope** and choose **Groceries**.
- [ ] With **Include purchases already on the tab** off, earlier purchases are not offered. Turn it on and **Save**: they appear.
- [ ] Owner sees rows such as "Your share" and "You covered someone else". Member sees "Your share" and "You paid them back".
- [ ] **Add** one row → it disappears from the list, and **Transactions** shows a row in Groceries with the merchant as payee (decrypted).
- [ ] **Skip** another row → it does not come back after reload.
- [ ] The other person never sees your envelope choice or your rows.

### 9. Logout and privacy

- [ ] Logging out clears a pending invite. Reopening the app after logout does not show the banner.
- [ ] In DevTools → Network, request and response bodies for `/api/shopping/*` contain only `sg1:` ciphertext for names, items, and merchants.

### 10. Mobile

- [ ] Repeat steps 3, 6, and 8 at **390px** and **320px** widths. No horizontal page scroll; dialogs scroll inside.

## Troubleshooting

- **"This invite is missing a key"**: the link was cut off after `#`. Create a new invite.
- **Join fails with a public key error**: the member has never unlocked the app. Unlock once, then retry.
- **Invalid code on sign-in**: the dev server was not started with `E2E_TEST=true E2E_EMAIL_CODE=424242`, or the email does not end in `@bitbudget.test`. Click **Resend code** and try again.
