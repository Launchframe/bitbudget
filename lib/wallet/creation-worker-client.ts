import type { CreationCommand } from "@/lib/wallet/creation.worker"
import type { CreationProgress } from "@/lib/wallet/creation-session"
import { WalletClientError } from "@/lib/wallet/client-http"

type CommandInput = CreationCommand extends infer T ? T extends CreationCommand ? Omit<T, "id"> : never : never

export class CreationWorkerClient {
  private worker: Worker | null = null
  private pending: { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (event: CreationProgress) => void; timer: ReturnType<typeof setTimeout> } | null = null

  run(command: CommandInput, progress?: (event: CreationProgress) => void): Promise<unknown> {
    if (this.pending) return Promise.reject(new WalletClientError("wallet-operation-in-progress"))
    if (!this.worker) {
      this.worker = new Worker(new URL("./creation.worker.ts", import.meta.url), { type: "module" })
      this.worker.onmessage = event => {
        const pending = this.pending
        if (!pending || event.data?.id !== pending.id) return
        if (event.data.type === "progress") { pending.progress?.(event.data.progress); return }
        clearTimeout(pending.timer)
        this.pending = null
        if (event.data.type === "result") pending.resolve(event.data.result)
        else pending.reject(new WalletClientError(typeof event.data.code === "string" && /^[a-z-]{1,64}$/.test(event.data.code) ? event.data.code : "wallet-creation-failed"))
      }
      this.worker.onerror = event => { event.preventDefault(); this.dispose("wallet-worker-unavailable") }
    }
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose("wallet-operation-timeout"), 180_000)
      this.pending = { id, resolve, reject, progress, timer }
      const transfer = [command.input.prf.buffer]
      if (command.type === "create") transfer.push(command.input.privacyKey.buffer)
      try { this.worker!.postMessage({ ...command, id }, transfer) }
      catch { this.dispose("wallet-worker-unavailable") }
    })
  }

  dispose(code = "setup-cancelled") {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new WalletClientError(code))
      this.pending = null
    }
    this.worker?.terminate()
    this.worker = null
  }
}
