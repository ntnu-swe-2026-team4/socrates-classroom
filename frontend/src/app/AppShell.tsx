import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, GraduationCap, Home, Moon, Settings, Sun, User as UserIcon } from "lucide-react";
import { api } from "@/api";
import { keys, useMe, useUpdateMe } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, imageToAvatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LANGS, useLang, useT } from "@/i18n";
import { useTheme } from "./theme";

/** 標題列：[網址, 標題, 上方的小字（老師與學生可以不同）] */
const TITLES: [RegExp, string, (role?: string) => string][] = [
  [/^\/$/, "首頁", () => "歡迎回來"],
  [/^\/dialogue/, "對話", () => "進行中的討論"],
  [/^\/topics/, "議題", () => "對話存檔"],
  [/^\/summary/, "論點總結", () => "從「議題」加進來的對話"],
  [/^\/bank\/private/, "私人題庫", () => "只有你看得到"],
  [/^\/bank\/public/, "公開題庫", () => "大家都看得到"],
  [/^\/classrooms\/[^/]+\/activities/, "教室", () => "辯論活動"],
  [/^\/classrooms/, "教室", (r) => (r === "teacher" ? "教師工具" : "")],
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
  const t = useT();
  // 切換語言會重新載入整個畫面，這個旗標讓設定視窗在重新載入後維持開啟
  const [settings, setSettings] = useState(() => { try { return sessionStorage.getItem("reopen-settings") === "1"; } catch { return false; } });
  useEffect(() => { try { sessionStorage.removeItem("reopen-settings"); } catch { /* 沒有就算了 */ } }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 教室裡的頁面（教室、辯論、活動）自己有緊湊的標題列，不再重複顯示上方的大標題
  const inClassroom = /^\/classrooms\/[^/]+/.test(pathname) || pathname.startsWith("/dialogue");
  const hit = TITLES.find(([re]) => re.test(pathname));
  const title = hit ? t(hit[1]) : "";
  const eyebrow = hit ? t(hit[2](me?.role)) : "";
  const tip = theme === "dark" ? t("目前是黑色介面，點一下切換為白色") : t("目前是白色介面，點一下切換為黑色");
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
        <Link to="/" title={me?.name} className="mb-5 flex w-full flex-col items-center gap-1.5 border-b border-line px-2 pb-4">
          <Avatar name={me?.name} src={me?.avatarUrl} className="size-9 text-sm" />
          <span className="line-clamp-2 max-w-full break-all text-center font-serif text-[12.5px] leading-snug tracking-[.04em] text-ink-dim">{me?.name}</span>
        </Link>
        <Link to="/" className={navBtn} activeProps={navActive} activeOptions={{ exact: true }}><Home className="size-5" /><span>{t("首頁")}</span></Link>
        <NavGroup label={t("單人")} icon={<UserIcon className="size-5" />} paths={["/dialogue", "/topics", "/summary"]}>
          <Link to="/dialogue" className={sub} activeProps={navActive}>{t("對話")}</Link>
          <Link to="/topics" className={sub} activeProps={navActive}>{t("議題")}</Link>
          <Link to="/summary" className={sub} activeProps={navActive}>{t("論點總結")}</Link>
        </NavGroup>
        <NavGroup label={t("題庫")} icon={<BookOpen className="size-5" />} paths={["/bank"]}>
          <Link to="/bank/$kind" params={{ kind: "private" }} className={sub} activeProps={navActive}>{t("私人題庫")}</Link>
          <Link to="/bank/$kind" params={{ kind: "public" }} className={sub} activeProps={navActive}>{t("公開題庫")}</Link>
        </NavGroup>
        <Link to="/classrooms" className={navBtn} activeProps={navActive}><GraduationCap className="size-5" /><span>{t("教室")}</span></Link>

        <div className="flex-1" />
        <button
          type="button" onClick={toggle} aria-label={tip}
          title={tip}
          className="mb-2 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-bg-2 text-ink-dim transition-colors hover:border-bronze hover:text-bronze"
        >
          {theme === "dark" ? <Moon className="size-[19px]" /> : <Sun className="size-[19px]" />}
        </button>
        <button type="button" onClick={() => setSettings(true)} className="flex w-[72px] cursor-pointer flex-col items-center gap-1 rounded-md border border-line-strong py-2 text-[10.5px] text-ink-faint hover:text-ink-dim">
          <Settings className="size-[15px]" /><span>{t("設定")}</span>
        </button>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-col">
        {!inClassroom && <header className="flex h-16 shrink-0 items-center border-b border-line px-6">
          <div className="flex flex-col justify-center gap-0.5">
            {eyebrow && <div className="text-[11.5px] text-bronze">{eyebrow}</div>}
            <h1 className="font-serif text-lg font-medium leading-tight">{title}</h1>
          </div>
        </header>}
        <main className="relative min-h-0 flex-1 overflow-auto"><Outlet /></main>
      </div>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogTitle>{t("設定")}</DialogTitle>
          <DialogDescription>{t("帳號與介面設定")}</DialogDescription>
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm">
            <span>{t("登入身分")}</span>
            <span className="text-ink-faint">{me?.role === "teacher" ? t("教師") : t("學生")}</span>
          </div>
          <AvatarEditor name={me?.name ?? ""} src={me?.avatarUrl} />
          <LanguageSwitcher />
          <NameEditor key={String(settings) + me?.name} name={me?.name ?? ""} />
          <Button variant="danger" className="w-full bg-bg-2" onClick={logout}>{t("登出")}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 設定裡的顯示名稱：改完按「儲存」，側邊欄與教室成員表會一起更新 */
function NameEditor({ name }: { name: string }) {
  const t = useT();
  const update = useUpdateMe();
  const [value, setValue] = useState(name);
  const changed = value.trim() !== name && value.trim() !== "";
  return (
    <form className="mb-4 rounded-2xl bg-bg-2 px-4 py-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (changed) update.mutate({ name: value.trim() }); }}>
      <label htmlFor="display-name" className="mb-2 block">{t("名稱")}</label>
      <div className="flex items-center gap-2">
        <Input id="display-name" className="h-9 bg-bg-1" value={value} maxLength={20} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" size="sm" disabled={!changed || update.isPending}>{t("儲存")}</Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">{t("左側欄會顯示這個名稱，老師與同學在成員表也看得到。")}</p>
      {update.error && <p className="mt-1 text-[12.5px] text-wine">{update.error.message}</p>}
    </form>
  );
}

/** 設定裡的頭像：預設是黑色，可以上傳自己的圖片（會置中裁成正方形並縮小），也可以移除 */
function AvatarEditor({ name, src }: { name: string; src?: string | null }) {
  const t = useT();
  const update = useUpdateMe();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  async function pick(file?: File) {
    if (!file) return;
    setErr("");
    try { update.mutate({ avatarUrl: await imageToAvatar(file) }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <div className="mb-4 rounded-2xl bg-bg-2 px-4 py-3 text-sm">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={src} className="size-16 text-2xl" />
        <div className="min-w-0 flex-1">
          <div className="mb-2">{t("頭像")}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={update.isPending} onClick={() => input.current?.click()}>{t("上傳圖片")}</Button>
            {src && <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ avatarUrl: null })}>{t("移除")}</Button>}
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </div>
      </div>
      {(err || update.error) && <p className="mt-2 text-[12.5px] text-wine">{err || update.error?.message}</p>}
    </div>
  );
}

/** 設定裡的語言切換：繁體中文 / English / Español，選擇會記在這個瀏覽器 */
function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <div className="mb-4 rounded-2xl bg-bg-2 px-4 py-3 text-sm">
      <div className="mb-2" id="lang-label">{t("介面語言")}</div>
      <div role="radiogroup" aria-labelledby="lang-label" className="inline-flex gap-0.5 rounded-full border border-line-strong bg-bg-1 p-0.5">
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} lang={l.code}
            onClick={() => { if (l.code === lang) return; try { sessionStorage.setItem("reopen-settings", "1"); } catch { /* 沒有就算了 */ } setLang(l.code); }}
            className={cn("cursor-pointer rounded-full px-4 py-1.5 text-[13px]", lang === l.code ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim hover:text-ink")}>{l.label}</button>
        ))}
      </div>
    </div>
  );
}
