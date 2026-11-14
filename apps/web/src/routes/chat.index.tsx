import { createFileRoute } from "@tanstack/react-router";
import { SidebarToggle } from "@/components/ChatLayout";
import { StartChat } from "@/components/StartChat";
import { Motif } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/chat/")({
  component: NewChatPage,
});

function NewChatPage() {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-3 pl-14 md:pl-2">
        <SidebarToggle />
        <h1 className="truncate pl-1 text-[14.5px] font-medium text-ink">{t("chat_new")}</h1>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-2xl">
          <Motif name="owl" className="mb-3 h-12 text-ochre" />
          <p className="text-[12.5px] text-ember">{t("dlg_socrates")}</p>
          <h2 className="mt-1 mb-4 font-serif text-[28px] leading-snug text-ink">{t("home_question")}</h2>
          <StartChat autoFocus />
        </div>
      </div>
    </div>
  );
}
