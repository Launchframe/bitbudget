import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

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

function parseDate(dateStr: string): string | null {
  const mmddyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  const iso = dateStr.match(/^\d{4}-\d{2}-\d{2}$/)
  if (iso) return dateStr
  return null
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

  // envelopeMapping: JSON string of { "CSV Envelope Name": "existing-envelope-id" | "__new__" }
  // If a CSV name maps to "__new__", a new envelope is created with that name.
  // If a CSV name maps to an existing ID, transactions go to that envelope.
  const rawMapping = formData.get("envelopeMapping") as string | null
  const envelopeMapping: Record<string, string> = rawMapping ? JSON.parse(rawMapping) : {}

  const text = await file.text()
  const lines = text.split("\n").filter(l => l.trim())
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV file is empty or has no data rows" }, { status: 400 })
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ""))

  const dateIdx = headers.findIndex(h => h === "date")
  const envelopeIdx = headers.findIndex(h => h === "envelope" || h === "category")
  const nameIdx = headers.findIndex(h => h === "name" || h === "payee" || h === "description")
  const amountIdx = headers.findIndex(h => h === "amount")
  const notesIdx = headers.findIndex(h => h === "notes" || h === "memo")

  if (dateIdx === -1 || amountIdx === -1) {
    return NextResponse.json({ error: "CSV must have Date and Amount columns" }, { status: 400 })
  }

  const userEnvelopes = await prisma.envelope.findMany({
    where: { userId: session.user.id },
  })
  const envelopeByName: Record<string, string> = {}
  for (const e of userEnvelopes) {
    envelopeByName[e.name.toLowerCase()] = e.id
  }

  // Pre-resolve the mapping: create any "__new__" envelopes up front
  const resolvedMapping: Record<string, string> = {}
  for (const [csvName, target] of Object.entries(envelopeMapping)) {
    if (target === "__new__") {
      const existing = envelopeByName[csvName.toLowerCase()]
      if (existing) {
        resolvedMapping[csvName.toLowerCase()] = existing
      } else {
        const newEnv = await prisma.envelope.create({
          data: {
            userId: session.user.id,
            name: csvName,
            monthlyAllotment: 0,
            color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")}`,
          },
        })
        resolvedMapping[csvName.toLowerCase()] = newEnv.id
        envelopeByName[csvName.toLowerCase()] = newEnv.id
      }
    } else {
      resolvedMapping[csvName.toLowerCase()] = target
    }
  }

  let created = 0
  let skipped = 0
  const newEnvelopes: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length <= Math.max(dateIdx, amountIdx)) { skipped++; continue }

    const dateStr = parseDate(cols[dateIdx])
    if (!dateStr) { skipped++; continue }

    const rawAmount = parseFloat(cols[amountIdx]?.replace(/[$,]/g, ""))
    if (isNaN(rawAmount)) { skipped++; continue }

    const payee = nameIdx >= 0 ? cols[nameIdx] || "Unknown" : "Unknown"
    const type = rawAmount < 0 ? "expense" : "credit"
    const amount = Math.abs(rawAmount)
    const envelopeName = envelopeIdx >= 0 ? cols[envelopeIdx] || "Uncategorized" : "Uncategorized"
    const lowerName = envelopeName.toLowerCase()

    // Resolve envelope: check mapping first, then fall back to name match, then auto-create
    let envelopeId = resolvedMapping[lowerName] ?? envelopeByName[lowerName]
    if (!envelopeId) {
      const newEnv = await prisma.envelope.create({
        data: {
          userId: session.user.id,
          name: envelopeName,
          monthlyAllotment: 0,
          color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")}`,
        },
      })
      envelopeId = newEnv.id
      envelopeByName[lowerName] = envelopeId
      newEnvelopes.push(envelopeName)
    }

    const tags: string[] = []
    if (notesIdx >= 0 && cols[notesIdx]) {
      tags.push(cols[notesIdx])
    }

    const btcPrice = await getBtcPriceForDate(dateStr)

    await prisma.transaction.create({
      data: {
        userId: session.user.id,
        envelopeId,
        date: new Date(dateStr),
        payee,
        amount,
        type,
        tags: JSON.stringify(tags),
        satsAmount: btcPrice ? usdToSats(amount, btcPrice) : null,
      },
    })
    created++
  }

  return NextResponse.json({
    imported: created,
    skipped,
    newEnvelopes,
    totalRows: lines.length - 1,
  })
}
