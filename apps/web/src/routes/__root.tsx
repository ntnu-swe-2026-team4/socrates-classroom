import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { AppShell } from "@/components/AppShell";
import { safeNext } from "@/lib/safeNext";

const PUBLIC_PATHS = new Set(["/", "/login"]);

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({
      queryKey: ["me"],
      queryFn: () => api.me(),
      staleTime: Infinity,
    });
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (PUBLIC_PATHS.has(path)) {
      if (me) {
        const next = safeNext((location.search as { next?: unknown }).next);
        throw redirect({ href: next ?? "/home" });
      }
      return;
    }
    if (!me) throw redirect({ to: "/login", search: { next: location.href } });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
