import type { AuthProvider, AuthProviders } from "@socrates/shared";
import type { Env } from "../env";

export function providerConfigured(env: Env, provider: AuthProvider): boolean {
  switch (provider) {
    case "google":
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case "facebook":
      return Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET);
    case "apple":
      return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  }
}

export function enabledProviders(env: Env): AuthProviders {
  return {
    google: providerConfigured(env, "google"),
    apple: providerConfigured(env, "apple"),
    facebook: providerConfigured(env, "facebook"),
  };
}
