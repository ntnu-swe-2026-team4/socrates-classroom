import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "@/api";
import { Button, Card, Field, Input, Segmented, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/setup")({
  component: SetupPage,
});

type Step = "class" | "topic" | "share";
type Source = "pick" | "custom" | "ai";

function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("class");
  const [classroomName, setClassroomName] = useState("");
  const [source, setSource] = useState<Source>("pick");
  const [picked, setPicked] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [direction, setDirection] = useState("");
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const create = useMutation({
    mutationFn: () => api.createClassroom(classroomName, picked ?? "custom"),
    onSuccess: (result) => {
      setCreated(result);
      setStep("share");
    },
  });
  const [created, setCreated] = useState<{ code: string; url: string; activityId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const topicReady =
    source === "pick" || source === "ai"
      ? Boolean(picked)
      : customTitle.trim().length > 0 && customStatement.trim().length > 0;
  const list = source === "ai" ? (generated.data ?? []) : (topics.data ?? []);

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold text-ink">{t("setup_title")}</h1>
      <div className="mt-5 flex items-center gap-2 text-[12.5px] text-ink-faint">
        {(["class", "topic", "share"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-line" />}
            <span className={step === s ? "font-medium text-ember" : step > s ? "text-moss" : ""}>
              {t(`setup_step_${s}` as const)}
            </span>
          </span>
        ))}
      </div>

      {step === "class" && (
        <Card className="mt-6 flex flex-col gap-5 p-6">
          <Field label={t("setup_class_label")}>
            <Input
              value={classroomName}
              placeholder={t("setup_class_placeholder")}
              maxLength={40}
              onChange={(event) => setClassroomName(event.target.value)}
            />
          </Field>
          <Button disabled={classroomName.trim().length === 0} onClick={() => setStep("topic")} className="self-end">
            {t("common_confirm")}
          </Button>
        </Card>
      )}

      {step === "topic" && (
        <div className="mt-6 flex flex-col gap-5">
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
                    onChange={(event) => setDirection(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!direction.trim() || generated.isPending}
                    onClick={() => generated.mutate()}
                  >
                    {generated.isPending ? <Spinner /> : t("setup_topic_generate")}
                  </Button>
                </div>
              )}
              {generated.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
              <div className="flex flex-col gap-2">
                {list.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setPicked(item.id)}
                    className={`rounded-2xl border p-4 text-left transition-colors ${
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
            <Card className="flex flex-col gap-5 p-6">
              <Field label={t("setup_class_label")}>
                <Input value={customTitle} maxLength={40} onChange={(event) => setCustomTitle(event.target.value)} />
              </Field>
              <Field label={t("setup_topic_statement")}>
                <Input
                  value={customStatement}
                  maxLength={80}
                  onChange={(event) => setCustomStatement(event.target.value)}
                />
              </Field>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("class")}>
              {t("common_back")}
            </Button>
            <Button disabled={!topicReady || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Spinner /> : t("common_confirm")}
            </Button>
          </div>
        </div>
      )}

      {step === "share" && created && (
        <Card className="mt-6 flex flex-col items-center gap-5 p-8 text-center">
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
      )}
    </div>
  );
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
