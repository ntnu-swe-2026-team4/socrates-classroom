import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, FileText, Link2, MessageCircle, Pencil, Trash2, Upload, X } from "lucide-react";
import { api } from "@/api";
import { useActivity, useInvalidateTopic, useMe, useMembers, useTopic } from "@/api/queries";
import type { ClassroomTopic, TopicResource } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/utils";
import { DueLabel, STAGE_NAME, StageBar, TOPIC_TYPE } from "./ClassroomPage";
import { DiscussionBoard } from "./Discussion";
import { TopicReports } from "./TopicReports";
import { TopicFormDialog } from "./TopicFormDialog";

function ResourceRow({ r, onDelete }: { r: TopicResource; onDelete?: () => void }) {
  const file = r.kind === "file" ? r.file : null;
  return (
    <div className="flex items-center gap-3 border-t border-line px-1 py-2.5 first:border-t-0">
      {file ? <FileText className="size-4 shrink-0 text-bronze" /> : <Link2 className="size-4 shrink-0 text-bronze" />}
      <a href={file ? file.url : r.kind === "link" ? r.url : undefined} target="_blank" rel="noreferrer" download={file?.name}
        className="min-w-0 flex-1 truncate text-[13.5px] hover:text-bronze hover:underline">{file ? file.name : r.kind === "link" ? r.name : ""}</a>
      <span className="shrink-0 text-[11.5px] text-ink-faint">{file ? formatBytes(file.size) : "連結"}</span>
      {onDelete && <button type="button" aria-label="移除資源" onClick={onDelete} className="cursor-pointer text-ink-faint hover:text-wine"><X className="size-4" /></button>}
    </div>
  );
}

/** 議題說明與相關資料（老師可加連結、上傳檔案） */
function TopicInfo({ topic, teacher }: { topic: ClassroomTopic; teacher: boolean }) {
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
    <section className="border-b border-line py-5 first:pt-0 last:border-b-0">
      <div className="mb-2 text-xs tracking-wider text-ink-faint">議題說明</div>
      {topic.description ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{topic.description}</p> : <p className="text-sm text-ink-faint">沒有額外說明。</p>}
      {(teacher || topic.resources.length > 0) && <div className="mb-2 mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
        <span className="text-xs tracking-wider text-ink-faint">相關資料</span>
        {teacher && (
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}><Link2 className="size-3.5" />加連結</Button>
            <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}><Upload className="size-3.5" />{upload.isPending ? "上傳中…" : "上傳檔案"}</Button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { for (const f of e.target.files ?? []) upload.mutate(f); e.target.value = ""; }} />
          </span>
        )}
      </div>}
      {adding && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="h-9 min-w-40 flex-1" placeholder="名稱（選填）" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="h-9 min-w-56 flex-[2]" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && addLink.mutate()} />
          <Button size="sm" className="h-9" disabled={!url.trim() || addLink.isPending} onClick={() => addLink.mutate()}>加入</Button>
        </div>
      )}
      {topic.resources.map((r) => <ResourceRow key={r.id} r={r} onDelete={teacher ? () => remove.mutate(r.id) : undefined} />)}
      {teacher && !topic.resources.length && <p className="text-sm text-ink-faint">還沒有資料。可以加入閱讀材料的連結，或上傳講義、影片等檔案。</p>}
      {error && <p className="mt-2 text-[12.5px] text-wine">{error.message}</p>}
    </section>
  );
}

/** 進入議題的活動：團體議題是辯論，個人議題是個人思辨（完成後看到結算） */
function StartPanel({ topic, teacher }: { topic: ClassroomTopic; teacher: boolean }) {
  const { data: activity } = useActivity(topic.activityId ?? "");
  const { data: members = [] } = useMembers(topic.activityId ?? "", topic.type === "individual");
  if (!activity) return null;

  if (topic.type === "group") {
    return (
      <section className="border-b border-line py-5 first:pt-0 last:border-b-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs tracking-wider text-ink-faint">辯論活動 · {STAGE_NAME[activity.stage]}</span>
          <span className="flex flex-wrap gap-1.5">{activity.axes.map((x) => <Badge key={x.key}>{x.left} ⟷ {x.right}</Badge>)}</span>
        </div>
        <StageBar stage={activity.stage} />
        <Button className="mt-4" asChild>
          <Link to="/classrooms/$classroomId/activities/$activityId" params={{ classroomId: topic.classroomId, activityId: activity.id }}>
            <MessageCircle className="size-4" />{teacher ? "管理辯論" : activity.stage === "done" ? "查看結果" : "進入辯論"}
          </Link>
        </Button>
      </section>
    );
  }

  // 個人議題：學生看自己的狀態，老師看完成人數
  const status = members.find((m) => m.isMe)?.individual?.status ?? "todo";
  const doneCount = members.filter((m) => m.individual?.status === "done").length;
  const text = teacher ? `已完成 ${doneCount} / ${members.length} 人`
    : { todo: "讀完說明和資料後，和蘇格拉底一起思辨你的想法。", talking: "你已經開始思辨了，可以接著上次的對話。", confirmed: "你已經整理好論點，確認後按「完成」就能看到結算。", done: "你已經完成這個議題的思辨。" }[status];
  const label = teacher ? "查看學生進度" : { todo: "開始個人思辨", talking: "繼續個人思辨", confirmed: "繼續個人思辨", done: "查看結算" }[status];
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-5 first:pt-0 last:border-b-0">
      <p className="text-sm text-ink-dim">{text}</p>
      <Button asChild>
        <Link to="/classrooms/$classroomId/activities/$activityId" params={{ classroomId: topic.classroomId, activityId: activity.id }}><MessageCircle className="size-4" />{label}</Link>
      </Button>
    </section>
  );
}

function DeleteDialog({ topic, open, onOpenChange }: { topic: ClassroomTopic; open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateTopic(topic.classroomId);
  const del = useMutation({
    mutationFn: () => api.deleteTopic(topic.id),
    onSuccess: () => { invalidate(); navigate({ to: "/classrooms/$classroomId", params: { classroomId: topic.classroomId }, search: { tab: "topics" } }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>刪除議題？</DialogTitle>
        <DialogDescription>「{topic.title}」會被永久刪除{topic.type === "group" ? "，連同辯論活動裡學生的對話、分組與成績" : ""}，無法復原。</DialogDescription>
        {del.error && <p className="mb-3 text-[12.5px] text-wine">{del.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}><Trash2 className="size-4" />刪除</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClassroomTopicPage() {
  const { classroomId, topicId } = useParams({ from: "/_app/classrooms/$classroomId/topics/$topicId" });
  const { data: me } = useMe();
  const { data: topic, error } = useTopic(topicId);
  const { data: activity } = useActivity(topic?.activityId ?? "");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const teacher = me?.role === "teacher";

  const back = <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "topics" }} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-bg-2 px-3.5 py-1.5 text-[13px] text-ink-dim hover:text-ink"><ArrowLeft className="size-3.5" />回議題列表</Link>;
  if (error) return <div className="mx-auto max-w-3xl p-8">{back}<p className="mt-6 text-sm text-ink-faint">{error.message}</p></div>;
  if (!topic) return null;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2"><Badge tone={TOPIC_TYPE[topic.type].tone}>{TOPIC_TYPE[topic.type].name}議題</Badge><DueLabel at={topic.dueAt} /></div>
          <h2 className="font-serif text-2xl leading-snug">{topic.title}</h2>
        </div>
        {teacher && (
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={topic.type === "group" && !activity} onClick={() => setEditing(true)}><Pencil className="size-3.5" />編輯</Button>
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Trash2 className="size-3.5" />刪除</Button>
          </span>
        )}
      </div>
      <div className="grid items-start border-t border-line pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="lg:pr-8">
          <TopicInfo topic={topic} teacher={teacher} />
          <StartPanel topic={topic} teacher={teacher} />
          <TopicReports topic={topic} teacher={teacher} />
        </div>
        <section className="max-lg:mt-2 max-lg:border-t max-lg:border-line max-lg:pt-6 lg:min-h-full lg:border-l lg:border-line lg:pl-8">
          <h3 className="mb-3 font-serif text-lg">討論{topic.postCount > 0 && <span className="ml-2 font-sans text-sm text-ink-faint">{topic.postCount}</span>}</h3>
          <DiscussionBoard classroomId={classroomId} topicId={topic.id} />
        </section>
      </div>
      {teacher && (
        <>
          <TopicFormDialog classroomId={classroomId} topic={topic} activity={activity} open={editing} onOpenChange={setEditing} />
          <DeleteDialog topic={topic} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </div>
  );
}
