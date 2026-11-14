import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getSettingsLayoutMode,
  setSettingsLayoutMode,
  SETTINGS_LAYOUT_MODE_KEY,
  subscribeSettingsLayoutMode,
} from "@/lib/settings-layout-mode"

function createMemoryStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key]
    },
    getItem(key: string) {
      return store[key] ?? null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
  }
}

function createWindowMock() {
  const handlers = new Map<string, Set<() => void>>()
  return {
    addEventListener: vi.fn((event: string, fn: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(fn)
    }),
    removeEventListener: vi.fn((event: string, fn: () => void) => {
      handlers.get(event)?.delete(fn)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      handlers.get(event.type)?.forEach((fn) => fn())
      return true
    }),
  }
}

describe("settings-layout-mode", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage())
    vi.stubGlobal("window", createWindowMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("defaults to grid", () => {
    expect(getSettingsLayoutMode()).toBe("grid")
  })

  it("persists stack mode", () => {
    setSettingsLayoutMode("stack")
    expect(localStorage.getItem(SETTINGS_LAYOUT_MODE_KEY)).toBe("stack")
    expect(getSettingsLayoutMode()).toBe("stack")
  })

  it("notifies subscribers on change", () => {
    const listener = vi.fn()
    subscribeSettingsLayoutMode(listener)
    setSettingsLayoutMode("stack")
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
