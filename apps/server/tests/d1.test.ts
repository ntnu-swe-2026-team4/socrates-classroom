import { describe, expect, it } from "vitest";
import { prepare } from "../src/db/d1";

describe("d1 prepare（named → positional；字串常數內 $ 不替換）", () => {
  it("named params 轉 positional", () => {
    const q = prepare("SELECT * FROM users WHERE id = $id AND role = $role", { id: "u_1", role: "teacher" });
    expect(q.sql).toBe("SELECT * FROM users WHERE id = ? AND role = ?");
    expect(q.values).toEqual(["u_1", "teacher"]);
  });

  it("字串常數內的 $word 不替換、不耗 params", () => {
    const q = prepare("SELECT '$id' AS literal, name FROM t WHERE id = $id", { id: "u_1" });
    expect(q.sql).toBe("SELECT '$id' AS literal, name FROM t WHERE id = ?");
    expect(q.values).toEqual(["u_1"]);
  });

  it("escaped quote（''）後的 named param 仍替換", () => {
    const q = prepare("SELECT 'it''s $id' AS literal, id FROM t WHERE id = $id", { id: "u_1" });
    expect(q.sql).toBe("SELECT 'it''s $id' AS literal, id FROM t WHERE id = ?");
    expect(q.values).toEqual(["u_1"]);
  });

  it("缺 param 拋錯", () => {
    expect(() => prepare("SELECT * FROM t WHERE id = $id")).toThrow("missing bind param");
  });
});
