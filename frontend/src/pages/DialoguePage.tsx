import { useT } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Mic, Send } from "lucide-react";
import { api } from "@/api";
import { keys, useArchives } from "@/api/queries";
import { SocratesStage, type SocratesExpression, type SocratesHandle } from "@/components/SocratesStage";
import type { Emotion } from "@/api";
import { StageLayout } from "@/pages/stages/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { SPEECH_RATES, createRecognizer, getSpeechRate, setSpeechRate, speak, speechInputSupported, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";

type Line = { id: string; role: "user" | "assistant"; text: string };

export function DialoguePage() {
  const t = useT();
  const { topic } = useSearch({ from: "/_app/dialogue" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: archives = [] } = useArchives();
  const archive = archives.find((a) => a.id === topic) ?? archives[0];
  const { data: history = [] } = useQuery({ queryKey: ["topicDialogue", archive?.id], queryFn: () => api.listTopicDialogue(archive!.id), enabled: !!archive });

  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState(getSpeechRate);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const rec = useRef(createRecognizer());
  const stage = useRef<SocratesHandle>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [history, pending, mine]);
  const speakTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(speakTimer.current); stopSpeaking(); }, []);

  // 沒有指定議題時，把網址補成第一個議題，之後重新整理也停在同一個
  useEffect(() => { if (!topic && archive) navigate({ to: "/dialogue", search: { topic: archive.id }, replace: true }); }, [topic, archive, navigate]);

  async function send(input: string) {
    if (!archive || !input.trim() || pending !== null) return;
    setMine(input); setPending(""); setStatus(t("思考中…")); clearTimeout(speakTimer.current); stopSpeaking();
    stage.current?.setExpression(null);
    // AI 一決定情緒就先做表情（例如先笑），回覆文字接著出現；開口說話至少等表情做出來之後
    let reactedAt = 0;
    const react = (e: Emotion) => { if (reactedAt) return; reactedAt = performance.now(); stage.current?.setExpression(EMOTION_CLIP[e]); };
    try {
      const msg = await api.sendTopicDialogue(archive.id, input, (c) => setPending((p) => (p ?? "") + c), react);
      setStatus("");
      const emotion = msg.emotion ?? "neutral";
      react(emotion); // 後端沒有提早送情緒時，在這裡補做
      const wait = EMOTION_CLIP[emotion] ? Math.max(0, REACT_MS - (performance.now() - reactedAt)) : 0;
      speakTimer.current = setTimeout(() => speak(msg.text, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) }), wait);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e)); // 錯誤留在畫面上，下次送出時才清掉
      stage.current?.setExpression(null);
    } finally {
      setPending(null); setMine(null);
      qc.invalidateQueries({ queryKey: ["topicDialogue", archive.id] });
      qc.invalidateQueries({ queryKey: keys.archives });
    }
  }

  // 這個議題在這次進來之前就已經有對話（例如從議題頁按「繼續對話」）
  const earlier = !!archive && archive.rounds - history.filter((m) => m.role === "user").length > 0;
  const lines: Line[] = [
    { id: "open", role: "assistant", text: earlier ? t("我們上次談到「{title}」。你現在的想法有什麼不一樣嗎？", { title: archive?.title ?? "" }) : t("我們來談談「{title}」。你現在怎麼想？", { title: archive?.title ?? "…" }) },
    ...history,
  ];

  const hint = listening ? t("聆聽中…") : status || (speechInputSupported() ? t("按住麥克風說話") : t("這個瀏覽器不支援語音辨識，請用文字輸入"));
  return (
    <div className="flex h-full flex-col">
      {/* 最上面一排：這個對話的主題 */}
      <div className="flex min-h-topbar shrink-0 items-center gap-3 border-b border-line px-5 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-bronze">{t("與蘇格拉底對話")}</div>
          <h2 className="truncate font-serif text-[15px] leading-tight" title={archive?.title}>{archive?.title}</h2>
        </div>
      </div>
      {/* 跟辯論一樣：左邊模型、右邊對話，可以拖曳調整寬度，任一邊都能收起來 */}
      <StageLayout mascot={false} leftLabel={t("蘇格拉底")} rightLabel={t("對話")}
        left={(
          <div className="flex h-full min-h-[320px] flex-col items-center gap-3 p-4">
            <div className="relative min-h-0 w-full flex-1" title={t("點一下可切換全息效果")}>
              <SocratesStage ref={stage} speaking={speaking} className="absolute inset-0" />
              {/* 說話倍速：點一下換下一個速度，正在唸的話會用新速度接著唸 */}
              <button type="button" title={t("說話速度 {rate} 倍，點一下切換", { rate })} aria-label={t("說話速度 {rate} 倍，點一下切換", { rate })}
                onClick={() => { const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length]; setSpeechRate(next); setRate(next); }}
                className="absolute left-2 top-2 z-10 flex h-7 cursor-pointer items-center gap-1 rounded-full border border-line-strong bg-bg-1/85 px-2.5 text-[12px] tabular-nums text-ink-dim backdrop-blur hover:border-bronze hover:text-bronze">
                <Gauge className="size-3.5" />{rate}×
              </button>
            </div>
            {/* 表情：點一下播放模型的大笑 / 疑惑 / 生氣，說話時也能疊上去 */}
            <div role="group" aria-label={t("表情預覽")} className="flex shrink-0 flex-wrap justify-center gap-1.5">
              {EXPRESSIONS.map(([name, label]) => (
                <Button key={name} type="button" size="sm" variant="outline" onClick={() => stage.current?.setExpression(name)}>{t(label)}</Button>
              ))}
            </div>
            <div className="shrink-0 text-center text-[11.5px] text-ink-faint">{hint}</div>
          </div>
        )}
        right={(
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {lines.map((m) => <Bubble key={m.id} role={m.role} text={m.text} />)}
              {mine && <Bubble role="user" text={mine} />}
              {pending !== null && <Bubble role="assistant" text={pending || "…"} />}
              <div ref={end} />
            </div>
            <div className="flex shrink-0 items-end gap-2 border-t border-line p-3">
              <Button variant="outline" size="icon" aria-label={t("按住說話")} disabled={!rec.current}
                className={cn(listening && "border-bronze text-bronze")}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); clearTimeout(speakTimer.current); stopSpeaking(); setListening(true); rec.current?.start(); }}
                onPointerUp={async () => { setListening(false); const heard = await rec.current!.stop(); if (heard) void send(heard); else setStatus(t("沒聽清楚，請再說一次")); }}>
                <Mic className="size-4" />
              </Button>
              <Textarea rows={1} value={text} placeholder={t("輸入你的想法…")} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = text; setText(""); void send(v); } }} />
              <Button size="icon" aria-label={t("送出")} disabled={pending !== null} onClick={() => { const v = text; setText(""); void send(v); }}><Send className="size-4" /></Button>
            </div>
          </>
        )} />
    </div>
  );
}

/** 表情開始後至少過這麼久才開口（先笑 / 先生氣，再說話） */
const REACT_MS = 1200;
/** AI 回覆的情緒 → 模型的表情動畫（neutral 不播） */
const EMOTION_CLIP: Record<Emotion, SocratesExpression | null> = { neutral: null, happy: "Happy", confused: "Confused", angry: "Angry" };

const EXPRESSIONS: [SocratesExpression, string][] = [["Happy", "大笑"], ["Confused", "疑惑"], ["Angry", "生氣"]];

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const t = useT();
  return (
    <div className={cn("flex gap-3", role === "user" && "flex-row-reverse")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-2 font-serif text-sm text-bronze">{role === "user" ? t("我") : t("蘇")}</span>
      <p className={cn("max-w-[80%] rounded-2xl border border-line px-4 py-2.5 font-serif text-[14.5px] leading-7", role === "user" ? "bg-bronze-soft" : "bg-bg-2")}>{text}</p>
    </div>
  );
}
