// @vitest-environment node
import { describe, expect, it } from "vitest"
import { mergeShoppingOwnerInvites } from "@/lib/shopping-server"

describe("mergeShoppingOwnerInvites", () => {
  const d = (iso: string) => new Date(iso)

  it("always keeps actionable invites even when history is capped", () => {
    const actionable = [
      { id: "old-pending", status: "pending", createdAt: d("2025-01-01T00:00:00.000Z") },
    ]
    const history = Array.from({ length: 60 }, (_, i) => ({
      id: `h${i}`,
      status: "revoked",
      createdAt: d(`2025-06-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`),
    }))
    const merged = mergeShoppingOwnerInvites(actionable, history, 50)
    expect(merged.some((row) => row.id === "old-pending")).toBe(true)
    expect(merged.length).toBe(51)
  })

  it("dedupes overlapping rows and sorts newest first", () => {
    const t = d("2025-06-15T12:00:00.000Z")
    const merged = mergeShoppingOwnerInvites(
      [{ id: "a", createdAt: t }],
      [{ id: "a", createdAt: t }, { id: "b", createdAt: d("2025-06-16T12:00:00.000Z") }],
      50,
    )
    expect(merged.map((r) => r.id)).toEqual(["b", "a"])
  })
})
