/**
 * Helpers for producing a single-file Vault Manager MCP App HTML.
 *
 * Critical: never pass UI JS as a String.replace *string* replacement. Minified
 * bundles contain `$&` (regex escape helpers); String.replace treats `$&` as
 * "insert the matched substring", which re-injects `</script>` mid-bundle and
 * makes hosts dump the rest of the App as raw text (zod / ZodError noise).
 */

export const SCRIPT_SRC_TAG =
  `<script type="module" src="./vault-manager-ui.js"></script>`;

/** Make inline JS safe inside an HTML <script> element. */
export function sanitizeInlineScript(js) {
  // HTML parsers end <script> at the first literal </script>, even inside JS strings.
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

/**
 * Inline the UI module into the HTML template without `$&` / `$n` replacement pitfalls.
 */
export function inlineVaultManagerHtml(template, uiJs) {
  if (!template.includes(SCRIPT_SRC_TAG)) {
    throw new Error(
      `vault-manager.html template missing expected tag: ${SCRIPT_SRC_TAG}`,
    );
  }
  const safeJs = sanitizeInlineScript(uiJs);
  // Function replacer — do NOT use a string replacement (avoids $& expansion).
  const html = template.replace(SCRIPT_SRC_TAG, () => {
    return `<script type="module">\n${safeJs}\n</script>`;
  });
  assertVaultManagerHtml(html);
  return html;
}

/** Fail if the App HTML would dump JS as document text. */
export function assertVaultManagerHtml(html) {
  if (!html.trimStart().startsWith("<!DOCTYPE html>")) {
    throw new Error("vault-manager.html must start with <!DOCTYPE html>");
  }
  const opens = html.match(/<script\b/gi) ?? [];
  const closes = html.match(/<\/script>/gi) ?? [];
  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(
      `vault-manager.html must contain exactly one <script>…</script> pair (found opens=${opens.length}, closes=${closes.length}). Likely $& corruption during inline.`,
    );
  }
  if (html.includes(SCRIPT_SRC_TAG)) {
    throw new Error(
      "vault-manager.html still references external vault-manager-ui.js",
    );
  }
  const openIdx = html.search(/<script\b/i);
  const closeIdx = html.search(/<\/script>/i);
  const body = html.slice(html.indexOf(">", openIdx) + 1, closeIdx);
  if (/<\/script/i.test(body)) {
    throw new Error(
      "vault-manager.html script body contains a raw </script sequence",
    );
  }
}
