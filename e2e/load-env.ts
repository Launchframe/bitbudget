/**
 * Playwright test workers may not inherit env from playwright.config evaluation.
 * Load the same files as the config so Prisma and fetches see DATABASE_URL, etc.
 */
import path from "node:path"
import dotenv from "dotenv"

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })
dotenv.config({ path: path.resolve(process.cwd(), ".env") })
