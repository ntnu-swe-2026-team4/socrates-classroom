import { useRef, useState } from "react";
import { useAccountSheetRequest } from "@/lib/accountSheet";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, GraduationCap, Home, LogIn, LogOut, Menu, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { api, type User } from "@/api";
import { meQueryOptions } from "@/api/me";
import { SESSION_SIGNAL_KEY } from "@/api/http";
import { Initial, TrapDialog, cn } from "@/components/ui";
import { useDomEvent } from "@/hooks/useSubscription";
import { useI18n } from "@/i18n";
import { toggleTheme, useTheme } from "@/theme";

const BARE_ROUTES = [/^\/$/, /^\/login\/?$/];

const RAIL_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion";
const NAV_BTN = cn(
  "comic-sink flex w-16 cursor-pointer flex-col items-center gap-1 border-[1.5px] border-transparent py-[9px] text-[11.5px] text-ht-soft hover:border-ht-line hover:bg-ht-hover hover:text-ht-ink",
  RAIL_FOCUS,
);
const NAV_ACTIVE =
  "border-ht-accent-line bg-ht-accent font-bold text-ht-on-accent hover:bg-ht-accent hover:text-ht-on-accent";
const RAIL_SQUARE_BTN = cn(
  "comic-sink flex size-10 cursor-pointer items-center justify-center rounded-none border-[1.5px] border-ht-line bg-ht-surface text-ht-ink hover:border-ht-line hover:bg-ht-hover hover:text-ht-ink",
  RAIL_FOCUS,
);

const NAV = [
  { to: "/home", label: "nav_home", icon: Home, match: ["/home"] },
  {
    to: "/classrooms",
    label: "nav_classrooms",
    icon: GraduationCap,
    match: ["/classrooms", "/join", "/dialogue", "/t/", "/report"],
  },
] as const;

const HALFTONE_MATCH = ["/home", "/classrooms", "/dialogue", "/admin", "/t/", "/report", "/settings", "/join"];

function useSessionSync() {
  const queryClient = useQueryClient();
  const checking = useRef(false);
  const check = async (force = false) => {
    if (checking.current || (!force && document.visibilityState !== "visible")) return;
    const before = queryClient.getQueryData<User | null>(["me"]);
    if (before === undefined) return;
    checking.current = true;
    try {
      const now = await api.me();
      if ((now?.id ?? null) !== (before?.id ?? null)) {
        window.location.reload();
        return;
      }
      if (now && before && now.isAdmin !== before.isAdmin) {
        queryClient.setQueryData(["me"], now);
        await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      }
    } catch {
      return;
    } finally {
      checking.current = false;
    }
  };
  useDomEvent(window, "focus", () => void check());
  useDomEvent(document, "visibilitychange", () => void check());
  useDomEvent(window, "storage", (event: StorageEvent) => {
    if (event.key === SESSION_SIGNAL_KEY) void check(true);
  });
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useSessionSync();
  if (BARE_ROUTES.some((re) => re.test(pathname))) return <>{children}</>;
  return <RailShell pathname={pathname}>{children}</RailShell>;
}

function RailShell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const me = useQuery(meQueryOptions);
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      setAccountOpen(false);
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      await navigate({ to: "/" });
    },
  });

  const accountRequest = useAccountSheetRequest();
  const [prevAccountRequest, setPrevAccountRequest] = useState(accountRequest);
  if (accountRequest !== prevAccountRequest) {
    setPrevAccountRequest(accountRequest);
    setAccountOpen(true);
  }

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
    setAccountOpen(false);
  }

  const inAdmin = pathname.startsWith("/admin");
  const halftone = HALFTONE_MATCH.some((prefix) => pathname.startsWith(prefix));
  const themeTip = t("theme_toggle");

  const rail = (
    <nav className="flex h-full w-[88px] flex-col items-center overflow-x-hidden overflow-y-auto border-r-[1.5px] border-ht-line bg-ht-surface py-4 font-comic-sans">
      <Link
        to="/home"
        aria-label={t("app_name")}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center bg-ht-solid font-comic-serif text-[21px] font-black text-ht-on-solid",
          RAIL_FOCUS,
        )}
      >
        {t("app_mark")}
      </Link>
      <span aria-hidden className="mt-1.5 font-dot text-[10px] tracking-[0.25em] text-ht-ink uppercase">
        {t("brand_name")}
      </span>
      <i aria-hidden className="my-3.5 block w-11 shrink-0 border-t-2 border-dotted border-ht-dotted" />

      <div className="flex flex-col items-center gap-1.5">
        {NAV.map((item) => {
          const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} className={cn(NAV_BTN, active && NAV_ACTIVE)}>
              <Icon className="size-[19px]" />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex-1" />

      {me.data?.isAdmin && (
        <div className="mb-3 flex w-full justify-center">
          <Link to={inAdmin ? "/home" : "/admin/users"} data-rail="site" className={NAV_BTN}>
            {inAdmin ? <Eye className="size-[19px]" /> : <ShieldCheck className="size-[19px]" />}
            <span className="text-center leading-tight">{t(inAdmin ? "nav_back_to_site" : "nav_manage_site")}</span>
          </Link>
        </div>
      )}
      <div className="mb-3.5 flex flex-col items-center gap-2 pt-3">
        <button type="button" onClick={toggleTheme} aria-label={themeTip} title={themeTip} className={RAIL_SQUARE_BTN}>
          {theme === "dark" ? <Moon className="size-[17px]" /> : <Sun className="size-[17px]" />}
        </button>
      </div>
      {me.data ? (
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(false);
            setAccountOpen(true);
          }}
          aria-haspopup="dialog"
          aria-label={t("account_title")}
          className={cn(
            "flex w-full shrink-0 cursor-pointer flex-col items-center gap-[5px] border-t-2 border-dotted border-ht-dotted pt-3.5 pb-1 text-ht-ink transition-colors hover:bg-ht-hover",
            RAIL_FOCUS,
          )}
        >
          <Initial
            name={me.data?.name}
            className="size-8 rounded-none bg-ht-solid font-comic-serif text-[14px] font-bold text-ht-on-solid"
          />
          <span className="line-clamp-1 max-w-[76px] break-all text-center text-[11px] leading-tight">
            {me.data?.name}
          </span>
        </button>
      ) : (
        me.isSuccess && (
          <Link
            to="/login"
            data-rail="login"
            className={cn(
              "flex w-full shrink-0 flex-col items-center gap-[5px] border-t-2 border-dotted border-ht-dotted pt-3.5 pb-2 text-ht-ink transition-colors hover:bg-ht-hover",
              RAIL_FOCUS,
            )}
          >
            <LogIn className="size-[19px]" />
            <span className="text-[11px] leading-tight">{t("login_title")}</span>
          </Link>
        )
      )}
    </nav>
  );

  return (
    <div className="flex h-dvh bg-paper text-ink [--font-serif:var(--font-sans)]">
      <aside className="relative hidden h-dvh shrink-0 md:block">{rail}</aside>

      <button
        type="button"
        aria-label={t("menu_open")}
        onClick={() => setDrawerOpen(true)}
        className="fixed top-3 left-3 z-30 flex size-8 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-card text-ink-soft md:hidden"
      >
        <Menu className="size-[17px]" />
      </button>

      {drawerOpen && (
        <TrapDialog className="absolute inset-y-0 left-0" onClose={() => setDrawerOpen(false)}>
          {rail}
        </TrapDialog>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className={cn("relative min-h-0 min-w-0 flex-1 overflow-y-auto", halftone && "ht-theme")}>
          {children}
        </main>
      </div>

      {accountOpen && (
        <TrapDialog
          ariaLabelledBy="account-title"
          plain
          className="anim-rise absolute bottom-3 left-3 flex w-64 flex-col rounded-xl border border-line bg-paper p-1.5 shadow-xl md:left-[92px]"
          onClose={() => setAccountOpen(false)}
        >
          <h2 id="account-title" className="sr-only">
            {t("account_title")}
          </h2>
          {me.data && (
            <div className="flex items-center gap-3 px-2.5 py-2.5">
              <Initial name={me.data.name} className="size-9 text-[14px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{me.data.name}</div>
              </div>
            </div>
          )}
          <div className="my-1 h-px bg-line" aria-hidden />
          <Link
            to="/settings"
            data-menu="settings"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-paper-deep"
          >
            <Settings className="size-4 text-ink-soft" />
            <span className="flex-1">{t("settings_title")}</span>
          </Link>
          <div className="my-1 h-px bg-line" aria-hidden />
          <button
            type="button"
            data-menu="logout"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-flag transition-colors hover:bg-flag-wash"
          >
            <LogOut className="size-4" />
            {t("account_logout")}
          </button>
        </TrapDialog>
      )}
    </div>
  );
}
