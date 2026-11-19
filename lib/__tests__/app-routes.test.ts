import { describe, expect, it } from "vitest"
import { hashToPage, initialRouteFromLocation, pageToHash } from "@/lib/app-routes"

describe("hashToPage / pageToHash", () => {
  it("round-trips shopping group routes", () => {
    expect(pageToHash("shopping-group", "g1")).toBe("#/shopping/group/g1")
    expect(hashToPage("#/shopping/group/g1")).toEqual({ page: "shopping-group", envelopeId: "g1" })
  })

  it("maps envelope detail and allocations", () => {
    expect(pageToHash("envelope-detail", "env-1")).toBe("#/envelope/env-1")
    expect(hashToPage("#/envelope/env-1")).toEqual({ page: "envelope-detail", envelopeId: "env-1" })
    expect(pageToHash("envelope-allocations")).toBe("#/envelopes/allocations")
    expect(hashToPage("#/envelopes/allocations")).toEqual({ page: "envelope-allocations" })
  })

  it("maps settings subpaths to settings", () => {
    expect(hashToPage("#/settings/payee-rules")).toEqual({ page: "settings" })
  })

  it("maps the shopping list and unknown paths", () => {
    expect(hashToPage("#/shopping")).toEqual({ page: "shopping" })
    expect(hashToPage("#/nope")).toEqual({ page: "dashboard" })
    expect(hashToPage("")).toEqual({ page: "dashboard" })
    expect(hashToPage("#/")).toEqual({ page: "dashboard" })
  })

  it("uses simple page hashes for standard pages", () => {
    expect(pageToHash("transactions")).toBe("#/transactions")
    expect(pageToHash("dashboard")).toBe("#/dashboard")
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
