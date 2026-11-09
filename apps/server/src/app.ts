import { Hono } from "hono";
import { ApiError } from "@socrates/shared";
import { localize } from "./messages";
import { normalizeLang, type AppEnv } from "./http";
import { seedDemo } from "./seed";
import { SESSION_COOKIE, userFromSessionToken } from "./auth";
import { getCookie } from "hono/cookie";
import { authRoutes } from "./routes/auth";
import { joinRoutes } from "./routes/join";
import { topicsRoutes } from "./routes/topics";
import { classroomsRoutes } from "./routes/classrooms";
import { activityRoutes } from "./routes/activity";
import { voiceRoutes } from "./routes/voice";
import { lookupRoutes } from "./routes/lookup";
import { teacherKeyRoutes } from "./routes/teacher-keys";
import { timingSafeEqual } from "./auth-crypto";

export function createApi() {
  return new Hono<AppEnv>()
    .route("/", authRoutes())
    .route("/", joinRoutes())
    .route("/", topicsRoutes())
    .route("/", classroomsRoutes())
    .route("/", activityRoutes())
    .route("/", voiceRoutes())
    .route("/", lookupRoutes())
    .route("/", teacherKeyRoutes());
}
export type RpcApi = ReturnType<typeof createApi>;

export function createApp() {
  return new Hono<AppEnv>()
    .use("/api/*", async (c, next) => {
      c.set("lang", normalizeLang(c.req.header("Accept-Language")));
      const token = getCookie(c, SESSION_COOKIE);
      c.set("user", await userFromSessionToken({ env: c.env }, token));
      await next();
    })
    .route("/api", createApi())
    .get("/health", (c) => c.json({ ok: true }))
    .post("/api/dev/seed", async (c) => {
      const token = c.req.header("x-seed-token") ?? "";
      const allowed =
        (c.env.LLM_PROVIDER === "mock" || c.env.DGX_BASE_URL) &&
        !!c.env.SEED_TOKEN &&
        timingSafeEqual(token, c.env.SEED_TOKEN);
      if (!allowed) {
        return c.json(
          { message: localize("not_found", normalizeLang(c.req.header("Accept-Language"))), code: "not_found" },
          404,
        );
      }
      const mock = c.env.LLM_PROVIDER === "mock";
      const password = mock
        ? undefined
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => (b & 15).toString(16)).join("");
      await seedDemo(c.env.DB, password);
      return c.json({ seeded: true, ...(password ? { password } : {}) });
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
