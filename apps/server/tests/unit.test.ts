import { describe, expect, test } from "vitest";
import { prepare } from "../src/db/d1";
import { CLASS_POOL, DEV_POOL, MOCK_POOL, poolForMode } from "../src/providers/whitelist";
import { BYOK_CATALOG, byokSupported } from "../src/providers/byok";

describe("D1 $named → 位置參數轉換", () => {
  test("基本轉換：出現順序即綁定順序", () => {
    const q = prepare("SELECT * FROM users WHERE id = $id AND role = $role", { role: "teacher", id: "u_1" });
    expect(q.sql).toBe("SELECT * FROM users WHERE id = ? AND role = ?");
    // $id 在 SQL 中先出現，即使 params 物件順序相反
    expect(q.values).toEqual(["u_1", "teacher"]);
  });

  test("同一參數重複出現會綁兩次", () => {
    const q = prepare("INSERT INTO t (a, b) VALUES ($v, $v)", { v: 7 });
    expect(q.values).toEqual([7, 7]);
  });

  test("缺參數直接丟錯（避免静默 null）", () => {
    expect(() => prepare("SELECT * FROM t WHERE a = $missing", {})).toThrow(/\$missing/);
  });

  test("undefined 轉成 null", () => {
    const q = prepare("INSERT INTO t (a) VALUES ($a)", { a: undefined });
    expect(q.values).toEqual([null]);
  });
});

describe("provider 白名單（ZDR 規則）", () => {
  test("班級 pool：四段、順序固定、全在白名單內", () => {
    expect(CLASS_POOL.map((p) => p.provider)).toEqual(["dgx-spark", "opencode-go", "openrouter", "workers-ai"]);
    expect(CLASS_POOL.every((p) => /glm/i.test(p.model))).toBe(true);
  });

  test("開發路由：Coding Plan 優先", () => {
    expect(DEV_POOL[0]).toEqual({ provider: "zai", model: "glm-5.3-flash" });
  });

  test("mock 模式與模式解析", () => {
    expect(MOCK_POOL[0].provider).toBe("mock");
    expect(poolForMode("dev")[0].provider).toBe("zai");
    expect(poolForMode("mock")[0].provider).toBe("mock");
    expect(poolForMode(undefined)[0].provider).toBe("dgx-spark");
    expect(poolForMode("pool")).toEqual(CLASS_POOL);
  });

  test("禁入清單不得出現在任何 pool", () => {
    const banned = ["muse", "iceman", "grok", "gpt", "claude", "deepseek"];
    for (const pool of [CLASS_POOL, DEV_POOL, MOCK_POOL]) {
      for (const entry of pool) {
        for (const b of banned) {
          expect(`${entry.provider}:${entry.model}`.toLowerCase().includes(b)).toBe(false);
        }
      }
    }
  });
});

describe("BYOK 目錄", () => {
  test("班級 pool 用到的雲端 provider 都在 BYOK 目錄內", () => {
    for (const entry of [...CLASS_POOL, ...DEV_POOL]) {
      if (["dgx-spark", "workers-ai", "mock"].includes(entry.provider)) continue;
      expect(byokSupported(entry.provider)).toBe(true);
    }
  });

  test("主要 BYOK provider 都有預設模型與環境變數名", () => {
    for (const id of ["openrouter", "zai", "opencode-go", "anthropic", "openai", "google", "groq"]) {
      expect(BYOK_CATALOG[id]).toBeDefined();
      expect(BYOK_CATALOG[id].defaultModel.length).toBeGreaterThan(0);
      expect(BYOK_CATALOG[id].env).toBeDefined();
    }
  });

  test("不支援的 provider 直接拒絕", () => {
    expect(byokSupported("github-copilot")).toBe(false);
    expect(byokSupported("amazon-bedrock")).toBe(false);
    expect(byokSupported("not-a-provider")).toBe(false);
  });
});
