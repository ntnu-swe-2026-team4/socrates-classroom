import { createFileRoute, Navigate, Outlet, useChildMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: JoinRoute,
});

function JoinRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <Navigate to="/classrooms" replace />;
}
