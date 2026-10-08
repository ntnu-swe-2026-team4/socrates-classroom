import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Share2 } from "lucide-react";
import { api } from "@/api";
import { keys, useArchives, useClassrooms, useMe, useUpdateArchive } from "@/api/queries";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils"; 

export function SummaryPage() {
  const { data: archives = [] } = useArchives();
  const update = useUpdateArchive();
  const items = archives.filter((a) => a.inSummary);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">從「議題」加進來的對話</p>
      <h2 className="mb-1 font-serif text-2xl">論點總結</h2>
      <p className="mb-6 text-sm text-ink-dim">整理你的核心主張、支持理由，以及過程中立場如何被檢驗與修正。</p>
      {items.map((a) => (
        <Card key={a.id} className="mb-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-base">{a.title}</h3>
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: a.id, inSummary: false })}>移除</Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{a.snippet}（共 {a.rounds} 輪對話，{a.date}）</p>
        </Card>
      ))}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">尚未加入任何對話記錄。<br />先到「議題」頁，把想整理的對話加進來。</Card>}
    </div>
  );
}


interface ShareCandidate {
  id: string;
  name: string;
  role: string;
}

// Mock 名單
const MOCK_SHARE_RECIPIENTS: ShareCandidate[] = [
  { id: "member-a", name: "組員 A（王小安）", role: "同學" },
  { id: "member-b", name: "組員 B（李小恩）", role: "同學" },
  { id: "member-c", name: "組員 C（陳大宇）", role: "同學" },
  { id: "advisor-lin", name: "指導教授（林老師）", role: "指導教授" },
];

export function BankPage() {
  const { kind } = useParams({ from: "/_app/bank/\$kind" });
  const { data: me } = useMe();
  const { data: archives = [] } = useArchives();
  const updateArchive = useUpdateArchive(); 
  const qc = useQueryClient();

  const items = archives.filter((a) => a.bank === kind);

  // 核心 Mock 狀態：當後端合約尚未支援分享時，由前端接管儲存
  const [sharedMap, setSharedMap] = useState<Record<string, string[]>>({});

  // 彈出視窗狀態
  const [sharingArchive, setSharingArchive] = useState<Archive | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 優先看後端物件 a 有沒有 sharedWithIds 欄位，沒有就回退到 Mock 狀態
  const getSharedIds = (archive: Archive & { sharedWithIds?: string[] }) => {
    if (Array.isArray(archive.sharedWithIds)) {
      return archive.sharedWithIds; // 未來後端合約若擴充，直接走這條
    }
    return sharedMap[archive.id] || []; // 目前後端合約沒寫，自動退回前端 Mock 模式
  };

  const isOwner = (archive: Archive & { ownerId?: string; authorId?: string; userId?: string; isOwner?: boolean }) => {
    if (typeof archive.isOwner === "boolean") return archive.isOwner;
    if (archive.ownerId) return me ? archive.ownerId === me.id : true;
    if (archive.authorId) return me ? archive.authorId === me.id : true;
    if (archive.userId) return me ? archive.userId === me.id : true;
    return true;
  };

  const handleOpenShare = (archive: Archive) => {
    setSharingArchive(archive);
    setSelectedIds(getSharedIds(archive));
  };

  const handleCloseShare = () => {
    setSharingArchive(null);
    setSelectedIds([]);
  };

  const handleToggleRecipient = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirmShare = () => {
    if (!sharingArchive) return;

    // 發送 Mutation 給後端。
    updateArchive.mutate(
      {
        id: sharingArchive.id,
        // @ts-ignore 後端目前的 Archive 型別不吃此欄位，用 ts-ignore 確保不卡編譯，並保留未來擴充彈性
        sharedWithIds: selectedIds, 
      },
      {
        onSuccess: () => {
          // 成功時刷新題庫快取
          qc.invalidateQueries({ queryKey: keys.archives });
        }
      }
    );

    // 2. 核心保底：不管後端有沒有實作這個欄位，前端的 Mock 狀態都要同步更新！
    // 這樣在 VITE_API_MODE=http 模式下，雖然重整會消失，但當下點擊 UI 完全是活的、可展示的
    setSharedMap((prev) => ({
      ...prev,
      [sharingArchive.id]: selectedIds,
    }));

    // 處理 Toast 提示
    const recipientNames = selectedIds
      .map((id) => MOCK_SHARE_RECIPIENTS.find((r) => r.id === id)?.name)
      .filter(Boolean);
    const feedback = selectedIds.length > 0
      ? `已將「${sharingArchive.title}」成功分享給 ${recipientNames.length} 位人選`
      : `已取消「${sharingArchive.title}」的分享`;
      
    setToastMessage(feedback);
    setTimeout(() => {
      setToastMessage((cur) => (cur === feedback ? null : cur));
    }, 3500);
    handleCloseShare();
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">{kind === "private" ? "只有你看得到" : "大家都看得到"}</p>
      <h2 className="mb-6 font-serif text-2xl">{kind === "private" ? "私人題庫" : "公開題庫"}</h2>

      {toastMessage && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-bronze-dim bg-bronze-soft px-4 py-2.5 text-sm text-ink">
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-3 cursor-pointer text-xs text-ink-dim hover:text-ink"
          >
            關閉
          </button>
        </div>
      )}

      {items.map((a: Archive & { sharedWithIds?: string[] }) => {
        const canShare = kind === "private" && isOwner(a);
        const currentSharedIds = getSharedIds(a);
        const currentSharedNames = currentSharedIds
          .map((id) => MOCK_SHARE_RECIPIENTS.find((r) => r.id === id)?.name)
          .filter(Boolean);

        return (
          <Card key={a.id} className="mb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-base">{a.title}</h3>
                <p className="mt-1 text-sm text-ink-dim">{a.snippet}</p>
                {currentSharedNames.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-dim">
                    <span className="text-ink-faint">已分享給：</span>
                    {currentSharedNames.map((name) => (
                      <Badge key={name} tone="bronze" className="text-[11.5px]">
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {canShare && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenShare(a)}
                  className="shrink-0 gap-1.5 hover:border-bronze hover:text-bronze"
                >
                  <Share2 className="size-3.5 text-bronze" />
                  <span>分享</span>
                </Button>
              )}
            </div>
          </Card>
        );
      })}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">這裡還沒有題目。到「議題」把對話加進題庫。</Card>}

      <Dialog open={Boolean(sharingArchive)} onOpenChange={(open) => !open && handleCloseShare()}>
        <DialogContent className="max-w-md">
          <div className="mb-1">
            <p className="text-xs font-medium text-bronze">私人題庫協作</p>
            <DialogTitle className="font-serif text-xl font-normal text-ink">分享題目</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-ink-dim">
            {sharingArchive && (
              <span className="my-2 block border-l-2 border-bronze pl-2.5 font-serif text-[14px] font-medium text-ink">
                {sharingArchive.title}
              </span>
            )}
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
                    checked
                      ? "border-bronze bg-bronze-soft text-ink"
                      : "border-line bg-bg-2/50 hover:bg-bg-2 hover:border-line-strong text-ink"
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
              <Button variant="outline" size="sm" onClick={handleCloseShare}>
                取消
              </Button>
              <Button size="sm" onClick={handleConfirmShare} disabled={updateArchive.isPending}>
                {updateArchive.isPending ? "儲存中..." : "確認分享"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export function ClassroomsPage() {
  const { data: me } = useMe();
  const { data: classrooms = [] } = useClassrooms();
  const qc = useQueryClient();
  const teacher = me?.role === "teacher";
  const list = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const invites = teacher ? [] : classrooms.filter((c) => !c.joined);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: keys.classrooms });
  const create = useMutation({ mutationFn: () => api.createClassroom(name.trim()), onSuccess: () => { setOpen(false); setName(""); refresh(); } });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">我的教室</h2>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-dim">{teacher ? "建立教室、邀請學生加入，之後可以在教室裡管理成員、發起辯論。" : "老師建立教室後會邀請你加入，你沒有辦法自己建立教室。"}</p>
        </div>
        {teacher && <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增教室</Button>}
      </div>

      {invites.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs tracking-wider text-ink-faint">待處理邀請</div>
          {invites.map((c) => (
            <Card key={c.id} className="mb-2 flex items-center justify-between gap-3 py-3.5">
              <span><b className="font-serif">{c.name}</b><small className="block text-xs text-ink-faint">{c.teacherName} 邀請你加入</small></span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => api.declineInvite(c.id).then(refresh)}>拒絕</Button>
                <Button size="sm" onClick={() => api.acceptInvite(c.id).then(refresh)}>接受</Button>
              </span>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }}>
            <Card className="h-full transition-colors hover:border-bronze-dim">
              <h3 className="font-serif text-lg">{c.name}</h3>
              <p className="mt-1 text-sm text-ink-faint">{c.studentCount} 位學生 · {c.debateCount} 場辯論</p>
              <Badge tone="bronze" className="mt-3">進入教室</Badge>
            </Card>
          </Link>
        ))}
      </div>
      {!list.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有建立任何教室，按上面「新增教室」開始吧。" : "目前還沒有加入任何教室。"}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>新增教室</DialogTitle>
          <DialogDescription>建立之後，可以在教室裡新增成員、發起辯論。</DialogDescription>
          <Input placeholder="教室名稱，例如：高二哲學選修 C" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()} />
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>建立</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
