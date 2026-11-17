import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { VaultError, envNameFor, openVault } from "@password-space/vault";

export const RUN_USAGE = `Run a command with secrets in its environment:
  password-space run -s GITHUB_TOKEN -- gh repo list
  password-space run -s OPENAI_API_KEY=openai-prod -s DB_URL -- npm test
  password-space run --all -- ./deploy.sh

  -s, --secret NAME        Pass secret NAME as env var NAME (upper-cased, non [A-Z0-9_] → _)
  -s, --secret VAR=NAME    Pass secret NAME as env var VAR
  --all                    Pass every stored secret
  --redact / --no-redact   Replace secret values in the command's output with [REDACTED]
                           (default: on when output is not a terminal, e.g. an agent)
  The command runs directly (no shell). Values never appear in argv or chat.`;

export type RunSpec = { name: string; envVar?: string };

export type RunOptions = {
  specs: RunSpec[];
  all: boolean;
  redact?: boolean;
  dataDir?: string;
  command: string[];
};

/** Parse everything after `run`. Options stop at `--` (or at the first non-option). */
export function parseRunArgs(argv: string[]): RunOptions {
  const opts: RunOptions = { specs: [], all: false, command: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      i++;
      break;
    }
    if (a === "-s" || a === "--secret") {
      const v = argv[++i];
      if (!v) throw new VaultError(`${a} needs a secret name`, "INVALID");
      const eq = v.indexOf("=");
      opts.specs.push(eq > 0 ? { envVar: v.slice(0, eq), name: v.slice(eq + 1) } : { name: v });
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--redact") {
      opts.redact = true;
    } else if (a === "--no-redact") {
      opts.redact = false;
    } else if (a === "-d" || a === "--data-dir") {
      opts.dataDir = argv[++i];
    } else if (a.startsWith("-")) {
      throw new VaultError(`Unknown run option: ${a}\n\n${RUN_USAGE}`, "INVALID");
    } else {
      break;
    }
  }
  opts.command = argv.slice(i);
  return opts;
}

export { envNameFor };

/** Resolve specs to env vars. Throws before anything runs if a name is unknown. */
export function resolveRunEnv(dataDir: string, opts: Pick<RunOptions, "specs" | "all">): Record<string, string> {
  const store = openVault({ dataDir });
  try {
    if (!store.isInitialized()) {
      throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
    }
    const specs: RunSpec[] = opts.all
      ? [...store.listSecrets().map((m) => ({ name: m.name })), ...opts.specs]
      : opts.specs;
    const env: Record<string, string> = {};
    for (const spec of specs) {
      const secret = store.getSecret(spec.name, "cli-run");
      const envVar = spec.envVar ?? envNameFor(secret.name);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) {
        throw new VaultError(`Invalid environment variable name: ${envVar}`, "INVALID");
      }
      env[envVar] = secret.value;
    }
    return env;
  } finally {
    store.close();
  }
}

/** Shortest value worth redacting from output; shorter ones would mangle normal text. */
const REDACT_MIN_LENGTH = 3;

/**
 * Streams text through, replacing known values. Holds back the last
 * (longest value − 1) characters so a value split across two chunks is
 * still caught; the held tail is flushed on end or after a short idle gap.
 */
export class StreamRedactor {
  private buf = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly values: string[];
  private readonly keep: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    values: string[],
    private readonly write: (s: string) => void,
    private readonly idleMs = 50,
  ) {
    this.values = [...new Set(values.filter((v) => v.length >= REDACT_MIN_LENGTH))].sort(
      (a, b) => b.length - a.length,
    );
    this.keep = Math.max(0, ...this.values.map((v) => v.length - 1));
  }

  push(chunk: Buffer | string): void {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.flush(false);
  }

  end(): void {
    this.buf += this.decoder.end();
    this.flush(true);
  }

  private flush(all: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let text = this.buf;
    for (const v of this.values) text = text.split(v).join("[REDACTED]");
    let cut = all ? text.length : Math.max(0, text.length - this.keep);
    // never split a surrogate pair
    if (cut > 0 && cut < text.length && /[\uD800-\uDBFF]/.test(text[cut - 1]!)) cut--;
    if (cut > 0) this.write(text.slice(0, cut));
    this.buf = text.slice(cut);
    if (this.buf && !all) {
      this.timer = setTimeout(() => this.flush(true), this.idleMs);
      this.timer.unref?.();
    }
  }
}

export async function runWithSecrets(defaultDataDir: string, opts: RunOptions): Promise<number> {
  if (opts.command.length === 0) {
    throw new VaultError(`No command given.\n\n${RUN_USAGE}`, "INVALID");
  }
  if (opts.specs.length === 0 && !opts.all) {
    throw new VaultError(`Name at least one secret with -s NAME (or use --all).\n\n${RUN_USAGE}`, "INVALID");
  }
  const secretEnv = resolveRunEnv(opts.dataDir ?? defaultDataDir, opts);
  const redact = opts.redact ?? !process.stdout.isTTY;
  const [cmd, ...args] = opts.command;

  return await new Promise<number>((resolve) => {
    const child = spawn(cmd!, args, {
      env: { ...process.env, ...secretEnv },
      stdio: redact ? ["inherit", "pipe", "pipe"] : "inherit",
      // .cmd/.bat shims (npm, npx, ...) only start through the shell on Windows.
      shell: process.platform === "win32",
    });

    const values = Object.values(secretEnv);
    const out = redact ? new StreamRedactor(values, (s) => process.stdout.write(s)) : null;
    const err = redact ? new StreamRedactor(values, (s) => process.stderr.write(s)) : null;
    child.stdout?.on("data", (c: Buffer) => out!.push(c));
    child.stderr?.on("data", (c: Buffer) => err!.push(c));

    const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);

    child.on("error", (e: NodeJS.ErrnoException) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      console.error(
        e.code === "ENOENT" ? `password-space run: command not found: ${cmd}` : `password-space run: ${e.message}`,
      );
      resolve(127);
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      out?.end();
      err?.end();
      if (signal) {
        const n = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }[signal as string] ?? 1;
        resolve(128 + n);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}
