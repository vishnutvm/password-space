export type SecretMetadata = {
  id: string;
  name: string;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SecretRecord = SecretMetadata & {
  value: string;
};

export type VaultMeta = {
  cryptoVersion: number;
  createdAt: string;
  kdf: {
    algorithm: "scrypt";
    N: number;
    r: number;
    p: number;
    salt: string; // base64
  };
};

export type AuditEvent = {
  id: string;
  at: string;
  action: string;
  secretId: string | null;
  secretName: string | null;
  actor: string;
  detail: string | null;
};

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_INITIALIZED"
      | "ALREADY_INITIALIZED"
      | "LOCKED"
      | "WRONG_PASSPHRASE"
      | "NOT_FOUND"
      | "DUPLICATE_NAME"
      | "INVALID",
  ) {
    super(message);
    this.name = "VaultError";
  }
}
