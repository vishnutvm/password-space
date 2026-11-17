import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: { PASSWORD_SPACE_KEYCHAIN: "none", PASSWORD_SPACE_STORAGE: "auto" },
    testTimeout: 30_000,
  },
});
