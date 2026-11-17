import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Unit tests never touch the real OS keychain; keychain tests inject one.
    env: { PASSWORD_SPACE_KEYCHAIN: "none", PASSWORD_SPACE_STORAGE: "auto" },
  },
});
