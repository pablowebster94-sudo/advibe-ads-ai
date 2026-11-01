import test from "node:test";
import assert from "node:assert/strict";
process.env.ENCRYPTION_KEY = "test-key-test-key-test-key";
const { encrypt, decrypt, mask, appSecretProof } = await import("../src/lib/crypto.ts");

test("cifrado ida y vuelta", () => {
  const t = "EAAB-token-secreto-123";
  const e = encrypt(t);
  assert.notEqual(e, t);
  assert.ok(!e.includes("secreto"));
  assert.equal(decrypt(e), t);
});
test("cada cifrado usa IV distinto", () => assert.notEqual(encrypt("a"), encrypt("a")));
test("manipulación detectada", () => {
  const e = encrypt("hola").split(".");
  e[3] = Buffer.from("xxxx").toString("base64url");
  assert.throws(() => decrypt(e.join(".")));
});
test("mask no revela", () => assert.equal(mask("abcdefghijkl"), "••••ijkl"));
test("appsecret_proof es hex de 64", () => assert.match(appSecretProof("t", "s"), /^[0-9a-f]{64}$/));
