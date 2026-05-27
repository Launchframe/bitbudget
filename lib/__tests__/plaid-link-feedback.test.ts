import { describe, expect, it } from "vitest"
import {
  PLAID_CONNECT_RETRY_DEFAULT,
  PLAID_CONNECT_RETRY_SESSION,
  plaidConnectFailureMessage,
  plaidLinkExitErrorMessage,
} from "@/lib/plaid-link-feedback"

describe("plaidConnectFailureMessage", () => {
  it("maps 401 to session timeout copy", () => {
    expect(plaidConnectFailureMessage({ httpStatus: 401 })).toBe(PLAID_CONNECT_RETRY_SESSION)
  })

  it("maps expired link token exit errors", () => {
    expect(
      plaidConnectFailureMessage({
        exitError: { error_code: "INVALID_LINK_TOKEN" },
      }),
    ).toContain("timed out")
  })

  it("prefers server message when provided", () => {
    expect(
      plaidConnectFailureMessage({
        httpStatus: 500,
        serverMessage: "Custom server error",
      }),
    ).toBe("Custom server error")
  })

  it("falls back to default encouragement", () => {
    expect(plaidConnectFailureMessage({ httpStatus: 500 })).toBe(PLAID_CONNECT_RETRY_DEFAULT)
  })
})

describe("plaidLinkExitErrorMessage", () => {
  it("uses Plaid display_message when present", () => {
    expect(
      plaidLinkExitErrorMessage({
        error_code: "INTERNAL_ERROR",
        display_message: "Something went wrong on our end.",
      }),
    ).toBe("Something went wrong on our end.")
  })
})
