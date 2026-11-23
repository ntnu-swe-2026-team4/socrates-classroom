import type { Env as ServerEnv } from "../src/env";

declare module "cloudflare:test" {
  // The vitest plugin's namespace type loses the DO generic; test code passes
  // the worker env straight into src functions typed on ServerEnv, so pin it.
  interface ProvidedEnv extends ServerEnv {
    Chat: DurableObjectNamespace<import("../src/do/chat").Chat>;
    SoloChat: DurableObjectNamespace<import("../src/do/solo-chat").SoloChat>;
    RateLimiter: DurableObjectNamespace<import("../src/do/rate-limiter").RateLimiter>;
    RoutingLedger: DurableObjectNamespace<import("../src/do/routing-ledger").RoutingLedger>;
  }
}

declare global {
  namespace Cloudflare {
    interface Env extends ServerEnv {
      Chat: DurableObjectNamespace<import("../src/do/chat").Chat>;
      SoloChat: DurableObjectNamespace<import("../src/do/solo-chat").SoloChat>;
      RateLimiter: DurableObjectNamespace<import("../src/do/rate-limiter").RateLimiter>;
      RoutingLedger: DurableObjectNamespace<import("../src/do/routing-ledger").RoutingLedger>;
    }
  }
}
