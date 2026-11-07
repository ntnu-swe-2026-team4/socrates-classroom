import { createFileRoute } from "@tanstack/react-router";
import { ChatWorkspace } from "@/components/ChatWorkspace";

export const Route = createFileRoute("/chat/")({
  component: () => <ChatWorkspace />,
});
