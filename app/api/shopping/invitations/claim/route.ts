import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, shoppingJson } from "@/lib/shopping-http"
import { isRequestVerificationCode } from "@/lib/shopping-invites"
import { publicKeyFingerprint } from "@/lib/shopping-crypto"
import { looksLikeAsymmetricCiphertext } from "@/lib/crypto"
import { claimInvite } from "@/lib/shopping-server"
import { prisma } from "@/lib/db"

export async function POST(req: Request) {
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const token = parsed.body.token
    const encryptedClaimantAlias = parsed.body.encryptedClaimantAlias
    const verificationCode = parsed.body.verificationCode
    if (typeof token !== "string") {
      return shoppingJson({ error: "Missing invite" }, 400)
    }
    if (typeof encryptedClaimantAlias !== "string" || !looksLikeAsymmetricCiphertext(encryptedClaimantAlias)) {
      return shoppingJson({ error: "Name must be encrypted" }, 400)
    }
    if (!isRequestVerificationCode(verificationCode)) {
      return shoppingJson({ error: "Enter the short verification code" }, 400)
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { publicKey: true },
    })
    if (!user?.publicKey) {
      return shoppingJson({ error: "Finish Secure Your Data before joining" }, 400)
    }
    const fingerprint = await publicKeyFingerprint(user.publicKey)
    const result = await claimInvite({
      userId,
      token,
      publicKey: user.publicKey,
      keyFingerprint: fingerprint,
      encryptedClaimantAlias,
      verificationCode,
    })
    return shoppingJson(result)
  })
}
