import { escapeCsvField } from "@/lib/transaction-export"
import type { PairwiseBalance } from "@/lib/shopping-ledger"
import { centsToDollars } from "@/lib/shopping-split-math"

export function buildShoppingTabCsv(params: {
  groupName: string
  generatedOn: string
  aliasesByMemberId: ReadonlyMap<string, string>
  balances: readonly PairwiseBalance[]
}): string {
  const lines = [
    ["Group", params.groupName],
    ["Generated", params.generatedOn],
    [],
    ["Member A", "Member B", "Net (A is owed)", "Prepaid A", "Prepaid B"],
  ]
  for (const row of params.balances) {
    lines.push([
      params.aliasesByMemberId.get(row.memberA) ?? row.memberA,
      params.aliasesByMemberId.get(row.memberB) ?? row.memberB,
      centsToDollars(row.netCents).toFixed(2),
      centsToDollars(row.prepaidA).toFixed(2),
      centsToDollars(row.prepaidB).toFixed(2),
    ])
  }
  return lines.map((cols) => cols.map((c) => escapeCsvField(String(c))).join(",")).join("\n")
}
