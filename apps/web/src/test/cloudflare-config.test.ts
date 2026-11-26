import { describe, expect, it } from "vitest";
import cfConfig from "../../cloudflare.config";

const workerOwnedPrefixes = ["/api/*", "/agents/*", "/health"] as const;

describe("cloudflare config shape", () => {
  it("runs the worker first for every worker-owned path prefix", () => {
    const { assets } = cfConfig({ isPreview: false, mode: "production" }).worker;
    expect(assets?.notFoundHandling).toBe("single-page-application");
    expect(Array.isArray(assets?.runWorkerFirst)).toBe(true);
    for (const prefix of workerOwnedPrefixes) {
      expect(assets?.runWorkerFirst).toContain(prefix);
    }
  });
});
