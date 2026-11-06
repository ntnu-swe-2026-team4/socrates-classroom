import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { MessageKey } from "@/i18n";

export const SUGGESTION_KEYS: MessageKey[] = ["suggest_1", "suggest_2", "suggest_3"];

export const chatTitleOf = (text: string) => {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
};

export function useStartChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.createSoloChat(chatTitleOf(text)),
    onSuccess: async (chat, text) => {
      await queryClient.invalidateQueries({ queryKey: ["soloChats"] });
      await navigate({ to: "/chat/$chatId", params: { chatId: chat.id }, search: { q: text.trim() } });
    },
  });
}
