#!/usr/bin/env node
/**
 * Build the self-contained CLI that ships to npm as `password-space`.
 *
 * The published package has no runtime dependencies: the vault code is bundled
 * in, the same way plugins/password-space/dist/cli.js is built for the plugin.
 * Runs as part of `pnpm build` and again from `prepack`, so `npm pack` and
 * `npm publish` always ship a fresh bundle.
 */
import * as esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "packages/cli");
const outfile = join(pkgDir, "dist/password-space.js");

await esbuild.build({
  entryPoints: [join(pkgDir, "src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  logLevel: "warning",
  // src/index.ts starts with #!/usr/bin/env node; esbuild keeps it.
});

// npm only packs a LICENSE that sits in the package folder.
copyFileSync(join(root, "LICENSE"), join(pkgDir, "LICENSE"));

console.log(`bundled → ${outfile}`);
