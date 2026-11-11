import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Ghost, UserRound } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Checkbox, Field, Initial, Input, PageHeader, Spinner } from "@/components/ui";
import { ApiError } from "@/api";
import { useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";

export const Route = createFileRoute("/join/$code")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code: rawCode } = Route.useParams();
  const code = normalizeJoinCode(rawCode);
  const { draft } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["join", code], queryFn: () => api.joinByCode(code) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const account = me.data && !me.data.preview ? me.data : null;
  const [asGuest, setAsGuest] = useState(false);
  const signedIn = Boolean(account);
  const loginHref = `/join/${code}`;

  useEffect(() => {
    fetch("/socrates.glb").catch(() => {});
  }, []);

  const topic = info.data?.topic;
  const ready = (signedIn || name.trim().length > 0) && tos && !submitting;

  async function start() {
    if (!topic) return;
    setSubmitting(true);
    setFailed(null);
    try {
      const { activityId, user } = await api.joinAsGuest(code, signedIn ? undefined : name.trim());
      queryClient.setQueryData(["me"], user);
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      if (draft) {
        await navigate({ to: "/dialogue", search: { activityId, q: draft } });
        return;
      }
      const activity = await api.activityInfo(activityId);
      await navigate({ to: "/classrooms/$classroomId", params: { classroomId: activity.classroomId } });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      setFailed(
        code === "name_taken"
          ? t("join_err_name_taken")
          : code === "activity_finished"
            ? t("join_err_finished")
            : code === "only_student"
              ? t("join_only_student")
              : t("join_failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-xl" eyebrow={t("hero_chip_join")} title={info.data?.classroomName ?? t("join_title")} />
      <div className="mx-auto w-full max-w-xl px-4 py-4 md:px-6">
        <Card className="p-4">
          {info.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : info.isError || !topic ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-[15px] text-ink-soft">
                {info.error instanceof ApiError && info.error.code === "rate_limited"
                  ? t("join_failed")
                  : info.error instanceof ApiError && info.error.code === "only_student"
                    ? t("join_only_student")
                    : t("join_invalid")}
              </p>
              <Button variant="outline" onClick={() => void navigate({ to: "/classrooms" })}>
                {t("common_back")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs tracking-wider text-ink-faint">{t("join_title")}</p>
                <h2 className="mt-1 font-serif text-2xl leading-snug">{topic.title}</h2>
                <p className="mt-4 border-l-2 border-ember-deep pl-4 font-serif text-[15px] leading-8 text-ink-soft">
                  {topic.summary ?? topic.statement}
                </p>
              </div>
              {failed && (
                <p role="alert" className="text-[13px] text-flag">
                  {failed}
                </p>
              )}
              {account ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
                  <Initial name={account.name} className="size-9 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-ink">{t("join_as", { name: account.name })}</p>
                    <p className="text-[12px] text-ink-faint">
                      {account.guest ? t("account_kind_guest") : t("join_with_account")}
                    </p>
                  </div>
                  <Link
                    to="/login"
                    search={{ next: loginHref }}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] text-ember hover:bg-ember-wash"
                  >
                    {account.guest ? t("join_use_account") : t("login_switch_account")}
                  </Link>
                </div>
              ) : !asGuest ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-ink-soft">{t("join_choose")}</p>
                  <Link
                    to="/login"
                    search={{ next: loginHref }}
                    className="flex items-center gap-3 rounded-xl border border-line-strong bg-paper px-3 py-3 transition-colors hover:border-ember"
                  >
                    <UserRound className="size-5 shrink-0 text-ember" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-ink">{t("join_option_account")}</span>
                      <span className="block text-[12px] text-ink-faint">{t("join_option_account_hint")}</span>
                    </span>
                    <ChevronRight className="size-4 text-ink-faint" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setAsGuest(true)}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-paper px-3 py-3 text-left transition-colors hover:border-ember"
                  >
                    <Ghost className="size-5 shrink-0 text-ink-soft" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-ink">{t("join_option_guest")}</span>
                      <span className="block text-[12px] text-ink-faint">{t("join_option_guest_hint")}</span>
                    </span>
                    <ChevronRight className="size-4 text-ink-faint" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAsGuest(false)}
                    className="flex cursor-pointer items-center gap-1 self-start text-[12.5px] text-ink-faint hover:text-ink"
                  >
                    <ArrowLeft className="size-3.5" />
                    {t("join_choose_again")}
                  </button>
                  <Field label={t("join_name_label")}>
                    <Input
                      value={name}
                      placeholder={t("join_name_placeholder")}
                      maxLength={24}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                </>
              )}
              {(account || asGuest) && (
                <>
                  <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
                  <Button size="lg" disabled={!ready} onClick={() => void start()}>
                    {submitting ? <Spinner /> : t("join_start")}
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
