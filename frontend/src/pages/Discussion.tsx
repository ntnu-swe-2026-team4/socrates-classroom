import { useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { useCreatePost, useDeletePost, useMe, usePosts } from "@/api/queries";
import type { DiscussionPost } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { useT } from "@/i18n";

/** 發文框：學生可以勾選匿名（同學看不到名字，老師看得到） */
function Composer({ classroomId, topicId, parentId, placeholder, onDone, autoFocus }: {
  classroomId: string; topicId: string | null; parentId?: string; placeholder: string; onDone?: () => void; autoFocus?: boolean;
}) {
  const t = useT();
  const { data: me } = useMe();
  const create = useCreatePost(classroomId, topicId);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const submit = () => body.trim() && create.mutate({ body, anonymous, parentId: parentId ?? null }, { onSuccess: () => { setBody(""); onDone?.(); } });
  return (
    <div className="space-y-2">
      <Textarea autoFocus={autoFocus} rows={parentId ? 2 : 3} placeholder={placeholder} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {me?.role === "student"
          ? <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-dim" title={t("同學看不到你的名字，老師看得到")}><input type="checkbox" className="size-4 accent-bronze" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />{t("匿名（老師仍看得到）")}</label>
          : <span />}
        <span className="flex gap-2">
          {onDone && parentId && <Button variant="ghost" size="sm" onClick={onDone}>{t("取消")}</Button>}
          <Button size="sm" disabled={!body.trim() || create.isPending} onClick={submit}>{parentId ? t("回覆") : t("發佈")}</Button>
        </span>
      </div>
      {create.error && <p className="text-[12.5px] text-wine">{create.error.message}</p>}
    </div>
  );
}

function PostBody({ p, canDelete, onDelete }: { p: DiscussionPost; canDelete: boolean; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="group">
      <div className="flex items-center gap-2 text-[12px]">
        <b className={cn("font-medium", p.deleted && "text-ink-faint")}>{p.deleted ? t("（已刪除）") : p.authorLabel}</b>
        {p.authorRole === "teacher" && !p.deleted && <Badge tone="bronze">{t("老師")}</Badge>}
        <span className="text-ink-faint">{formatDateTime(p.createdAt)}</span>
        {canDelete && !p.deleted && (
          <button type="button" aria-label={t("刪除貼文")} onClick={onDelete} className="ml-auto cursor-pointer text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-wine focus:opacity-100"><Trash2 className="size-3.5" /></button>
        )}
      </div>
      {!p.deleted && <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed">{p.body}</p>}
    </div>
  );
}

/** 討論區：topicId = null 為教室討論區，否則為該場辯論的討論區。回覆只有一層 */
export function DiscussionBoard({ classroomId, topicId }: { classroomId: string; topicId: string | null }) {
  const t = useT();
  const { data: me } = useMe();
  const { data: posts = [] } = usePosts(classroomId, topicId);
  const del = useDeletePost(classroomId, topicId);
  const [replying, setReplying] = useState<string | null>(null);
  const teacher = me?.role === "teacher";
  const threads = posts.filter((p) => !p.parentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const repliesOf = (id: string) => posts.filter((p) => p.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canDelete = (p: DiscussionPost) => p.isMine || teacher;

  return (
    <div>
      <div className="border-b border-line pb-5"><Composer classroomId={classroomId} topicId={topicId} placeholder={topicId ? t("對這場辯論有什麼想法或疑問？") : t("想問老師或同學什麼？")} /></div>
      {threads.map((th) => (
        <article key={th.id} className="border-b border-line py-4 last:border-b-0">
          <PostBody p={th} canDelete={canDelete(th)} onDelete={() => del.mutate(th.id)} />
          {repliesOf(th.id).length > 0 && (
            <div className="mt-3 space-y-3 border-l-2 border-line pl-4">
              {repliesOf(th.id).map((r) => <PostBody key={r.id} p={r} canDelete={canDelete(r)} onDelete={() => del.mutate(r.id)} />)}
            </div>
          )}
          {!th.deleted && (replying === th.id
            ? <div className="mt-3 pl-4"><Composer autoFocus classroomId={classroomId} topicId={topicId} parentId={th.id} placeholder={t("回覆…")} onDone={() => setReplying(null)} /></div>
            : <button type="button" onClick={() => setReplying(th.id)} className="mt-2.5 inline-flex cursor-pointer items-center gap-1 text-xs text-ink-faint hover:text-bronze"><MessageSquare className="size-3.5" />{t("回覆")}</button>)}
        </article>
      ))}
      {!threads.length && <p className="pt-4 text-sm text-ink-faint">{t("還沒有人發言。")}</p>}
      {del.error && <p className="text-[12.5px] text-wine">{del.error.message}</p>}
    </div>
  );
}
