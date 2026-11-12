"use client"

import { useCallback, useEffect, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  assessTransactionCaptureReadiness,
  type TransactionCaptureReadiness,
} from "@/lib/transaction-capture-readiness"

export function useTransactionCaptureReadiness(): {
  readiness: TransactionCaptureReadiness
  loading: boolean
  refresh: () => Promise<void>
} {
  const { state, encryption } = useApp()
  const [hasEncryptedPrivacyKey, setHasEncryptedPrivacyKey] = useState(true)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/user/encryption")
      if (!res.ok) {
        setHasEncryptedPrivacyKey(false)
        return
      }
      const data = (await res.json()) as { encryptedPrivacyKey?: string | null }
      const blob = data.encryptedPrivacyKey
      setHasEncryptedPrivacyKey(typeof blob === "string" && blob.trim().length > 0)
    } catch {
      setHasEncryptedPrivacyKey(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const readiness = assessTransactionCaptureReadiness({
    encryptionReady: encryption.ready,
    needsPinUnlock: encryption.needsPinUnlock,
    hasEncryptedPrivacyKeyOnServer: hasEncryptedPrivacyKey,
    monthlyIncome: state.monthlyIncome,
  })

  return { readiness, loading, refresh }
}
