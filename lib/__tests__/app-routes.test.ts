import { describe, expect, it } from "vitest"
import { hashToPage, initialRouteFromLocation, pageToHash } from "@/lib/app-routes"

describe("hashToPage / pageToHash", () => {
  it("round-trips shopping group routes", () => {
    expect(pageToHash("shopping-group", "g1")).toBe("#/shopping/group/g1")
    expect(hashToPage("#/shopping/group/g1")).toEqual({ page: "shopping-group", envelopeId: "g1" })
  })

  it("maps the shopping list and unknown paths", () => {
    expect(hashToPage("#/shopping")).toEqual({ page: "shopping" })
    expect(hashToPage("#/nope")).toEqual({ page: "dashboard" })
    expect(hashToPage("")).toEqual({ page: "dashboard" })
  })
})

describe("initialRouteFromLocation", () => {
  it("opens Shopping when an invite is waiting and no page is in the URL", () => {
    expect(initialRouteFromLocation("", true)).toEqual({ page: "shopping" })
    expect(initialRouteFromLocation("#/", true)).toEqual({ page: "shopping" })
  })

  it("keeps an explicit page even with a waiting invite", () => {
    expect(initialRouteFromLocation("#/transactions", true)).toEqual({ page: "transactions" })
    expect(initialRouteFromLocation("#/shopping/group/g1", true)).toEqual({
      page: "shopping-group",
      envelopeId: "g1",
    })
  })

  it("falls back to the dashboard without an invite", () => {
    expect(initialRouteFromLocation("", false)).toEqual({ page: "dashboard" })
  })
})
