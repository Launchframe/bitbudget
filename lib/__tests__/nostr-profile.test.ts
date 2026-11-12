import { describe, expect, it } from "vitest"
import {
  computeNostrProfileUpdates,
  isNostrPlaceholderName,
  needsNostrProfileSync,
  sanitizeNostrProfileImage,
  sanitizeNostrProfileName,
} from "../nostr-profile"

describe("isNostrPlaceholderName", () => {
  it("detects auto-generated nostr: prefix names", () => {
    expect(isNostrPlaceholderName("nostr:b1774ffd")).toBe(true)
    expect(isNostrPlaceholderName("Alice")).toBe(false)
    expect(isNostrPlaceholderName(null)).toBe(false)
  })
})

describe("needsNostrProfileSync", () => {
  const pubkey = "a".repeat(64)

  it("is false for non-Nostr accounts", () => {
    expect(
      needsNostrProfileSync({ nostrPubkey: null, name: "Alice", image: "https://x.test/a.png" }),
    ).toBe(false)
  })

  it("is true when name is still a placeholder", () => {
    expect(
      needsNostrProfileSync({
        nostrPubkey: pubkey,
        name: "nostr:b1774ffd",
        image: "https://x.test/a.png",
      }),
    ).toBe(true)
  })

  it("is true when avatar is missing", () => {
    expect(
      needsNostrProfileSync({ nostrPubkey: pubkey, name: "Alice", image: null }),
    ).toBe(true)
  })

  it("is false when name and avatar are populated", () => {
    expect(
      needsNostrProfileSync({
        nostrPubkey: pubkey,
        name: "Alice",
        image: "https://x.test/a.png",
      }),
    ).toBe(false)
  })
})

describe("sanitizeNostrProfileName", () => {
  it("trims and caps length", () => {
    expect(sanitizeNostrProfileName(` ${"A".repeat(90)} `)).toBe("A".repeat(80))
  })
})

describe("sanitizeNostrProfileImage", () => {
  it("accepts https URLs", () => {
    expect(sanitizeNostrProfileImage(" https://cdn.test/p.png ")).toBe("https://cdn.test/p.png")
  })

  it("rejects javascript URLs", () => {
    expect(sanitizeNostrProfileImage("javascript:alert(1)")).toBeUndefined()
  })
})

describe("computeNostrProfileUpdates", () => {
  it("updates placeholder name and missing avatar", () => {
    expect(
      computeNostrProfileUpdates(
        { name: "nostr:abc12345", image: null },
        { name: "Alice", image: "https://cdn.test/a.png" },
      ),
    ).toEqual({
      name: "Alice",
      image: "https://cdn.test/a.png",
    })
  })

  it("does not overwrite a custom display name", () => {
    expect(
      computeNostrProfileUpdates(
        { name: "Alice", image: null },
        { name: "Bob", image: "https://cdn.test/a.png" },
      ),
    ).toEqual({
      image: "https://cdn.test/a.png",
    })
  })

  it("returns null when relay metadata adds nothing new", () => {
    expect(
      computeNostrProfileUpdates(
        { name: "Alice", image: "https://cdn.test/a.png" },
        { name: "Bob", image: "https://cdn.test/a.png" },
      ),
    ).toBeNull()
  })
})
