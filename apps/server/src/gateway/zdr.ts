/**
 * Models verified for zero data retention (0-day), from the official source
 * linked in docs/providers.md. Entries are `${provider}:${model}` pairs; adding
 * one is a PR-reviewed change with the verification note — the same review the
 * YAML chain used to carry, now in-band for admin BYOK legs. The seed entries
 * are the Workers AI text models the binding chain already serves under the
 * platform data-usage policy verified on 2026-11-08 (providers.md §4/§7.1);
 * the keyed REST variant is the same models, same policy, different transport.
 */
export const ZDR_ZERO_DAY_MODELS: ReadonlySet<string> = new Set([
  "cloudflare-workers-ai:@cf/zai-org/glm-5.3-flash",
  "cloudflare-workers-ai:@cf/zai-org/glm-4.7-flash",
]);

export function zdrBlockedModels(
  provider: string,
  models: readonly string[],
  whitelist: ReadonlySet<string> = ZDR_ZERO_DAY_MODELS,
): string[] {
  return models.filter((model) => !whitelist.has(`${provider}:${model}`));
}
