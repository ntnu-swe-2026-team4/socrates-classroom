import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { DevAccounts, User } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { FIXTURE_ACCOUNTS, FIXTURE_CLASSROOMS, FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, callWith, cookieOf, must } from "./helpers";

const migrations = inject("d1Migrations");

function jsonInit(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function counts(): Promise<{ users: number; classrooms: number; members: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM classrooms) AS classrooms,
      (SELECT COUNT(*) FROM members) AS members`,
  ).first<{ users: number; classrooms: number; members: number }>();
  return must(row, "seed counts row");
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
});

describe("dev fixtures", () => {
  test("re-seeding keeps the same rows and fixed ids", async () => {
    const before = await counts();
    await seedFixture(env.DB);
    expect(await counts()).toEqual(before);
    expect(before.classrooms).toBe(FIXTURE_CLASSROOMS.length);

    const lin = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("demo@socrates.tw")
      .first<{ id: string }>();
    expect(lin?.id).toBe("u_fx_lin");
    const philosophy = await env.DB.prepare("SELECT id, join_code FROM classrooms WHERE name = ?")
      .bind("高二哲學選修 A")
      .first<{ id: string; join_code: string }>();
    expect(philosophy).toEqual({ id: "c_fx_philosophy", join_code: "demo-phil" });
  });

  test("GET /api/dev/accounts lists every fixture with its classrooms", async () => {
    const res = await call("/api/dev/accounts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DevAccounts;
    expect(body.password).toBe(FIXTURE_PASSWORD);
    expect(body.accounts.map((account) => account.email)).toEqual(FIXTURE_ACCOUNTS.map((account) => account.email));

    const lin = must(
      body.accounts.find((account) => account.email === "demo@socrates.tw"),
      "lin account row",
    );
    expect(lin.fixtureRole).toBe("teacher");
    expect(lin.classrooms).toHaveLength(2);
    expect(lin.classrooms.every((room) => room.role === "teacher" && room.code !== null)).toBe(true);

    const chen = must(
      body.accounts.find((account) => account.email === "chen@socrates.tw"),
      "chen account row",
    );
    expect("canManageClasses" in chen).toBe(false);
    expect(chen.isAdmin).toBe(false);
    expect(chen.classrooms.map((room) => room.role)).toEqual(["student"]);
    expect(chen.classrooms[0].code).toBeNull();

    const member = must(
      body.accounts.find((account) => account.email === "student-b@socrates.tw"),
      "member account row",
    );
    expect(member.classrooms.map((room) => room.id)).toEqual(["c_fx_philosophy"]);
    expect(member.classrooms[0].role).toBe("student");

    const admin = must(
      body.accounts.find((account) => account.fixtureRole === "admin"),
      "admin account row",
    );
    expect(admin.email).toBe("admin@socrates.tw");
    expect(admin.isAdmin).toBe(true);

    const philosophy = must(
      lin.classrooms.find((room) => room.id === "c_fx_philosophy"),
      "philosophy classroom row",
    );
    expect(philosophy.activityId).toBe("a_fx_philosophy");
    expect(philosophy.url).toContain("/join/demo-phil");
  });

  test("POST /api/dev/login signs in without a password", async () => {
    const res = await call("/api/dev/login", jsonInit({ email: "student-b@socrates.tw" }));
    expect(res.status).toBe(200);
    const user = (await res.json()) as User;
    expect(user.name).toBe("李美玲");
    expect("canManageClasses" in user).toBe(false);

    const me = await call("/api/me", { headers: { Cookie: cookieOf(res) } });
    expect(((await me.json()) as User).id).toBe(user.id);
  });

  test("POST /api/dev/login heals is_admin drift left by an older seed", async () => {
    await env.DB.prepare("UPDATE users SET is_admin = 0 WHERE id = 'u_fx_admin'").run();
    const res = await call("/api/dev/login", jsonInit({ email: "admin@socrates.tw" }));
    expect(res.status).toBe(200);
    const user = (await res.json()) as User;
    expect(user.isAdmin).toBe(true);

    const me = await call("/api/me", { headers: { Cookie: cookieOf(res) } });
    expect(((await me.json()) as User).isAdmin).toBe(true);
    const listed = await call("/api/admin/users", { headers: { Cookie: cookieOf(res) } });
    expect(listed.status).toBe(200);
  });

  test("POST /api/dev/login rejects emails outside the fixture list", async () => {
    const res = await call("/api/dev/login", jsonInit({ email: "nobody@example.com" }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });

  test("every dev endpoint is 404 outside ENVIRONMENT=dev", async () => {
    const production = { ENVIRONMENT: "production" };
    expect((await callWith(production, "/api/dev/accounts")).status).toBe(404);
    expect((await callWith(production, "/api/dev/login", jsonInit({ email: "demo@socrates.tw" }))).status).toBe(404);
    const seeded = await callWith(production, "/api/dev/seed", {
      method: "POST",
      headers: { "x-seed-token": env.SEED_TOKEN ?? "" },
    });
    expect(seeded.status).toBe(404);
  });
});
