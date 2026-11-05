import { createApp } from "./app";
import { PiAgent } from "./do/pi-agent";
import { ActivityEvents } from "./do/events";
import { Coordinator } from "./do/coordinator";
import { ReportJob } from "./do/report-job";
import type { Env } from "./env";

export const app = createApp;
export { PiAgent, ActivityEvents, Coordinator, ReportJob };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app().fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
