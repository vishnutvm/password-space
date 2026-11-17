#!/usr/bin/env node
/**
 * One version for the whole project.
 *
 * The root package.json "version" is the source of truth. Every other place
 * that carries a version (workspace packages, plugin manifests, marketplace
 * entries, the MCP server and Vault Manager app identities) must match it.
 * Claude Code and Cursor only offer a plugin update when the manifest version
 * changes, so a release that forgets one of these never reaches users.
 *
 *   node scripts/version.mjs check            exit 1 if anything is out of sync
 *   node scripts/version.mjs set 0.3.0        write 0.3.0 everywhere
 *   node scripts/version.mjs check --tag v0.3.0   also require the tag to match
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** JSON files and the dotted paths inside them that hold the version. */
const JSON_TARGETS = [
  ["package.json", ["version"]],
  ["packages/vault/package.json", ["version"]],
  ["packages/cli/package.json", ["version"]],
  ["packages/mcp-server/package.json", ["version"]],
  ["plugins/password-space/.claude-plugin/plugin.json", ["version"]],
  ["plugins/password-space/.cursor-plugin/plugin.json", ["version"]],
  [".claude-plugin/marketplace.json", ["metadata.version", "plugins.0.version"]],
  [".cursor-plugin/marketplace.json", ["metadata.version"]],
];

/** Source files with a `version: "x.y.z"` literal (server / app identity). */
const SOURCE_TARGETS = [
  "packages/mcp-server/src/index.ts",
  "packages/mcp-server/src/app/vault-manager-ui.ts",
];
const SOURCE_RE = /(version:\s*")([^"]+)(")/;

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

/** Rewrite only the version values so the files keep their own formatting. */
function writeJsonVersion(rel, paths, from, to) {
  const file = join(root, rel);
  let text = readFileSync(file, "utf8");
  for (const p of paths) {
    const key = p.split(".").pop();
    const re = new RegExp(`("${key}"\\s*:\\s*")${from.replace(/\./g, "\\.")}(")`);
    if (!re.test(text)) throw new Error(`${rel}: could not find ${p} = ${from}`);
    text = text.replace(re, `$1${to}$2`);
  }
  // Sanity: the result must parse and hold the new version at every path.
  const parsed = JSON.parse(text);
  for (const p of paths) {
    if (getPath(parsed, p) !== to) {
      setPath(parsed, p, to);
      text = JSON.stringify(parsed, null, 2) + "\n";
    }
  }
  writeFileSync(file, text);
}

function collect() {
  const found = [];
  for (const [rel, paths] of JSON_TARGETS) {
    const json = readJson(rel);
    for (const p of paths) found.push({ where: `${rel} (${p})`, value: getPath(json, p) });
  }
  for (const rel of SOURCE_TARGETS) {
    const m = readFileSync(join(root, rel), "utf8").match(SOURCE_RE);
    found.push({ where: `${rel} (version literal)`, value: m ? m[2] : undefined });
  }
  return found;
}

function check(tag) {
  const expected = readJson("package.json").version;
  const bad = collect().filter((f) => f.value !== expected);
  if (tag !== undefined && tag.replace(/^v/, "") !== expected) {
    bad.push({ where: `git tag ${tag}`, value: tag });
  }
  if (bad.length) {
    console.error(`Version mismatch. Root package.json says ${expected}:`);
    for (const b of bad) console.error(`  ${b.where}: ${b.value ?? "(missing)"}`);
    console.error(`Fix with: node scripts/version.mjs set ${expected}`);
    process.exit(1);
  }
  console.log(`All versions are ${expected}.`);
}

function set(next) {
  if (!SEMVER.test(next ?? "")) {
    console.error("Usage: node scripts/version.mjs set <x.y.z>");
    process.exit(2);
  }
  for (const [rel, paths] of JSON_TARGETS) {
    const json = readJson(rel);
    // Each path may currently hold a different (out of sync) value.
    for (const p of paths) writeJsonVersion(rel, [p], String(getPath(json, p)), next);
  }
  for (const rel of SOURCE_TARGETS) {
    const file = join(root, rel);
    const text = readFileSync(file, "utf8");
    if (!SOURCE_RE.test(text)) throw new Error(`${rel}: no version literal found`);
    writeFileSync(file, text.replace(SOURCE_RE, `$1${next}$3`));
  }
  console.log(`Set version ${next} in ${JSON_TARGETS.length + SOURCE_TARGETS.length} files.`);
  console.log("Next: add a CHANGELOG.md section for it, run `pnpm build`, and commit (see docs/RELEASING.md).");
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === "check") {
  check(arg === "--tag" ? arg2 : undefined);
} else if (cmd === "set") {
  set(arg);
} else {
  console.error("Usage: node scripts/version.mjs check [--tag vX.Y.Z] | set <x.y.z>");
  process.exit(2);
}
