#!/usr/bin/env node
/**
 * Portable redaction utility (stdin → stdout) for hooks or other message filters.
 *
 * Thin wrapper over the plugin hook at plugins/password-space/scripts/redact.mjs,
 * which is the single implementation. The plugin entry defaults to
 * --from-inject --fail-on-leak (what a beforeSubmitPrompt hook wants); this
 * wrapper keeps the utility opt-in: nothing is loaded and nothing blocks unless
 * you pass --from-inject / --secrets-file / --secret and --fail-on-leak.
 * Later flags win, so explicit flags after these defaults override them.
 */
process.argv.splice(2, 0, "--no-from-inject", "--no-fail-on-leak");
await import("../plugins/password-space/scripts/redact.mjs");
