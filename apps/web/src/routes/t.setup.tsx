import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "@/api";
import { Button, Card, Field, Input, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/setup")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

type Source = "pick" | "custom" | "ai";

function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const [classroomName, setClassroomName] = useState("");
  const [source, setSource] = useState<Source>("pick");
  const [picked, setPicked] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [direction, setDirection] = useState("");
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const create = useMutation({ mutationFn: () => api.createClassroom(classroomName, picked ?? customTitle) });
  const created = create.data ?? null;
  const [copied, setCopied] = useState(false);

  const topicReady =
    source === "custom" ? customTitle.trim().length > 0 && customStatement.trim().length > 0 : Boolean(picked);
  const classReady = classroomName.trim().length > 0;
  const ready = classReady && topicReady;
  const list = source === "ai" ? (generated.data ?? []) : (topics.data ?? []);

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold text-ink pl-12 md:pl-0">{t("setup_title")}</h1>

      <section aria-labelledby="setup-class" className="flex flex-col gap-4">
        <h2
          id="setup-class"
          className="flex items-center gap-2.5 text-[13px] font-medium tracking-wider text-ink-faint uppercase"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink font-sans text-[11px] font-semibold text-paper">
            1
          </span>
          {t("setup_step_class")}
        </h2>
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

      <section aria-labelledby="setup-topic" className="flex flex-col gap-4">
        <h2
          id="setup-topic"
          className="flex items-center gap-2.5 text-[13px] font-medium tracking-wider text-ink-faint uppercase"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink font-sans text-[11px] font-semibold text-paper">
            2
          </span>
          {t("setup_step_topic")}
        </h2>
        <Card className={cn("p-5", cnLocked(Boolean(created)))}>
          <div className="flex flex-col gap-5">
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
                <div className="flex max-h-105 flex-col gap-2 overflow-y-auto pr-0.5">
                  {list.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={Boolean(created)}
                      onClick={() => setPicked(item.id)}
                      className={`rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${
                        picked === item.id ? "border-ember bg-ember-wash" : "border-line bg-card hover:border-ink-faint"
                      }`}
                    >
                      <p className="font-serif text-[16px] font-medium text-ink">{item.title}</p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{item.statement}</p>
                    </button>
                  ))}
                  {source === "ai" && !generated.data && !generated.isPending && (
                    <p className="py-6 text-center text-[13px] text-ink-faint">{t("setup_topic_direction")} →</p>
                  )}
                </div>
              </div>
            )}

            {source === "custom" && (
              <div className="flex flex-col gap-5">
                <Field label={t("setup_class_label")}>
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

      <section aria-labelledby="setup-share" className="flex flex-col gap-4">
        <h2
          id="setup-share"
          className="flex items-center gap-2.5 text-[13px] font-medium tracking-wider text-ink-faint uppercase"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink font-sans text-[11px] font-semibold text-paper">
            3
          </span>
          {t("setup_step_share")}
        </h2>
        {created ? (
          <Card className="flex flex-col items-center gap-5 p-8 text-center">
            <p className="font-serif text-xl font-semibold text-ink">{t("setup_share_title")}</p>
            <p className="max-w-xs text-[13.5px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
            <QrBlock url={created.url} />
            <code className="rounded-lg bg-paper-deep px-4 py-2 text-[13px] text-ink-soft">{created.url}</code>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? t("setup_copied") : t("setup_copy")}
              </Button>
              <Button onClick={() => void navigate({ to: "/t/live/$id", params: { id: created.activityId } })}>
                {t("setup_go_live")}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-[13.5px] leading-relaxed text-ink-faint">{t("setup_share_hint")}</p>
            <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Spinner /> : t("setup_create")}
            </Button>
          </Card>
        )}
      </section>
    </div>
  );
}

function cnLocked(locked: boolean): string {
  return locked ? "pointer-events-none opacity-55" : "";
}

function QrBlock({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useQuery({
    queryKey: ["qr", url],
    queryFn: async () => {
      const result = await QRCode.toDataURL(url, {
        margin: 1,
        width: 192,
        color: { dark: "#251f16", light: "#fffdf8" },
      });
      setDataUrl(result);
      return result;
    },
    staleTime: Infinity,
  });
  if (!dataUrl) return <div className="h-48 w-48 rounded-xl bg-paper-deep" />;
  return <img src={dataUrl} alt="QR" className="h-48 w-48 rounded-xl border border-line" />;
}
