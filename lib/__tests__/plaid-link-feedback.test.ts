import { describe, expect, it } from "vitest"
import {
  PLAID_CONNECT_RETRY_DEFAULT,
  PLAID_CONNECT_RETRY_SESSION,
  plaidApiErrorMessage,
  plaidConnectFailureMessage,
  plaidLinkExitErrorMessage,
} from "@/lib/plaid-link-feedback"

describe("plaidConnectFailureMessage", () => {
  it("maps 401 to session timeout copy", () => {
    expect(plaidConnectFailureMessage({ httpStatus: 401 })).toBe(PLAID_CONNECT_RETRY_SESSION)
  })

  it("maps INVALID_LINK_TOKEN exit error to timed-out copy", () => {
    expect(
      plaidConnectFailureMessage({
        exitError: { error_code: "INVALID_LINK_TOKEN" },
      }),
    ).toContain("timed out")
  })

  it("maps INVALID_PUBLIC_TOKEN exit error to timed-out copy", () => {
    expect(
      plaidConnectFailureMessage({
        exitError: { error_code: "INVALID_PUBLIC_TOKEN" },
      }),
    ).toContain("timed out")
  })

  it("maps ITEM_LOGIN_REQUIRED exit error to timed-out copy", () => {
    expect(
      plaidConnectFailureMessage({
        exitError: { error_code: "ITEM_LOGIN_REQUIRED" },
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

  it("uses error_message when display_message is absent", () => {
    expect(
      plaidConnectFailureMessage({
        exitError: { error_code: "INTERNAL_SERVER_ERROR", error_message: "Internal failure." },
      }),
    ).toBe("Internal failure.")
  })

  it("returns default when exitError fields are all empty", () => {
    expect(plaidConnectFailureMessage({ exitError: {} })).toBe(PLAID_CONNECT_RETRY_DEFAULT)
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

  it("falls back to error_message when display_message is absent", () => {
    expect(
      plaidLinkExitErrorMessage({
        error_code: "INTERNAL_ERROR",
        error_message: "Fallback message.",
      }),
    ).toBe("Fallback message.")
  })

  it("returns default when passed null", () => {
    expect(plaidLinkExitErrorMessage(null)).toBe(PLAID_CONNECT_RETRY_DEFAULT)
  })
})

describe("plaidApiErrorMessage", () => {
  it("returns null for non-object errors", () => {
    expect(plaidApiErrorMessage("string error")).toBeNull()
    expect(plaidApiErrorMessage(null)).toBeNull()
  })

  it("returns null when response.data is absent", () => {
    expect(plaidApiErrorMessage({ response: {} })).toBeNull()
  })

  it("maps SDK error shape to user-facing copy", () => {
    expect(
      plaidApiErrorMessage({
        response: {
          data: { error_code: "INVALID_LINK_TOKEN" },
        },
      }),
    ).toContain("timed out")
  })
})
