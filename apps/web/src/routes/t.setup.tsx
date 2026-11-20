import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActivityStarted } from "@socrates/shared";
import { api } from "@/api";
import { AddTopic, StartActivity, useClassroomTopics } from "@/components/ClassroomTopics";
import { Button, Card, Field, Input, PageHeader, SectionTitle, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { QrBlock, absoluteUrl } from "@/components/QrBlock";

export const Route = createFileRoute("/t/setup")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/classrooms" });
  },
  component: SetupPage,
});

function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [classroomName, setClassroomName] = useState("");
  const createClassroom = useMutation({
    mutationFn: () => api.createClassroom(classroomName.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
  const classroom = createClassroom.data ?? null;
  const topics = useClassroomTopics(classroom?.classroomId ?? null);
  const [started, setStarted] = useState<ActivityStarted | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!started) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl(started.url));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader eyebrow={t("eyebrow_teacher")} title={t("setup_title")} />
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="setup-class">
            <SectionTitle step={1}>
              <span id="setup-class">{t("setup_step_class")}</span>
            </SectionTitle>
            <Card className="p-5">
              {classroom ? (
                <p className="text-[13px] text-ink-soft">{t("setup_class_ready", { code: classroom.code })}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <Field label={t("setup_class_label")}>
                    <Input
                      value={classroomName}
                      placeholder={t("setup_class_placeholder")}
                      maxLength={80}
                      onChange={(event) => setClassroomName(event.target.value)}
                    />
                  </Field>
                  <Button
                    className="self-start"
                    disabled={!classroomName.trim() || createClassroom.isPending}
                    onClick={() => createClassroom.mutate()}
                  >
                    {createClassroom.isPending ? <Spinner /> : t("setup_create")}
                  </Button>
                </div>
              )}
              {createClassroom.isError && (
                <p role="alert" className="mt-3 text-[13px] text-flag">
                  {t("common_error")}
                </p>
              )}
            </Card>
          </section>

          <section aria-labelledby="setup-topics">
            <SectionTitle step={2}>
              <span id="setup-topics">{t("setup_step_topics")}</span>
            </SectionTitle>
            <Card className={cn("p-5", cnLocked(classroom === null))}>
              {classroom ? (
                <div className="flex flex-col gap-4">
                  {(topics.data ?? []).length === 0 ? (
                    <p className="text-[13px] text-ink-faint">{t("setup_topics_empty")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {(topics.data ?? []).map((topic) => (
                        <li key={topic.id} className="rounded-xl bg-paper-deep p-3">
                          <b className="block font-serif text-[15px] font-medium text-ink">{topic.title}</b>
                          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                            {topic.statement}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <AddTopic classroomId={classroom.classroomId} />
                </div>
              ) : (
                <p className="text-[13px] text-ink-faint">{t("setup_locked_hint")}</p>
              )}
            </Card>
          </section>

          <section aria-labelledby="setup-activity">
            <SectionTitle step={3}>
              <span id="setup-activity">{t("setup_step_activity")}</span>
            </SectionTitle>
            {classroom ? (
              <StartActivity classroomId={classroom.classroomId} allowTest={false} onStarted={setStarted} />
            ) : (
              <Card className="p-5">
                <p className="text-[13px] text-ink-faint">{t("setup_locked_hint")}</p>
              </Card>
            )}
          </section>
        </div>

        <aside aria-labelledby="setup-share" className="lg:sticky lg:top-6 lg:self-start">
          <SectionTitle>
            <span id="setup-share">{t("setup_step_share")}</span>
          </SectionTitle>
          {started ? (
            <Card className="flex flex-col items-center gap-4 p-6 text-center">
              <p className="font-serif text-xl text-ink">{t("setup_share_title")}</p>
              <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
              <QrBlock url={started.url} />
              <code className="max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 font-mono text-[12.5px] text-ink-soft">
                {absoluteUrl(started.url)}
              </code>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => void copy()}>
                  {copied ? t("setup_copied") : t("setup_copy")}
                </Button>
                <Button onClick={() => void navigate({ to: "/t/live/$id", params: { id: started.activityId } })}>
                  {t("setup_go_live")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void navigate({ to: "/classrooms/$classroomId", params: { classroomId: started.classroomId } })
                  }
                >
                  {t("setup_go_classroom")}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="flex flex-col items-center gap-4 bg-gradient-to-br from-ember-wash to-transparent p-6 text-center">
              <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function cnLocked(locked: boolean): string {
  return locked ? "pointer-events-none opacity-55" : "";
}
