import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  History,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Square,
  SquarePen,
  TextSearch,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api, type SoloChat } from "@/api";
import { SocratesStage, type SocratesHandle } from "@/components/SocratesStage";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { cn } from "@/components/ui";
import { useDialogue, type DialoguePhase } from "@/hooks/useDialogue";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { SUGGESTION_KEYS, useStartChat } from "@/hooks/useStartChat";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useT, type MessageKey, type Translate } from "@/i18n";

type PanelTab = "history" | "socrates";
const PANEL_KEY = "socrates_chat_panel";
const DESKTOP_QUERY = "(min-width: 768px)";

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

function statusOf(phase: DialoguePhase, t: Translate): string {
  if (phase === "thinking" || phase === "streaming") return t("dlg_thinking");
  if (phase === "speaking") return t("dlg_speaking");
  return "";
}
const NO_HISTORY: never[] = [];
const onAmplitudeNoop = () => {};

const VOICE_ERROR_KEY: Record<"denied" | "unsupported" | "failed", MessageKey> = {
  denied: "voice_denied",
  unsupported: "voice_unsupported",
  failed: "voice_failed",
};

function readPanelTab(): PanelTab {
  try {
    return localStorage.getItem(PANEL_KEY) === "socrates" ? "socrates" : "history";
  } catch {
    return "history";
  }
}

export interface ChatWorkspaceProps {
  chatId?: string;
  autoSend?: string;
  onAutoSent?: () => void;
  openTerm?: string;
  onTermOpened?: () => void;
}

export function ChatWorkspace({ chatId, autoSend, onAutoSent, openTerm, onTermOpened }: ChatWorkspaceProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [tab, setTabState] = useState<PanelTab>(readPanelTab);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const termRef = useRef<TermPanelHandle>(null);
  const stageRef = useRef<SocratesHandle>(null);
  const miniRef = useRef<SocratesHandle>(null);
  const desktop = useIsDesktop();
  const [collapsed, setCollapsed] = usePersistentFlag("socrates_chat_collapsed", false);

  const chat = useQuery({
    queryKey: ["soloChat", chatId],
    queryFn: () => api.soloChat(chatId!),
    enabled: Boolean(chatId),
  });
  const history = useQuery({
    queryKey: ["soloHistory", chatId],
    queryFn: () => api.soloHistory(chatId!),
    enabled: Boolean(chatId),
  });
  const { messages, draft, phase, error, send, retryLast, interrupt } = useDialogue(
    chatId ?? "",
    history.data ?? NO_HISTORY,
    { solo: true },
  );
  const start = useStartChat();

  function setTab(next: PanelTab) {
    setTabState(next);
    try {
      localStorage.setItem(PANEL_KEY, next);
    } catch {}
  }

  useEffect(() => {
    for (const stage of [stageRef.current, miniRef.current]) {
      if (phase === "thinking") stage?.setExpression("Confused", { loop: true });
      else stage?.setExpression(null);
    }
  }, [phase]);

  const autoSent = useRef(false);
  useEffect(() => {
    if (chatId && autoSend && !autoSent.current && phase === "idle" && !history.isPending) {
      autoSent.current = true;
      void send(autoSend).then(() => queryClient.invalidateQueries({ queryKey: ["soloChats"] }));
      onAutoSent?.();
    }
  }, [chatId, autoSend, phase, history.isPending, send, onAutoSent, queryClient]);

  const termHandled = useRef(false);
  useEffect(() => {
    if (openTerm && !termHandled.current) {
      termHandled.current = true;
      setTermOpen(true);
      termRef.current?.openTerm(openTerm);
      onTermOpened?.();
    }
  }, [openTerm, onTermOpened]);

  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value) return false;
      if (!chatId) {
        if (start.isPending) return false;
        start.mutate(value);
        return true;
      }
      if (phase !== "idle") return false;
      void send(value).then(() => queryClient.invalidateQueries({ queryKey: ["soloChats"] }));
      return true;
    },
    [chatId, phase, send, start, queryClient],
  );

  const busy = phase !== "idle" || start.isPending;
  const empty = !chatId || (messages.length === 0 && !draft && phase === "idle" && !autoSend && !history.isPending);
  const title = chatId ? (chat.data?.title ?? "") : t("chat_new_button");

  const panelBody =
    tab === "history" ? (
      <HistoryList activeChatId={chatId} onNavigate={() => setDrawerOpen(false)} />
    ) : (
      <SocratesPane phase={phase} stageRef={stageRef} />
    );

  return (
    <div className="flex h-dvh min-h-0">
      {!collapsed && (
        <aside className="hidden w-[300px] shrink-0 flex-col border-r border-line bg-card md:flex lg:w-[320px]">
          <PanelHeader
            tab={tab}
            onTab={setTab}
            onNavigate={() => setDrawerOpen(false)}
            onCollapse={() => setCollapsed(true)}
          />
          {panelBody}
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-[88px] shrink-0 items-center gap-2 pr-4 pl-16 md:h-14",
            collapsed ? "md:pl-3" : "md:pl-6",
          )}
        >
          {collapsed && (
            <span className="hidden items-center gap-0.5 md:flex">
              <IconButton label={t("panel_expand")} onClick={() => setCollapsed(false)}>
                <PanelLeftOpen className="size-[18px]" />
              </IconButton>
              <Link
                to="/chat"
                aria-label={t("chat_new_button")}
                title={t("chat_new_button")}
                className="flex size-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
              >
                <SquarePen className="size-[18px]" />
              </Link>
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-medium text-ink">{title || t("dlg_title")}</h1>
            <p className="truncate text-[11.5px] text-ink-faint md:hidden">{t("chat_eyebrow")}</p>
          </div>
          <IconButton label={t("chat_history")} className="md:hidden" onClick={() => setDrawerOpen(true)}>
            <History className="size-[18px]" />
          </IconButton>
          <IconButton label={t("term_panel")} active={termOpen} onClick={() => setTermOpen((v) => !v)}>
            <TextSearch className="size-[18px]" />
          </IconButton>
        </header>

        {!desktop && !drawerOpen && (
          <MobileSocrates
            stageRef={miniRef}
            phase={phase}
            onOpen={() => {
              setTab("socrates");
              setDrawerOpen(true);
            }}
          />
        )}

        <div className="flex min-h-0 flex-1">
          <Conversation
            t={t}
            chatTitle={chat.data?.title}
            empty={empty}
            messages={messages}
            draft={draft}
            phase={phase}
            busy={busy}
            error={Boolean(error) || start.isError}
            onRetry={retryLast}
            onInterrupt={interrupt}
            onSubmit={submit}
            onLookup={(text) => {
              setTermOpen(true);
              termRef.current?.openTerm(text);
            }}
          />
          <TermPanel ref={termRef} open={termOpen} onClose={() => setTermOpen(false)} />
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-line bg-card">
            <PanelHeader
              tab={tab}
              onTab={setTab}
              onNavigate={() => setDrawerOpen(false)}
              onClose={() => setDrawerOpen(false)}
            />
            {panelBody}
          </aside>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  active,
  className,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors",
        active ? "bg-ember-wash text-ember" : "text-ink-soft hover:bg-paper-deep hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

function PanelHeader({
  tab,
  onTab,
  onNavigate,
  onClose,
  onCollapse,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onNavigate: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-topbar shrink-0 flex-col justify-center gap-2.5 border-b border-line px-3">
      <div className="flex items-center justify-between gap-2 pl-1">
        <span className="font-serif text-[17px] text-ink">{t("nav_chat")}</span>
        <span className="flex items-center gap-0.5">
          <Link
            to="/chat"
            onClick={onNavigate}
            aria-label={t("chat_new_button")}
            title={t("chat_new_button")}
            className="flex size-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            <SquarePen className="size-[18px]" />
          </Link>
          {onCollapse && (
            <IconButton label={t("panel_collapse")} onClick={onCollapse}>
              <PanelLeftClose className="size-[18px]" />
            </IconButton>
          )}
          {onClose && (
            <IconButton label={t("common_back")} onClick={onClose}>
              <X className="size-[18px]" />
            </IconButton>
          )}
        </span>
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-paper-deep p-1">
        {(["history", "socrates"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => onTab(value)}
            className={cn(
              "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[12.5px] transition-colors",
              tab === value ? "bg-card font-medium text-ink shadow-sm" : "text-ink-faint hover:text-ink-soft",
            )}
          >
            {value === "history" ? <History className="size-3.5" /> : <UserRound className="size-3.5" />}
            {value === "history" ? t("chat_history") : t("dlg_socrates")}
          </button>
        ))}
      </div>
    </div>
  );
}

function SocratesPane({ phase, stageRef }: { phase: DialoguePhase; stageRef: React.RefObject<SocratesHandle | null> }) {
  const t = useT();
  const status = statusOf(phase, t);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-8">
      <div className="relative aspect-square w-full max-w-[280px]">
        <SocratesStage ref={stageRef} speaking={phase === "speaking"} className="absolute inset-0" />
      </div>
      <div className="text-center">
        <p className="font-serif text-[15px] text-ink">{t("dlg_socrates")}</p>
        <p className="mt-1 min-h-5 text-[12.5px] text-ink-faint">
          {status ? <span className="state-shimmer">{status}</span> : t("dlg_opening_hint")}
        </p>
      </div>
    </div>
  );
}

function MobileSocrates({
  stageRef,
  phase,
  onOpen,
}: {
  stageRef: React.RefObject<SocratesHandle | null>;
  phase: DialoguePhase;
  onOpen: () => void;
}) {
  const t = useT();
  const status = statusOf(phase, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full shrink-0 cursor-pointer items-center gap-3 border-b border-line bg-card px-4 py-2 text-left"
    >
      <span className="relative size-14 shrink-0">
        <SocratesStage ref={stageRef} speaking={phase === "speaking"} mini hideStatus className="absolute inset-0" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block font-serif text-[14px] font-medium text-ink">{t("dlg_socrates")}</b>
        <span className="block truncate text-[12px] text-ink-faint">
          {status ? <span className="state-shimmer">{status}</span> : t("chat_disclaimer")}
        </span>
      </span>
    </button>
  );
}

function groupOf(updatedAt: string): MessageKey {
  const day = 864e5;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const at = new Date(updatedAt).getTime();
  if (at >= startOfToday.getTime()) return "chat_today";
  if (at >= startOfToday.getTime() - day) return "chat_yesterday";
  if (at >= startOfToday.getTime() - 6 * day) return "chat_week";
  return "chat_older";
}

function HistoryList({ activeChatId, onNavigate }: { activeChatId?: string; onNavigate: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const chats = useQuery({ queryKey: ["soloChats"], queryFn: () => api.listSoloChats() });
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSoloChat(id),
    onSuccess: async (_data, id) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ["soloChats"] });
      if (id === activeChatId) await navigate({ to: "/chat" });
    },
  });

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = (chats.data ?? []).filter(
      (chat) => !kw || `${chat.title} ${chat.lastText ?? ""}`.toLowerCase().includes(kw),
    );
    const order: MessageKey[] = ["chat_today", "chat_yesterday", "chat_week", "chat_older"];
    return order
      .map((key) => ({ key, items: list.filter((chat) => groupOf(chat.updatedAt) === key) }))
      .filter((group) => group.items.length > 0);
  }, [chats.data, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            aria-label={t("chat_search")}
            placeholder={t("chat_search")}
            className="h-9 w-full rounded-xl border border-transparent bg-paper-deep pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-ember"
          />
        </div>
      </div>
      <nav aria-label={t("chat_history")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.key} className="mb-3">
            <p className="px-3 pt-2 pb-1 text-[11.5px] text-ink-faint">{t(group.key)}</p>
            {group.items.map((chat) => (
              <HistoryItem
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId}
                confirming={confirming === chat.id}
                onConfirm={() => setConfirming(chat.id)}
                onCancel={() => setConfirming(null)}
                onDelete={() => remove.mutate(chat.id)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
        {!chats.isPending && groups.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-ink-faint">{q ? t("search_none") : t("home_no_chats")}</p>
        )}
      </nav>
    </div>
  );
}

function HistoryItem({
  chat,
  active,
  confirming,
  onConfirm,
  onCancel,
  onDelete,
  onNavigate,
}: {
  chat: SoloChat;
  active: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-xl transition-colors",
        active ? "bg-ember-wash" : "hover:bg-paper-deep",
      )}
    >
      <Link
        to="/chat/$chatId"
        params={{ chatId: chat.id }}
        onClick={onNavigate}
        title={chat.title}
        className={cn("min-w-0 flex-1 truncate px-3 py-2 text-[13.5px]", active ? "text-ink" : "text-ink-soft")}
      >
        {chat.title}
      </Link>
      {confirming ? (
        <span className="mr-1 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="cursor-pointer rounded-full bg-flag-wash px-2.5 py-1 text-[11.5px] font-medium text-flag"
          >
            {t("chat_delete_confirm")}
          </button>
          <button
            type="button"
            aria-label={t("common_back")}
            onClick={onCancel}
            className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label={t("chat_delete")}
          title={t("chat_delete")}
          onClick={onConfirm}
          className="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-flag focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Conversation({
  t,
  chatTitle,
  empty,
  messages,
  draft,
  phase,
  busy,
  error,
  onRetry,
  onInterrupt,
  onSubmit,
  onLookup,
}: {
  t: Translate;
  chatTitle?: string;
  empty: boolean;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  draft: string;
  phase: DialoguePhase;
  busy: boolean;
  error: boolean;
  onRetry: () => void;
  onInterrupt: () => void;
  onSubmit: (text: string) => boolean;
  onLookup: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const { selection, clear } = useSelectionPopover(scrollRef);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  });

  const composer = (
    <Composer
      t={t}
      busy={busy}
      phase={phase}
      onSubmit={onSubmit}
      onInterrupt={onInterrupt}
      autoFocusKey={empty ? "empty" : "chat"}
    />
  );

  if (empty) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-line-strong bg-paper-deep font-serif text-lg text-ember">
              {t("bubble_socrates")}
            </span>
            <h2 className="font-serif text-2xl leading-snug sm:text-3xl">{chatTitle || t("home_question")}</h2>
          </div>
          {composer}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTION_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => onSubmit(t(key))}
                className="cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-ember hover:text-ink disabled:opacity-50"
              >
                {t(key)}
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-center text-[12.5px] text-flag">{t("common_error")}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (element) pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="stream-scroll min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
        aria-busy={busy}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 py-8">
          {messages.map((message) => (
            <Turn key={message.id} author={message.role} text={message.text} t={t} />
          ))}
          {phase === "thinking" && !draft && (
            <div className="flex gap-4">
              <Avatar t={t} />
              <span className="state-shimmer pt-1 text-[14px]">{t("dlg_thinking")}</span>
            </div>
          )}
          {draft && <Turn author="assistant" text={draft} caret={phase === "streaming"} t={t} />}
        </div>
      </div>

      {selection && (
        <button
          type="button"
          onClick={() => {
            onLookup(selection.text);
            clear();
          }}
          className="fixed z-50 -translate-x-1/2 -translate-y-full cursor-pointer rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-paper shadow-sm"
          style={{ left: selection.x, top: selection.y - 8 }}
        >
          {t("term_lookup")}「<span className="inline-block max-w-52 truncate align-middle">{selection.text}</span>」
        </button>
      )}

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2 text-[13px] text-ink-soft">
              <span className="min-w-0 flex-1 truncate">{t("dlg_error")}</span>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ember transition-colors hover:border-ember"
              >
                {t("dlg_retry")}
              </button>
            </div>
          )}
          {composer}
          <p className="mt-2 text-center text-[11.5px] text-ink-faint">{t("chat_disclaimer")}</p>
        </div>
      </div>
    </section>
  );
}

function Avatar({ t }: { t: Translate }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-deep font-serif text-sm text-ember">
      {t("bubble_socrates")}
    </span>
  );
}

function Turn({
  author,
  text,
  caret,
  t,
}: {
  author: "user" | "assistant";
  text: string;
  caret?: boolean;
  t: Translate;
}) {
  if (author === "user") {
    return (
      <div className="anim-rise flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-paper-deep px-5 py-3 text-[15px] leading-7 text-ink">
          {text}
        </p>
      </div>
    );
  }
  return (
    <div className="anim-rise flex gap-4">
      <Avatar t={t} />
      <p
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap pt-0.5 font-serif text-[15.5px] leading-8 text-ink",
          caret && "caret",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function Composer({
  t,
  busy,
  phase,
  onSubmit,
  onInterrupt,
  autoFocusKey,
}: {
  t: Translate;
  busy: boolean;
  phase: DialoguePhase;
  onSubmit: (text: string) => boolean;
  onInterrupt: () => void;
  autoFocusKey: string;
}) {
  const [text, setText] = useState("");
  const desktop = useIsDesktop();
  const area = useRef<HTMLTextAreaElement>(null);
  const onVoiceFinal = useCallback((heard: string) => void onSubmit(heard), [onSubmit]);
  const voice = useVoiceInput(onVoiceFinal, onAmplitudeNoop);
  const streaming = phase !== "idle";

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the composer moves between the empty state and the docked bar
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, [autoFocusKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize the textarea whenever its content changes
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [text]);

  function submit() {
    if (onSubmit(text)) setText("");
  }

  return (
    <div className="rounded-3xl border border-line-strong bg-card p-2 shadow-sm transition-colors focus-within:border-ember-deep">
      {(voice.interim || voice.error) && (
        <p className={cn("truncate px-3 pt-1 text-[12.5px]", voice.error ? "text-flag" : "text-ink-faint")}>
          {voice.error ? t(VOICE_ERROR_KEY[voice.error]) : voice.interim}
        </p>
      )}
      <textarea
        ref={area}
        rows={1}
        value={text}
        aria-label={t("dlg_input_placeholder")}
        placeholder={desktop ? t("chat_composer_placeholder") : t("dlg_input_placeholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className="block max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <button
          type="button"
          aria-label={t("dlg_hold_to_talk")}
          title={t("dlg_hold_to_talk")}
          disabled={busy}
          onPointerDown={(event) => {
            event.preventDefault();
            void voice.start();
          }}
          onPointerUp={() => void voice.stop()}
          onPointerLeave={() => voice.state === "listening" && void voice.stop()}
          style={{ touchAction: "none" }}
          className={cn(
            "flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors disabled:opacity-50",
            voice.state === "listening" ? "bg-ember text-on-ember" : "text-ink-soft hover:bg-paper-deep hover:text-ink",
          )}
        >
          <Mic className="size-4" />
          {voice.state === "listening" ? t("dlg_listening") : t("dlg_hold_to_talk")}
        </button>
        {streaming ? (
          <button
            type="button"
            onClick={onInterrupt}
            aria-label={t("dlg_tap_to_interrupt")}
            title={t("dlg_tap_to_interrupt")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-ink text-paper"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || busy}
            aria-label={t("common_send")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-ember text-on-ember transition hover:brightness-110 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
