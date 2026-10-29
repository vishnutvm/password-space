import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultDataDir, resolvePasswordSpaceHome } from "./paths.js";

describe("resolvePasswordSpaceHome", () => {
  it("returns undefined for unset / empty / whitespace", () => {
    expect(resolvePasswordSpaceHome(undefined)).toBeUndefined();
    expect(resolvePasswordSpaceHome(null)).toBeUndefined();
    expect(resolvePasswordSpaceHome("")).toBeUndefined();
    expect(resolvePasswordSpaceHome("   ")).toBeUndefined();
  });

  it("rejects the literal ${PASSWORD_SPACE_HOME} placeholder", () => {
    expect(resolvePasswordSpaceHome("${PASSWORD_SPACE_HOME}")).toBeUndefined();
    expect(
      resolvePasswordSpaceHome("  ${PASSWORD_SPACE_HOME}  "),
    ).toBeUndefined();
  });

  it("rejects other unresolved ${VAR} placeholders", () => {
    expect(resolvePasswordSpaceHome("${OTHER_HOME}")).toBeUndefined();
    expect(resolvePasswordSpaceHome("${CURSOR_PLUGIN_ROOT}")).toBeUndefined();
  });

  it("accepts a real absolute path", () => {
    expect(resolvePasswordSpaceHome("/tmp/ps-demo")).toBe("/tmp/ps-demo");
    expect(resolvePasswordSpaceHome(" /custom/vault ")).toBe("/custom/vault");
  });
});

describe("defaultDataDir", () => {
  it("defaults to ~/.password-space when env is missing", () => {
    expect(defaultDataDir({})).toBe(join(homedir(), ".password-space"));
  });

  it("defaults when env is empty or literal placeholder", () => {
    expect(defaultDataDir({ PASSWORD_SPACE_HOME: "" })).toBe(
      join(homedir(), ".password-space"),
    );
    expect(
      defaultDataDir({ PASSWORD_SPACE_HOME: "${PASSWORD_SPACE_HOME}" }),
    ).toBe(join(homedir(), ".password-space"));
  });

  it("uses a concrete PASSWORD_SPACE_HOME when set", () => {
    expect(defaultDataDir({ PASSWORD_SPACE_HOME: "/tmp/ps-home" })).toBe(
      "/tmp/ps-home",
    );
  });
});
