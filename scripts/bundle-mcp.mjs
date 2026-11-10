#!/usr/bin/env node
/**
 * Bundle the MCP server (+ vault + deps) into plugins/password-space/dist/index.js
 * and the Vault Manager MCP App HTML into plugins/password-space/dist/vault-manager.html
 * so marketplace installs can run with Node only (no pnpm required for MCP).
 */
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "plugins/password-space/dist");
const outfile = join(outDir, "index.js");
const appHtmlOut = join(outDir, "vault-manager.html");
const require = createRequire(import.meta.url);

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "packages/mcp-server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  // Source already has a shebang; do not double it (breaks ESM parse).
  packages: "bundle",
  sourcemap: true,
  logLevel: "info",
});

console.log(`bundled → ${outfile}`);

// --- Vault Manager App (single-file HTML for MCP Apps progressive enhancement) ---
const uiEntry = join(root, "packages/mcp-server/src/app/vault-manager-ui.ts");
const htmlTemplatePath = join(root, "packages/mcp-server/src/app/vault-manager.html");

const uiBundle = await esbuild.build({
  entryPoints: [uiEntry],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  write: false,
  minify: true,
  logLevel: "info",
});

const uiJs = uiBundle.outputFiles?.[0]?.text;
if (!uiJs) {
  throw new Error("Failed to bundle vault-manager UI");
}

let html = readFileSync(htmlTemplatePath, "utf8");
html = html.replace(
  `<script type="module" src="./vault-manager-ui.js"></script>`,
  `<script type="module">\n${uiJs}\n</script>`,
);
writeFileSync(appHtmlOut, html);
console.log(`bundled → ${appHtmlOut}`);

// Ensure ext-apps is installed (peer of MCP Apps helpers used at runtime via bundled server).
const extAppsPkg = join(root, "packages/mcp-server/node_modules/@modelcontextprotocol/ext-apps/package.json");
if (!existsSync(extAppsPkg)) {
  console.warn(
    "warn: @modelcontextprotocol/ext-apps not found under packages/mcp-server — run pnpm install",
  );
} else {
  const ver = JSON.parse(readFileSync(extAppsPkg, "utf8")).version;
  console.log(`ext-apps ${ver} available for server helpers`);
}

// Touch require so unused import linters stay quiet if tree-shaken differently
void require;
