import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { isAdmin } from "../admin"

describe("isAdmin", () => {
  it("returns true for admin role", () => {
    expect(isAdmin({ role: "admin" })).toBe(true)
  })

  it("returns false for user role", () => {
    expect(isAdmin({ role: "user" })).toBe(false)
  })

  it("returns false for null/undefined", () => {
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})
