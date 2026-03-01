# Build Prompt: Bitcoin opportunity cost budgeting app

Use the following prompt to build business logic into this project. The frontend is provided.

Your job is to wire in the state and backend logic and make changes to the frontend as needed to support the user flows.

---

## Prompt

Build a **Budgeting app** NextJS + Vercel web app for budgeting transactions, which demonstrates the **Opportunity Cost** of past transactions to encourage the user to save their money.

## Core Ethos
This app is intended to **encourage responsible stacking**, not reckless investing or leveraged betting on the BTC price. The core ethos tennets:
1. **Cypherpunk**: we want users to onboard with freedom tech like Nostr, and we want to encourage sound money standards by showing them the advantage of saving in BTC.
2. **Sovereign software**: the user is the sole owner of their data. Though we may store that data for the user's convenience, the user owns the keys to their data, and their data is encrypted before storage so that nobody else can see it - not even our own developers. Their keys/data will NEVER BE LOGGED.
3. **Transparent**: we have nothing to hide with our privacy and security. The user understands in very simple terms that their data is theirs alone, and we can see only what we need to in order to provide them a best-in-class budgeting app.

## Concepts/Definitiions
**BTC**: "Bitcoin", a finite, permissionless, fungible and decentralized money that has historically appreciated relative to USD, and is expected to continue appreciating in the future.
**Saving**: the conversion of USD into BTC
**Payee**: the recipient of a transaction
**Payer**: the sender of a transaction
**Expense**: a transaction involving the expenditure of budgeted funds from the User to a Payee
**Credit**: a transaction involving the receiving of funds into the budget, from a Payer to the User
**Transaction**: an Expense or Credit
**Opportunity Cost**: the current value of a historical Transaction, had the dollar amount of that transaction been used to purchase BTC instead. The Opportunity Cost is the current USD value of that amount of BTC that could have been purchased had a transaction gone into savings instead.
**Envelope**: a bucket for organizing transactions based on what they were used for, e.g., Rent, Food, Entertainment, Travel, Mortgage, Student Loans

### Requirements

**1. Tech stack**
- **Language:** Latest NextJS + Node. Utilize the app router.
- **Authentication:** 
  - **Web 2.0 Authentication:** NextAuth5 OAuth flow with one-time code via email, or SSO via Google or Github. User sessions last for 30 days.
  - **nostr authentication:** support popular nostr nsec integration extensions like `nos2x`
- **e2e Encryption:** a lynchpin of this project is e2e encryption of the user's sensitive data. This means sensitive data in transactions, such as payee and the manually entered description, are encrypted at the client layer. How this is done will depend on the authentication mechanism the user used:
  - **nostr authentication:** the client extension like `nos2x` holds the user's `nsec` and uses that for encryption. The backend stores the user's `npub` and can use it for encrypting messages or notifications for the client to decrypt via `nsec`. The app NEVER REQUESTS the user's `nsec`.
  - **Web 2.0 Authentication:** upon account creation:
    - **the user provides a PIN or password that is used to derive a passphrase for that user's `privacy key`. The backend stores the encrypted privacy key, which can only be decrypted at the client layer when the user enters their PIN or password. The backend

- Async jobs and API integrations for fetching current and historical BTC/USD price data onto the app backend (Vercel service) and storing it in our own DB.
- Persistence: DB for storing users, user resources (models like Transactions and Envelopes), authentication info, historical BTC price data

**2. User flow**

- **Sign up/log in:**
  - Guide the user through first time account creation. NOSTR should be encouraged, with a guided flow for adding `nos2x` to their browser and creating or importing their `nsec` into the extension. Web 2.0 logins like one-time email code and Google or Github SSO are provided as well.
- **Establish secure data channels:**
  - How the user's encryption key is managed depends on how they logged in.
  - **Nostr nsec extension:** No further input needed. The nostr nsec is used for encrypting/decrypting private data.
  - **Email, Google and Github:** collect a PIN or password from the user (their choice). This will be used to derive a salted passphrase, which is in turn used to encrypt their privacy key. The key is stored in our backend in this encrypted form and delivered to the client at login.
- **Enter income and cadence:**
  - The user is asked what their after-tax income is, and whether they're paid monthly or bi-monthly. This figure will set the baseline for how much can be distributed across envelopes.
- **Set up envelopes:**
  - The user is taken through a wizard flow to create their first envelope. The user must provide a name, and optionally select a color and an icon to represent the envelope.
  - This step repeats until the user is finished creating envelopes.
- **Set up income allocations across envelopes:**
  - The user is given an intuitive, reactive GUI for allocating their income across the envelopes they created. Every pay cycle, the allocated amount will be debited to the respective envelope.
- **Enter transactions:**
  - The user can enter the first transaction via the **Transaction** form, or import their transaction history from other budgeting apps. `transaction_history.csv` is provided for testing/reference.
- **View historical transactions:**
  - The user can easily search and sort their past transactions, by envelope, date window, payee, tags/labels
- **Analyze spending behavior:**
  - The **Analytics** tab is used to show at-a-glance analysis of expenditure.