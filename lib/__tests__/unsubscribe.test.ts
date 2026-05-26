import { describe, expect, it } from "vitest"
import { parseUnsubscribeRequest, unsubscribeConfirmHtml } from "@/lib/unsubscribe"

describe("unsubscribe", () => {
  it("parses token and category from unsubscribe links", () => {
    expect(parseUnsubscribeRequest("tok", "feature_updates")).toEqual({
      token: "tok",
      preference: "featureUpdates",
      label: "feature updates",
    })
    expect(parseUnsubscribeRequest("tok", "all")).toEqual({
      token: "tok",
      preference: "all",
      label: "all optional BitBudget email categories",
    })
    expect(parseUnsubscribeRequest("", "feature_updates")).toBeNull()
  })

  it("renders a POST confirmation form without mutating preferences", () => {
    const html = unsubscribeConfirmHtml(
      "https://bitbudget.test",
      "secret-token",
      "feature_updates",
      "feature updates",
    )
    expect(html).toContain('method="post"')
    expect(html).toContain('name="token" value="secret-token"')
    expect(html).toContain('name="category" value="feature_updates"')
    expect(html).toContain("nothing has been updated yet")
  })
})
