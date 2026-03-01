import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const text = await file.text()
  const lines = text.split("\n").filter(l => l.trim())
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV file is empty or has no data rows" }, { status: 400 })
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ""))
  const envelopeIdx = headers.findIndex(h => h === "envelope" || h === "category")
  const dateIdx = headers.findIndex(h => h === "date")
  const amountIdx = headers.findIndex(h => h === "amount")

  if (dateIdx === -1 || amountIdx === -1) {
    return NextResponse.json({ error: "CSV must have Date and Amount columns" }, { status: 400 })
  }

  const nameIdx = headers.findIndex(h => h === "name" || h === "payee" || h === "description")

  interface SampleTxn { date: string; payee: string; amount: number }
  const envelopeCounts: Record<string, number> = {}
  const envelopeSamples: Record<string, SampleTxn[]> = {}
  const MAX_SAMPLES = 3

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length <= Math.max(dateIdx, amountIdx)) continue
    const name = envelopeIdx >= 0 ? (cols[envelopeIdx] || "Uncategorized") : "Uncategorized"
    envelopeCounts[name] = (envelopeCounts[name] || 0) + 1

    if (!envelopeSamples[name]) envelopeSamples[name] = []
    if (envelopeSamples[name].length < MAX_SAMPLES) {
      const rawAmount = parseFloat(cols[amountIdx]?.replace(/[$,]/g, ""))
      envelopeSamples[name].push({
        date: cols[dateIdx] || "",
        payee: nameIdx >= 0 ? (cols[nameIdx] || "Unknown") : "Unknown",
        amount: isNaN(rawAmount) ? 0 : rawAmount,
      })
    }
  }

  // Get the user's existing envelopes
  const userEnvelopes = await prisma.envelope.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  })

  // Build a case-insensitive lookup for auto-matching
  const existingByLower: Record<string, { id: string; name: string }> = {}
  for (const e of userEnvelopes) {
    existingByLower[e.name.toLowerCase()] = { id: e.id, name: e.name }
  }

  // For each CSV envelope name, check if it matches an existing envelope
  const csvEnvelopes = Object.entries(envelopeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => {
      const match = existingByLower[name.toLowerCase()]
      return {
        csvName: name,
        count,
        autoMatchId: match?.id ?? null,
        autoMatchName: match?.name ?? null,
        samples: envelopeSamples[name] ?? [],
      }
    })

  return NextResponse.json({
    totalRows: lines.length - 1,
    csvEnvelopes,
    existingEnvelopes: userEnvelopes,
  })
}
