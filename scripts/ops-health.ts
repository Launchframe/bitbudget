#!/usr/bin/env npx tsx
/**
 * Ping /api/health (local or production).
 * Usage: OPS_BASE_URL=https://bitbudget.io pnpm ops:health
 */

const base = (process.env.OPS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")

async function main() {
  const url = `${base}/api/health`
  const res = await fetch(url, { cache: "no-store" })
  const body = await res.text()
  console.log(`GET ${url}`)
  console.log(`Status: ${res.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2))
  } catch {
    console.log(body)
  }
  process.exit(res.ok ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
