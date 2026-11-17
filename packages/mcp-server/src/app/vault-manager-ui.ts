/**
 * MCP Apps Vault Manager view — status-only.
 * Secret add/remove belongs in the Terminal CLI (never App forms).
 */
import { App } from "@modelcontextprotocol/ext-apps";

type SecretMeta = { id: string; name: string; tags: string[]; notes: string | null };
type ManagerPayload = {
  status?: {
    initialized?: boolean;
    unlocked?: boolean;
    setup_state?: string;
    human_summary?: string;
    primary_action?: { do_this?: string; copy_paste_command?: string };
    storage?: string;
    lock_unlock_needed?: boolean;
  };
  secrets?: SecretMeta[];
  apps_fallback?: { copy_paste_command?: string };
};

function root(): HTMLElement {
  const el = document.getElementById("root");
  if (!el) throw new Error("Missing #root");
  return el;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function parseToolJson(result: {
  content?: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(msg: string, kind: "ok" | "err" | "info" = "info"): void {
  const el = document.getElementById("status-line");
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

function renderShell(): void {
  root().innerHTML = `
    <div class="shell">
      <h1 id="page-title">Password Space</h1>
      <section class="panel" id="auth-panel"></section>
      <section class="panel" id="secrets-panel"></section>
      <p class="foot" id="status-line"></p>
    </div>
  `;
}

async function main(): Promise<void> {
  renderShell();
  const app = new App({ name: "Password Space Vault Manager", version: "0.1.0" });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await app.callServerTool({ name, arguments: args });
    const payload = parseToolJson(result);
    if (result.isError || payload.ok === false) {
      throw new Error(String(payload.error ?? payload.howToFix ?? "Tool failed"));
    }
    return payload;
  };

  const paint = (payload: ManagerPayload) => {
    const st = payload.status ?? {};
    const title = $("page-title");
    const auth = $("auth-panel");
    const secrets = $("secrets-panel");
    const cmd =
      payload.apps_fallback?.copy_paste_command ??
      st.primary_action?.copy_paste_command ??
      'node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set';

    title.textContent = "Status";
    auth.innerHTML = `
      <p class="hint">${escapeHtml(
        st.initialized
          ? "Local plain-text store ready. Lock/unlock not needed."
          : "Store not created yet. Use Terminal to set up.",
      )}</p>
      <p class="hint">Add or remove secrets in <strong>Terminal only</strong> — never paste values in chat.</p>
      <pre class="cmd">${escapeHtml(cmd)}</pre>
    `;

    const list = payload.secrets ?? [];
    secrets.innerHTML = `
      <h2>Named secrets</h2>
      <ul class="list">
        ${
          list.length === 0
            ? `<li class="empty">No credentials yet — run Terminal set.</li>`
            : list
                .map(
                  (s) => `
            <li>
              <strong>${escapeHtml(s.name)}</strong>
            </li>`,
                )
                .join("")
        }
      </ul>
    `;
  };

  const refresh = async () => {
    const status = await call("vault_status");
    let secrets: SecretMeta[] = [];
    if (status.initialized === true) {
      try {
        const listed = await call("list_secrets");
        secrets = (listed.secrets as SecretMeta[]) ?? [];
      } catch {
        secrets = [];
      }
    }
    paint({ status: status as ManagerPayload["status"], secrets });
  };

  app.ontoolresult = (result) => {
    const payload = parseToolJson(result) as ManagerPayload & { app?: string };
    if (payload.app === "vault-manager") {
      paint(payload);
      return;
    }
  };

  await app.connect();
  try {
    await refresh();
    setStatus("Status only — use Terminal to add or remove secrets.", "info");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "err");
  }
}

void main();
