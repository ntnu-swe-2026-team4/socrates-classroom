import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

export const keyableProviders = builtinProviders().filter((provider) => provider.auth.apiKey !== undefined);

export function keyableProvider(providerId: string) {
  return keyableProviders.find((provider) => provider.id === providerId);
}
