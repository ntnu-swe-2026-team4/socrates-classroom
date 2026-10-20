import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ListPlus, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useImportMembers, useJoinPolicy, usePendingApplications, useRegenerateJoinCode, useReviewApplication, useUpdateJoinPolicy } from "@/api/queries";
import type { ImportMembersResult, JoinApplication, JoinQuestion } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { tr, useT } from "@/i18n";

function Switch({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4 py-2.5", disabled && "cursor-default opacity-60")}>
      <span><span className="block text-[13.5px]">{label}</span><span className="block text-[11.5px] text-ink-faint">{hint}</span></span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", checked ? "bg-bronze" : "bg-bg-3")}>
        <i className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

/* ---------- 加入設定（邀請碼、探索、審核） ---------- */
export function JoinSettingsCard({ classroomId }: { classroomId: string }) {
  const t = useT();
  const { data: p } = useJoinPolicy(classroomId);
  const update = useUpdateJoinPolicy(classroomId);
  const regen = useRegenerateJoinCode(classroomId);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [editingQs, setEditingQs] = useState(false);
  if (!p) return null;

  const copy = () => navigator.clipboard?.writeText(p.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const error = update.error ?? regen.error;
  return (
    <Card>
      <div className="mb-1 text-xs tracking-wider text-ink-faint">{t("加入方式")}</div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <span className={cn("font-mono text-2xl tracking-[0.25em]", !p.codeEnabled && "text-ink-faint line-through")}>{p.code}</span>
        <span className="flex gap-1.5">
          <Button variant="outline" size="sm" disabled={!p.codeEnabled} onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? t("已複製") : t("複製")}</Button>
          {confirmRegen
            ? <><Button variant="danger" size="sm" disabled={regen.isPending} onClick={() => regen.mutate(undefined, { onSuccess: () => setConfirmRegen(false) })}>{t("確定換新碼（舊碼立即失效）")}</Button><Button variant="ghost" size="sm" onClick={() => setConfirmRegen(false)}>{t("取消")}</Button></>
            : <Button variant="ghost" size="sm" onClick={() => setConfirmRegen(true)}><RefreshCw className="size-3.5" />{t("重新產生")}</Button>}
        </span>
      </div>
      <div className="divide-y divide-line">
        <Switch label={t("開放用邀請碼加入")} hint={t("學生在「教室」頁輸入上面的邀請碼就能找到這個教室。")} checked={p.codeEnabled} disabled={update.isPending} onChange={(v) => update.mutate({ codeEnabled: v })} />
        <Switch label={t("出現在「探索教室」")} hint={t("所有學生都能搜尋到這個教室並申請加入，不需要邀請碼。")} checked={p.discoverable} disabled={update.isPending} onChange={(v) => update.mutate({ discoverable: v })} />
        <Switch label={t("加入需要老師審核")} hint={t("學生要先填寫申請問卷，你通過後才會成為成員。")} checked={p.requireApproval} disabled={update.isPending} onChange={(v) => update.mutate({ requireApproval: v })} />
      </div>
      {p.requireApproval && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-bg-2 px-4 py-3">
          <span className="text-[12.5px] text-ink-dim">{p.questionnaire.length ? t("申請問卷共 {n} 題", { n: p.questionnaire.length }) : t("還沒有申請問卷，學生申請時只需要按送出。")}</span>
          <Button variant="outline" size="sm" onClick={() => setEditingQs(true)}><ListPlus className="size-3.5" />{t("編輯問卷")}</Button>
        </div>
      )}
      {error && <p className="mt-2 text-[12.5px] text-wine">{error.message}</p>}
      <QuestionnaireDialog classroomId={classroomId} questions={p.questionnaire} open={editingQs} onOpenChange={setEditingQs} />
    </Card>
  );
}

/* ---------- 申請問卷編輯 ---------- */
const KIND_NAME: Record<JoinQuestion["kind"], string> = { text: "單行文字", paragraph: "多行文字", choice: "單選" };
let draftSeq = 0;
const blankQuestion = (): JoinQuestion => ({ id: `new-${Date.now().toString(36)}-${draftSeq++}`, prompt: "", kind: "paragraph", required: true });

function QuestionnaireDialog({ classroomId, questions, open, onOpenChange }: { classroomId: string; questions: JoinQuestion[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const update = useUpdateJoinPolicy(classroomId);
  const [qs, setQs] = useState<JoinQuestion[]>([]);
  useEffect(() => {
    if (!open) return;
    setQs(structuredClone(questions));
    update.reset();
    // 只在開啟時帶入目前的值
  }, [open]);

  const edit = (i: number, patch: Partial<JoinQuestion>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => { const next = [...qs]; [next[i], next[i + d]] = [next[i + d], next[i]]; setQs(next); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t("申請問卷")}</DialogTitle>
        <DialogDescription>{t("學生申請加入時要回答這些問題。修改問卷不影響已經送出的申請。")}</DialogDescription>
        <div className="space-y-3">
          {qs.map((q, i) => (
            <div key={q.id} className="rounded-2xl border border-line p-3.5">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center font-serif text-sm text-ink-faint">{i + 1}</span>
                <Input className="h-9" placeholder={t("題目")} value={q.prompt} onChange={(e) => edit(i, { prompt: e.target.value })} />
                <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("上移")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("下移")} disabled={i === qs.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></Button>
                <Button variant="danger" size="icon" className="size-8 shrink-0" aria-label={t("刪除題目")} onClick={() => setQs(qs.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 pl-7 text-[12.5px] text-ink-dim">
                <select value={q.kind} onChange={(e) => { const kind = e.target.value as JoinQuestion["kind"]; edit(i, { kind, options: kind === "choice" ? q.options ?? ["", ""] : undefined }); }}
                  className="h-8 cursor-pointer rounded-full border border-line-strong bg-bg-2 px-3 text-ink outline-none focus:border-bronze">
                  {Object.entries(KIND_NAME).map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}
                </select>
                <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="size-4 accent-bronze" checked={q.required} onChange={(e) => edit(i, { required: e.target.checked })} />{t("必填")}</label>
              </div>
              {q.kind === "choice" && (
                <div className="mt-2.5 space-y-1.5 pl-7">
                  {(q.options ?? []).map((o, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <i className="size-3 shrink-0 rounded-full border border-line-strong" />
                      <Input className="h-8" placeholder={t("選項 {n}", { n: k + 1 })} value={o} onChange={(e) => edit(i, { options: q.options!.map((x, m) => (m === k ? e.target.value : x)) })} />
                      <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("刪除選項")} disabled={(q.options?.length ?? 0) <= 2} onClick={() => edit(i, { options: q.options!.filter((_, m) => m !== k) })}><Trash2 className="size-3.5" /></Button>
                    </div>
                  ))}
                  <button type="button" onClick={() => edit(i, { options: [...(q.options ?? []), ""] })} className="cursor-pointer pl-5 text-xs text-bronze hover:underline">{t("＋ 加一個選項")}</button>
                </div>
              )}
            </div>
          ))}
          {!qs.length && <p className="text-sm text-ink-faint">{t("沒有題目：學生申請時只需要按送出。")}</p>}
          <Button variant="outline" size="sm" onClick={() => setQs([...qs, blankQuestion()])}><Plus className="size-3.5" />{t("加一題")}</Button>
          {update.error && <p className="text-[12.5px] text-wine">{update.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button disabled={update.isPending} onClick={() => update.mutate({ questionnaire: qs }, { onSuccess: () => onOpenChange(false) })}>{t("儲存問卷")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 待審核申請 ---------- */
function ApplicationRow({ a, classroomId }: { a: JoinApplication; classroomId: string }) {
  const t = useT();
  const review = useReviewApplication(classroomId);
  const [note, setNote] = useState("");
  return (
    <div className="border-t border-line py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b className="font-serif text-[15px] font-medium">{a.studentName}</b>
        <span className="text-[11.5px] text-ink-faint">{t("申請於 {time}", { time: formatDateTime(a.createdAt) })}</span>
      </div>
      {a.answers.length > 0 && (
        <dl className="mt-2 space-y-1.5 text-[13px]">
          {a.answers.map((x) => <div key={x.questionId}><dt className="text-[11.5px] text-ink-faint">{x.prompt}</dt><dd className="whitespace-pre-line">{x.answer || <span className="text-ink-faint">{t("（未回答）")}</span>}</dd></div>)}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="h-8 min-w-48 flex-1" placeholder={t("給學生的附註（選填，例如拒絕的原因）")} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="outline" size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, decision: "reject", note })}>{t("拒絕")}</Button>
        <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, decision: "approve", note })}>{t("通過")}</Button>
      </div>
      {review.error && <p className="mt-1.5 text-[12.5px] text-wine">{review.error.message}</p>}
    </div>
  );
}

export function PendingApplications({ classroomId }: { classroomId: string }) {
  const t = useT();
  const { data: list = [] } = usePendingApplications(classroomId);
  if (!list.length) return null;
  return (
    <Card className="border-bronze-dim">
      <div className="text-xs tracking-wider text-bronze">{t("待審核的加入申請")} · {list.length}</div>
      {list.map((a) => <ApplicationRow key={a.id} a={a} classroomId={classroomId} />)}
    </Card>
  );
}

/* ---------- 批次匯入成員 ---------- */
/** 每行一個；也接受逗號、頓號或 Tab 分隔（從試算表貼上） */
const parseNames = (text: string) => text.split(/[\n,，、\t]+/).map((x) => x.trim()).filter(Boolean);

export function ImportMembersButton({ classroomId }: { classroomId: string }) {
  const t = useT();
  const rich = (key: string, n: number, cls: string) => { const [a, b] = t(key, { n: "\u0001" }).split("\u0001"); return <>{a}<b className={cls}>{n}</b>{b}</>; };
  const imp = useImportMembers(classroomId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportMembersResult | null>(null);
  const names = parseNames(text);
  const close = (v: boolean) => { setOpen(v); if (!v) { setText(""); setResult(null); imp.reset(); } };
  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}><Upload className="size-4" />{t("批次匯入")}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-lg">
          <DialogTitle>{t("批次匯入成員")}</DialogTitle>
          <DialogDescription>{t("每行一個帳號或姓名，也可以直接從試算表複製一整欄貼上。")}</DialogDescription>
          {result ? (
            <div className="space-y-3 text-sm">
              <p>{rich("已加入 {n} 位", result.added.length, "text-olive")}{result.skipped.length > 0 && rich("，略過 {n} 位", result.skipped.length, "text-wine")}{t("。")}</p>
              {result.skipped.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl bg-bg-2 px-4 py-3 text-[12.5px]">
                  {result.skipped.map((x, i) => <li key={i}>{x.name}<span className="text-ink-faint"> — {tr(x.reason)}</span></li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setResult(null)}>{t("再匯入一批")}</Button><Button onClick={() => close(false)}>{t("完成")}</Button></div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <Textarea rows={8} className="font-mono text-[13px]" placeholder={"王小明\nwang.xm@school.edu.tw\n李○恩"} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="text-xs text-ink-faint">{names.length ? t("共 {n} 位", { n: names.length }) : t("還沒有輸入名單")}</p>
              {imp.error && <p className="text-[12.5px] text-wine">{imp.error.message}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => close(false)}>{t("取消")}</Button>
                <Button disabled={!names.length || imp.isPending} onClick={() => imp.mutate(names, { onSuccess: (r) => { setResult(r); setText(""); } })}>{t("匯入")}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
