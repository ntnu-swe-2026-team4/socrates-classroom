import { Hono } from "hono";
import type { Config } from "./config";
import type { DB } from "./db";
import { authMiddleware } from "./auth";
import { HttpError, type AppEnv } from "./http";
import { languageOf, msg } from "./messages";
import { activityRoutes } from "./routes/activities";
import { announcementRoutes } from "./routes/announcements";
import { archiveRoutes } from "./routes/archives";
import { authRoutes } from "./routes/auth";
import { calendarRoutes } from "./routes/calendar";
import { classroomRoutes } from "./routes/classrooms";
import { discussionRoutes } from "./routes/discussions";
import { lookupRoutes } from "./routes/lookup";
import { postRoutes } from "./routes/posts";
import { teamRoutes } from "./routes/team";
import { topicRoutes } from "./routes/topics";

export function createApp(db: DB, config: Config): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowed = !!origin && config.corsOrigins.includes(origin);
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
  const lang = (c: any) => c.get("lang") as import("./config").Lang;
  api.route("/", authRoutes(db, config.cookieSecure));
  api.route("/", archiveRoutes(db, config, lang));
  api.route("/", classroomRoutes(db));
  api.route("/", announcementRoutes(db));
  api.route("/", topicRoutes(db, config));
  api.route("/", postRoutes(db));
  api.route("/", discussionRoutes(db, config, lang));
  api.route("/", calendarRoutes(db));
  api.route("/", activityRoutes(db, config, lang));
  api.route("/", teamRoutes(db, lang));
  api.route("/", lookupRoutes(config));

  app.route("/api", api);

  app.get("/health", (c) => c.json({ ok: true, db: "sqlite" }));

  app.notFound((c) => c.json({ message: msg(languageOf(c.req.header("Accept-Language")), "not_found"), code: "not_found" }, 404));

  app.onError((error, c) => {
    const language = c.get("lang") ?? languageOf(c.req.header("Accept-Language"));
    if (error instanceof HttpError) {
      return c.json({ message: msg(language, error.key, error.vars), code: error.code ?? error.key }, error.status as any);
    }
    console.error("[server] unhandled error:", error);
    return c.json({ message: msg(language, "internal_error"), code: "internal_error" }, 500);
  });

  return app;
}
