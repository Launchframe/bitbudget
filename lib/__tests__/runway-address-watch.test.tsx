// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RunwayAddressWatch } from "@/components/runway-address-watch"
import {
  clearAllWalletWatches,
  getWalletWatchSnapshot,
  writeWalletWatches,
  type WalletWatch,
} from "@/lib/wallet-watch-store"

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ currentUserId: "user-1" }),
}))

const KNOWN = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
const ADDED = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"

const pending: Array<(response: Response) => void> = []

function watch(partial: Partial<WalletWatch> & Pick<WalletWatch, "id" | "descriptor">): WalletWatch {
  return {
    label: "Wallet",
    role: "wallet",
    kind: "address",
    confirmedSats: 0,
    updatedAt: null,
    ...partial,
  }
}

function stubLookup() {
  pending.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve)
        }),
    ),
  )
}

async function finishLookup(body: unknown, status = 200) {
  const resolve = pending.shift()
  if (!resolve) throw new Error("no pending lookup")
  await act(async () => {
    resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )
  })
}

describe("RunwayAddressWatch", () => {
  beforeEach(() => {
    stubLookup()
    clearAllWalletWatches()
  })

  afterEach(() => {
    cleanup()
    clearAllWalletWatches()
    vi.unstubAllGlobals()
  })

  it("does not show an unread address as zero bitcoin", () => {
    writeWalletWatches("user-1", [watch({ id: "old", descriptor: KNOWN })])
    render(<RunwayAddressWatch />)
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument()
    expect(screen.queryByText(/0 sats/)).not.toBeInTheDocument()
    expect(screen.getByText(/already sent to sell/)).toBeInTheDocument()
  })

  it("keeps a just-added address when another row is removed before the lookup finishes", async () => {
    writeWalletWatches("user-1", [
      watch({ id: "old", descriptor: KNOWN, confirmedSats: 1000, updatedAt: "2026-11-01T00:00:00.000Z" }),
    ])
    render(<RunwayAddressWatch />)

    fireEvent.change(screen.getByLabelText("Bitcoin address"), { target: { value: ADDED } })
    fireEvent.click(screen.getByRole("button", { name: "Add address" }))
    expect(screen.getByText(/Checking…/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "Remove this address" })[0]!)
    await finishLookup({
      address: ADDED,
      chain_stats: { funded_txo_sum: 50, spent_txo_sum: 5 },
    })

    const ids = getWalletWatchSnapshot("user-1").map((row) => row.descriptor)
    expect(ids).toEqual([ADDED])
    expect(getWalletWatchSnapshot("user-1")[0]?.confirmedSats).toBe(45)
    expect(screen.queryByText(KNOWN)).not.toBeInTheDocument()
  })

  it("leaves a failed add as not checked, and a refresh does not restore a cleared list", async () => {
    writeWalletWatches("user-1", [
      watch({ id: "old", descriptor: KNOWN, confirmedSats: 1000, updatedAt: "2026-11-01T00:00:00.000Z" }),
    ])
    render(<RunwayAddressWatch />)

    fireEvent.change(screen.getByLabelText("Bitcoin address"), { target: { value: ADDED } })
    fireEvent.click(screen.getByRole("button", { name: "Add address" }))
    await finishLookup({ address: ADDED }, 400)

    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't look up/)
    expect(getWalletWatchSnapshot("user-1").map((row) => row.descriptor)).toEqual([KNOWN, ADDED])
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "Remove this address" })[1]!)
    fireEvent.click(screen.getByRole("button", { name: "Refresh this address" }))
    act(() => {
      clearAllWalletWatches()
    })
    await finishLookup({
      address: KNOWN,
      chain_stats: { funded_txo_sum: 9, spent_txo_sum: 0 },
    })
    expect(getWalletWatchSnapshot("user-1")).toEqual([])
  })
})
