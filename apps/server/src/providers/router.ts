import type { Env } from "../env";
import { availableProviders, isMockMode, type ProviderDescriptor } from "./catalog";

export type SettleKind = "ok" | "rate" | "timeout" | "error";

export interface Lease {
  provider: ProviderDescriptor;
}

export class ProviderRouter {
  constructor(private readonly env: Env) {}

  private stub(providerId: string) {
    return this.env.Coordinator.getByName(providerId);
  }

  async acquire(threadKey: string, homeProvider?: string): Promise<Lease> {
    const providers = availableProviders(this.env);
    if (providers.length === 0) throw new Error("llm_not_configured");
    if (isMockMode(this.env)) return { provider: providers[0]! };
    const ordered = [...providers].sort((a, b) => a.priority - b.priority);
    if (homeProvider) {
      const home = ordered.find((p) => p.id === homeProvider);
      if (home) {
        const outcome = await this.stub(home.id).lease(home.id, threadKey);
        if (outcome === "granted") return { provider: home };
      }
    }
    for (const provider of ordered) {
      const outcome = await this.stub(provider.id).lease(provider.id, threadKey);
      if (outcome === "granted") return { provider };
    }
    throw new Error("llm_not_configured");
  }

  async settle(lease: Lease, kind: SettleKind): Promise<void> {
    if (isMockMode(this.env)) return;
    await this.stub(lease.provider.id).settle(lease.provider.id, kind);
  }
}
