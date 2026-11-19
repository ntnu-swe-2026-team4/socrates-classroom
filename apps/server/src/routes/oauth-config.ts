import type { AuthProvider, AuthProviders } from "@socrates/shared";
import type { Env } from "../env";

export function providerConfigured(env: Env, provider: AuthProvider): boolean {
  return provider === "google" && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function enabledProviders(env: Env): AuthProviders {
  return {
    google: providerConfigured(env, "google"),
  };
}
