import { useEffect, useState } from "react";
import { onOpenAccountSheet } from "@/lib/accountSheet";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleUserRound, GraduationCap, Home, KeyRound, Menu, MessageSquare, Moon, Sun, X } from "lucide-react";
import { api } from "@/api";
import { Initial, cn } from "@/components/ui";
import { LANGS, setLocale, useI18n, type Locale } from "@/i18n";
import { toggleTheme, useTheme } from "@/theme";

const BARE_ROUTES = [/^\/$/, /^\/login\/?$/];

const NAV_BTN =
  "flex w-[72px] flex-col items-center gap-1 rounded-md py-2.5 text-[11.5px] text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink-soft";
const NAV_ACTIVE = "bg-ember-wash text-ember hover:bg-ember-wash hover:text-ember";

const NAV = [
  { to: "/home", label: "nav_home", icon: Home, match: ["/home"] },
  { to: "/chat", label: "nav_chat", icon: MessageSquare, match: ["/chat"] },
  {
    to: "/classrooms",
    label: "nav_classrooms",
    icon: GraduationCap,
    match: ["/classrooms", "/join", "/dialogue", "/t/", "/report"],
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (BARE_ROUTES.some((re) => re.test(pathname))) return <>{children}</>;
  return <RailShell pathname={pathname}>{children}</RailShell>;
}

function RailShell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

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
  const isTeacher = me.data?.role === "teacher";
  useEffect(() => onOpenAccountSheet(() => setAccountOpen(true)), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close overlays on every navigation
  useEffect(() => {
    setDrawerOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  const themeTip = t("theme_toggle");

  const rail = (
    <nav className="flex h-full w-24 flex-col items-center gap-1 border-r border-line bg-card pb-5">
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        title={me.data?.name}
        className="mb-5 flex h-topbar w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 border-b border-line px-2"
      >
        <Initial name={me.data?.name ?? "詰"} />
        <span className="line-clamp-2 max-w-full break-all text-center font-serif text-[12.5px] leading-snug tracking-[.04em] text-ink-soft">
          {me.data?.name}
        </span>
      </button>

      {NAV.map((item) => {
        const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} className={cn(NAV_BTN, active && NAV_ACTIVE)}>
            <Icon className="size-5" />
            <span>{t(item.label)}</span>
          </Link>
        );
      })}

      <div className="flex-1" />

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={themeTip}
        title={themeTip}
        className="mb-2 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-paper-deep text-ink-soft transition-colors hover:border-ember hover:text-ember"
      >
        {theme === "dark" ? <Moon className="size-[19px]" /> : <Sun className="size-[19px]" />}
      </button>
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="flex w-[72px] cursor-pointer flex-col items-center gap-1 rounded-md border border-line-strong py-2 text-[10.5px] text-ink-faint hover:text-ink-soft"
      >
        <CircleUserRound className="size-[15px]" />
        <span>{t("account_title")}</span>
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
        className="fixed top-6 left-3 z-40 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-card text-ink-soft md:hidden"
      >
        <Menu className="size-[18px]" />
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0">{rail}</aside>
        </div>
      )}

      <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>

      {accountOpen && (
        <div className="fixed inset-0 z-50">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => setAccountOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-title"
            className="anim-sheet absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-paper p-6 shadow-xl"
          >
            <button
              type="button"
              aria-label={t("common_back")}
              onClick={() => setAccountOpen(false)}
              className="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-paper-deep hover:text-ink"
            >
              <X className="size-4" />
            </button>
            <h2 id="account-title" className="font-serif text-lg">
              {t("account_title")}
            </h2>
            <p className="mb-5 text-[13px] text-ink-faint">{t("app_sub")}</p>

            {me.data && (
              <div className="mb-4 flex items-center gap-4 rounded-2xl bg-paper-deep px-4 py-3">
                <Initial name={me.data.name} className="size-12 text-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[15px]">{me.data.name}</div>
                  <div className="text-[12.5px] text-ink-faint">
                    {t("account_role")} · {isTeacher ? t("role_teacher") : t("role_student")}
                  </div>
                </div>
              </div>
            )}

            {me.data && <NameEditor key={me.data.id} name={me.data.name} />}

            <div className="mb-4 rounded-2xl bg-paper-deep px-4 py-3 text-sm">
              <div className="mb-2" id="account-lang">
                {t("settings_lang")}
              </div>
              <div
                role="radiogroup"
                aria-labelledby="account-lang"
                className="inline-flex gap-0.5 rounded-full border border-line-strong bg-card p-0.5"
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
                      "cursor-pointer rounded-full px-4 py-1.5 text-[13px]",
                      locale === l.code ? "bg-ember font-semibold text-on-ember" : "text-ink-soft hover:text-ink",
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {isTeacher && (
              <Link
                to="/settings"
                className="mb-4 flex items-center gap-3 rounded-2xl bg-paper-deep px-4 py-3 text-sm hover:text-ember"
              >
                <KeyRound className="size-4" />
                <span className="flex-1">{t("settings_byok")}</span>
                <span aria-hidden="true">›</span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="mt-auto h-10 w-full cursor-pointer rounded-full bg-paper-deep text-sm font-medium text-flag transition-colors hover:bg-flag-wash"
            >
              {t("account_logout")}
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function NameEditor({ name }: { name: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const update = useMutation({
    mutationFn: (next: string) => api.updateMe(next),
    onSuccess: async (user) => {
      queryClient.setQueryData(["me"], user);
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    },
  });
  const changed = value.trim() !== "" && value.trim() !== name;
  return (
    <form
      className="mb-4 rounded-2xl bg-paper-deep px-4 py-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) update.mutate(value.trim());
      }}
    >
      <label htmlFor="account-display-name" className="mb-2 block">
        {t("account_name")}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="account-display-name"
          value={value}
          maxLength={40}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-full border border-line-strong bg-card px-4 text-sm text-ink outline-none focus:border-ember"
        />
        <button
          type="submit"
          disabled={!changed || update.isPending}
          className="h-9 shrink-0 cursor-pointer rounded-full bg-ember px-4 text-xs font-semibold text-on-ember disabled:opacity-50"
        >
          {t("account_save")}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">
        {update.isSuccess ? t("account_saved") : t("account_name_hint")}
      </p>
      {update.isError && <p className="mt-1 text-[12.5px] text-flag">{t("account_name_taken")}</p>}
    </form>
  );
}
