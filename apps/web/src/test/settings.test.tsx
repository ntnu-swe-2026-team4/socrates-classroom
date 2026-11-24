import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";
import { companion, getCompanion } from "@/lib/companion";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ProviderKeys", () => ({
  ProviderKeys: () => (
    <div data-testid="provider-keys">
      <h2>API keys (bring your own)</h2>
    </div>
  ),
}));

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/me") {
        return new Response(
          JSON.stringify({
            id: "teacher-1",
            name: "Teacher",
            canManageClasses: true,
            isAdmin: false,
            emailVerified: true,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  companion.setVisible(true);
  companion.setMuted(false);
  companion.setVolume(0.8);
  companion.setVoiceStyle("elder");
});

async function mountRoute(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client },
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return () => {
    cleanup();
    client.clear();
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function stubRoutes(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const route = routes[path];
      if (route) return route();
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
}

const teacher = () => json({ id: "teacher-1", name: "Teacher", isAdmin: false, emailVerified: false });
const providers = () => json({ providers: ["google"] });

test("settings shows the three section tabs and defaults to the general language card", async () => {
  const dispose = await mountRoute("/settings");
  try {
    expect(await screen.findByRole("button", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dialogue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "API keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.queryByTestId("provider-keys")).toBeNull();
    expect(screen.queryByText("Socrates 3D model")).toBeNull();
  } finally {
    dispose();
  }
});

test("section nav buttons carry the design-system focus ring", async () => {
  const dispose = await mountRoute("/settings");
  try {
    for (const name of ["General", "Dialogue", "API keys"]) {
      expect(screen.getByRole("button", { name }).className).toContain("focus-visible:outline-ember");
    }
  } finally {
    dispose();
  }
});

test("switching to the dialogue tab swaps the panel and marks the tab current", async () => {
  const dispose = await mountRoute("/settings");
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Dialogue" }));
    expect(await screen.findByText("Socrates 3D model")).toBeTruthy();
    expect(screen.getByText("Voice playback")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dialogue" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByText("Language")).toBeNull();
  } finally {
    dispose();
  }
});

test("the dialogue panel wires the model and voice controls to the companion store", async () => {
  const dispose = await mountRoute("/settings?section=dialogue");
  try {
    const modelSwitch = await screen.findByRole("switch", { name: "Use the 3D model" });
    expect(modelSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(modelSwitch);
    expect(getCompanion().visible).toBe(false);
    expect(screen.getByRole("switch", { name: "Use the 3D model" }).getAttribute("aria-checked")).toBe("false");

    const voiceSwitch = screen.getByRole("switch", { name: "Read Socrates’ replies aloud" });
    expect(voiceSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(voiceSwitch);
    expect(getCompanion().muted).toBe(true);
    expect(screen.getByRole("switch", { name: "Read Socrates’ replies aloud" }).getAttribute("aria-checked")).toBe(
      "false",
    );

    const volume = screen.getByRole("slider", { name: "Volume" });
    expect(volume).toHaveProperty("value", "80");
    fireEvent.change(volume, { target: { value: "30" } });
    expect(getCompanion().volume).toBeCloseTo(0.3);

    fireEvent.click(screen.getByRole("tab", { name: "Original" }));
    expect(getCompanion().voiceStyle).toBe("natural");
  } finally {
    dispose();
  }
});

test("switching to the keys tab mounts the provider keys panel", async () => {
  const dispose = await mountRoute("/settings");
  try {
    fireEvent.click(await screen.findByRole("button", { name: "API keys" }));
    expect(await screen.findByTestId("provider-keys")).toBeTruthy();
    expect(screen.getByRole("button", { name: "API keys" }).getAttribute("aria-current")).toBe("page");
  } finally {
    dispose();
  }
});

test("the keys panel does not duplicate the provider keys heading", async () => {
  const dispose = await mountRoute("/settings?section=keys");
  try {
    await screen.findByTestId("provider-keys");
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["API keys (bring your own)"]);
  } finally {
    dispose();
  }
});

test("account section lists sign-in methods and gates changes behind re-auth", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () =>
      json({
        email: { email: "teacher@example.com", verified: false },
        oauth: [{ provider: "google", email: "teacher@gmail.com", linkedAt: "2026-11-20T00:00:00.000Z" }],
        reauthExpiresAt: null,
      }),
  });
  const dispose = await mountRoute("/settings?section=account");
  try {
    expect(await screen.findByText("Email and password")).toBeTruthy();
    expect(screen.getByText("teacher@example.com")).toBeTruthy();
    expect(screen.getByText("teacher@gmail.com")).toBeTruthy();
    expect(screen.getByText("Confirm your identity")).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: "Remove" })) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  } finally {
    dispose();
  }
});

test("account section disables the one unconfigured provider and notes the last method", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () => json({ email: null, oauth: [], reauthExpiresAt: null }),
  });
  const dispose = await mountRoute("/settings?section=account");
  try {
    const linkButtons = await screen.findAllByRole("button", { name: "Link" });
    expect(linkButtons).toHaveLength(2);
    expect(linkButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText(/at least one must remain/)).toBeTruthy();
  } finally {
    dispose();
  }
});

test("a reauth redirect notice is announced on the account section", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () => json({ email: null, oauth: [], reauthExpiresAt: null }),
  });
  const dispose = await mountRoute("/settings?section=account&reauth=ok");
  try {
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Identity confirmed. You can change sign-in methods now.",
    );
  } finally {
    dispose();
  }
});
