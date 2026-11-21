import { describe, expect, test } from "vitest";
import { call, callWith } from "./helpers";

describe("GET /health (#215)", () => {
  test("dev reports missing fail-fast secrets; production stays byte-identical", async () => {
    const configured = (await (await call("/health")).json()) as { ok: boolean; warnings?: string[] };
    expect(configured).toEqual({ ok: true, warnings: [] });

    const missing = await callWith({ AUTH_SECRET: "", BYOK_ENC_KEY: "" }, "/health");
    expect((await missing.json()) as { ok: boolean; warnings?: string[] }).toEqual({
      ok: true,
      warnings: ["AUTH_SECRET", "BYOK_ENC_KEY"],
    });

    const production = await callWith({ ENVIRONMENT: "production" }, "/health");
    expect(await production.text()).toBe('{"ok":true}');
  });
});
