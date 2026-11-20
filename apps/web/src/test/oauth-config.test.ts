import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vite", () => ({ loadEnv: () => ({}) }));

import config from "../../cloudflare.config";

describe("cloudflare.config google oauth bindings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("production with unset GOOGLE_CLIENT_ID declares no GOOGLE_CLIENT_SECRET", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    const { worker } = config({ mode: "production", isPreview: false });
    expect(worker.env.GOOGLE_CLIENT_ID).toMatchObject({ type: "text", value: "" });
    expect(worker.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it("production with GOOGLE_CLIENT_ID declares it with the required secret", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    const { worker } = config({ mode: "production", isPreview: false });
    expect(worker.env.GOOGLE_CLIENT_ID).toMatchObject({
      type: "text",
      value: "cid.apps.googleusercontent.com",
    });
    expect(worker.env.GOOGLE_CLIENT_SECRET).toMatchObject({ type: "secret" });
  });

  it("development with GOOGLE_CLIENT_ID keeps GOOGLE_CLIENT_SECRET optional text", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    const { worker } = config({ mode: "development", isPreview: false });
    expect(worker.env.GOOGLE_CLIENT_SECRET).toMatchObject({ type: "text" });
  });

  it("development with unset GOOGLE_CLIENT_ID declares no GOOGLE_CLIENT_SECRET", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    const { worker } = config({ mode: "development", isPreview: false });
    expect(worker.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });
});
