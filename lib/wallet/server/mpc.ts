import { readFile } from "node:fs/promises"
import { join } from "node:path"
import * as core from "@/wallet-mpc/pkg/wallet_mpc.js"
import { assertServerRuntime, WalletError } from "@/lib/wallet/server/config"

let initialization: Promise<void> | undefined

export async function loadWalletMpc() {
  assertServerRuntime()
  initialization ??= readFile(join(process.cwd(), "wallet-mpc", "pkg", "wallet_mpc_bg.wasm"))
    .then(bytes => core.default({ module_or_path: bytes }))
    .then(() => undefined)
    .catch(() => {
      initialization = undefined
      throw new WalletError(503, "creation-unavailable")
    })
  await initialization
  return core
}

