import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "./db/d1";
import { one, run } from "./db/d1";
import { languageOf } from "./messages";
import type { AppEnv, UserRow } from "./http";
import { fail } from "./http";

export const SESSION_COOKIE = "socrates_session";
const SESSION_DAYS = 30;

export function authMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("lang", languageOf(c.req.header("Accept-Language")));
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const row = await one<{ user_id: string; expires_at: string }>(db,
        "SELECT user_id, expires_at FROM sessions WHERE token = $token",
        { token },
      );
      if (row && row.expires_at > new Date().toISOString()) {
        const user = await one<UserRow>(db,
          "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id",
          { id: row.user_id },
        );
        if (user) c.set("user", user);
      } else if (row) {
        await run(db, "DELETE FROM sessions WHERE token = $token", { token });
      }
    }
    await next();
  };
}

export function requireUser(c: { get: (k: "user") => UserRow | undefined }): UserRow {
  const user = c.get("user");
  if (!user) fail(401, "unauthorized");
  return user;
}

export async function startSession(db: Db, c: any, userId: string, secure: boolean): Promise<void> {
  // 順手清掉過期 session，避免資料表隨登入次數無限增長
  await run(db, "DELETE FROM sessions WHERE expires_at < $now", { now: new Date().toISOString() });
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 864e5);
  await run(db, "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($token, $userId, $now, $expires)", {
    token, userId, now: now.toISOString(), expires: expires.toISOString(),
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure,
  });
}

export async function endSession(db: Db, c: any): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await run(db, "DELETE FROM sessions WHERE token = $token", { token });
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
