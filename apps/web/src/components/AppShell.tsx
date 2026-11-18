import { useEffect, useRef, useState, type RefObject } from "react";
import { onOpenAccountSheet } from "@/lib/accountSheet";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  LogIn,
  LogOut,
  Eye,
  BookOpen,
  GraduationCap,
  MessageCircleQuestion,
  Home,
  Settings,
  Menu,
  MessageSquare,
  Moon,
  Sun,
  UserPlus,
} from "lucide-react";
import { api, type User } from "@/api";
import { SESSION_SIGNAL_KEY } from "@/api/http";
import { readActivityId } from "@/api/local";
import { ADMIN_SECTIONS, type AdminTab } from "@/lib/adminSections";
import { NotificationBell } from "@/components/Notifications";
import { SocratesCompanion } from "@/components/SocratesCompanion";
import { Button, ConfirmDialog, Initial, cn } from "@/components/ui";
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
  { to: "/chat", label: "nav_chat", icon: MessageSquare, match: ["/chat"] },
] as const;

const HALFTONE_MATCH = ["/home", "/chat", "/classrooms", "/dialogue", "/admin", "/t/", "/report", "/settings", "/join"];

const CLASSROOM_MATCH = ["/classrooms", "/join", "/dialogue", "/t/", "/report"];

function useSessionSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let checking = false;
    const check = async (force = false) => {
      if (checking || (!force && document.visibilityState !== "visible")) return;
      const before = queryClient.getQueryData<User | null>(["me"]);
      if (before === undefined) return;
      checking = true;
      try {
        const now = await api.me();
        if ((now?.id ?? null) !== (before?.id ?? null)) {
          window.location.reload();
          return;
        }
        if (
          now &&
          before &&
          (now.teacherPlan !== before.teacherPlan ||
            now.teacherMode !== before.teacherMode ||
            now.isAdmin !== before.isAdmin)
        ) {
          queryClient.setQueryData(["me"], now);
          await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
        }
      } catch {
        return;
      } finally {
        checking = false;
      }
    };
    const onVisible = () => void check();
    const onSignal = (event: StorageEvent) => {
      if (event.key === SESSION_SIGNAL_KEY) void check(true);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onSignal);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onSignal);
    };
  }, [queryClient]);
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
  const [guestLogout, setGuestLogout] = useState(false);
  const focusRestoreRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = drawerOpen || accountOpen;
    if (!open) return;
    focusRestoreRef.current = document.activeElement as HTMLElement | null;
    const target = drawerOpen ? drawerRef.current : accountRef.current;
    target?.focus();
  }, [drawerOpen, accountOpen]);

  useEffect(() => {
    if (drawerOpen || accountOpen) return;
    focusRestoreRef.current?.focus();
    focusRestoreRef.current = null;
  }, [drawerOpen, accountOpen]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      setAccountOpen(false);
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      await navigate({ to: guest ? "/login" : "/" });
    },
  });
  const guest = me.data?.guest ?? true;
  const guestActivityId = me.data ? me.data.activityId : readActivityId();
  const member = (me.data?.kind ?? "member") === "member" && !guest;
  const student = me.data?.kind === "student";
  const accountLabel =
    me.data?.kind === "student"
      ? t("account_kind_student")
      : guest
        ? t("account_kind_guest")
        : me.data?.teacherPlan === "school"
          ? t("account_plan_school", { school: me.data.schoolName ?? "" })
          : me.data?.teacherPlan === "trial"
            ? t("account_plan_trial")
            : null;
  const previewRoom = me.data?.preview ? me.data.previewClassroomId : undefined;
  useEffect(() => onOpenAccountSheet(() => setAccountOpen(true)), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close overlays on every navigation
  useEffect(() => {
    setDrawerOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  const inClassrooms = CLASSROOM_MATCH.some((prefix) => pathname.startsWith(prefix));
  const halftone = HALFTONE_MATCH.some((prefix) => pathname.startsWith(prefix));
  const listView = useRouterState({
    select: (state) => (state.location.search as { view?: string } | undefined)?.view,
  });
  const rooms = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => api.listClassrooms(),
    enabled: (member && inClassrooms) || student,
  });
  const roomId = /^\/classrooms\/([^/]+)/.exec(pathname)?.[1];
  const teachingHere = roomId
    ? rooms.data?.find((room) => room.id === roomId)?.role === "teacher"
    : pathname.startsWith("/t/") ||
      pathname.startsWith("/report") ||
      (listView === "teacher" && me.data?.teacherMode === true);

  const themeTip = t("theme_toggle");
  const inAdmin = pathname.startsWith("/admin") && me.data?.isAdmin === true;
  const adminTab =
    useRouterState({ select: (state) => (state.location.search as { tab?: AdminTab } | undefined)?.tab }) ?? "overview";
  const adminOverview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.adminOverview(),
    enabled: inAdmin,
  });
  const pendingRequests = adminOverview.data?.pendingRequests ?? 0;

  const rail = (
    <nav className="flex h-full w-[88px] flex-col items-center overflow-x-hidden overflow-y-auto border-r-[1.5px] border-ht-line bg-ht-surface py-4 font-comic-sans">
      <Link
        to={inAdmin ? "/admin" : "/home"}
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
        {previewRoom ? (
          <Link to="/classrooms/$classroomId" params={{ classroomId: previewRoom }} className={cn(NAV_BTN, NAV_ACTIVE)}>
            <Eye className="size-[19px]" />
            <span className="text-center leading-tight">{t("preview_rail")}</span>
          </Link>
        ) : inAdmin ? (
          ADMIN_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.tab}
                to="/admin"
                search={item.tab === "overview" ? {} : { tab: item.tab }}
                data-tab={item.tab}
                aria-current={adminTab === item.tab ? "page" : undefined}
                className={cn(NAV_BTN, "relative", adminTab === item.tab && NAV_ACTIVE)}
              >
                <Icon className="size-[19px]" />
                <span className="text-center leading-tight">{t(item.label)}</span>
                {item.tab === "requests" && pendingRequests > 0 && (
                  <span className="absolute top-1.5 right-3 rounded-md bg-ember px-1 py-0.5 text-[10px] font-semibold leading-none text-on-ember">
                    {pendingRequests}
                  </span>
                )}
              </Link>
            );
          })
        ) : (
          <>
            {NAV.filter(() => member).map((item) => {
              const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} className={cn(NAV_BTN, active && NAV_ACTIVE)}>
                  <Icon className="size-[19px]" />
                  <span>{t(item.label)}</span>
                </Link>
              );
            })}
            {guest ? (
              guestActivityId && (
                <Link
                  to="/dialogue"
                  search={{ activityId: guestActivityId }}
                  className={cn(NAV_BTN, pathname.startsWith("/dialogue") && NAV_ACTIVE)}
                >
                  <MessageCircleQuestion className="size-[19px]" />
                  <span>{t("nav_activity")}</span>
                </Link>
              )
            ) : student && me.data?.classroomId ? (
              <Link
                to="/classrooms/$classroomId"
                params={{ classroomId: me.data.classroomId }}
                className={cn(NAV_BTN, inClassrooms && NAV_ACTIVE)}
              >
                <BookOpen className="size-[19px]" />
                <span>{t("nav_learning")}</span>
              </Link>
            ) : (
              <>
                <Link
                  to="/classrooms"
                  search={{ view: "student" }}
                  className={cn(NAV_BTN, inClassrooms && !teachingHere && NAV_ACTIVE)}
                >
                  <BookOpen className="size-[19px]" />
                  <span>{t("nav_learning")}</span>
                </Link>
                {member && me.data?.teacherMode && (
                  <Link
                    to="/classrooms"
                    search={{ view: "teacher" }}
                    className={cn(NAV_BTN, inClassrooms && teachingHere && NAV_ACTIVE)}
                  >
                    <GraduationCap className="size-[19px]" />
                    <span>{t("nav_classrooms")}</span>
                  </Link>
                )}
              </>
            )}
            {(guest || student) && me.data && (
              <Link to="/settings" className={cn(NAV_BTN, pathname.startsWith("/settings") && NAV_ACTIVE)}>
                <Settings className="size-[19px]" />
                <span>{t("settings_title")}</span>
              </Link>
            )}
          </>
        )}
      </div>

      <div className="flex-1" />

      {guest && me.data && !previewRoom && (
        <div className="mb-3 flex w-full justify-center">
          <button type="button" data-rail="leave" onClick={() => setGuestLogout(true)} className={NAV_BTN}>
            <LogOut className="size-[19px]" />
            <span className="text-center leading-tight">{t("guest_leave_activity")}</span>
          </button>
        </div>
      )}
      {me.data?.isAdmin && !previewRoom && (
        <div className="mb-3 flex w-full justify-center">
          <Link to={inAdmin ? "/home" : "/admin"} data-rail="site" className={NAV_BTN}>
            {inAdmin ? <Eye className="size-[19px]" /> : <ShieldCheck className="size-[19px]" />}
            <span className="text-center leading-tight">{t(inAdmin ? "nav_back_to_site" : "nav_manage_site")}</span>
          </Link>
        </div>
      )}
      <div className="mb-3.5 flex flex-col items-center gap-2 pt-3">
        {me.data && <NotificationBell side="beside" className={RAIL_SQUARE_BTN} />}
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
            "flex w-full shrink-0 cursor-pointer flex-col transition-colors hover:bg-ht-hover items-center gap-[5px] border-t-2 border-dotted border-ht-dotted pt-3.5 pb-1 text-ht-ink",
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
        <TrapDialog ref={drawerRef} className="absolute inset-y-0 left-0" onClose={() => setDrawerOpen(false)}>
          {rail}
        </TrapDialog>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {me.data?.preview && <PreviewBanner classroomId={previewRoom} pathname={pathname} />}
        <main className={cn("relative min-h-0 min-w-0 flex-1 overflow-y-auto", halftone && "ht-theme")}>
          {children}
        </main>
      </div>

      <SocratesCompanion />
      <ConfirmDialog
        open={guestLogout}
        danger
        title={t("logout_guest_title")}
        body={t("logout_guest_body")}
        confirmLabel={t("logout_guest_confirm")}
        cancelLabel={t("common_cancel")}
        extra={
          <Button
            onClick={() => {
              setGuestLogout(false);
              void navigate({ to: "/login", search: { mode: "register" } });
            }}
          >
            {t("account_upgrade")}
          </Button>
        }
        onCancel={() => setGuestLogout(false)}
        onConfirm={() => {
          setGuestLogout(false);
          logout.mutate();
        }}
      />

      {accountOpen && (
        <TrapDialog
          ref={accountRef}
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
                {accountLabel && <div className="truncate text-[12px] text-ink-faint">{accountLabel}</div>}
              </div>
            </div>
          )}
          <div className="my-1 h-px bg-line" aria-hidden />
          {guest && !me.data?.preview && (
            <Link
              to="/login"
              search={{ mode: "register" }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-paper-deep"
            >
              <UserPlus className="size-4 text-ember" />
              <span className="flex-1">{t("account_upgrade")}</span>
            </Link>
          )}
          {!me.data?.preview && (
            <Link
              to="/settings"
              data-menu="settings"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-paper-deep"
            >
              <Settings className="size-4 text-ink-soft" />
              <span className="flex-1">{t("settings_title")}</span>
            </Link>
          )}
          <div className="my-1 h-px bg-line" aria-hidden />
          <button
            type="button"
            data-menu="logout"
            onClick={() => (guest && !me.data?.preview ? setGuestLogout(true) : logout.mutate())}
            disabled={logout.isPending}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-flag transition-colors hover:bg-flag-wash"
          >
            <LogOut className="size-4" />
            {guest && !me.data?.preview ? t("guest_leave_activity") : t("account_logout")}
          </button>
        </TrapDialog>
      )}
    </div>
  );
}

function PreviewBanner({ classroomId, pathname }: { classroomId?: string; pathname: string }) {
  const { t } = useI18n();
  const leave = useMutation({
    mutationFn: () => api.exitPreview(),
    onSuccess: () => {
      window.location.assign(classroomId ? `/classrooms/${classroomId}` : "/classrooms?view=teacher");
    },
  });
  const reset = useMutation({
    mutationFn: () => api.resetPreview(),
    onSuccess: () => {
      window.location.assign(classroomId ? `/classrooms/${classroomId}` : window.location.pathname);
    },
  });
  const busy = leave.isPending || reset.isPending;
  const onRoom = classroomId ? pathname === `/classrooms/${classroomId}` : true;
  return (
    <div
      role="status"
      className="flex h-11 shrink-0 items-center gap-2 bg-ink pr-2 pl-14 text-[13px] text-paper md:pl-4"
    >
      <Eye className="size-4 shrink-0 text-ember" />
      <span className="shrink-0 font-semibold">{t("preview_title")}</span>
      <span className="hidden min-w-0 truncate opacity-70 lg:inline">{t("preview_banner")}</span>
      <span className="flex-1" />
      {classroomId && !onRoom && (
        <Link
          to="/classrooms/$classroomId"
          params={{ classroomId }}
          className="hidden h-7 shrink-0 items-center rounded-full px-3 opacity-85 hover:bg-paper/10 hover:opacity-100 sm:flex"
        >
          {t("preview_back_to_room")}
        </Link>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => reset.mutate()}
        className="h-7 shrink-0 cursor-pointer rounded-full px-3 opacity-85 hover:bg-paper/10 hover:opacity-100 disabled:opacity-50"
      >
        {t("preview_reset")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => leave.mutate()}
        className="h-7 shrink-0 cursor-pointer rounded-full bg-paper px-3 font-semibold text-ink hover:brightness-95 disabled:opacity-50"
      >
        {t("preview_leave")}
      </button>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function TrapDialog({
  ref,
  className,
  onClose,
  ariaLabelledBy,
  plain,
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  className: string;
  onClose: () => void;
  ariaLabelledBy?: string;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className={cn("absolute inset-0", !plain && "anim-fade bg-black/40")} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        {...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {})}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const container = event.currentTarget;
          const focusables = [...container.querySelectorAll(FOCUSABLE)] as HTMLElement[];
          if (focusables.length === 0) return;
          const first = focusables[0]!;
          const last = focusables.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}
