import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { useT } from "@/i18n";

function RouteProblem({ kind }: { kind: "error" | "notFound" }) {
  const t = useT();
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 text-center">
      <p className="font-serif text-lg text-ink">{kind === "error" ? t("common_error") : t("common_not_found")}</p>
      <Link
        to="/"
        className="rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ember transition-colors hover:border-ember"
      >
        {t("common_back")}
      </Link>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  errorComponent: () => <RouteProblem kind="error" />,
  notFoundComponent: () => <RouteProblem kind="notFound" />,
});
