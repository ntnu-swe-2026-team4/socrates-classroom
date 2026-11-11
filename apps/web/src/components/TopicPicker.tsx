import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Field, Input, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

type Source = "pick" | "custom" | "ai";

export function TopicPicker({
  excludeId,
  submitLabel,
  onPicked,
}: {
  excludeId?: string;
  submitLabel: string;
  onPicked: (topicId: string) => Promise<unknown>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>("pick");
  const [picked, setPicked] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [direction, setDirection] = useState("");
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const submit = useMutation({
    mutationFn: async () => {
      let topicId: string;
      if (source === "custom") {
        topicId = (await api.createTopic({ title: customTitle.trim(), statement: customStatement.trim(), prompts: [] }))
          .id;
      } else {
        const generatedTopic = (generated.data ?? []).find((topic) => topic.id === picked);
        topicId = generatedTopic
          ? (
              await api.createTopic({
                title: generatedTopic.title,
                statement: generatedTopic.statement,
                prompts: generatedTopic.prompts,
              })
            ).id
          : picked!;
      }
      await onPicked(topicId);
    },
    onSuccess: () => {
      setPicked(null);
      setCustomTitle("");
      setCustomStatement("");
      void queryClient.invalidateQueries({ queryKey: ["topics"] });
    },
  });

  const locked = submit.isPending;
  const ready =
    source === "custom" ? customTitle.trim().length > 0 && customStatement.trim().length > 0 : Boolean(picked);
  const list = (source === "ai" ? (generated.data ?? []) : (topics.data ?? [])).filter(
    (topic) => topic.id !== excludeId,
  );

  return (
    <div className="flex flex-col gap-3">
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
        <div className="flex flex-col gap-2">
          {source === "ai" && (
            <div className="flex gap-2">
              <Input
                value={direction}
                placeholder={t("setup_topic_direction")}
                disabled={locked}
                onChange={(event) => setDirection(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={!direction.trim() || generated.isPending || locked}
                onClick={() => {
                  setPicked(null);
                  generated.mutate();
                }}
              >
                {generated.isPending ? <Spinner /> : t("setup_topic_generate")}
              </Button>
            </div>
          )}
          {generated.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-xl border border-line p-1">
            {source === "pick" && topics.isPending && (
              <div className="flex justify-center py-5">
                <Spinner />
              </div>
            )}
            {list.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={locked}
                aria-pressed={picked === item.id}
                onClick={() => setPicked(item.id)}
                className={cn(
                  "flex w-full cursor-pointer flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
                  picked === item.id ? "bg-ember-wash" : "hover:bg-paper-deep",
                )}
              >
                <b className="font-serif text-[14.5px] font-medium text-ink">{item.title}</b>
                <span className="text-[12.5px] leading-relaxed text-ink-soft">{item.statement}</span>
              </button>
            ))}
            {source === "ai" && !generated.data && !generated.isPending && (
              <p className="py-5 text-center text-[13px] text-ink-faint">{t("setup_topic_direction")} →</p>
            )}
          </div>
        </div>
      )}

      {source === "custom" && (
        <div className="flex flex-col gap-3">
          <Field label={t("setup_topic_title")}>
            <Input
              value={customTitle}
              maxLength={40}
              disabled={locked}
              onChange={(event) => setCustomTitle(event.target.value)}
            />
          </Field>
          <Field label={t("setup_topic_statement")}>
            <Input
              value={customStatement}
              maxLength={80}
              disabled={locked}
              onChange={(event) => setCustomStatement(event.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {submit.isError ? <p className="text-[12.5px] text-flag">{t("common_error")}</p> : <span />}
        <Button disabled={!ready || locked} onClick={() => submit.mutate()}>
          {locked ? <Spinner /> : submitLabel}
        </Button>
      </div>
    </div>
  );
}
