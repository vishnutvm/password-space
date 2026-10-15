import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";

/** AES-256-GCM + scrypt (N=2^15, r=8, p=1) — Node crypto AEAD + KDF, no custom primitives. */
export const CRYPTO_VERSION = 1;
export const SCRYPT_N = 2 ** 15;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_LEN = 32;
export const SALT_LEN = 32;
export const IV_LEN = 12;
export const TAG_LEN = 16;

export type EncryptedBlob = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export async function deriveKey(
  passphrase: string,
  salt: Buffer,
  opts?: { N?: number; r?: number; p?: number },
): Promise<Buffer> {
  const N = opts?.N ?? SCRYPT_N;
  const r = opts?.r ?? SCRYPT_R;
  const p = opts?.p ?? SCRYPT_P;
  return new Promise((resolve, reject) => {
    scryptCb(
      passphrase,
      salt,
      KEY_LEN,
      { N, r, p, maxmem: 64 * 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key as Buffer);
      },
    );
  });
}

export function encrypt(plaintext: Buffer, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, blob.iv);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

export function encryptString(plaintext: string, key: Buffer): EncryptedBlob {
  return encrypt(Buffer.from(plaintext, "utf8"), key);
}

export function decryptString(blob: EncryptedBlob, key: Buffer): string {
  return decrypt(blob, key).toString("utf8");
}

export function randomKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function randomSalt(): Buffer {
  return randomBytes(SALT_LEN);
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pack iv|tag|ciphertext for storage as a single BLOB. */
export function packBlob(blob: EncryptedBlob): Buffer {
  return Buffer.concat([blob.iv, blob.tag, blob.ciphertext]);
}

export function unpackBlob(packed: Buffer): EncryptedBlob {
  if (packed.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted blob: too short");
  }
  return {
    iv: packed.subarray(0, IV_LEN),
    tag: packed.subarray(IV_LEN, IV_LEN + TAG_LEN),
    ciphertext: packed.subarray(IV_LEN + TAG_LEN),
  };
}
