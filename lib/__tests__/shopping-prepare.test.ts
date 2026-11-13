// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import { encryptFieldAsymmetric, generateKeyPairFromSeed, publicKeyToHex } from "../crypto"
import { unwrapGroupContentKey } from "../shopping-crypto"
import {
  decryptShoppingJson,
  parseGroupMetadata,
  shoppingAad,
} from "../shopping-payloads"
import { decryptClaimantAlias, prepareApproveMember, prepareCreateGroup } from "../shopping-prepare"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

describe("prepareCreateGroup", () => {
  it("encrypts name and optional description under the new group id", async () => {
    const privacyKey = crypto.getRandomValues(new Uint8Array(32))
    const prepared = await prepareCreateGroup({
      privacyKey,
      name: "Household groceries",
      description: "Weekly staples",
      alias: "You",
    })
    const { secretKey } = generateKeyPairFromSeed(privacyKey)
    const groupKey = unwrapGroupContentKey(prepared.body.wrappedKey as string, secretKey)
    const raw = await decryptShoppingJson(
      prepared.body.encryptedMetadata as string,
      groupKey,
      shoppingAad({
        groupId: prepared.groupId,
        objectId: prepared.groupId,
        keyVersion: 1,
        revision: 1,
        recordType: "group_metadata",
      }),
    )
    expect(parseGroupMetadata(raw)).toEqual({
      schemaVersion: 1,
      name: "Household groceries",
      description: "Weekly staples",
    })
  })
})

describe("prepareApproveMember", () => {
  it("unwraps a name sealed to the owner and wraps the group key to the requester", async () => {
    const ownerSeed = crypto.getRandomValues(new Uint8Array(32))
    const owner = generateKeyPairFromSeed(ownerSeed)
    const claimant = generateKeyPairFromSeed(crypto.getRandomValues(new Uint8Array(32)))
    const preparedGroup = await prepareCreateGroup({
      privacyKey: ownerSeed,
      name: "Household",
      alias: "You",
    })
    const groupKey = unwrapGroupContentKey(preparedGroup.body.wrappedKey as string, owner.secretKey)
    const sealed = encryptFieldAsymmetric("Maya", owner.publicKey)
    expect(decryptClaimantAlias(sealed, ownerSeed)).toBe("Maya")
    const approved = await prepareApproveMember({
      groupId: preparedGroup.groupId,
      groupKey,
      keyVersion: 1,
      claimantPublicKeyHex: publicKeyToHex(claimant.publicKey),
      alias: "Maya",
    })
    expect(unwrapGroupContentKey(approved.wrappedKey, claimant.secretKey)).toEqual(groupKey)
    const raw = await decryptShoppingJson(
      approved.encryptedAlias,
      groupKey,
      shoppingAad({
        groupId: preparedGroup.groupId,
        objectId: approved.localId,
        keyVersion: 1,
        revision: 1,
        recordType: "member_alias",
      }),
    )
    expect(raw.alias).toBe("Maya")
  })
})
