import { createApp } from "./app";
import { PiAgent } from "./do/pi-agent";
import { ActivityEvents } from "./do/events";
import type { Env } from "./env";

export const app = createApp;
export { PiAgent, ActivityEvents };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
