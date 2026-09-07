import { createBrowserWallet, resumeBrowserWallet, verifyBrowserRecovery } from "@/lib/wallet/creation-session"
import type { CreationInput, CreationIdentity } from "@/lib/wallet/creation-session"
import { WalletClientError } from "@/lib/wallet/client-http"

export type CreationCommand =
  | { id: string; type: "create"; input: CreationInput }
  | { id: string; type: "resume"; input: CreationIdentity & { walletId: string } }
  | { id: string; type: "verify"; input: CreationIdentity & { walletId: string; password: string; file: string } }

const scope = self as unknown as { onmessage: ((event: MessageEvent<CreationCommand>) => void) | null; postMessage(value: unknown): void }
let busy = false
scope.onmessage = event => {
  const command = event.data
  if (busy) {
    command.input?.prf?.fill(0)
    if (command.type === "create") command.input?.privacyKey?.fill(0)
    scope.postMessage({ id: command.id, type: "error", code: "wallet-operation-in-progress" })
    return
  }
  busy = true
  void (async () => {
    try {
      const result = command.type === "create"
        ? await createBrowserWallet(command.input, progress => scope.postMessage({ id: command.id, type: "progress", progress }))
        : command.type === "resume"
          ? await resumeBrowserWallet(command.input)
          : command.type === "verify"
            ? await verifyBrowserRecovery(command.input)
            : null
      if (!result) throw new WalletClientError("invalid-wallet-request")
      scope.postMessage({ id: command.id, type: "result", result, assetGroup: "bitbudget-wallet-assets:signer:worker:v1" })
    } catch (error) {
      scope.postMessage({ id: command.id, type: "error", code: error instanceof WalletClientError ? error.code : command.type === "verify" ? "recovery-verification-failed" : "wallet-creation-failed" })
    } finally {
      command.input?.prf?.fill(0)
      if (command.type === "create") command.input?.privacyKey?.fill(0)
      busy = false
    }
  })()
}
