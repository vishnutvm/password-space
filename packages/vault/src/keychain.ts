import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { VaultError } from "./types.js";

/**
 * OS keychain access without native Node addons.
 *
 * Each backend shells out to a tool the OS already ships (or that the
 * desktop installs with its keyring):
 *   - macOS:   /usr/bin/security               (login Keychain)
 *   - Windows: powershell.exe + advapi32 Cred*  (Credential Manager)
 *   - Linux:   secret-tool (libsecret)          (Secret Service: GNOME Keyring, KWallet, ...)
 *
 * Secret values are always passed on stdin, never on the command line,
 * so they do not show up in `ps` output or shell history.
 */

export const KEYCHAIN_SERVICE = "password-space";

export type KeychainKind =
  | "macos-keychain"
  | "windows-credential-manager"
  | "linux-secret-service"
  | "memory";

export interface Keychain {
  readonly kind: KeychainKind;
  /** Human-readable name for status output. */
  readonly description: string;
  /** Returns null when the item does not exist. */
  get(account: string): string | null;
  set(account: string, value: string, label: string): void;
  /** Deleting a missing item is not an error. */
  delete(account: string): void;
}

export type RunResult = { status: number | null; stdout: string; stderr: string; error?: Error };
export type Runner = (cmd: string, args: string[], input?: string) => RunResult;

export const defaultRunner: Runner = (cmd, args, input) => {
  const r = spawnSync(cmd, args, {
    input: input ?? "",
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error,
  };
};

function fail(op: string, kind: string, r: RunResult): never {
  const detail = (r.error?.message ?? r.stderr ?? "").trim().split("\n")[0] || `exit ${r.status}`;
  throw new VaultError(`${kind}: ${op} failed (${detail})`, "KEYCHAIN");
}

/** Labels are informational only; keep them to characters every backend accepts unquoted. */
function safeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_.:@+-]/g, "_").slice(0, 120) || "secret";
}

function assertSafeAccount(account: string): void {
  if (!/^[A-Za-z0-9_.:/@+-]{1,200}$/.test(account)) {
    throw new VaultError(`Invalid keychain account name: ${account}`, "INVALID");
  }
}

// ---------------------------------------------------------------- macOS

/**
 * macOS `security` prints a password containing non-printable bytes as hex,
 * which is ambiguous. Values that are not plain printable ASCII are stored as
 * `b64:<base64>` so reads are always exact.
 */
const MAC_B64_PREFIX = "b64:";

export function encodeMacValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value) && !value.startsWith(MAC_B64_PREFIX)) return value;
  return MAC_B64_PREFIX + Buffer.from(value, "utf8").toString("base64");
}

export function decodeMacValue(stored: string): string {
  if (stored.startsWith(MAC_B64_PREFIX)) {
    return Buffer.from(stored.slice(MAC_B64_PREFIX.length), "base64").toString("utf8");
  }
  return stored;
}

export class MacKeychain implements Keychain {
  readonly kind = "macos-keychain" as const;
  readonly description: string;

  constructor(
    private readonly run: Runner = defaultRunner,
    /** Optional keychain file (tests / CI). Default: the user's login keychain. */
    private readonly keychainPath: string | undefined = process.env.PASSWORD_SPACE_MACOS_KEYCHAIN?.trim() ||
      undefined,
    private readonly bin = "/usr/bin/security",
  ) {
    this.description = keychainPath ? `macOS Keychain (${keychainPath})` : "macOS Keychain";
  }

  private kc(): string[] {
    return this.keychainPath ? [this.keychainPath] : [];
  }

  get(account: string): string | null {
    assertSafeAccount(account);
    const r = this.run(this.bin, [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      "-w",
      ...this.kc(),
    ]);
    if (r.status === 44) return null; // errSecItemNotFound
    if (r.status !== 0) fail("read", this.description, r);
    return decodeMacValue(r.stdout.replace(/\n$/, ""));
  }

  set(account: string, value: string, label: string): void {
    assertSafeAccount(account);
    // `security -i` reads commands from stdin; the value goes in as hex (-X)
    // so it never needs quoting and never appears in argv.
    const hex = Buffer.from(encodeMacValue(value), "utf8").toString("hex");
    const kc = this.keychainPath ? ` ${this.keychainPath}` : "";
    if (/\s/.test(kc.trim())) {
      throw new VaultError("PASSWORD_SPACE_MACOS_KEYCHAIN must not contain spaces", "INVALID");
    }
    const line = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -l ${safeLabel(label)} -X ${hex}${kc}\n`;
    const r = this.run(this.bin, ["-i"], line);
    // `security -i` can exit 0 after a failed command; it reports on stderr.
    if (r.status !== 0 || r.stderr.trim()) fail("write", this.description, r);
  }

  delete(account: string): void {
    assertSafeAccount(account);
    const r = this.run(this.bin, [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      ...this.kc(),
    ]);
    if (r.status === 0 || r.status === 44) return;
    fail("delete", this.description, r);
  }
}

// ---------------------------------------------------------------- Linux

export class LinuxSecretService implements Keychain {
  readonly kind = "linux-secret-service" as const;
  readonly description = "Secret Service (libsecret)";

  constructor(
    private readonly run: Runner = defaultRunner,
    private readonly bin = "secret-tool",
  ) {}

  get(account: string): string | null {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["lookup", "service", KEYCHAIN_SERVICE, "account", account]);
    if (r.status === 0) return r.stdout;
    // secret-tool exits 1 with no output when the item is missing.
    if (r.status === 1 && !r.stderr.trim() && !r.error) return null;
    fail("read", this.description, r);
  }

  set(account: string, value: string, label: string): void {
    assertSafeAccount(account);
    const r = this.run(
      this.bin,
      ["store", `--label=${safeLabel(label)}`, "service", KEYCHAIN_SERVICE, "account", account],
      value,
    );
    if (r.status !== 0) fail("write", this.description, r);
  }

  delete(account: string): void {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["clear", "service", KEYCHAIN_SERVICE, "account", account]);
    // `clear` exits 1 when nothing matched; that is fine.
    if (r.status === 0 || (r.status === 1 && !r.stderr.trim() && !r.error)) return;
    fail("delete", this.description, r);
  }
}

// ---------------------------------------------------------------- Windows

/** Windows caps a generic credential blob at 5 * 512 bytes. */
export const WINDOWS_MAX_BLOB_BYTES = 2560;

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$src = @"
using System;
using System.Runtime.InteropServices;
public static class PsCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr p);
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int e = Marshal.GetLastWin32Error();
      if (e == 1168) return null;
      throw new System.ComponentModel.Win32Exception(e);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] b = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
      return Convert.ToBase64String(b);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string b64) {
    byte[] b = Convert.FromBase64String(b64);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = b.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(Math.Max(b.Length, 1));
    try {
      if (b.Length > 0) Marshal.Copy(b, 0, c.CredentialBlob, b.Length);
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static void Delete(string target) {
    if (!CredDeleteW(target, 1, 0)) {
      int e = Marshal.GetLastWin32Error();
      if (e != 1168) throw new System.ComponentModel.Win32Exception(e);
    }
  }
}
"@
Add-Type -TypeDefinition $src
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$res = @{ ok = $true; value = $null; error = $null }
try {
  switch ($req.op) {
    'get' { $res.value = [PsCred]::Read($req.target) }
    'set' { [PsCred]::Write($req.target, $req.user, $req.value) }
    'delete' { [PsCred]::Delete($req.target) }
  }
} catch { $res.ok = $false; $res.error = $_.Exception.Message }
[Console]::Out.Write((ConvertTo-Json -InputObject $res -Compress))
`;

export class WindowsCredentialManager implements Keychain {
  readonly kind = "windows-credential-manager" as const;
  readonly description = "Windows Credential Manager";
  private readonly encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");

  constructor(
    private readonly run: Runner = defaultRunner,
    private readonly bin = "powershell.exe",
  ) {}

  private call(op: "get" | "set" | "delete", account: string, extra: Record<string, string> = {}) {
    const input = JSON.stringify({ op, target: `${KEYCHAIN_SERVICE}:${account}`, ...extra });
    const r = this.run(
      this.bin,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", this.encoded],
      input,
    );
    if (r.status !== 0) fail(op, this.description, r);
    let parsed: { ok: boolean; value: string | null; error: string | null };
    try {
      parsed = JSON.parse(r.stdout.trim());
    } catch {
      fail(op, this.description, { ...r, stderr: "unexpected output" });
    }
    if (!parsed.ok) fail(op, this.description, { ...r, stderr: parsed.error ?? "unknown error" });
    return parsed;
  }

  get(account: string): string | null {
    assertSafeAccount(account);
    const r = this.call("get", account);
    return r.value == null ? null : Buffer.from(r.value, "base64").toString("utf8");
  }

  set(account: string, value: string, label: string): void {
    assertSafeAccount(account);
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > WINDOWS_MAX_BLOB_BYTES) {
      throw new VaultError(
        `Secret is ${bytes.length} bytes; Windows Credential Manager allows at most ${WINDOWS_MAX_BLOB_BYTES}.`,
        "INVALID",
      );
    }
    this.call("set", account, { user: safeLabel(label), value: bytes.toString("base64") });
  }

  delete(account: string): void {
    assertSafeAccount(account);
    this.call("delete", account);
  }
}

// ---------------------------------------------------------------- memory (tests)

export class MemoryKeychain implements Keychain {
  readonly kind = "memory" as const;
  readonly description = "in-memory keychain (tests)";
  readonly items = new Map<string, string>();
  get(account: string): string | null {
    return this.items.has(account) ? this.items.get(account)! : null;
  }
  set(account: string, value: string): void {
    this.items.set(account, value);
  }
  delete(account: string): void {
    this.items.delete(account);
  }
}

// ---------------------------------------------------------------- selection

let override: Keychain | null | undefined;

/** Tests: force a keychain (or `null` for "no keychain on this machine"). `undefined` resets. */
export function setKeychainForTesting(kc: Keychain | null | undefined): void {
  override = kc;
}

function onPath(bin: string): boolean {
  const r = defaultRunner(process.platform === "win32" ? "where" : "which", [bin]);
  return r.status === 0;
}

/**
 * The platform keychain, or null when this machine has none we can use.
 * Does not touch the keychain; call {@link probeKeychain} to test it works.
 */
export function platformKeychain(platform: NodeJS.Platform = process.platform): Keychain | null {
  if (override !== undefined) return override;
  if (process.env.PASSWORD_SPACE_KEYCHAIN === "none") return null;
  if (platform === "darwin") {
    return existsSync("/usr/bin/security") ? new MacKeychain() : null;
  }
  if (platform === "win32") return new WindowsCredentialManager();
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return onPath("secret-tool") ? new LinuxSecretService() : null;
  }
  return null;
}

/**
 * Round-trip a throwaway item to check the keychain is reachable and unlocked
 * (a headless Linux box often has secret-tool but no Secret Service running).
 */
export function probeKeychain(kc: Keychain): { ok: true } | { ok: false; reason: string } {
  const account = `probe-${process.pid}-${Date.now()}`;
  const value = `probe-${Math.random().toString(36).slice(2)}`;
  try {
    kc.set(account, value, "password-space-probe");
    const back = kc.get(account);
    kc.delete(account);
    if (back !== value) return { ok: false, reason: `${kc.description}: read-back mismatch` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
