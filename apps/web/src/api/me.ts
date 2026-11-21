import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { User } from "@socrates/shared";

export const meQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: () => api.me(),
  staleTime: Infinity,
});

export async function meOf(queryClient: QueryClient): Promise<User | null> {
  return queryClient.fetchQuery(meQueryOptions).catch(() => null);
}
