import { useEffect, useState } from "react";
import { Clock, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useAnnouncements, useDeleteAnnouncement, useSaveAnnouncement } from "@/api/queries";
import type { Announcement } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, formatDateTime, fromLocalInput, toLocalInput } from "@/lib/utils";
import { useT } from "@/i18n";

function AnnouncementCard({ a, onEdit, onDelete }: { a: Announcement; onEdit?: () => void; onDelete?: () => void }) {
  const t = useT();
  return (
    <Card className={cn(!a.published && "border-dashed")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {a.pinned && <Badge tone="bronze"><Pin className="mr-1 size-3" />{t("置頂")}</Badge>}
            {!a.published && <Badge><Clock className="mr-1 size-3" />{t("排程 {time}", { time: formatDateTime(a.publishAt) })}</Badge>}
          </div>
          <h3 className="font-serif text-[15.5px] leading-snug">{a.title}</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">{a.authorName} · {formatDateTime(a.publishAt)}{a.updatedAt > a.publishAt && a.updatedAt !== a.createdAt ? t("（已編輯）") : ""}</p>
        </div>
        {(onEdit || onDelete) && (
          <span className="flex shrink-0 gap-1">
            {onEdit && <Button variant="ghost" size="icon" className="size-8" aria-label={t("編輯公告")} onClick={onEdit}><Pencil className="size-3.5" /></Button>}
            {onDelete && <Button variant="danger" size="icon" className="size-8" aria-label={t("刪除公告")} onClick={onDelete}><Trash2 className="size-3.5" /></Button>}
          </span>
        )}
      </div>
      {a.body && <p className="mt-2.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-dim">{a.body}</p>}
    </Card>
  );
}

/** 新增（不帶 announcement）或編輯公告。已發布的公告編輯時不能再改發布時間 */
function AnnouncementFormDialog({ classroomId, announcement, open, onOpenChange }: {
  classroomId: string; announcement?: Announcement; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const save = useSaveAnnouncement(classroomId, announcement?.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");
  const published = !!announcement?.published;

  useEffect(() => {
    if (!open) return;
    setTitle(announcement?.title ?? "");
    setBody(announcement?.body ?? "");
    setPinned(announcement?.pinned ?? false);
    const scheduled = !!announcement && !announcement.published;
    setMode(scheduled ? "schedule" : "now");
    setAt(scheduled ? toLocalInput(announcement.publishAt) : "");
    setErr("");
    save.reset();
    // 只在開啟時帶入目前的值
  }, [open]);

  function submit() {
    if (!title.trim()) return setErr(t("請填寫公告標題。"));
    let publishAt: string | null = null;
    if (published) publishAt = announcement.publishAt;
    else if (mode === "schedule") {
      publishAt = fromLocalInput(at);
      if (!publishAt) return setErr(t("請選擇發布時間。"));
      if (new Date(publishAt).getTime() <= Date.now()) return setErr(t("排程時間要晚於現在；要馬上發布請選「立即發布」。"));
    }
    setErr("");
    save.mutate({ title: title.trim(), body: body.trim(), pinned, publishAt }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{announcement ? t("編輯公告") : t("新增公告")}</DialogTitle>
        <DialogDescription>{published ? t("這則公告已於 {time} 發布。", { time: formatDateTime(announcement.publishAt) }) : t("可以立即發布，或排程在指定時間讓學生看到。")}</DialogDescription>
        <div className="space-y-4 text-sm">
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("標題")}</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("例如：下週請先讀完《理想國》第一卷")} /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("內容")}</span><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("要讓學生知道的事……")} /></label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-dim">
            <input type="checkbox" className="size-4 accent-bronze" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />{t("置頂（顯示在最上方）")}
          </label>
          {!published && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex gap-0.5 rounded-full border border-line-strong bg-bg-2 p-0.5">
                {([["now", "立即發布"], ["schedule", "排程發布"]] as const).map(([v, n]) => (
                  <button key={v} type="button" onClick={() => setMode(v)} className={cn("cursor-pointer rounded-full px-4 py-1.5 text-[13px]", mode === v ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{t(n)}</button>
                ))}
              </div>
              {mode === "schedule" && <Input type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} />}
            </div>
          )}
          {(err || save.error) && <p className="text-[12.5px] text-wine">{err || save.error?.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button disabled={save.isPending} onClick={submit}>{announcement ? t("儲存") : mode === "schedule" ? t("排程") : t("發布")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ classroomId, announcement, onOpenChange }: { classroomId: string; announcement: Announcement | null; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const del = useDeleteAnnouncement(classroomId);
  return (
    <Dialog open={!!announcement} onOpenChange={(v) => { if (!v) del.reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogTitle>{t("刪除公告？")}</DialogTitle>
        <DialogDescription>{t("「{title}」會被永久刪除，學生也看不到了。", { title: announcement?.title ?? "" })}</DialogDescription>
        {del.error && <p className="mb-3 text-[12.5px] text-wine">{del.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
          <Button variant="danger" disabled={del.isPending} onClick={() => announcement && del.mutate(announcement.id, { onSuccess: () => onOpenChange(false) })}><Trash2 className="size-4" />{t("刪除")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 教室的「公告」分頁：老師可新增、編輯、刪除、排程 */
export function AnnouncementsTab({ classroomId, staff }: { classroomId: string; staff: boolean }) {
  const t = useT();
  const { data: list = [] } = useAnnouncements(classroomId);
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  return (
    <div>
      {staff && <div className="mb-4 flex justify-end"><Button onClick={() => setEditing("new")}><Plus className="size-4" />{t("新增公告")}</Button></div>}
      <div className="space-y-3">
        {list.map((a) => <AnnouncementCard key={a.id} a={a} onEdit={staff ? () => setEditing(a) : undefined} onDelete={staff ? () => setDeleting(a) : undefined} />)}
      </div>
      {!list.length && <p className="text-sm text-ink-faint">{staff ? t("還沒有公告。按右上「新增公告」發布第一則。") : t("目前沒有公告。")}</p>}
      {staff && (
        <>
          <AnnouncementFormDialog classroomId={classroomId} announcement={editing === "new" ? undefined : editing ?? undefined} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />
          <DeleteDialog classroomId={classroomId} announcement={deleting} onOpenChange={(v) => !v && setDeleting(null)} />
        </>
      )}
    </div>
  );
}
