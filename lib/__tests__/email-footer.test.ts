import { describe, expect, it } from "vitest"
import { insertBeforeLastClosingDiv } from "../email"

describe("insertBeforeLastClosingDiv", () => {
  it("inserts before the outer closing div when templates nest divs", () => {
    const html = `<div outer><div inner></div><p>body</p></div>`
    const out = insertBeforeLastClosingDiv(html, `<footer></div>`)
    expect(out).toBe(`<div outer><div inner></div><p>body</p><footer></div>`)
  })

  it("returns html unchanged when no closing div exists", () => {
    expect(insertBeforeLastClosingDiv("<p>only</p>", "<footer></div>")).toBe("<p>only</p>")
  })
})
