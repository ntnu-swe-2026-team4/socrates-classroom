import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useNoteActions, useNotes } from "@/api/queries";
import type { Activity, ThinkingNote } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function NoteRow({ n, activityId, readOnly }: { n: ThinkingNote; activityId: string; readOnly: boolean }) {
  const { update, remove } = useNoteActions(activityId);
  const [editing, setEditing] = useState<string | null>(null);
  const quote = n.kind === "highlight";
  return (
    <li className="group flex items-start gap-2 border-t border-line py-2.5 first:border-t-0">
      {editing !== null ? (
        <div className="flex-1 space-y-1.5">
          <Textarea rows={2} value={editing} onChange={(e) => setEditing(e.target.value)} />
          <span className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="size-7" aria-label="取消" onClick={() => setEditing(null)}><X className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label="儲存" disabled={!editing.trim()} onClick={() => update.mutate({ id: n.id, text: editing }, { onSuccess: () => setEditing(null) })}><Check className="size-3.5" /></Button>
          </span>
        </div>
      ) : (
        <>
          <p className={cn("flex-1 whitespace-pre-line text-[13px] leading-relaxed", quote && "border-l-2 border-bronze-dim pl-2.5 font-serif text-ink-dim")}>{n.text}</p>
          {!readOnly && (
            <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {!quote && <Button variant="ghost" size="icon" className="size-7" aria-label="修改筆記" onClick={() => setEditing(n.text)}><Pencil className="size-3" /></Button>}
              <Button variant="danger" size="icon" className="size-7" aria-label="刪除筆記" onClick={() => remove.mutate(n.id)}><Trash2 className="size-3" /></Button>
            </span>
          )}
        </>
      )}
    </li>
  );
}

/** 學生自己的思路筆記：對話中標註的重點（引言樣式）與自己寫下的想法，只有本人看得到 */
export function NotesCard({ a, readOnly }: { a: Activity; readOnly: boolean }) {
  const { data: notes = [] } = useNotes(a.id);
  const { create } = useNoteActions(a.id);
  const [text, setText] = useState("");
  const add = () => text.trim() && create.mutate({ kind: "thought", text }, { onSuccess: () => setText("") });
  return (
    <Card className="p-4">
      <CardTitle className="flex items-center justify-between">我的筆記 <span className="font-sans text-xs font-normal text-ink-faint">只有你看得到</span></CardTitle>
      {notes.length > 0
        ? <ul className="max-h-64 overflow-y-auto">{notes.map((n) => <NoteRow key={n.id} n={n} activityId={a.id} readOnly={readOnly} />)}</ul>
        : <p className="text-[12.5px] leading-relaxed text-ink-faint">在對話裡把滑鼠移到一句話上，按「標註」就會收進這裡；也可以寫下自己的想法。</p>}
      {!readOnly && (
        <div className="mt-3 flex items-end gap-2">
          <Textarea rows={1} placeholder="寫下現在的想法…" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }} />
          <Button size="sm" className="h-10" disabled={!text.trim() || create.isPending} onClick={add}>加入</Button>
        </div>
      )}
      {create.error && <p className="mt-1.5 text-[12.5px] text-wine">{create.error.message}</p>}
    </Card>
  );
}
