import { Configuration, PlaidApi, PlaidEnvironments } from "plaid"

const basePath =
  process.env.PLAID_ENV === "production"
    ? PlaidEnvironments.production
    : PlaidEnvironments.sandbox

const config = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID || "",
      "PLAID-SECRET": process.env.PLAID_SECRET || "",
    },
  },
})

export const plaidClient = new PlaidApi(config)
