import { Hono } from "hono";
import type { Env } from "./env";
import { d1 } from "./db/d1";
import { authMiddleware } from "./auth";
import { HttpError, fail, type AppEnv } from "./http";
import { languageOf, msg } from "./messages";
import { configureEventBus } from "./do/events";
import { setPublicBase } from "./services/serialize";
import { activityRoutes } from "./routes/activities";
import { announcementRoutes } from "./routes/announcements";
import { archiveRoutes } from "./routes/archives";
import { authRoutes } from "./routes/auth";
import { calendarRoutes } from "./routes/calendar";
import { classroomRoutes } from "./routes/classrooms";
import { discussionRoutes } from "./routes/discussions";
import { postRoutes } from "./routes/posts";
import { teamRoutes } from "./routes/team";
import { topicRoutes } from "./routes/topics";

export function createApp(env: Env): Hono<AppEnv> {
  const db = d1(env.DB);
  configureEventBus(env.ActivityEvents);
  setPublicBase(env.PUBLIC_BASE_URL);
  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowed = !!origin && corsOrigins.includes(origin);
    if (c.req.method === "OPTIONS") {
      if (allowed) {
        c.header("Access-Control-Allow-Origin", origin!);
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Accept, Accept-Language");
        c.header("Access-Control-Max-Age", "86400");
      }
      return c.body(null, 204);
    }
    await next();
    if (allowed) {
      c.header("Access-Control-Allow-Origin", origin!);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
  });

  app.use("/api/*", authMiddleware(db));

  const api = new Hono<AppEnv>();
  const lang = (c: any) => c.get("lang") as import("@socrates/shared").Lang;
  api.route("/", authRoutes(db, !!env.COOKIE_SECURE));
  api.route("/", archiveRoutes(db, lang));
  api.route("/", classroomRoutes(db));
  api.route("/", announcementRoutes(db));
  api.route("/", topicRoutes(db));
  api.route("/", postRoutes(db));
  api.route("/", discussionRoutes(db, lang));
  api.route("/", calendarRoutes(db));
  api.route("/", activityRoutes(db, lang));
  api.route("/", teamRoutes(db, lang));

  app.route("/api", api);

  // 一次性示種資料（SEED_TOKEN 未設定時關閉）；本機：npm run seed
  app.post("/api/dev/seed", async (c) => {
    const token = c.req.header("x-seed-token") ?? "";
    if (!env.SEED_TOKEN || token !== env.SEED_TOKEN) fail(404, "not_found");
    const { seedDemo } = await import("./seed");
    const seeded = await seedDemo(db);
    return c.json({ seeded });
  });

  app.get("/health", (c) => c.json({ ok: true, db: "d1" }));

  app.notFound((c) =>
    c.json({ message: msg(languageOf(c.req.header("Accept-Language")), "not_found"), code: "not_found" }, 404),
  );

  app.onError((error, c) => {
    const language = c.get("lang") ?? languageOf(c.req.header("Accept-Language"));
    if (error instanceof HttpError) {
      return c.json(
        { message: msg(language, error.key, error.vars), code: error.code ?? error.key },
        error.status as any,
      );
    }
    const raw = error instanceof Error ? error.message : String(error);
    if (raw === "already_streaming") {
      return c.json({ message: msg(language, "already_streaming"), code: "already_streaming" }, 409);
    }
    if (raw === "llm_not_configured") {
      return c.json({ message: msg(language, "llm_not_configured"), code: "llm_not_configured" }, 503);
    }
    if (raw.startsWith("llm_rate_limited") || raw === "llm_rate_limited") {
      return c.json({ message: msg(language, "llm_rate_limited"), code: "llm_rate_limited" }, 429);
    }
    if (raw.startsWith("llm_unavailable")) {
      return c.json({ message: msg(language, "llm_unavailable"), code: "llm_unavailable" }, 503);
    }
    console.error("[server] unhandled error:", error);
    return c.json({ message: msg(language, "internal_error"), code: "internal_error" }, 500);
  });

  return app;
}
