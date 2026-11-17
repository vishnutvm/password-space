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

/** Plain-text store metadata (no KDF / encryption). */
export type VaultMeta = {
  storeVersion: number;
  createdAt: string;
  storage: "plain-json";
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
      | "INVALID"
      | "LEGACY_ENCRYPTED"
      | "DEPRECATED",
  ) {
    super(message);
    this.name = "VaultError";
  }
}
