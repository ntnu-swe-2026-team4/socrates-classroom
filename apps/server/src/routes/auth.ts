import { Hono } from "hono";
import type { Db } from "../db/d1";
import { one, run } from "../db/d1";
import { endSession, requireUser, startSession } from "../auth";
import { bodyOf, fail, type AppEnv, type UserRow } from "../http";
import { publicUser } from "../services/serialize";

export function authRoutes(db: Db, cookieSecure: boolean) {
  const r = new Hono<AppEnv>();

  r.post("/auth/login", async (c) => {
    const body = await bodyOf(c);
    const role = body.role === "teacher" ? "teacher" : body.role === "student" ? "student" : null;
    if (!role) fail(422, "invalid_role");
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const name = rawName || (role === "teacher" ? "林老師" : "訪客");
    if (name.length > 80) fail(422, "text_too_long", { n: 80 });
    let user = await one<UserRow>(db, "SELECT * FROM users WHERE role = $role AND name = $name", { role, name });
    if (!user) {
      const id = crypto.randomUUID().replaceAll("-", "");
      await run(db, "INSERT INTO users (id, name, role, avatar_url, created_at) VALUES ($id, $name, $role, NULL, $at)", {
        id, name, role, at: new Date().toISOString(),
      });
      user = (await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id }))!;
    }
    await startSession(db, c, user.id, cookieSecure);
    return c.json(publicUser(user));
  });

  r.get("/me", (c) => {
    const user = requireUser(c);
    return c.json(publicUser(user));
  });

  r.patch("/me", async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(c);
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) fail(422, "name_required");
      const name = body.name.trim();
      if (name.length > 80) fail(422, "text_too_long", { n: 80 });
      const clash = await one(db, "SELECT id FROM users WHERE role = $role AND name = $name AND id <> $id", { role: user.role, name, id: user.id });
      if (clash) fail(409, "conflict");
      await run(db, "UPDATE users SET name = $name WHERE id = $id", { name, id: user.id });
    }
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === null) {
        await run(db, "UPDATE users SET avatar_url = NULL WHERE id = $id", { id: user.id });
      } else {
        if (typeof body.avatarUrl !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(body.avatarUrl)) fail(422, "avatar_invalid");
        if (body.avatarUrl.length > 200 * 1024) fail(413, "avatar_too_large");
        await run(db, "UPDATE users SET avatar_url = $avatar WHERE id = $id", { avatar: body.avatarUrl, id: user.id });
      }
    }
    const updated = (await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id: user.id }))!;
    c.set("user", updated);
    return c.json(publicUser(updated));
  });

  r.post("/auth/logout", async (c) => {
    await endSession(db, c);
    return c.body(null, 204);
  });

  return r;
}
