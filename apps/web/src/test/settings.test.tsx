import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function createAppRouter(client: QueryClient, url: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client },
  });
}

type AppRouter = ReturnType<typeof createAppRouter>;

interface RouteDispose {
  (): void;
  router: AppRouter;
}

async function mountRoute(url: string): Promise<RouteDispose> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client, url);
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const dispose: RouteDispose = () => {
    cleanup();
    client.clear();
  };
  dispose.router = router;
  return dispose;
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

test("an unverified email offers a resend and protects the last verified method", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () =>
      json({
        email: { email: "teacher@example.com", verified: false },
        oauth: [{ provider: "google", email: "teacher@gmail.com", linkedAt: "2026-11-20T00:00:00.000Z" }],
        reauthExpiresAt: "2026-11-25T12:00:00.000Z",
      }),
    "/api/auth/email/verify/resend": () => new Response(null, { status: 204 }),
  });
  const dispose = await mountRoute("/settings?section=account");
  try {
    const buttons = await screen.findAllByRole("button", { name: "Remove" });
    expect(buttons).toHaveLength(2);
    const [emailRemove, googleRemove] = buttons;
    expect(emailRemove?.hasAttribute("disabled")).toBe(false);
    expect(googleRemove?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findByRole("button", { name: "Resent" })).toBeTruthy();
  } finally {
    dispose();
  }
});

test("a verified email leaves every provider removable", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () =>
      json({
        email: { email: "teacher@example.com", verified: true },
        oauth: [{ provider: "google", email: "teacher@gmail.com", linkedAt: "2026-11-20T00:00:00.000Z" }],
        reauthExpiresAt: "2026-11-25T12:00:00.000Z",
      }),
  });
  const dispose = await mountRoute("/settings?section=account");
  try {
    for (const button of await screen.findAllByRole("button", { name: "Remove" })) {
      expect(button.hasAttribute("disabled")).toBe(false);
    }
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
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

test("a reauth redirect notice is announced once and dropped from the URL", async () => {
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
    expect(dispose.router.state.location.href).toBe("/settings?section=account");
    await dispose.router.navigate({ to: "/settings", search: {} });
    await dispose.router.navigate({ to: "/settings", search: { section: "account" } });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  } finally {
    dispose();
  }
});

test("an OAuth error notice routes the visitor to the account section", async () => {
  stubRoutes({
    "/api/me": teacher,
    "/api/auth/providers": providers,
    "/api/me/identities": () => json({ email: null, oauth: [], reauthExpiresAt: null }),
  });
  const dispose = await mountRoute("/settings?section=dialogue&error=identity_taken");
  try {
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(dispose.router.state.location.href).toBe("/settings?section=account");
    expect(screen.getByRole("button", { name: "Account" }).getAttribute("aria-current")).toBe("page");
  } finally {
    dispose();
  }
});
