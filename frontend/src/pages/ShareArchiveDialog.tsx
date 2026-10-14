import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useUpdateArchive } from "@/api/queries";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ShareArchiveDialogProps {
  archive: any | null; // 當前正在分享的對話物件，為 null 時關閉
  onClose: () => void;
}

const MOCK_SHARE_RECIPIENTS = [
  { id: "member-a", name: "組員 A（王小安）", role: "同學" },
  { id: "member-b", name: "組員 B（李小恩）", role: "同學" },
  { id: "member-c", name: "組員 C（陳大宇）", role: "同學" },
  { id: "advisor-lin", name: "指導教授（林老師）", role: "指導教授" },
];

// 全域導出供其他頁面讀取狀態的輔助函式
export const getSharedIdsFromStorage = (archiveId: string) => {
  const savedMap = JSON.parse(localStorage.getItem("mock_shared_map") || "{}");
  return savedMap[archiveId] || [];
};

export function ShareArchiveDialog({ archive, onClose }: ShareArchiveDialogProps) {
  const updateArchive = useUpdateArchive();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 當開啟的對話改變時，同步載入舊有的分享紀錄
  useEffect(() => {
    if (archive) {
      if (Array.isArray(archive.sharedWithIds)) {
        setSelectedIds(archive.sharedWithIds);
      } else {
        setSelectedIds(getSharedIdsFromStorage(archive.id));
      }
    }
  }, [archive]);

  if (!archive) return null;

  const handleToggleRecipient = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirmShare = () => {
    // 1. 調用 API 更新後端狀態（保留擴充彈性）
    updateArchive.mutate(
      {
        id: archive.id,
        // @ts-ignore
        sharedWithIds: selectedIds,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: keys.archives });
        },
      }
    );

    // 2. 純前端 Mock 測試保底：存入 localStorage
    const savedMap = JSON.parse(localStorage.getItem("mock_shared_map") || "{}");
    savedMap[archive.id] = selectedIds;
    localStorage.setItem("mock_shared_map", JSON.stringify(savedMap));

    onClose();
  };

  return (
    <Dialog open={Boolean(archive)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <div className="mb-1">
          <p className="text-xs font-medium text-bronze">私人題庫協作</p>
          <DialogTitle className="font-serif text-xl font-normal text-ink">分享題目</DialogTitle>
        </div>
        <DialogDescription className="text-sm text-ink-dim">
          <span className="my-2 block border-l-2 border-bronze pl-2.5 font-serif text-[14px] font-medium text-ink">
            {archive.title}
          </span>
          勾選要分享的特定人選。確認後，對方將能查閱這道私人題目的內容與推論脈絡。
        </DialogDescription>
        
        <div className="my-4 space-y-2">
          <div className="text-xs font-medium tracking-wider text-ink-faint">選擇分享人選（可多選）</div>
          {MOCK_SHARE_RECIPIENTS.map((target) => {
            const checked = selectedIds.includes(target.id);
            return (
              <label
                key={target.id}
                className={cn(
                  "flex items-center justify-between rounded-2xl border p-3 transition-colors cursor-pointer select-none",
                  checked ? "border-bronze bg-bronze-soft text-ink" : "border-line bg-bg-2/50 hover:bg-bg-2 hover:border-line-strong text-ink"
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleRecipient(target.id)}
                    className="size-4 accent-bronze rounded cursor-pointer"
                  />
                  <div>
                    <span className="font-serif text-[14px] font-medium">{target.name}</span>
                    <span className="ml-2 text-xs text-ink-faint">({target.role})</span>
                  </div>
                </div>
                {checked && <Badge tone="bronze">已勾選</Badge>}
              </label>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <span className="text-xs text-ink-faint">
            已選取 <b className="font-semibold text-bronze">{selectedIds.length}</b> 位對象
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" onClick={handleConfirmShare} disabled={updateArchive.isPending}>
              {updateArchive.isPending ? "儲存中..." : "確認分享"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
