import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Field, Input, PageHeader, SectionTitle, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { QrBlock, absoluteUrl } from "@/components/QrBlock";

export const Route = createFileRoute("/t/setup")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/classrooms" });
  },
  component: SetupPage,
});

type Source = "pick" | "custom" | "ai";

function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [classroomName, setClassroomName] = useState("");
  const [source, setSource] = useState<Source>("pick");
  const [picked, setPicked] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [direction, setDirection] = useState("");
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const create = useMutation({
    mutationFn: async () => {
      const topicId =
        source === "custom"
          ? (await api.createTopic({ title: customTitle.trim(), statement: customStatement.trim(), prompts: [] })).id
          : picked!;
      return api.createClassroom(classroomName.trim(), topicId);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
  });
  const created = create.data ?? null;
  const [copied, setCopied] = useState(false);

  const topicReady =
    source === "custom" ? customTitle.trim().length > 0 && customStatement.trim().length > 0 : Boolean(picked);
  const classReady = classroomName.trim().length > 0;
  const ready = classReady && topicReady;
  const list = source === "ai" ? (generated.data ?? []) : (topics.data ?? []);

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl(created.url));
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
            <Card className={cn("p-5", cnLocked(Boolean(created)))}>
              <Field label={t("setup_class_label")}>
                <Input
                  value={classroomName}
                  placeholder={t("setup_class_placeholder")}
                  maxLength={40}
                  disabled={Boolean(created)}
                  onChange={(event) => setClassroomName(event.target.value)}
                />
              </Field>
            </Card>
          </section>

          <section aria-labelledby="setup-topic">
            <SectionTitle step={2}>
              <span id="setup-topic">{t("setup_step_topic")}</span>
            </SectionTitle>
            <Card className={cn("p-5", cnLocked(Boolean(created)))}>
              <div className="flex flex-col gap-4">
                <Segmented
                  label={t("setup_step_topic")}
                  value={source}
                  onChange={(value) => {
                    setSource(value);
                    setPicked(null);
                  }}
                  items={[
                    { value: "pick", label: t("setup_topic_pick") },
                    { value: "custom", label: t("setup_topic_custom") },
                    { value: "ai", label: t("setup_topic_ai") },
                  ]}
                />

                {source !== "custom" && (
                  <div className="flex flex-col gap-3">
                    {source === "ai" && (
                      <div className="flex gap-2">
                        <Input
                          value={direction}
                          placeholder={t("setup_topic_direction")}
                          disabled={Boolean(created)}
                          onChange={(event) => setDirection(event.target.value)}
                        />
                        <Button
                          variant="outline"
                          disabled={!direction.trim() || generated.isPending || Boolean(created)}
                          onClick={() => generated.mutate()}
                        >
                          {generated.isPending ? <Spinner /> : t("setup_topic_generate")}
                        </Button>
                      </div>
                    )}
                    {generated.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
                    <div className="flex max-h-105 flex-col gap-1 overflow-y-auto pr-0.5">
                      {list.map((item, index) => (
                        <button
                          type="button"
                          key={item.id}
                          disabled={Boolean(created)}
                          aria-pressed={picked === item.id}
                          onClick={() => setPicked(item.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                            picked === item.id
                              ? "border-ember-deep bg-ember-wash"
                              : "border-transparent hover:bg-paper-deep",
                          )}
                        >
                          <span className="mt-0.5 rounded-full bg-paper-deep px-2 py-0.5 font-serif text-[11px] text-ink-faint">
                            #{index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <b className="block font-serif text-[15px] font-medium text-ink">{item.title}</b>
                            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                              {item.statement}
                            </span>
                          </span>
                        </button>
                      ))}
                      {source === "ai" && !generated.data && !generated.isPending && (
                        <p className="py-6 text-center text-[13px] text-ink-faint">{t("setup_topic_direction")} →</p>
                      )}
                    </div>
                  </div>
                )}

                {source === "custom" && (
                  <div className="flex flex-col gap-4">
                    <Field label={t("setup_topic_title")}>
                      <Input
                        value={customTitle}
                        maxLength={40}
                        disabled={Boolean(created)}
                        onChange={(event) => setCustomTitle(event.target.value)}
                      />
                    </Field>
                    <Field label={t("setup_topic_statement")}>
                      <Input
                        value={customStatement}
                        maxLength={80}
                        disabled={Boolean(created)}
                        onChange={(event) => setCustomStatement(event.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
            </Card>
          </section>
        </div>

        <aside aria-labelledby="setup-share" className="lg:sticky lg:top-6 lg:self-start">
          <SectionTitle step={3}>
            <span id="setup-share">{t("setup_step_share")}</span>
          </SectionTitle>
          {created ? (
            <Card className="flex flex-col items-center gap-4 p-6 text-center">
              <p className="font-serif text-xl text-ink">{t("setup_share_title")}</p>
              <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
              <QrBlock url={created.url} />
              <code className="max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 font-mono text-[12.5px] text-ink-soft">
                {absoluteUrl(created.url)}
              </code>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => void copy()}>
                  {copied ? t("setup_copied") : t("setup_copy")}
                </Button>
                <Button onClick={() => void navigate({ to: "/t/live/$id", params: { id: created.activityId } })}>
                  {t("setup_go_live")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void navigate({ to: "/classrooms/$classroomId", params: { classroomId: created.classroomId } })
                  }
                >
                  {t("setup_go_classroom")}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="flex flex-col items-center gap-4 bg-gradient-to-br from-ember-wash to-transparent p-6 text-center">
              <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
              <Button className="w-full" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? <Spinner /> : t("setup_create")}
              </Button>
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
