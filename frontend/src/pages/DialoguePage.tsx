import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Send } from "lucide-react";
import { api } from "@/api";
import { keys, useArchives } from "@/api/queries";
import { SocratesStage } from "@/components/SocratesStage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { createRecognizer, speak, speechInputSupported, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";

type Line = { id: string; role: "user" | "assistant"; text: string };

export function DialoguePage() {
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
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const rec = useRef(createRecognizer());
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [history, pending, mine]);
  useEffect(() => () => stopSpeaking(), []);

  // 沒有指定議題時，把網址補成第一個議題，之後重新整理也停在同一個
  useEffect(() => { if (!topic && archive) navigate({ to: "/dialogue", search: { topic: archive.id }, replace: true }); }, [topic, archive, navigate]);

  async function send(t: string) {
    if (!archive || !t.trim() || pending !== null) return;
    setMine(t); setPending(""); setStatus("思考中…"); stopSpeaking();
    try {
      const msg = await api.sendTopicDialogue(archive.id, t, (c) => setPending((p) => (p ?? "") + c));
      speak(msg.text, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null); setMine(null); setStatus("");
      qc.invalidateQueries({ queryKey: ["topicDialogue", archive.id] });
      qc.invalidateQueries({ queryKey: keys.archives });
    }
  }

  // 這個議題在這次進來之前就已經有對話（例如從議題頁按「繼續對話」）
  const earlier = !!archive && archive.rounds - history.filter((m) => m.role === "user").length > 0;
  const lines: Line[] = [
    { id: "open", role: "assistant", text: earlier ? `我們上次談到「${archive?.title}」。你現在的想法有什麼不一樣嗎？` : `我們來談談「${archive?.title ?? "…"}」。你現在怎麼想？` },
    ...history,
  ];

  return (
    <div className="grid h-full md:grid-cols-[1fr_minmax(340px,420px)]">
      <div className="relative min-h-[280px] border-r border-line bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,var(--bronze-soft),transparent_75%)]">
        <SocratesStage speaking={speaking} className="absolute inset-0" />
        <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-ink-faint">
          {listening ? "聆聽中…" : status || (speechInputSupported() ? "按住麥克風說話（點模型可切換全息效果）" : "這個瀏覽器不支援語音辨識，請用文字輸入")}
          <span className="ml-1">（離線模式：瀏覽器語音）</span>
        </p>
      </div>
      <aside className="flex min-h-0 flex-col bg-bg-1">
        <div className="border-b border-line px-5 py-3"><div className="font-serif text-sm">與蘇格拉底對話</div><div className="truncate text-xs text-ink-faint">{archive?.title}</div></div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {lines.map((m) => <Bubble key={m.id} role={m.role} text={m.text} />)}
          {mine && <Bubble role="user" text={mine} />}
          {pending !== null && <Bubble role="assistant" text={pending || "…"} />}
          <div ref={end} />
        </div>
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Button variant="outline" size="icon" aria-label="按住說話" disabled={!rec.current}
            className={cn(listening && "border-bronze text-bronze")}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stopSpeaking(); setListening(true); rec.current?.start(); }}
            onPointerUp={async () => { setListening(false); const t = await rec.current!.stop(); if (t) void send(t); else setStatus("沒聽清楚，請再說一次"); }}>
            <Mic className="size-4" />
          </Button>
          <Textarea rows={1} value={text} placeholder="輸入你的想法…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = text; setText(""); void send(t); } }} />
          <Button size="icon" aria-label="送出" disabled={pending !== null} onClick={() => { const t = text; setText(""); void send(t); }}><Send className="size-4" /></Button>
        </div>
      </aside>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  return (
    <div className={cn("flex gap-3", role === "user" && "flex-row-reverse")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-2 font-serif text-sm text-bronze">{role === "user" ? "我" : "Σ"}</span>
      <p className={cn("max-w-[80%] rounded-2xl border border-line px-4 py-2.5 font-serif text-[14.5px] leading-7", role === "user" ? "bg-bronze-soft" : "bg-bg-2")}>{text}</p>
    </div>
  );
}
