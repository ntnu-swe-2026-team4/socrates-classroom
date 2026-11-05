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
import { byokRoutes } from "./routes/byok";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("lang", normalizeLang(c.req.header("Accept-Language")));
    const token = getCookie(c, SESSION_COOKIE);
    c.set("user", await userFromSessionToken({ env: c.env }, token));
    await next();
  });

  const api = new Hono<AppEnv>()
    .route("/", authRoutes())
    .route("/", joinRoutes())
    .route("/", topicsRoutes())
    .route("/", classroomsRoutes())
    .route("/", activityRoutes())
    .route("/", voiceRoutes())
    .route("/", lookupRoutes())
    .route("/", byokRoutes());

  app.route("/api", api);

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/api/dev/seed", async (c) => {
    const token = c.req.header("x-seed-token") ?? "";
    if (!c.env.SEED_TOKEN || token !== c.env.SEED_TOKEN) {
      return c.json(
        { message: localize("not_found", normalizeLang(c.req.header("Accept-Language"))), code: "not_found" },
        404,
      );
    }
    await seedDemo(c.env.DB);
    return c.json({ seeded: true });
  });

  app.onError((error, c) => {
    const lang = c.get("lang") ?? normalizeLang(c.req.header("Accept-Language"));
    if (error instanceof ApiError) {
      return c.json({ message: localize(error.code, lang, error.vars), code: error.code }, error.status as never);
    }
    console.error("[api] unhandled", error);
    return c.json({ message: localize("internal_error", lang), code: "internal_error" }, 500);
  });

  app.notFound((c) => {
    const lang = normalizeLang(c.req.header("Accept-Language"));
    return c.json({ message: localize("not_found", lang), code: "not_found" }, 404);
  });

  return app;
}
