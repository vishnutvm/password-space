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

/** Where secret values live. Names, tags and notes are always in secrets.json. */
export type StorageBackend = "keychain" | "file";

export type VaultMeta = {
  storeVersion: number;
  createdAt: string;
  storage: StorageBackend;
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
      | "NOT_FOUND"
      | "DUPLICATE_NAME"
      | "INVALID"
      | "KEYCHAIN",
  ) {
    super(message);
    this.name = "VaultError";
  }
}
