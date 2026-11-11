import { useEffect, useRef, useState, type RefObject } from "react";
import { onOpenAccountSheet } from "@/lib/accountSheet";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronDown,
  Eye,
  GraduationCap,
  Hand,
  Home,
  Settings,
  Menu,
  MessageSquare,
  Moon,
  Presentation,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "@/api";
import { SocratesCompanion } from "@/components/SocratesCompanion";
import { Button, ConfirmDialog, Initial, cn } from "@/components/ui";
import { LANGS, setLocale, useI18n, type Locale } from "@/i18n";
import { companion, useCompanion } from "@/lib/companion";
import { toggleTheme, useTheme } from "@/theme";

const BARE_ROUTES = [/^\/$/, /^\/login\/?$/];

const NAV_BTN =
  "flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg py-2.5 text-[11.5px] text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink-soft";
const NAV_ACTIVE = "bg-ember-wash text-ember hover:bg-ember-wash hover:text-ember";
const RAIL_ICON_BTN =
  "flex size-9 cursor-pointer items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-ember hover:text-ember";

const NAV = [
  { to: "/home", label: "nav_home", icon: Home, match: ["/home"] },
  { to: "/chat", label: "nav_chat", icon: MessageSquare, match: ["/chat"] },
] as const;

const CLASSROOM_MATCH = ["/classrooms", "/join", "/dialogue", "/t/", "/report"];

const CLASSROOM_VIEWS = [
  { view: "student", label: "nav_learning", icon: BookOpen },
  { view: "teacher", label: "nav_teaching", icon: Presentation },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (BARE_ROUTES.some((re) => re.test(pathname))) return <>{children}</>;
  return <RailShell pathname={pathname}>{children}</RailShell>;
}

function RailShell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { visible: companionVisible } = useCompanion();
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
      await navigate({ to: "/" });
    },
  });
  const guest = me.data?.guest ?? true;
  const previewRoom = me.data?.preview ? me.data.previewClassroomId : undefined;
  useEffect(() => onOpenAccountSheet(() => setAccountOpen(true)), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close overlays on every navigation
  useEffect(() => {
    setDrawerOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  const search = useRouterState({ select: (state) => state.location.search as { view?: string } });
  const inClassrooms = CLASSROOM_MATCH.some((prefix) => pathname.startsWith(prefix));
  const [classroomsOpen, setClassroomsOpen] = useState(inClassrooms);
  useEffect(() => {
    if (inClassrooms) setClassroomsOpen(true);
  }, [inClassrooms]);

  const themeTip = t("theme_toggle");
  const helperTip = companionVisible ? t("companion_hide") : t("companion_show");

  const rail = (
    <nav className="flex h-full w-[84px] flex-col items-center border-r border-line bg-card pb-3">
      <Link
        to="/home"
        aria-label={t("app_name")}
        className="mb-2 flex h-14 w-full shrink-0 items-center justify-center border-b border-line font-serif text-[20px] text-ink"
      >
        {t("app_mark")}
      </Link>

      <div className="flex w-full flex-col gap-2 px-1.5">
        {previewRoom ? (
          <Link to="/classrooms/$classroomId" params={{ classroomId: previewRoom }} className={cn(NAV_BTN, NAV_ACTIVE)}>
            <Eye className="size-[19px]" />
            <span className="text-center leading-tight">{t("preview_rail")}</span>
          </Link>
        ) : (
          <>
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
            <button
              type="button"
              aria-expanded={classroomsOpen}
              aria-controls="rail-classrooms"
              onClick={() => setClassroomsOpen((open) => !open)}
              className={cn(NAV_BTN, inClassrooms && NAV_ACTIVE)}
            >
              <GraduationCap className="size-[19px]" />
              <span className="flex items-center gap-0.5">
                {t("nav_classrooms")}
                <ChevronDown className={cn("size-3 transition-transform", classroomsOpen && "rotate-180")} />
              </span>
            </button>
            {classroomsOpen && (
              <div id="rail-classrooms" className="flex flex-col gap-1 rounded-lg bg-paper-deep/60 p-1">
                {CLASSROOM_VIEWS.map((item) => {
                  const active =
                    pathname.replace(/\/$/, "") === "/classrooms" && (search.view ?? "student") === item.view;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.view}
                      to="/classrooms"
                      search={{ view: item.view }}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10.5px] text-ink-faint transition-colors hover:bg-paper hover:text-ink-soft",
                        active && "bg-paper text-ember hover:text-ember",
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{t(item.label)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="mb-3 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={companion.toggleVisible}
          aria-label={helperTip}
          aria-pressed={companionVisible}
          title={helperTip}
          className={cn(RAIL_ICON_BTN, companionVisible && "border-ember text-ember")}
        >
          <Hand className="size-[17px]" />
        </button>
        <button type="button" onClick={toggleTheme} aria-label={themeTip} title={themeTip} className={RAIL_ICON_BTN}>
          {theme === "dark" ? <Moon className="size-[17px]" /> : <Sun className="size-[17px]" />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        aria-label={t("account_title")}
        title={me.data?.name}
        className="flex w-full cursor-pointer flex-col items-center gap-1 border-t border-line pt-3 text-ink-soft hover:text-ink"
      >
        <Initial name={me.data?.name} className="size-8 text-[13px]" />
        <span className="line-clamp-1 max-w-[76px] break-all text-center text-[11px] leading-tight">
          {me.data?.name}
        </span>
      </button>
    </nav>
  );

  return (
    <div className="flex h-dvh bg-paper text-ink">
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
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
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
          className="anim-sheet absolute inset-y-0 right-0 flex w-full max-w-sm flex-col gap-3 border-l border-line bg-paper p-5 shadow-xl"
          onClose={() => setAccountOpen(false)}
        >
          <div className="flex items-center justify-between">
            <h2 id="account-title" className="font-serif text-lg">
              {t("account_title")}
            </h2>
            <button
              type="button"
              aria-label={t("common_back")}
              onClick={() => setAccountOpen(false)}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-paper-deep hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>

          {me.data && (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3 py-3">
              <Initial name={me.data.name} className="size-11 text-lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-[15px]">{me.data.name}</div>
                {guest && <div className="text-[12px] text-ink-faint">{t("account_kind_guest")}</div>}
              </div>
            </div>
          )}

          {guest && !me.data?.preview && (
            <Link
              to="/login"
              search={{ mode: "register" }}
              className="flex items-center gap-3 rounded-2xl border border-ember bg-ember-wash px-3 py-2.5 text-sm text-ink hover:brightness-105"
            >
              <UserPlus className="size-4 text-ember" />
              <span className="flex-1">
                <span className="block">{t("account_upgrade")}</span>
                <span className="block text-[12px] text-ink-soft">{t("account_upgrade_hint")}</span>
              </span>
            </Link>
          )}

          <div className="rounded-2xl border border-line bg-card px-3 py-3 text-sm">
            <div className="mb-2 text-[12.5px] text-ink-soft" id="account-lang">
              {t("settings_lang")}
            </div>
            <div
              role="radiogroup"
              aria-labelledby="account-lang"
              className="inline-flex gap-0.5 rounded-full border border-line-strong p-0.5"
            >
              {LANGS.map((l) => (
                // biome-ignore lint/a11y/useSemanticElements: language switch is a button-based radio group
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={locale === l.code}
                  lang={l.code}
                  onClick={() => setLocale(l.code as Locale)}
                  className={cn(
                    "cursor-pointer rounded-full px-3.5 py-1.5 text-[13px]",
                    locale === l.code ? "bg-ember font-semibold text-on-ember" : "text-ink-soft hover:text-ink",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {!me.data?.preview && (
            <Link
              to="/settings"
              className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2.5 text-sm hover:text-ember"
            >
              <Settings className="size-4" />
              <span className="flex-1">{t("settings_title")}</span>
              <span aria-hidden="true">›</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => (guest && !me.data?.preview ? setGuestLogout(true) : logout.mutate())}
            disabled={logout.isPending}
            className="mt-auto h-9 w-full cursor-pointer rounded-full border border-line text-sm font-medium text-flag transition-colors hover:bg-flag-wash"
          >
            {t("account_logout")}
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
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  className: string;
  onClose: () => void;
  ariaLabelledBy?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
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
