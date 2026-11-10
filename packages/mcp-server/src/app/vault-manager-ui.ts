/**
 * MCP Apps Vault Manager view — runs inside the host iframe.
 * Passphrase is collected in this form and sent via callServerTool args (never elicitation).
 */
import { App } from "@modelcontextprotocol/ext-apps";

type SecretMeta = { id: string; name: string; tags: string[]; notes: string | null };
type ManagerPayload = {
  status?: {
    initialized?: boolean;
    unlocked?: boolean;
    session?: boolean;
    setup_state?: string;
    human_summary?: string;
    primary_action?: { do_this?: string };
  };
  secrets?: SecretMeta[];
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
      <header class="hero">
        <p class="brand">Password Space</p>
        <h1>Vault Manager</h1>
        <p class="lede" id="lede">Loading vault status…</p>
      </header>
      <section class="panel" id="auth-panel"></section>
      <section class="panel" id="secrets-panel" hidden></section>
      <section class="panel" id="passphrase-panel" hidden></section>
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
    $("lede").textContent = st.unlocked
      ? "Unlocked — manage credentials on this device. Values stay out of chat."
      : st.initialized
        ? "Vault exists. Unlock to manage credentials."
        : "Create your encrypted vault to get started.";

    const auth = $("auth-panel");
    const secrets = $("secrets-panel");
    const passPanel = $("passphrase-panel");

    if (!st.initialized) {
      auth.innerHTML = `
        <h2>Create vault</h2>
        <p class="hint">Choose a passphrase (8+ characters). Entered here only — never in chat.</p>
        <label>Passphrase<input type="password" id="init-pass" autocomplete="new-password" minlength="8" /></label>
        <label>Confirm<input type="password" id="init-pass2" autocomplete="new-password" minlength="8" /></label>
        <button type="button" class="primary" id="btn-init">Create vault</button>
      `;
      secrets.hidden = true;
      passPanel.hidden = true;
      $("btn-init").onclick = async () => {
        const p1 = (document.getElementById("init-pass") as HTMLInputElement).value;
        const p2 = (document.getElementById("init-pass2") as HTMLInputElement).value;
        if (p1.length < 8) return setStatus("Passphrase must be at least 8 characters.", "err");
        if (p1 !== p2) return setStatus("Passphrases do not match.", "err");
        try {
          await call("vault_init", { passphrase: p1 });
          await call("vault_unlock", { passphrase: p1 });
          setStatus("Vault created and unlocked.", "ok");
          await refresh();
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), "err");
        }
      };
      return;
    }

    if (!st.unlocked) {
      auth.innerHTML = `
        <h2>Unlock</h2>
        <p class="hint">Same passphrase as setup. Not sent via elicitation.</p>
        <label>Passphrase<input type="password" id="unlock-pass" autocomplete="current-password" minlength="8" /></label>
        <div class="row">
          <button type="button" class="primary" id="btn-unlock">Unlock</button>
        </div>
      `;
      secrets.hidden = true;
      passPanel.hidden = true;
      $("btn-unlock").onclick = async () => {
        const p = (document.getElementById("unlock-pass") as HTMLInputElement).value;
        try {
          await call("vault_unlock", { passphrase: p });
          setStatus("Unlocked.", "ok");
          await refresh();
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), "err");
        }
      };
      return;
    }

    auth.innerHTML = `
      <div class="row between">
        <h2>Session</h2>
        <button type="button" class="ghost" id="btn-lock">Lock vault</button>
      </div>
      <p class="hint">Lock when idle. Unlocked session is local-only trust.</p>
    `;
    $("btn-lock").onclick = async () => {
      try {
        await call("vault_lock");
        setStatus("Locked.", "ok");
        await refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), "err");
      }
    };

    secrets.hidden = false;
    const list = payload.secrets ?? [];
    secrets.innerHTML = `
      <h2>Credentials</h2>
      <ul class="list" id="secret-list">
        ${
          list.length === 0
            ? `<li class="empty">No credentials yet.</li>`
            : list
                .map(
                  (s) => `
            <li>
              <div>
                <strong>${escapeHtml(s.name)}</strong>
                ${s.tags?.length ? `<span class="tags">${s.tags.map(escapeHtml).join(", ")}</span>` : ""}
              </div>
              <button type="button" class="danger" data-del="${escapeHtml(s.name)}">Remove</button>
            </li>`,
                )
                .join("")
        }
      </ul>
      <h3>Add or update</h3>
      <label>Name<input type="text" id="sec-name" autocomplete="off" /></label>
      <label>Value<input type="password" id="sec-value" autocomplete="new-password" /></label>
      <label>Tags <span class="muted">(comma-separated)</span><input type="text" id="sec-tags" autocomplete="off" /></label>
      <button type="button" class="primary" id="btn-save">Save credential</button>
    `;

    secrets.querySelectorAll("[data-del]").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = async () => {
        const name = (btn as HTMLButtonElement).dataset.del!;
        if (!confirm(`Remove ${name}?`)) return;
        try {
          await call("vault_delete_secret", { name });
          setStatus(`Removed ${name}.`, "ok");
          await refresh();
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), "err");
        }
      };
    });

    $("btn-save").onclick = async () => {
      const name = (document.getElementById("sec-name") as HTMLInputElement).value.trim();
      const value = (document.getElementById("sec-value") as HTMLInputElement).value;
      const tagsRaw = (document.getElementById("sec-tags") as HTMLInputElement).value;
      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (!name || !value) return setStatus("Name and value are required.", "err");
      try {
        await call("vault_set_secret", { name, value, tags });
        (document.getElementById("sec-value") as HTMLInputElement).value = "";
        setStatus(`Saved ${name}.`, "ok");
        await refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), "err");
      }
    };

    passPanel.hidden = false;
    passPanel.innerHTML = `
      <h2>Change passphrase</h2>
      <p class="hint">Re-wraps the vault key. Entered only in this form.</p>
      <label>Current<input type="password" id="cur-pass" autocomplete="current-password" /></label>
      <label>New<input type="password" id="new-pass" autocomplete="new-password" minlength="8" /></label>
      <label>Confirm new<input type="password" id="new-pass2" autocomplete="new-password" minlength="8" /></label>
      <button type="button" class="primary" id="btn-changepw">Update passphrase</button>
    `;
    $("btn-changepw").onclick = async () => {
      const cur = (document.getElementById("cur-pass") as HTMLInputElement).value;
      const n1 = (document.getElementById("new-pass") as HTMLInputElement).value;
      const n2 = (document.getElementById("new-pass2") as HTMLInputElement).value;
      if (n1.length < 8) return setStatus("New passphrase must be at least 8 characters.", "err");
      if (n1 !== n2) return setStatus("New passphrases do not match.", "err");
      try {
        await call("vault_change_passphrase", {
          current_passphrase: cur,
          new_passphrase: n1,
        });
        setStatus("Passphrase updated.", "ok");
        await refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), "err");
      }
    };
  };

  const refresh = async () => {
    // Prefer status/list tools so we do not re-invoke vault_manager (avoids nested Apps).
    const status = await call("vault_status");
    let secrets: SecretMeta[] = [];
    if (status.unlocked === true) {
      const listed = await call("list_secrets");
      secrets = (listed.secrets as SecretMeta[]) ?? [];
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
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "err");
  }
}

void main();
