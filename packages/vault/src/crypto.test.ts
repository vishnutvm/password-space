import { describe, expect, it } from "vitest";
import {
  decrypt,
  decryptString,
  deriveKey,
  encrypt,
  encryptString,
  packBlob,
  randomKey,
  randomSalt,
  unpackBlob,
} from "./crypto.js";

describe("crypto", () => {
  it("round-trips AES-GCM", () => {
    const key = randomKey();
    const plain = Buffer.from("hello vault", "utf8");
    const blob = encrypt(plain, key);
    expect(decrypt(blob, key).toString("utf8")).toBe("hello vault");
  });

  it("round-trips strings via pack/unpack", () => {
    const key = randomKey();
    const packed = packBlob(encryptString("s3cret!", key));
    expect(decryptString(unpackBlob(packed), key)).toBe("s3cret!");
  });

  it("fails decrypt with wrong key", () => {
    const blob = encryptString("x", randomKey());
    expect(() => decryptString(blob, randomKey())).toThrow();
  });

  it("derives stable key from passphrase + salt", async () => {
    const salt = randomSalt();
    const a = await deriveKey("correct horse battery staple", salt);
    const b = await deriveKey("correct horse battery staple", salt);
    expect(a.equals(b)).toBe(true);
    const c = await deriveKey("wrong passphrase!!", salt);
    expect(a.equals(c)).toBe(false);
  });

  it("rejects truncated packed blobs", () => {
    expect(() => unpackBlob(Buffer.alloc(8))).toThrow(/too short/i);
  });
});
