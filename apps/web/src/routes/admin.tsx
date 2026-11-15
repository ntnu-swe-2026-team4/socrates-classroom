import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/api";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    const isAdmin = await context.queryClient.fetchQuery({
      queryKey: ["admin-session", me?.id],
      queryFn: () => api.adminSession(),
      staleTime: 60_000,
    });
    if (!isAdmin) throw redirect({ to: "/classrooms" });
  },
  component: Outlet,
});
