import { Configuration, PlaidApi, PlaidEnvironments } from "plaid"

const basePath =
  process.env.PLAID_ENV === "production"
    ? PlaidEnvironments.production
    : PlaidEnvironments.sandbox

const plaidClientId = process.env.PLAID_CLIENT_ID
const plaidSecret = process.env.PLAID_SECRET

// TODO: enable once Plaid is fully integrated
// if (process.env.NODE_ENV === "production" && (!plaidClientId || !plaidSecret)) {
//   throw new Error(
//     "Missing required Plaid environment variables: PLAID_CLIENT_ID and/or PLAID_SECRET"
//   )
// }

const config = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": plaidClientId,
      "PLAID-SECRET": plaidSecret,
    },
  },
})

export const plaidClient = new PlaidApi(config)
