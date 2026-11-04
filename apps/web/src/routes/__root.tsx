import { createRootRouteWithContext, Link, Outlet, useLocation } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { LocaleSwitch, Wordmark } from "@/components/ui";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: AppShell,
});

function AppShell() {
  const pathname = useLocation({ select: (state) => state.pathname });
  const bare = pathname === "/dialogue";
  return (
    <div className="flex min-h-full flex-col bg-paper">
      {!bare && (
        <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
            <Link to="/" aria-label="home">
              <Wordmark sub />
            </Link>
            <LocaleSwitch />
          </div>
        </header>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
