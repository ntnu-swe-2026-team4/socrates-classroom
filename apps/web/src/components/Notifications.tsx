import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { api, ApiError } from "@/api";
import { accountNotificationsOptions, notificationsOptions } from "@/api/queries";
import { Button, Card, Field, Input, Spinner, TrapDialog, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

export function NotificationComposer() {
  const t = useT();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: () => api.postAdminNotification({ title: title.trim(), body: body.trim() }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await queryClient.invalidateQueries({ queryKey: notificationsOptions.queryKey });
    },
  });
  return (
    <Card className="p-6">
      <h2 className="mb-1 font-serif text-lg">{t("notify_title")}</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">{t("notify_admin_desc")}</p>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!post.isPending && title.trim()) post.mutate();
        }}
      >
        <Field label={t("notify_field_title")}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} />
        </Field>
        <Field label={t("notify_field_body")}>
          <textarea
            value={body}
            rows={3}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={post.isPending || !title.trim()}>
            {post.isPending ? <Spinner /> : null}
            {t("notify_send")}
          </Button>
          {post.isError && (
            <p role="alert" className="text-[13px] text-flag">
              {post.error instanceof ApiError ? post.error.message : t("common_error")}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

export function NotificationBell({ userId, className }: { userId: string; className: string }) {
  const t = useT();
  const formatDate = useFormatDate();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const options = accountNotificationsOptions(userId);
  const feed = useQuery(options);
  const unread = feed.data?.unread ?? 0;
  const seen = useMutation({
    mutationFn: async () => {
      const current = feed.data ?? (await queryClient.fetchQuery(options));
      if ((current.unread ?? 0) > 0) {
        await api.markNotificationsSeen();
        await queryClient.invalidateQueries({ queryKey: options.queryKey });
      }
    },
  });

  return (
    <>
      <button
        type="button"
        aria-label={unread > 0 ? t("notify_bell_unread", { n: unread }) : t("notify_bell")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("notify_bell")}
        className={cn("relative", className)}
        onClick={() => {
          setOpen(true);
          if (!seen.isPending) seen.mutate();
        }}
      >
        <Bell className="size-[17px]" aria-hidden />
        {unread > 0 && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-ember" />}
      </button>
      {open &&
        createPortal(
          <TrapDialog
            ariaLabelledBy={titleId}
            plain
            className="anim-rise absolute bottom-3 left-3 max-h-[min(70dvh,460px)] w-[calc(100%-1.5rem)] max-w-[340px] overflow-y-auto rounded-xl border border-line-strong bg-paper text-ink shadow-xl md:left-24"
            onClose={() => setOpen(false)}
          >
            <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-paper px-4 py-2">
              <h2 id={titleId} className="font-serif text-[15px]">
                {t("notify_title")}
              </h2>
              <button
                type="button"
                aria-label={t("notify_close")}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-vermilion"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div aria-busy={feed.isPending}>
              {feed.isPending && (
                <div className="flex justify-center p-4">
                  <Spinner />
                </div>
              )}
              {feed.data && feed.data.items.length > 0 && (
                <ul>
                  {feed.data.items.map((item) => (
                    <li key={item.id} className="border-b border-line px-4 py-3 wrap-anywhere last:border-b-0">
                      <p className="text-[13.5px] font-medium">{item.title}</p>
                      {item.body && (
                        <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                          {item.body}
                        </p>
                      )}
                      <time dateTime={item.createdAt} className="mt-1.5 block text-[11.5px] text-ink-faint">
                        {formatDate(item.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              {feed.isSuccess && feed.data.items.length === 0 && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-faint">{t("notify_empty")}</p>
              )}
            </div>
            {(feed.isError || seen.isError) && (
              <p role="alert" className="px-4 py-3 text-center text-[13px] text-flag">
                {t("common_error")}
              </p>
            )}
          </TrapDialog>,
          document.body,
        )}
    </>
  );
}
