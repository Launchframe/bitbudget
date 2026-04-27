import type { Page } from "@playwright/test"

declare global {
  interface Window {
    __BITBUDGET_TEST_NOW__?: number
    __BITBUDGET_TEST_CLOCK_INSTALLED__?: boolean
  }

  // Playwright runs this in the browser global scope, where `globalThis` is `Window`.
  // Extending the var shape keeps the injected script type-safe under the repo's strict TS config.
  var __BITBUDGET_TEST_NOW__: number | undefined
  var __BITBUDGET_TEST_CLOCK_INSTALLED__: boolean | undefined
}

export async function installTestClock(page: Page, isoDate: string): Promise<void> {
  const timestamp = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00.000Z`).getTime()

  await page.addInitScript((time) => {
    globalThis.__BITBUDGET_TEST_NOW__ = time
    if (globalThis.__BITBUDGET_TEST_CLOCK_INSTALLED__) return
    globalThis.__BITBUDGET_TEST_CLOCK_INSTALLED__ = true
    const RealDate = globalThis.Date

    class MockDate extends RealDate {
      constructor()
      constructor(value: string | number | Date)
      constructor(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number)
      constructor(...args: [] | [string | number | Date] | [number, number, number?, number?, number?, number?, number?]) {
        if (args.length === 0) {
          super(globalThis.__BITBUDGET_TEST_NOW__ ?? RealDate.now())
        } else if (args.length === 1) {
          super(args[0])
        } else {
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6])
        }
      }

      static now(): number {
        return globalThis.__BITBUDGET_TEST_NOW__ ?? RealDate.now()
      }
    }

    MockDate.UTC = RealDate.UTC
    MockDate.parse = RealDate.parse
    MockDate.prototype = RealDate.prototype
    globalThis.Date = MockDate as DateConstructor
  }, timestamp)

  if (!page.isClosed()) {
    await page.evaluate((time) => {
      globalThis.__BITBUDGET_TEST_NOW__ = time
    }, timestamp).catch(() => {
      /* Page may not have navigated yet; init script covers the first document. */
    })
  }
}
