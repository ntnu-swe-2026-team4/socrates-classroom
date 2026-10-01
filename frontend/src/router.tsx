import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppShell } from "@/app/AppShell";
import { api } from "@/api";
import { keys } from "@/api/queries";
import { LandingPage } from "@/landing/LandingPage";
import { HomePage } from "@/pages/HomePage";
import { TopicsPage } from "@/pages/TopicsPage";
import { BankPage, ClassroomsPage, SummaryPage } from "@/pages/ListPages";
import { CLASSROOM_TABS, ClassroomPage, type ClassroomTab } from "@/pages/ClassroomPage";
import { ActivityPage } from "@/pages/ActivityPage";
import { DialoguePage } from "@/pages/DialoguePage";

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const login = createRoute({
  getParentRoute: () => root, path: "/login", component: LandingPage,
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData({ queryKey: keys.me, queryFn: () => api.me(), staleTime: Infinity })) throw redirect({ to: "/" });
  },
});

const app = createRoute({
  getParentRoute: () => root, id: "_app", component: AppShell,
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData({ queryKey: keys.me, queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
  },
});

const routeTree = root.addChildren([
  login,
  app.addChildren([
    createRoute({ getParentRoute: () => app, path: "/", component: HomePage }),
    createRoute({ getParentRoute: () => app, path: "/dialogue", component: DialoguePage, validateSearch: (s: Record<string, unknown>): { topic?: string } => ({ topic: typeof s.topic === "string" ? s.topic : undefined }) }),
    createRoute({ getParentRoute: () => app, path: "/topics", component: TopicsPage }),
    createRoute({ getParentRoute: () => app, path: "/summary", component: SummaryPage }),
    createRoute({ getParentRoute: () => app, path: "/bank/$kind", component: BankPage }),
    createRoute({ getParentRoute: () => app, path: "/classrooms", component: ClassroomsPage }),
    createRoute({ getParentRoute: () => app, path: "/classrooms/$classroomId", component: ClassroomPage, validateSearch: (s: Record<string, unknown>): { tab?: ClassroomTab } => ({ tab: CLASSROOM_TABS.find((t) => t === s.tab) }) }),
    createRoute({ getParentRoute: () => app, path: "/classrooms/$classroomId/activities/$activityId", component: ActivityPage }),
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient: undefined! } });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
