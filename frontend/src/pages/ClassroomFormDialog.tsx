import { useEffect, useState } from "react";
import { useSaveClassroom } from "@/api/queries";
import type { Classroom } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useT } from "@/i18n";

const MAX_DESC = 300;

/** 新增教室（不帶 classroom）與編輯教室名稱、簡介共用的視窗 */
export function ClassroomFormDialog({ classroom, open, onOpenChange, onSaved }: {
  classroom?: Classroom;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (c: Classroom) => void;
}) {
  const t = useT();
  const save = useSaveClassroom(classroom?.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(classroom?.name ?? "");
    setDescription(classroom?.description ?? "");
    save.reset();
    // 只在開啟時帶入目前的值
  }, [open]);

  const submit = () => {
    if (!name.trim() || save.isPending) return;
    save.mutate({ name: name.trim(), description: description.trim() }, {
      onSuccess: (c) => { onOpenChange(false); onSaved?.(c); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{classroom ? t("編輯教室") : t("新增教室")}</DialogTitle>
        <DialogDescription>{classroom ? t("修改教室名稱與簡介，學生會在教室首頁看到簡介。") : t("建立之後，可以在教室裡新增成員、發起辯論。")}</DialogDescription>
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-dim">{t("教室名稱")}</span>
            <Input placeholder={t("例如：高二哲學選修 C")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between text-xs text-ink-dim"><span>{t("教室簡介（選填）")}</span><span className="text-ink-faint">{description.length} / {MAX_DESC}</span></span>
            <Textarea rows={4} maxLength={MAX_DESC} placeholder={t("這堂課要討論什麼、適合哪些同學……")} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {save.error && <p className="text-[12.5px] text-wine">{save.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button disabled={!name.trim() || save.isPending} onClick={submit}>{classroom ? t("儲存") : t("建立")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
