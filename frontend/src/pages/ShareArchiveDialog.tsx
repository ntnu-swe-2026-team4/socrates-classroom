import { useEffect, useState } from "react";
import type { Archive } from "@/api";
import { useShareTargets, useUpdateArchive } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * 私人題庫的協作：把一道私人題目分享給特定的同學、助教或老師，
 * 對方就能看到這道題目的內容與推論脈絡。archive = null 時關閉。
 */
export function ShareArchiveDialog({ archive, onClose }: { archive: Archive | null; onClose: () => void }) {
  const t = useT();
  const update = useUpdateArchive();
  const { data: targets = [] } = useShareTargets(!!archive);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (archive) setSelected(archive.sharedWithIds);
    update.reset();
    // 換成另一道題目時重新帶入它目前的分享名單
  }, [archive]);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Dialog open={!!archive} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {archive && (
          <>
            <p className="mb-1 text-xs font-medium text-bronze">{t("私人題庫協作")}</p>
            <DialogTitle className="font-serif text-xl font-normal">{t("分享題目")}</DialogTitle>
            <DialogDescription>
              <span className="my-2 block border-l-2 border-bronze pl-2.5 font-serif text-[14px] font-medium text-ink">{archive.title}</span>
              {t("勾選要分享的對象。確認後，對方的私人題庫裡會出現這道題目，看得到內容與推論脈絡。")}
            </DialogDescription>

            <div className="my-4 space-y-2">
              <div className="text-xs tracking-wider text-ink-faint">{t("選擇分享對象（可多選）")}</div>
              {targets.map((target) => {
                const checked = selected.includes(target.id);
                return (
                  <label key={target.id}
                    className={cn("flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition-colors select-none",
                      checked ? "border-bronze bg-bronze-soft" : "border-line bg-bg-2/50 hover:border-line-strong hover:bg-bg-2")}>
                    <span className="flex items-center gap-3">
                      <input type="checkbox" checked={checked} onChange={() => toggle(target.id)} className="size-4 cursor-pointer rounded accent-bronze" />
                      <span>
                        <span className="font-serif text-[14px] font-medium">{target.name}</span>
                        <span className="ml-2 text-xs text-ink-faint">（{t(target.role)}）</span>
                      </span>
                    </span>
                    {checked && <Badge tone="bronze">{t("已勾選")}</Badge>}
                  </label>
                );
              })}
              {!targets.length && <p className="text-[12.5px] text-ink-faint">{t("目前沒有可以分享的對象。")}</p>}
            </div>

            {update.error && <p className="text-[12.5px] text-wine">{update.error.message}</p>}
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-xs text-ink-faint">{t("已選取 {n} 位", { n: selected.length })}</span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>{t("取消")}</Button>
                <Button size="sm" disabled={update.isPending}
                  onClick={() => update.mutate({ id: archive.id, sharedWithIds: selected }, { onSuccess: onClose })}>
                  {update.isPending ? t("儲存中…") : t("確認分享")}
                </Button>
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
