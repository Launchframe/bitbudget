import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const image = "postgres:16.11-bookworm@sha256:a2420e9555e2224583fe84d0bb3f0b967e69354ae3a0be55a9c14e251388c4eb"
const runId = randomBytes(8).toString("hex")
const password = randomBytes(32).toString("hex")
const env = {
  ...process.env,
  PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH ?? ""}`,
  POSTGRES_PASSWORD: password,
  WALLET_COSIGNER_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  WALLET_WEBAUTHN_RP_ID: "wallet.example.test",
  WALLET_WEBAUTHN_ORIGINS: "https://wallet.example.test",
  WALLET_DATABASE_FIXTURE: runId,
}
let container = ""
let temporary = ""
let interrupted = false
process.on("SIGINT", () => { interrupted = true })
process.on("SIGTERM", () => { interrupted = true })

function run(command, args, capture = false) {
  if (interrupted) throw new Error("Wallet database fixture interrupted")
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${command} failed in isolated wallet database fixture`)
  return result.stdout?.trim() ?? ""
}

try {
  if (process.argv.slice(2).some(argument => !["--full-unit-suite", "--browser", "--cache-browser"].includes(argument))) throw new Error("Only --full-unit-suite, --browser and --cache-browser are supported")
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22 is required")
  run("docker", ["info"], true)
  run("docker", ["buildx", "imagetools", "inspect", image], true)
  run("docker", ["pull", image])
  container = run("docker", [
    "create", "--name", `wallet-database-${runId}`, "--label", `wallet-database-fixture=${runId}`,
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=wallet_test", "--env", "POSTGRES_USER=postgres",
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--tmpfs", "/var/run/postgresql:rw",
    "--security-opt", "no-new-privileges", "--pids-limit", "256", image,
  ], true)
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error("Unexpected fixture container identity")
  run("docker", ["start", container], true)
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (interrupted) throw new Error("Wallet database fixture interrupted")
    const result = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "wallet_test"], { env, stdio: "ignore" })
    if (result.status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error("Isolated Postgres did not start")
  const address = run("docker", ["port", container, "5432/tcp"], true)
  if (!/^127\.0\.0\.1:[0-9]+$/.test(address)) throw new Error("Fixture database must bind only to loopback")
  env.DATABASE_URL = `postgresql://postgres:${password}@${address}/wallet_test?schema=public`
  env.DATABASE_URL_UNPOOLED = env.DATABASE_URL
  env.WALLET_TEST_DATABASE_URL = env.DATABASE_URL
  temporary = await mkdtemp(path.join(tmpdir(), "bitbudget-wallet-schema-"))
  const sqlFile = path.join(temporary, "wallet.sql")
  run("pnpm", ["exec", "prisma", "migrate", "deploy"])
  const sql = run("pnpm", ["exec", "prisma", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], true)
  if (/^\s*(?:DROP|TRUNCATE|DELETE\s+FROM)\b/im.test(sql)) throw new Error("Fixture schema delta unexpectedly contains destructive SQL")
  await writeFile(sqlFile, sql)
  run("pnpm", ["exec", "prisma", "db", "execute", "--file", sqlFile, "--schema", "prisma/schema.prisma"])
  run("pnpm", ["exec", "vitest", "run", "--config", "scripts/wallet-database-vitest.config.mts"])
  if (process.argv.includes("--full-unit-suite")) run("pnpm", ["exec", "vitest", "run"])
  if (process.argv.includes("--cache-browser")) run("node", ["scripts/wallet-cache.browser.mjs"])
  if (process.argv.includes("--browser")) {
    env.WALLET_TEST_INTERRUPT_DKG = "false"
    env.WALLET_TEST_UNSUPPORTED_PRF = "false"
    run("node", ["scripts/wallet-setup.browser.mjs"])
    env.WALLET_TEST_INTERRUPT_DKG = "true"
    run("node", ["scripts/wallet-setup.browser.mjs"])
    env.WALLET_TEST_INTERRUPT_DKG = "false"
    env.WALLET_TEST_UNSUPPORTED_PRF = "true"
    run("node", ["scripts/wallet-setup.browser.mjs"])
  }
  console.log("Isolated wallet PostgreSQL integration passed; existing databases and environment files were untouched.")
} catch (error) {
  console.error(error instanceof Error ? error.message : "Isolated wallet database fixture failed")
  process.exitCode = 1
} finally {
  if (container) {
    const result = spawnSync("docker", ["rm", "-fv", container], { env, stdio: "ignore" })
    if (result.status !== 0) { console.error(`Could not remove owned fixture container ${container}`); process.exitCode = 1 }
  }
  if (temporary) await rm(temporary, { recursive: true, force: true })
}
