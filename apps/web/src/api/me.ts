import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { User } from "@socrates/shared";

export async function meOf(queryClient: QueryClient): Promise<User | null> {
  return queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity }).catch(() => null);
}
