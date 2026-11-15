import { Hono } from "hono";
import { ApiError } from "@socrates/shared";
import { localize } from "./messages";
import { fail, normalizeLang, type AppEnv } from "./http";
import { seedFixture } from "./seed";
import { lookupSession, SESSION_COOKIE } from "./auth";
import { getCookie } from "hono/cookie";
import { authRoutes } from "./routes/auth";
import { joinRoutes } from "./routes/join";
import { inviteRoutes } from "./routes/invites";
import { topicsRoutes } from "./routes/topics";
import { classroomsRoutes } from "./routes/classrooms";
import { activityRoutes } from "./routes/activity";
import { voiceRoutes } from "./routes/voice";
import { lookupRoutes } from "./routes/lookup";
import { teacherKeyRoutes } from "./routes/teacher-keys";
import { adminRoutes } from "./routes/admin";
import { devRoutes, isDev } from "./routes/dev";
import { timingSafeEqual } from "./auth-crypto";

export function createApi() {
  return new Hono<AppEnv>()
    .route("/", authRoutes())
    .route("/", joinRoutes())
    .route("/", inviteRoutes())
    .route("/", topicsRoutes())
    .route("/", classroomsRoutes())
    .route("/", activityRoutes())
    .route("/", voiceRoutes())
    .route("/", lookupRoutes())
    .route("/", teacherKeyRoutes())
    .route("/", adminRoutes())
    .route("/", devRoutes());
}
export type RpcApi = ReturnType<typeof createApi>;

export function createApp() {
  return new Hono<AppEnv>()
    .use("/api/*", async (c, next) => {
      c.set("lang", normalizeLang(c.req.header("Accept-Language")));
      const lookup = await lookupSession(c.env, getCookie(c, SESSION_COOKIE));
      c.set("user", lookup.kind === "ok" ? lookup.session.user : null);
      c.set("sessionIssue", lookup.kind === "ok" || lookup.kind === "missing" ? null : lookup.kind);
      await next();
    })
    .route("/api", createApi())
    .get("/health", (c) => c.json({ ok: true }))
    .post("/api/dev/seed", async (c) => {
      if (!isDev(c.env)) fail(404, "not_found");
      const token = c.req.header("x-seed-token") ?? "";
      const allowed = !!c.env.SEED_TOKEN && timingSafeEqual(token, c.env.SEED_TOKEN);
      if (!allowed) fail(404, "not_found");
      await seedFixture(c.env.DB);
      return c.json({ seeded: true });
    })
    .onError((error, c) => {
      const lang = c.get("lang") ?? normalizeLang(c.req.header("Accept-Language"));
      if (error instanceof ApiError) {
        return c.json({ message: localize(error.code, lang, error.vars), code: error.code }, error.status as never);
      }
      console.error("[api] unhandled", error);
      return c.json({ message: localize("internal_error", lang), code: "internal_error" }, 500);
    })
    .notFound((c) => {
      const lang = normalizeLang(c.req.header("Accept-Language"));
      return c.json({ message: localize("not_found", lang), code: "not_found" }, 404);
    });
}

export type RpcApp = ReturnType<typeof createApp>;
