import { describe, expect, it } from "vitest";
import { dictionaries, translate } from "@/i18n";

describe("i18n", () => {
  it("every locale exposes the identical key set", async () => {
    const keys = Object.keys(dictionaries["zh-TW"]!).sort();
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of ["en", "es"] as const) {
      expect(Object.keys(dictionaries[locale]!).sort()).toEqual(keys);
    }
  });

  it("substitutes {n} style placeholders", () => {
    expect(translate("zh-TW", "report_turn_ref", { turns: 3 })).toContain("3");
  });

  it("returns zh-TW text for the zh-TW locale", () => {
    expect(translate("zh-TW", "common_send")).toBe("送出");
  });
});
