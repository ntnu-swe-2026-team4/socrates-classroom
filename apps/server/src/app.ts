import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "@socrates/shared";
import { localize } from "./messages";
import { fail, normalizeLang, type AppEnv } from "./http";
import { seedFixture } from "./seed";
import { lookupSession, SESSION_COOKIE } from "./auth";
import { getCookie } from "hono/cookie";
import { authRoutes } from "./routes/auth";
import { joinRoutes } from "./routes/join";
import { classroomInviteRoutes } from "./routes/classroom-invites";
import { inviteRoutes } from "./routes/invites";
import { topicsRoutes } from "./routes/topics";
import { classroomCommunityRoutes } from "./routes/classroom-community";
import { communityContentRoutes } from "./routes/community-content";
import { classroomsRoutes } from "./routes/classrooms";
import { activityRoutes } from "./routes/activity";
import { voiceRoutes } from "./routes/voice";
import { lookupRoutes } from "./routes/lookup";
import { teacherKeyRoutes } from "./routes/teacher-keys";
import { adminRoutes } from "./routes/admin";
import { notificationRoutes } from "./routes/notifications";
import { soloRoutes } from "./routes/solo";
import { devRoutes, isDev } from "./routes/dev";
import { FAIL_FAST_SECRETS } from "./env";
import { timingSafeEqual } from "./auth-crypto";

export function createApi() {
  return new Hono<AppEnv>()
    .route("/", authRoutes())
    .route("/", joinRoutes())
    .route("/", inviteRoutes())
    .route("/", classroomInviteRoutes())
    .route("/", topicsRoutes())
    .route("/", classroomsRoutes())
    .route("/", classroomCommunityRoutes())
    .route("/", communityContentRoutes())
    .route("/", activityRoutes())
    .route("/", voiceRoutes())
    .route("/", lookupRoutes())
    .route("/", teacherKeyRoutes())
    .route("/", adminRoutes())
    .route("/", notificationRoutes())
    .route("/", soloRoutes())
    .route("/", devRoutes());
}
export type RpcApi = ReturnType<typeof createApi>;

export function createApp() {
  return new Hono<AppEnv>()
    .use("/api/*", async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      c.set("lang", normalizeLang(c.req.header("Accept-Language")));
      const lookup = await lookupSession(c.env, getCookie(c, SESSION_COOKIE));
      c.set("user", lookup.kind === "ok" ? lookup.session.user : null);
      c.set("sessionIssue", lookup.kind === "ok" || lookup.kind === "missing" ? null : lookup.kind);
      await next();
    })
    .route("/api", createApi())
    .get("/health", (c) =>
      isDev(c.env)
        ? c.json({ ok: true, warnings: FAIL_FAST_SECRETS.filter((key) => !c.env[key]) })
        : c.json({ ok: true }),
    )
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
      if (error instanceof HTTPException && error.status === 400) {
        return c.json({ message: localize("validation", lang), code: "validation" }, 422);
      }
      if (error instanceof HTTPException) {
        return error.getResponse();
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
