import { describe, expect, it } from "vitest"
import {
  initialsForEnvelopeName,
  isLettersEnvelopeIcon,
  makeLettersEnvelopeIcon,
  pickEnvelopeIconForName,
} from "../envelope-icons"

describe("pickEnvelopeIconForName", () => {
  it("uses letters placeholder when no confident keyword match (e.g. Ramsey vs weak substring)", () => {
    const icon = pickEnvelopeIconForName("Ramsey", [])
    expect(isLettersEnvelopeIcon(icon)).toBe(true)
    expect(icon).toContain("Ra")
  })

  it("avoids Lucide icon collision by using letters", () => {
    const used = new Set(["Utensils"])
    const icon = pickEnvelopeIconForName("Food", used)
    expect(isLettersEnvelopeIcon(icon)).toBe(true)
  })

  it("uses Lucide when rule matches and icon is free", () => {
    const icon = pickEnvelopeIconForName("Rent", [])
    expect(icon).toBe("Home")
  })
})

describe("initialsForEnvelopeName", () => {
  it("uses first two letters of one word", () => {
    expect(initialsForEnvelopeName("Ramsey")).toBe("Ra")
  })

  it("uses uppercase first letter of first and last word", () => {
    expect(initialsForEnvelopeName("Dave Ramsey")).toBe("DR")
  })
})

describe("makeLettersEnvelopeIcon", () => {
  it("preserves casing from initials (single-word vs multi-word)", () => {
    expect(makeLettersEnvelopeIcon(initialsForEnvelopeName("ramsey"))).toBe("__bb_letters__:Ra")
    expect(makeLettersEnvelopeIcon(initialsForEnvelopeName("Dave Ramsey"))).toBe("__bb_letters__:DR")
  })
})
