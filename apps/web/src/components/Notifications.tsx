import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Trash2 } from "lucide-react";
import type { NotificationFeed } from "@socrates/shared";
import { api } from "@/api";
import { Button, Card, Field, Input, Spinner, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

const FEED_KEY = ["notifications"];
const REFRESH_MS = 5 * 60 * 1000;

export function NotificationBell({ className, side = "below" }: { className?: string; side?: "below" | "beside" }) {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const feed = useQuery({ queryKey: FEED_KEY, queryFn: () => api.notifications(), refetchInterval: REFRESH_MS });
  const seen = useMutation({
    mutationFn: () => api.markNotificationsSeen(),
    onSuccess: () =>
      queryClient.setQueryData<NotificationFeed>(FEED_KEY, (current) => current && { ...current, unread: 0 }),
  });
  const unread = feed.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!open && unread > 0 && !seen.isPending) seen.mutate();
    setOpen(!open);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? t("notify_bell_unread", { n: unread }) : t("notify_bell")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("notify_bell")}
        className={cn(
          "relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-ember hover:text-ember",
          className,
        )}
      >
        <Bell className="size-[17px]" aria-hidden />
        {unread > 0 && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-ember" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("notify_title")}
          className={cn(
            "anim-rise absolute z-[60] flex max-h-[min(70vh,460px)] w-[min(86vw,340px)] flex-col overflow-hidden rounded-xl border border-line-strong bg-paper shadow-xl",
            side === "beside" ? "bottom-0 left-full ml-3" : "top-full right-0 mt-2",
          )}
        >
          <p className="shrink-0 border-b border-line px-4 py-3 font-serif text-[15px] text-ink">{t("notify_title")}</p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {feed.data?.items.map((item) => (
              <li key={item.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <p className="text-[13.5px] font-medium text-ink">{item.title}</p>
                {item.body && (
                  <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{item.body}</p>
                )}
                <p className="mt-1.5 text-[11.5px] text-ink-faint">{formatDate(item.createdAt)}</p>
              </li>
            ))}
            {feed.isSuccess && feed.data.items.length === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-ink-faint">{t("notify_empty")}</li>
            )}
            {feed.isError && <li className="px-4 py-8 text-center text-[13px] text-flag">{t("common_error")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NotificationBoard({ className }: { className?: string }) {
  const t = useT();
  const formatDate = useFormatDate();
  const feed = useQuery({ queryKey: FEED_KEY, queryFn: () => api.notifications() });
  return (
    <section
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-paper p-5",
        className,
      )}
    >
      <img
        src="/greek/hero.webp"
        alt=""
        decoding="async"
        className="pointer-events-none absolute right-0 bottom-0 w-[78%] max-w-[380px] opacity-90 [[data-theme=dark]_&]:opacity-70"
      />
      <h2 className="relative shrink-0 text-[22px] leading-snug font-semibold text-ink">{t("notify_board")}</h2>
      <ul className="relative mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-28">
        {feed.data?.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-line bg-paper px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[13.5px] font-semibold text-ink">{item.title}</p>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{formatDate(item.createdAt)}</span>
            </div>
            {item.body && (
              <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                {item.body}
              </p>
            )}
          </li>
        ))}
        {feed.isSuccess && feed.data.items.length === 0 && (
          <li className="py-6 text-[13px] text-ink-faint">{t("notify_empty")}</li>
        )}
      </ul>
    </section>
  );
}

export function NotificationComposer() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const feed = useQuery({ queryKey: FEED_KEY, queryFn: () => api.notifications() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: FEED_KEY });
  const send = useMutation({
    mutationFn: () => api.sendNotification({ title: title.trim(), body: body.trim() }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteNotification(id), onSettled: refresh });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <p className="font-serif text-[15.5px] text-ink">{t("notify_title")}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">{t("notify_admin_desc")}</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !send.isPending) send.mutate();
        }}
      >
        <Field label={t("notify_field_title")}>
          <Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label={t("notify_field_body")}>
          <textarea
            value={body}
            rows={3}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            className="w-full resize-y rounded-xl border border-line-strong bg-paper px-4 py-2 text-sm text-ink outline-none focus:border-ink"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!title.trim() || send.isPending}>
            {send.isPending ? <Spinner /> : null}
            {t("notify_send")}
          </Button>
          {send.isError && <span className="text-[12.5px] text-flag">{t("common_error")}</span>}
        </div>
      </form>
      <ul className="flex flex-col">
        {feed.data?.items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 border-t border-line py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-ink">{item.title}</p>
              <p className="text-[11.5px] text-ink-faint">{formatDate(item.createdAt)}</p>
            </div>
            <button
              type="button"
              aria-label={t("notify_delete", { title: item.title })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id)}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft hover:bg-flag-wash hover:text-flag disabled:opacity-50"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
