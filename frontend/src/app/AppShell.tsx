import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, Compass, GraduationCap, Home, Moon, Settings, Sun, User as UserIcon } from "lucide-react";
import { api } from "@/api";
import { keys, useMe } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme";

/** 標題列：[網址, 標題, 上方的小字（老師與學生可以不同）] */
const TITLES: [RegExp, string, (role?: string) => string][] = [
  [/^\/$/, "首頁", () => "歡迎回來"],
  [/^\/dialogue/, "對話", () => "進行中的討論"],
  [/^\/topics/, "議題", () => "對話存檔"],
  [/^\/summary/, "論點總結", () => "從「議題」加進來的對話"],
  [/^\/bank\/private/, "私人題庫", () => "只有你看得到"],
  [/^\/bank\/public/, "公開題庫", () => "大家都看得到"],
  [/^\/classrooms\/[^/]+\/activities/, "教室", () => "議題活動"],
  [/^\/classrooms/, "教室", (r) => (r === "teacher" ? "教師工具" : "")],
  [/^\/explore/, "探索課程", () => "開放加入的課程"],
];

const navBtn =
  "flex w-[72px] flex-col items-center gap-1 rounded-md py-2.5 text-[11.5px] text-ink-faint transition-colors hover:bg-bg-2 hover:text-ink-dim";
const navActive = { className: "!bg-bronze-soft !text-bronze" };

function NavGroup({ label, icon, children, paths }: { label: string; icon: ReactNode; children: ReactNode; paths: string[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const has = paths.some((p) => pathname.startsWith(p));
  // 自己的展開狀態：目前頁面在群組裡時會自動展開，但之後可以再點一次收起來
  const [open, setOpen] = useState(has);
  useEffect(() => { if (has) setOpen(true); }, [has]);
  const shown = open;
  return (
    <div className="flex w-full flex-col items-center gap-0.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={shown} className={cn(navBtn, has && "text-bronze")}>
        {icon}
        <span className="flex items-center gap-0.5">{label}<ChevronDown className={cn("size-3 transition-transform", shown && "rotate-180")} /></span>
      </button>
      {shown && <div className="flex flex-col items-center gap-0.5">{children}</div>}
    </div>
  );
}

const sub = "w-[72px] rounded-md py-1.5 text-center text-xs text-ink-faint hover:bg-bg-2 hover:text-ink-dim";

export function AppShell() {
  const { theme, toggle } = useTheme();
  const { data: me } = useMe();
  const [settings, setSettings] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hit = TITLES.find(([re]) => re.test(pathname));
  const title = hit?.[1] ?? "";
  const eyebrow = hit?.[2](me?.role) ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function logout() {
    await api.logout();
    qc.setQueryData(keys.me, null);
    setSettings(false);
    navigate({ to: "/login" });
  }

  return (
    <div className="grid h-full grid-cols-[96px_1fr] bg-bg text-ink">
      <nav className="flex flex-col items-center gap-1 border-r border-line bg-bg-1 py-5">
        <Link to="/" className="mb-5 flex w-full flex-col items-center gap-1.5 border-b border-line pb-4">
          <span className="flex size-[34px] items-center justify-center rounded-full border border-bronze font-serif text-[17px] text-bronze">Σ</span>
          <span className="font-serif text-[13px] tracking-[.14em] text-ink-dim">詰&nbsp;問</span>
        </Link>
        <Link to="/" className={navBtn} activeProps={navActive} activeOptions={{ exact: true }}><Home className="size-5" /><span>首頁</span></Link>
        <NavGroup label="單人" icon={<UserIcon className="size-5" />} paths={["/dialogue", "/topics", "/summary"]}>
          <Link to="/dialogue" className={sub} activeProps={navActive}>對話</Link>
          <Link to="/topics" className={sub} activeProps={navActive}>議題</Link>
          <Link to="/summary" className={sub} activeProps={navActive}>論點總結</Link>
        </NavGroup>
        <NavGroup label="題庫" icon={<BookOpen className="size-5" />} paths={["/bank"]}>
          <Link to="/bank/$kind" params={{ kind: "private" }} className={sub} activeProps={navActive}>私人題庫</Link>
          <Link to="/bank/$kind" params={{ kind: "public" }} className={sub} activeProps={navActive}>公開題庫</Link>
        </NavGroup>
        <Link to="/classrooms" className={navBtn} activeProps={navActive}><GraduationCap className="size-5" /><span>教室</span></Link>
        {me?.role === "student" && <Link to="/explore" className={navBtn} activeProps={navActive}><Compass className="size-5" /><span>探索</span></Link>}

        <div className="flex-1" />
        <button
          type="button" onClick={toggle} aria-label={theme === "dark" ? "目前是黑色介面，點一下切換為白色" : "目前是白色介面，點一下切換為黑色"}
          title={theme === "dark" ? "目前是黑色介面，點一下切換為白色" : "目前是白色介面，點一下切換為黑色"}
          className="mb-2 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-bg-2 text-ink-dim transition-colors hover:border-bronze hover:text-bronze"
        >
          {theme === "dark" ? <Moon className="size-[19px]" /> : <Sun className="size-[19px]" />}
        </button>
        <button type="button" onClick={() => setSettings(true)} className="flex w-[72px] cursor-pointer flex-col items-center gap-1 rounded-md border border-line-strong py-2 text-[10.5px] text-ink-faint hover:text-ink-dim">
          <Settings className="size-[15px]" /><span>設定</span>
        </button>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-line px-6">
          <div className="flex flex-col justify-center gap-0.5">
            {eyebrow && <div className="text-[11.5px] text-bronze">{eyebrow}</div>}
            <h1 className="font-serif text-lg font-medium leading-tight">{title}</h1>
          </div>
        </header>
        <main className="relative min-h-0 flex-1 overflow-auto"><Outlet /></main>
      </div>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>帳號與介面設定</DialogDescription>
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm">
            <span>登入身分</span>
            <span className="text-ink-faint">{me?.role === "teacher" ? "教師" : "學生"}</span>
          </div>
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm">
            <span>名稱</span>
            <span className="text-ink-faint">{me?.name}</span>
          </div>
          <Button variant="danger" className="w-full bg-bg-2" onClick={logout}>登出</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
