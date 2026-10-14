import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { KeyRound, Mail, Plus, Share2 } from "lucide-react"; // 引入 Share2 圖示
import { useArchives, useClassrooms, useMe, useUpdateArchive } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge"; // 引入 Badge 元件
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { InvitesDialog, JoinDialog } from "./JoinClassroom";
// 引入分享元件與輔助函式
import { ShareArchiveDialog, getSharedIdsFromStorage } from "./ShareArchiveDialog";

// 將 ID 對照轉換成畫面上顯示的名字
const MOCK_RECIPIENT_NAMES: Record<string, string> = {
  "member-a": "組員 A（王小安）",
  "member-b": "組員 B（李小恩）",
  "member-c": "組員 C（陳大宇）",
  "advisor-lin": "指導教授（林老師）",
};

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

export function BankPage() {
  const { kind } = useParams({ from: "/_app/bank/$kind" });
  const { data: archives = [] } = useArchives();
  const [sharingArchive, setSharingArchive] = useState<any | null>(null);

  // 強制檢查 localStorage 裡，是不是有任意題目被分享給了 member-b
  const checkIsSharedToB = () => {
    const saved = localStorage.getItem("mock_shared_map");
    if (!saved) return false;
    const map = JSON.parse(saved);
    // 只要有任何一個 key 的陣列裡面包含 "member-b"，就代表有分享成功
    return Object.values(map).some((ids: any) => Array.isArray(ids) && ids.includes("member-b"));
  };

  const currentUserId = localStorage.getItem("demo_current_user") || "member-a";
  const hasSharedTopic = checkIsSharedToB();

  // 正常資料過濾
  const items = archives.filter((a: any) => a.bank === kind);

  return (
    <div className="mx-auto max-w-3xl p-8">
      {/* Demo 專用小工具 */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-bg-2 p-3 text-xs">
        <span className="text-ink-dim">
          Demo 當前模擬身分：
          <b className="ml-1 text-bronze">
            {currentUserId === "member-b" ? "組員 B（李小恩）" : "我（王小安）"}
          </b>
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-[11px]"
          onClick={() => {
            localStorage.setItem("demo_current_user", currentUserId === "member-a" ? "member-b" : "member-a");
            window.location.reload();
          }}
        >
          切換身分
        </Button>
      </div>

      <p className="text-xs text-bronze">{kind === "private" ? "只有你看得到" : "大家都看得到"}</p>
      <h2 className="mb-6 font-serif text-2xl">{kind === "private" ? "私人題庫" : "公開題庫"}</h2>
      
      {/* 💡 【情境 A：我是王小安】正常渲染原本所有的私人題目 */}
      {kind === "private" && currentUserId === "member-a" && items.map((a: any) => {
        const saved = localStorage.getItem("mock_shared_map");
        const map = saved ? JSON.parse(saved) : {};
        const currentSharedIds = map[a.id] || [];

        return (
          <Card key={a.id} className="mb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-base">{a.title}</h3>
                <p className="mt-1 text-sm text-ink-dim">{a.snippet}</p>
                {currentSharedIds.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-dim">
                    <span className="text-ink-faint">已分享給：</span>
                    {currentSharedIds.map((id: string) => (
                      <Badge key={id} tone="bronze" className="text-[11.5px]">
                        {MOCK_RECIPIENT_NAMES[id] || id}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setSharingArchive(a)}
                className="shrink-0 gap-1.5 hover:border-bronze hover:text-bronze"
              >
                <Share2 className="size-3.5 text-bronze" />
                <span>分享</span>
              </Button>
            </div>
          </Card>
        );
      })}

      {/* 💡 【情境 B：我是李小恩，且王小安有勾選分享】強行硬塞一題寫死的完美 Demo 題目！ */}
      {kind === "private" && currentUserId === "member-b" && hasSharedTopic && (
        <Card className="mb-3 border-bronze bg-bronze-soft/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] bg-bronze/20 text-bronze-dark px-1.5 py-0.5 rounded font-medium">來自王小安的分享</span>
              <h3 className="font-serif text-base mt-1.5 text-ink">複製人是否享有數位 fork 的法律生命權？</h3>
              <p className="mt-1 text-sm text-ink-dim">這是王小安在議題頁面整理出來的核心對話，目前已正式開放協作權限給你瀏覽...</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-dim">
                <span className="text-ink-faint">共享成員：</span>
                <Badge tone="bronze" className="text-[11.5px]">組員 B（李小恩）</Badge>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 如果是公開題庫，就正常顯示 */}
      {kind !== "private" && items.map((a: any) => (
        <Card key={a.id} className="mb-3">
          <h3 className="font-serif text-base">{a.title}</h3>
          <p className="mt-1 text-sm text-ink-dim">{a.snippet}</p>
        </Card>
      ))}

      {/* 處理無資料畫面 */}
      {((kind === "private" && currentUserId === "member-a" && !items.length) || 
        (kind === "private" && currentUserId === "member-b" && !hasSharedTopic)) && (
        <Card className="py-14 text-center text-sm text-ink-faint">這裡還沒有題目。到「議題」把對話加進題庫。</Card>
      )}

      <ShareArchiveDialog archive={sharingArchive} onClose={() => setSharingArchive(null)} />
    </div>
  );
}

export function ClassroomsPage() {
  const { data: me } = useMe();
  const { data: classrooms = [] } = useClassrooms();
  const teacher = me?.role === "teacher";
  const list = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const inviteCount = teacher ? 0 : classrooms.filter((c) => !c.joined).length;
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [inviting, setInviting] = useState(false);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">我的教室</h2>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-dim">{teacher ? "建立教室、邀請學生加入，之後可以在教室裡管理成員、發起辯論。" : "用老師給的邀請碼加入，或到左側「探索」找開放加入的課程。"}</p>
        </div>
        {teacher ? <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增教室</Button> : (
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => setInviting(true)}><Mail className="size-4" />待處理邀請{inviteCount > 0 && <span className="rounded-full bg-bronze px-1.5 text-[11px] font-semibold text-[#221a0c]">{inviteCount}</span>}</Button>
            <Button onClick={() => setJoining(true)}><KeyRound className="size-4" />用邀請碼加入</Button>
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }}>
            <Card className="h-full transition-colors hover:border-bronze-dim">
              <h3 className="font-serif text-lg">{c.name}</h3>
              {c.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">{c.description}</p>}
              <p className="mt-1 text-sm text-ink-faint">{c.teacherName} · {c.studentCount} 位學生</p>
            </Card>
          </Link>
        ))}
      </div>
      {!list.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有建立 any 教室，按上面「新增教室」開始吧。" : "目前還沒有加入任何教室。"}</p>}

      {teacher ? <ClassroomFormDialog open={open} onOpenChange={setOpen} /> : (
        <>
          <JoinDialog open={joining} onOpenChange={setJoining} />
          <InvitesDialog open={inviting} onOpenChange={setInviting} />
        </>
      )}
    </div>
  );
}
