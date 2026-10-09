import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, FileText, Link2, MessageCircle, Pencil, Trash2, Upload, X } from "lucide-react";
import { api } from "@/api";
import { useActivity, useInvalidateTopic, useIsStaff, useMe, useTopic } from "@/api/queries";
import type { ClassroomTopic, TopicResource } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/utils";
import { useT } from "@/i18n";
import { DueLabel, STAGE_NAME, StageBar } from "./ClassroomPage";
import { DiscussionBoard } from "./Discussion";
import { DebateFormDialog } from "./DebateFormDialog";
import { DebateReports } from "./DebateReports";

function ResourceRow({ r, onDelete }: { r: TopicResource; onDelete?: () => void }) {
  const t = useT();
  const file = r.kind === "file" ? r.file : null;
  return (
    <div className="flex items-center gap-3 border-t border-line px-1 py-2.5 first:border-t-0">
      {file ? <FileText className="size-4 shrink-0 text-bronze" /> : <Link2 className="size-4 shrink-0 text-bronze" />}
      <a href={file ? file.url : r.kind === "link" ? r.url : undefined} target="_blank" rel="noreferrer" download={file?.name}
        className="min-w-0 flex-1 truncate text-[13.5px] hover:text-bronze hover:underline">{file ? file.name : r.kind === "link" ? r.name : ""}</a>
      <span className="shrink-0 text-[11.5px] text-ink-faint">{file ? formatBytes(file.size) : t("連結")}</span>
      {onDelete && <button type="button" aria-label={t("移除資源")} onClick={onDelete} className="cursor-pointer text-ink-faint hover:text-wine"><X className="size-4" /></button>}
    </div>
  );
}

/** 相關資料（老師與助教可加連結、上傳檔案、移除） */
function DebateResources({ topic, canEdit }: { topic: ClassroomTopic; canEdit: boolean }) {
  const t = useT();
  const invalidate = useInvalidateTopic(topic.classroomId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const done = () => invalidate(topic);
  const addLink = useMutation({ mutationFn: () => api.addTopicLink(topic.id, { name, url }), onSuccess: () => { setName(""); setUrl(""); setAdding(false); done(); } });
  const upload = useMutation({ mutationFn: (f: File) => api.uploadTopicFile(topic.id, f), onSuccess: done });
  const remove = useMutation({ mutationFn: (rid: string) => api.deleteTopicResource(topic.id, rid), onSuccess: done });
  const error = addLink.error ?? upload.error ?? remove.error;

  return (
    <div>
      {canEdit && (
        <div className="mb-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}><Link2 className="size-3.5" />{t("加連結")}</Button>
          <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}><Upload className="size-3.5" />{upload.isPending ? t("上傳中…") : t("上傳檔案")}</Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { for (const f of e.target.files ?? []) upload.mutate(f); e.target.value = ""; }} />
        </div>
      )}
      {adding && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="h-9 min-w-32 flex-1" placeholder={t("名稱（選填）")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="h-9 min-w-40 flex-[2]" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && addLink.mutate()} />
          <Button size="sm" className="h-9" disabled={!url.trim() || addLink.isPending} onClick={() => addLink.mutate()}>{t("加入#add")}</Button>
        </div>
      )}
      {topic.resources.map((r) => <ResourceRow key={r.id} r={r} onDelete={canEdit ? () => remove.mutate(r.id) : undefined} />)}
      {!topic.resources.length && <p className="text-sm text-ink-faint">{canEdit ? t("還沒有資料。可以加入閱讀材料的連結，或上傳講義、影片等檔案。") : t("沒有相關資料。")}</p>}
      {error && <p className="mt-2 text-[12.5px] text-wine">{error.message}</p>}
    </div>
  );
}

/** 進入辯論：目前階段、進度條與進入按鈕 */
function StartPanel({ topic, teacher }: { topic: ClassroomTopic; teacher: boolean }) {
  const t = useT();
  const { data: activity } = useActivity(topic.activityId ?? "");
  if (!activity) return null;
  return (
    <section className="rounded-2xl border border-line bg-bg-1 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[13px]"><span className="font-semibold text-bronze">{t(STAGE_NAME[activity.stage])}</span></div>
          <StageBar stage={activity.stage} />
        </div>
        <Button asChild>
          <Link to="/classrooms/$classroomId/activities/$activityId" params={{ classroomId: topic.classroomId, activityId: activity.id }}>
            <MessageCircle className="size-4" />{teacher ? t("管理辯論") : activity.stage === "done" ? t("查看結果") : t("進入辯論")}
          </Link>
        </Button>
      </div>
      {activity.axes.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{activity.axes.map((x) => <Badge key={x.key}>{x.left} ⟷ {x.right}</Badge>)}</div>}
    </section>
  );
}

function DeleteDialog({ topic, open, onOpenChange }: { topic: ClassroomTopic; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const invalidate = useInvalidateTopic(topic.classroomId);
  const del = useMutation({
    mutationFn: () => api.deleteTopic(topic.id),
    onSuccess: () => { invalidate(); navigate({ to: "/classrooms/$classroomId", params: { classroomId: topic.classroomId }, search: { tab: "debates" } }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("刪除辯論？")}</DialogTitle>
        <DialogDescription>{t("「{title}」會被永久刪除，連同辯論活動裡學生的對話、分組與成績，無法復原。", { title: topic.title })}</DialogDescription>
        {del.error && <p className="mb-3 text-[12.5px] text-wine">{del.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
          <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}><Trash2 className="size-4" />{t("刪除")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClassroomDebatePage() {
  const t = useT();
  const { classroomId, debateId: topicId } = useParams({ from: "/_app/classrooms/$classroomId/debates/$debateId" });
  const { data: me } = useMe();
  const { data: topic, error } = useTopic(topicId);
  const { data: activity } = useActivity(topic?.activityId ?? "");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const teacher = me?.role === "teacher";
  const staff = useIsStaff(classroomId);

  const back = <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "debates" }} aria-label={t("回辯論列表")} title={t("回辯論列表")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-dim hover:bg-bg-2 hover:text-ink"><ArrowLeft className="size-4" /></Link>;
  if (error) return <div className="mx-auto max-w-3xl p-8">{back}<p className="mt-6 text-sm text-ink-faint">{error.message}</p></div>;
  if (!topic) return null;
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-bg/95 px-6 py-2 backdrop-blur">
        {back}
        <h2 className="min-w-0 flex-1 truncate font-serif text-[17px] leading-tight" title={topic.title}>{topic.title}</h2>
        <DueLabel at={topic.dueAt} />
        {teacher && (
          <span className="flex gap-1">
            <Button variant="ghost" size="icon" className="size-8" aria-label={t("編輯辯論")} title={t("編輯辯論")} disabled={!activity} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
            <Button variant="danger" size="icon" className="size-8" aria-label={t("刪除辯論")} title={t("刪除辯論")} onClick={() => setDeleting(true)}><Trash2 className="size-3.5" /></Button>
          </span>
        )}
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-x-8 gap-y-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 主要內容：進入辯論、說明、討論 */}
        <div className="min-w-0 space-y-6">
          <StartPanel topic={topic} teacher={teacher} />
          {topic.description && <p className="whitespace-pre-line text-[14px] leading-relaxed">{topic.description}</p>}
          <section>
            <h3 className="mb-3 font-serif text-lg">{t("討論")}{topic.postCount > 0 && <span className="ml-2 font-sans text-sm text-ink-faint">{topic.postCount}</span>}</h3>
            <DiscussionBoard classroomId={classroomId} topicId={topic.id} />
          </section>
        </div>
        {/* 次要資訊：預設收合，需要時才拉開 */}
        <aside className="lg:sticky lg:top-16 lg:border-l lg:border-line lg:pl-6">
          <Collapsible title={t("相關資料")} hint={topic.resources.length || undefined} defaultOpen={topic.resources.length > 0}><DebateResources topic={topic} canEdit={staff} /></Collapsible>
          {topic.acceptsReports && <Collapsible title={t("結論報告")}><DebateReports topic={topic} teacher={teacher} /></Collapsible>}
        </aside>
      </div>
      {teacher && (
        <>
          <DebateFormDialog classroomId={classroomId} topic={topic} activity={activity} open={editing} onOpenChange={setEditing} />
          <DeleteDialog topic={topic} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </div>
  );
}
