import { Hono } from "hono";
import { requireAdmin, type AppEnv } from "../http";

export function adminRoutes() {
  return new Hono<AppEnv>()
    .use("/admin/*", async (c, next) => {
      await requireAdmin(c);
      await next();
    })
    .get("/admin/session", (c) => c.json({ admin: true as const }));
}
