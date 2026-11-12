// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const findFirst = vi.fn()
const update = vi.fn()
const create = vi.fn()
const deleteMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    plaidAccount: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
      create: (...args: unknown[]) => create(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}))

import { upsertPlaidAccountSnapshots } from "@/lib/plaid-account-sync"
import type { PlaidAccountSnapshot } from "@/lib/plaid-ledger"

function snapshot(accountId: string, name = "Checking"): PlaidAccountSnapshot {
  return {
    accountId,
    name,
    mask: "1234",
    type: "depository",
    balances: { current: 10, available: 8, isoCurrencyCode: "USD" },
  }
}

describe("upsertPlaidAccountSnapshots", () => {
  beforeEach(() => {
    findFirst.mockReset()
    update.mockReset()
    create.mockReset()
    deleteMany.mockReset()
    update.mockResolvedValue({})
    create.mockResolvedValue({})
    deleteMany.mockResolvedValue({ count: 0 })
  })

  it("drops accounts missing from the latest snapshot", async () => {
    findFirst.mockResolvedValue(null)
    await upsertPlaidAccountSnapshots("item_1", [snapshot("acc_live")])
    expect(create).toHaveBeenCalledOnce()
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        plaidItemId: "item_1",
        OR: [{ plaidAccountId: null }, { plaidAccountId: { notIn: ["acc_live"] } }],
      },
    })
  })

  it("removes every account when Plaid returns none", async () => {
    await upsertPlaidAccountSnapshots("item_1", [])
    expect(create).not.toHaveBeenCalled()
    expect(deleteMany).toHaveBeenCalledWith({
      where: { plaidItemId: "item_1" },
    })
  })
})
