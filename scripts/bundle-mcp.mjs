#!/usr/bin/env node
/**
 * Bundle the MCP server (+ vault + deps) into plugins/password-space/dist/index.js
 * so marketplace installs can run with Node only (no pnpm required for MCP).
 */
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "plugins/password-space/dist/index.js");

mkdirSync(dirname(outfile), { recursive: true });

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
