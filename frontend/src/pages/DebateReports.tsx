import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { useClassroom, useDeleteReport, useReports, useSubmitReport } from "@/api/queries";
import type { ClassroomTopic, TopicReport } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { useT } from "@/i18n";

const late = (r: TopicReport, t: ClassroomTopic) => !!t.dueAt && r.submittedAt > t.dueAt;

function FileLink({ r }: { r: TopicReport }) {
  return (
    <a href={r.file.url} download={r.file.name} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] hover:text-bronze hover:underline">
      <FileText className="size-4 shrink-0 text-bronze" /><span className="truncate">{r.file.name}</span><span className="shrink-0 text-[11.5px] text-ink-faint">{formatBytes(r.file.size)}</span>
    </a>
  );
}

/** 學生：上傳 / 重新上傳 / 刪除自己的結論報告 */
function MyReport({ topic }: { topic: ClassroomTopic }) {
  const t = useT();
  const { data: list = [] } = useReports(topic.id);
  const submit = useSubmitReport(topic.id);
  const del = useDeleteReport(topic.id);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState("");
  const [replacing, setReplacing] = useState(false);
  const mine = list[0];
  const send = () => file && submit.mutate({ file, comment }, { onSuccess: () => { setFile(null); setComment(""); setReplacing(false); } });
  const error = submit.error ?? del.error;

  return (
    <>
      {mine && !replacing ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><FileLink r={mine} />{late(mine, topic) && <Badge tone="wine">{t("逾期繳交")}</Badge>}</div>
          <p className="text-[11.5px] text-ink-faint">{t("繳交於 {time}", { time: formatDateTime(mine.submittedAt) })}</p>
          {mine.comment && <p className="whitespace-pre-line text-[13px] text-ink-dim">{mine.comment}</p>}
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setReplacing(true); setComment(mine.comment); }}>{t("重新上傳")}</Button>
            <Button variant="danger" size="sm" disabled={del.isPending} onClick={() => del.mutate(mine.id)}><Trash2 className="size-3.5" />{t("刪除")}</Button>
          </span>
        </div>
      ) : (
        <div className="space-y-2.5">
          <input ref={input} type="file" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}><Upload className="size-3.5" />{file ? t("換一個檔案") : t("選擇檔案")}</Button>
          {file && <p className="text-[13px]">{file.name} <span className="text-[11.5px] text-ink-faint">{formatBytes(file.size)}</span></p>}
          <Textarea rows={2} placeholder={t("給老師的說明（選填）")} value={comment} onChange={(e) => setComment(e.target.value)} />
          <span className="flex gap-2">
            {replacing && <Button variant="ghost" size="sm" onClick={() => { setReplacing(false); setFile(null); }}>{t("取消")}</Button>}
            <Button size="sm" disabled={!file || submit.isPending} onClick={send}>{submit.isPending ? t("上傳中…") : t("繳交")}</Button>
          </span>
        </div>
      )}
      {error && <p className="mt-2 text-[12.5px] text-wine">{error.message}</p>}
    </>
  );
}

/** 老師：全班的繳交狀況 */
function AllReports({ topic }: { topic: ClassroomTopic }) {
  const t = useT();
  const { data: list = [] } = useReports(topic.id);
  const { data: classroom } = useClassroom(topic.classroomId);
  return (
    <>
      <p className="mb-2 text-[12.5px] text-ink-dim">{t("已繳交")} <b className="text-ink">{list.length}</b>{classroom && ` / ${classroom.studentCount}`} {t("人")}</p>
      {list.map((r) => (
        <div key={r.id} className="border-t border-line py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="font-medium">{r.studentName}</b>
            <span className="flex items-center gap-2 text-[11.5px] text-ink-faint">{late(r, topic) && <Badge tone="wine">{t("逾期")}</Badge>}{formatDateTime(r.submittedAt)}</span>
          </div>
          <div className="mt-1"><FileLink r={r} /></div>
          {r.comment && <p className="mt-1 whitespace-pre-line text-[12.5px] text-ink-dim">{r.comment}</p>}
        </div>
      ))}
    </>
  );
}

export function DebateReports({ topic, teacher }: { topic: ClassroomTopic; teacher: boolean }) {
  return teacher ? <AllReports topic={topic} /> : <MyReport topic={topic} />;
}
