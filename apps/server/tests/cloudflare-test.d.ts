import type { Env as ServerEnv } from "../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends ServerEnv {
    Chat: DurableObjectNamespace;
  }
}

declare global {
  namespace Cloudflare {
    interface Env extends ServerEnv {
      Chat: DurableObjectNamespace;
    }
  }
}
