import { describe, expect, test } from "vitest";
import { bool, call, callWith, field } from "./helpers";

function warningsOf(body: unknown): string[] {
  if (bool(body, "ok") !== true) throw new Error("health not ok");
  const warnings: unknown = field(body, "warnings") ?? [];
  if (!Array.isArray(warnings)) throw new Error("health warnings is not an array");
  return warnings.filter((warning): warning is string => typeof warning === "string");
}

describe("GET /health (#215)", () => {
  test("dev reports missing fail-fast secrets; production stays byte-identical", async () => {
    const configured = await (await call("/health")).json();
    expect({ ok: bool(configured, "ok"), warnings: warningsOf(configured) }).toEqual({
      ok: true,
      warnings: [],
    });

    const missing = await callWith({ AUTH_SECRET: "", BYOK_ENC_KEY: "" }, "/health");
    const missingBody = await missing.json();
    expect({ ok: bool(missingBody, "ok"), warnings: warningsOf(missingBody) }).toEqual({
      ok: true,
      warnings: ["AUTH_SECRET", "BYOK_ENC_KEY"],
    });

    const production = await callWith({ ENVIRONMENT: "production" }, "/health");
    expect(await production.text()).toBe('{"ok":true}');
  });

  test("callWith overrides stay scoped to their own request (#292)", async () => {
    await callWith({ AUTH_SECRET: "", BYOK_ENC_KEY: "" }, "/health");
    const after = await (await call("/health")).json();
    expect({ ok: bool(after, "ok"), warnings: warningsOf(after) }).toEqual({ ok: true, warnings: [] });
  });
});
