import { describe, expect, it } from "vitest";
import { prepare } from "../src/db/d1";

describe("d1 prepare (named → positional; $ inside string literals is not replaced)", () => {
  it("named params become positional", () => {
    const q = prepare("SELECT * FROM users WHERE id = $id AND role = $role", { id: "u_1", role: "teacher" });
    expect(q.sql).toBe("SELECT * FROM users WHERE id = ? AND role = ?");
    expect(q.values).toEqual(["u_1", "teacher"]);
  });

  it("$word inside a string literal is not replaced and consumes no params", () => {
    const q = prepare("SELECT '$id' AS literal, name FROM t WHERE id = $id", { id: "u_1" });
    expect(q.sql).toBe("SELECT '$id' AS literal, name FROM t WHERE id = ?");
    expect(q.values).toEqual(["u_1"]);
  });

  it("named params after an escaped quote ('') are still replaced", () => {
    const q = prepare("SELECT 'it''s $id' AS literal, id FROM t WHERE id = $id", { id: "u_1" });
    expect(q.sql).toBe("SELECT 'it''s $id' AS literal, id FROM t WHERE id = ?");
    expect(q.values).toEqual(["u_1"]);
  });

  it("missing param throws", () => {
    expect(() => prepare("SELECT * FROM t WHERE id = $id")).toThrow("missing bind param");
  });
});
