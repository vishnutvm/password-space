import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  SCRIPT_SRC_TAG,
  assertVaultManagerHtml,
  inlineVaultManagerHtml,
  sanitizeInlineScript,
} from "./vault-manager-html.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(
  root,
  "packages/mcp-server/src/app/vault-manager.html",
);

describe("vault-manager HTML inline", () => {
  it("does not expand $& from minified JS into a premature </script>", () => {
    // Reproduces the production bug: zod/minifier regex escape uses "$&".
    const uiJs = `function esc(t){return t.replace(/[.*+?^$\${}()|[\\]\\\\]/g,"\\\\$&")}esc("</script>");`;
    const template = `<!DOCTYPE html><html><body>${SCRIPT_SRC_TAG}</body></html>`;
    const html = inlineVaultManagerHtml(template, uiJs);
    assert.equal((html.match(/<script\b/gi) ?? []).length, 1);
    assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
    assert.ok(html.includes("\\\\$&") || html.includes("\\$&"));
    assert.ok(!html.includes(SCRIPT_SRC_TAG));
    assert.ok(html.includes('<\\/script>'));
  });

  it("sanitizes literal </script> sequences in UI JS", () => {
    assert.equal(
      sanitizeInlineScript(`const x = "</script>";`),
      `const x = "<\\/script>";`,
    );
  });

  it("inlines the real template without corrupting script boundaries", () => {
    const template = readFileSync(templatePath, "utf8");
    const uiJs = `console.log("Vault Manager"); const re = /x/.source; const y = "$&";`;
    const html = inlineVaultManagerHtml(template, uiJs);
    assertVaultManagerHtml(html);
    assert.ok(html.includes('console.log("Vault Manager")'));
    // $& must remain as characters, not expand to the matched script src tag.
    assert.ok(html.includes("$&"));
    assert.ok(!html.includes('src="./vault-manager-ui.js"'));
  });

  it("rejects HTML that would dump JS into the document", () => {
    assert.throws(
      () =>
        assertVaultManagerHtml(
          `<!DOCTYPE html><html><body><script>a${SCRIPT_SRC_TAG}b</script></body></html>`,
        ),
      /exactly one/,
    );
  });
});
