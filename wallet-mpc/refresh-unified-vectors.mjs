import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const commit = "8c85b1585dac23f964e2dd32045624de7f02aa58";
const expectedBlob = "7f6c9685bf913cba28a334ff5b2bd1b447d44d56";
const bytes = execFileSync("gh", [
  "api",
  `repos/bitcoinknots/bitcoin/contents/src/test/data/unified_sighash.json?ref=${commit}`,
  "-H",
  "Accept: application/vnd.github.raw+json",
], { maxBuffer: 1024 * 1024 });
const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
assert.equal(blob, expectedBlob, "upstream fixture differs from the inspected pinned Git blob");
const vectors = JSON.parse(bytes.toString("utf8"));
assert.equal(vectors.length, 167);
assert.deepEqual(vectors[0], ["scriptCode", "rawTx", "inIdx", "hashType", "scriptType", "spentOutputs", "sighash"]);
for (const vector of vectors.slice(1)) {
  assert.equal(vector.length, 7);
  assert.match(vector[6], /^[0-9a-f]{64}$/);
}
writeFileSync(new URL("./src/unified-vectors.json", import.meta.url), bytes);
console.log(`Imported 166 pinned public vectors; Git blob ${blob}`);
