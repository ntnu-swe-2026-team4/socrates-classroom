import { routeAgentRequest } from "agents";
import { createApp } from "./app";
import { Chat } from "./do/chat";
import { ReportRunner } from "./do/report-runner";
import type { Env } from "./env";
import { flushUsageAlerts } from "./routes/usage";

export { Chat, ReportRunner };
export type { RpcApp } from "./app";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return createApp().fetch(request, env);
    }
    try {
      return (await routeAgentRequest(request, env, { cors: false })) ?? new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("chat request failed", error);
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(flushUsageAlerts(env));
  },
} satisfies ExportedHandler<Env>;
