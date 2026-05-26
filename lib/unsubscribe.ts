import {
  COMMUNICATION_PREFERENCE_KEYS,
  communicationPreferenceForKey,
  type CommunicationPreferenceKey,
  parseUnsubscribePreference,
} from "@/lib/communication-preferences"
import { prisma } from "@/lib/db"

export type ParsedUnsubscribeRequest = {
  token: string
  preference: CommunicationPreferenceKey | "all"
  label: string
}

export function parseUnsubscribeRequest(
  token: string | null | undefined,
  rawPreference: string | null | undefined,
): ParsedUnsubscribeRequest | null {
  const trimmedToken = token?.trim()
  const preference = parseUnsubscribePreference(rawPreference)
  if (!trimmedToken || !preference) return null

  const label =
    preference === "all"
      ? "all optional BitBudget email categories"
      : communicationPreferenceForKey(preference).label.toLowerCase()

  return { token: trimmedToken, preference, label }
}

export function unsubscribeConfirmHtml(
  origin: string,
  token: string,
  rawPreference: string,
  label: string,
): string {
  const action = new URL("/api/user/unsubscribe", origin).toString()
  const escapedLabel = escapeHtml(label)
  const escapedToken = escapeHtml(token)
  const escapedPreference = escapeHtml(rawPreference)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribe — BitBudget</title>
</head>
<body style="margin:0;background:#0D0D0D;color:#e5e5e5;font-family:system-ui,sans-serif;">
  <main style="max-width:420px;margin:48px auto;padding:0 20px;">
    <h1 style="font-size:22px;margin:0 0 12px;">Confirm unsubscribe</h1>
    <p style="color:#a3a3a3;line-height:1.5;margin:0 0 24px;">
      You asked to stop <strong style="color:#e5e5e5;">${escapedLabel}</strong> emails from BitBudget.
      Link scanners cannot change your preferences until you confirm below.
    </p>
    <form method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="token" value="${escapedToken}" />
      <input type="hidden" name="category" value="${escapedPreference}" />
      <button type="submit" style="width:100%;background:#F7931A;color:#0D0D0D;border:none;border-radius:12px;padding:14px 16px;font-size:15px;font-weight:600;cursor:pointer;">
        Unsubscribe
      </button>
    </form>
    <p style="margin:24px 0 0;font-size:13px;color:#737373;">
      Changed your mind? Close this page — nothing has been updated yet.
    </p>
  </main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function applyEmailUnsubscribe(
  token: string,
  preference: CommunicationPreferenceKey | "all",
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { emailUnsubscribeToken: token },
    select: { id: true },
  })
  if (!user) return false

  const preferences =
    preference === "all"
      ? Object.fromEntries(
          COMMUNICATION_PREFERENCE_KEYS.map((key) => [
            communicationPreferenceForKey(key).field,
            false,
          ]),
        )
      : { [communicationPreferenceForKey(preference).field]: false }

  await prisma.user.update({
    where: { id: user.id },
    data: preferences,
  })
  return true
}
