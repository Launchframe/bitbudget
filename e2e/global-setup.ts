import "./load-env"
import { execSync } from "node:child_process"
import { seedAppE2e } from "./seed-app-e2e"
import { seedRecurringE2e } from "./seed-recurring-e2e"
import { seedReferralE2e } from "./seed-referral-e2e"
import { seedIncomeImporterE2e } from "./seed-income-importer-e2e"
import { seedIncomeOverhaulE2e } from "./seed-income-overhaul-e2e"

async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Playwright e2e (see AGENTS.md Testing).")
  }
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  })
  await seedReferralE2e()
  await seedRecurringE2e()
  await seedAppE2e()
  await seedIncomeImporterE2e()
  await seedIncomeOverhaulE2e()
}

export default globalSetup
