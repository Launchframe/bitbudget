import { describe, expect, it } from "vitest"
import { parseBitbudgetRefCookie } from "@/lib/bitbudget-ref-cookie"

describe("parseBitbudgetRefCookie", () => {
  it("returns null when cookie absent", () => {
    expect(parseBitbudgetRefCookie("")).toBeNull()
    expect(parseBitbudgetRefCookie("other=1")).toBeNull()
  })

  it("parses code-only value with link share method", () => {
    expect(parseBitbudgetRefCookie("bitbudget_ref=ABC12")).toEqual({
      code: "ABC12",
      shareMethod: "link",
    })
  })

  it("parses code:method", () => {
    const encoded = encodeURIComponent("MYCODE:email")
    expect(parseBitbudgetRefCookie(`foo=1; bitbudget_ref=${encoded}; bar=2`)).toEqual({
      code: "MYCODE",
      shareMethod: "email",
    })
  })

  it("uses direct when method segment empty after colon", () => {
    const encoded = encodeURIComponent("XYZ:")
    expect(parseBitbudgetRefCookie(`bitbudget_ref=${encoded}`)).toEqual({
      code: "XYZ",
      shareMethod: "direct",
    })
  })
})
