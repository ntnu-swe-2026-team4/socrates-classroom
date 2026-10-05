import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useSaveTopic } from "@/api/queries";
import type { Activity, AnswerMode, ClassroomTopic, TopicInput, TopicType } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, fromLocalInput, toLocalInput } from "@/lib/utils";

type Settings = NonNullable<TopicInput["activity"]>;
type AxisDraft = Settings["axes"][number];

const EMPTY_AXES: AxisDraft[] = [{ name: "", left: "", right: "" }, { name: "", left: "", right: "" }];
const TYPE_INFO: Record<TopicType, [string, string]> = {
  individual: ["個人議題", "每位學生各自和蘇格拉底進行個人思辨，完成後看到自己的結算。"],
  group: ["團體議題", "先各自對話找出立場，再依立場分組、辯論。"],
};

function Segmented<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-line-strong bg-bg-2 p-0.5">
      {items.map(([v, n]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn("cursor-pointer rounded-full px-4 py-1.5 text-[13px]", value === v ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{n}</button>
      ))}
    </div>
  );
}

/** 團體議題的辯論設定：回答方式、價值軸、組別人數 */
function DebateSettingsFields({ mode, setMode, axes, setAxes, size, setSize }: {
  mode: AnswerMode; setMode: (v: AnswerMode) => void;
  axes: AxisDraft[]; setAxes: (v: AxisDraft[]) => void;
  size: number; setSize: (v: number) => void;
}) {
  const edit = (i: number, k: keyof AxisDraft, v: string) => setAxes(axes.map((y, j) => (j === i ? { ...y, [k]: v } : y)));
  return (
    <>
      <div><span className="mb-1 block text-xs text-ink-dim">回答方式</span><Segmented items={[["text", "文字"], ["voice", "語音"], ["both", "文字或語音"]]} value={mode} onChange={setMode} /></div>
      <div>
        <span className="mb-1 block text-xs text-ink-dim">價值軸（1–3 條）</span>
        <div className="space-y-2">
          {axes.map((x, i) => (
            <div key={i} className="grid grid-cols-[1.1fr_1fr_auto_1fr_auto] items-center gap-2">
              <Input className="h-9" placeholder="軸名稱" value={x.name} onChange={(e) => edit(i, "name", e.target.value)} />
              <Input className="h-9" placeholder="偏左（−1）" value={x.left} onChange={(e) => edit(i, "left", e.target.value)} />
              <span className="text-ink-faint">⟷</span>
              <Input className="h-9" placeholder="偏右（+1）" value={x.right} onChange={(e) => edit(i, "right", e.target.value)} />
              {axes.length > 1 ? <button type="button" aria-label="移除" onClick={() => setAxes(axes.filter((_, j) => j !== i))} className="cursor-pointer text-ink-faint"><X className="size-4" /></button> : <span />}
            </div>
          ))}
        </div>
        {axes.length < 3 && <Button variant="outline" size="sm" className="mt-2" onClick={() => setAxes([...axes, { name: "", left: "", right: "" }])}><Plus className="size-3.5" />加一條軸</Button>}
      </div>
      <div><span className="mb-1 block text-xs text-ink-dim">組別人數</span><Segmented items={[["3", "3 人"], ["4", "4 人"], ["5", "5 人"]]} value={String(size)} onChange={(v) => setSize(Number(v))} /></div>
    </>
  );
}

/** 新增議題（不帶 topic）或編輯議題。團體議題編輯時要帶 activity 才能顯示原本的辯論設定 */
export function TopicFormDialog({ classroomId, topic, activity, open, onOpenChange, onSaved }: {
  classroomId: string;
  topic?: ClassroomTopic;
  activity?: Activity;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (t: ClassroomTopic) => void;
}) {
  const save = useSaveTopic(classroomId, topic?.id);
  const [type, setType] = useState<TopicType>("individual");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [reports, setReports] = useState(false);
  const [mode, setMode] = useState<AnswerMode>("both");
  const [axes, setAxes] = useState<AxisDraft[]>(EMPTY_AXES);
  const [size, setSize] = useState(3);
  const [err, setErr] = useState("");

  const original = activity && { answerMode: activity.answerMode, groupSize: activity.groupSize, axes: activity.axes.map(({ name, left, right }) => ({ name, left, right })) };

  useEffect(() => {
    if (!open) return;
    setType(topic?.type ?? "individual");
    setTitle(topic?.title ?? "");
    setDescription(topic?.description ?? "");
    setDue(toLocalInput(topic?.dueAt ?? null));
    setReports(topic?.acceptsReports ?? false);
    setMode(original?.answerMode ?? "both");
    setAxes(original?.axes ?? EMPTY_AXES);
    setSize(original?.groupSize ?? 3);
    setErr("");
    save.reset();
    // 只在開啟時帶入目前的值
  }, [open]);

  function submit() {
    if (!title.trim()) return setErr("請填寫議題標題。");
    const input: TopicInput = { type, title: title.trim(), description: description.trim(), dueAt: fromLocalInput(due), acceptsReports: reports };
    if (type === "group") {
      const clean = axes.filter((x) => x.name.trim() && x.left.trim() && x.right.trim()).map((x) => ({ name: x.name.trim(), left: x.left.trim(), right: x.right.trim() }));
      if (!clean.length) return setErr("至少要有一條完整的價值軸（名稱與兩端都要填）。");
      const settings: Settings = { answerMode: mode, groupSize: size, axes: clean };
      // 編輯時只有設定真的改了才送出，避免活動已開始時連帶改標題也被拒絕
      if (!original || JSON.stringify(settings) !== JSON.stringify(original)) input.activity = settings;
    }
    setErr("");
    save.mutate(input, { onSuccess: (t) => { onOpenChange(false); onSaved?.(t); } });
  }

  const editing = !!topic;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{editing ? "編輯議題" : "新增議題"}</DialogTitle>
        <DialogDescription>{TYPE_INFO[type][1]}</DialogDescription>
        <div className="space-y-4 text-sm">
          {!editing && <div><span className="mb-1 block text-xs text-ink-dim">議題類型</span><Segmented items={[["individual", TYPE_INFO.individual[0]], ["group", TYPE_INFO.group[0]]]} value={type} onChange={setType} /></div>}
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">議題</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：正義是否只是強者的利益？" /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">詳細說明（選填）</span><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="議題背景、要思考的方向、閱讀材料的重點……" /></label>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-dim">截止時間（選填）</span>
              <span className="flex items-center gap-2">
                <Input type="datetime-local" className="w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
                {due && <button type="button" onClick={() => setDue("")} className="cursor-pointer text-xs text-ink-faint hover:text-ink">清除</button>}
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-[13px] text-ink-dim">
              <input type="checkbox" className="size-4 accent-bronze" checked={reports} onChange={(e) => setReports(e.target.checked)} />讓學生上傳結論報告
            </label>
          </div>
          {type === "group" && (
            <div className="space-y-4 rounded-2xl border border-line p-4">
              <p className="text-xs text-ink-faint">{editing ? "辯論設定：有學生開始對話後就不能再修改。" : "辯論設定：同學會先各自跟 AI 對話，AI 依價值軸推估每個人的立場。"}</p>
              <DebateSettingsFields mode={mode} setMode={setMode} axes={axes} setAxes={setAxes} size={size} setSize={setSize} />
            </div>
          )}
          {(err || save.error) && <p className="text-[12.5px] text-wine">{err || save.error?.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={submit} disabled={save.isPending}>{editing ? "儲存" : "建立議題"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
