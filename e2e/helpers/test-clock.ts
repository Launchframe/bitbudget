import type { Page } from "@playwright/test"

declare global {
  interface Window {
    __BITBUDGET_TEST_NOW__?: number
    __BITBUDGET_TEST_CLOCK_INSTALLED__?: boolean
  }
}

export async function installTestClock(page: Page, isoDate: string): Promise<void> {
  const timestamp = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00.000Z`).getTime()

  await page.addInitScript((time) => {
    globalThis.__BITBUDGET_TEST_NOW__ = time
    if (globalThis.__BITBUDGET_TEST_CLOCK_INSTALLED__) return
    globalThis.__BITBUDGET_TEST_CLOCK_INSTALLED__ = true
    const RealDate = globalThis.Date

    class MockDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(globalThis.__BITBUDGET_TEST_NOW__ ?? RealDate.now())
        } else {
          super(...args)
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
