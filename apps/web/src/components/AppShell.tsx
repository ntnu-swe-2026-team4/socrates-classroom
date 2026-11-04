import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesColumn,
  Globe,
  MessageSquare,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  SquareActivity,
  Sun,
  User,
} from "lucide-react";
import { api } from "@/api";
import { cn } from "@/components/ui";
import { locales, setLocale, useI18n, type Locale } from "@/i18n";
import { toggleTheme, useTheme } from "@/theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      queryClient.setQueryData(["me"], null);
      await navigate({ to: "/" });
    },
  });

  const isTeacher = me.data?.role === "teacher";

  const actions = [
    { to: "/dialogue", label: t("nav_dialogue"), icon: <MessageSquare size={17} strokeWidth={1.6} /> },
    { to: "/report/current", label: t("nav_reports"), icon: <ChartNoAxesColumn size={17} strokeWidth={1.6} /> },
    ...(isTeacher
      ? [
          { to: "/t/setup", label: t("nav_setup"), icon: <Plus size={17} strokeWidth={1.6} /> },
          { to: "/t/live/current", label: t("nav_live"), icon: <SquareActivity size={17} strokeWidth={1.6} /> },
        ]
      : []),
    { to: "/settings", label: t("nav_settings"), icon: <Settings size={17} strokeWidth={1.6} /> },
  ];

  const recent = [
    { title: "電車難題", when: locale === "zh" ? "今天" : locale === "en" ? "Today" : "Hoy" },
    { title: "努力的報酬", when: locale === "zh" ? "本週" : locale === "en" ? "This week" : "Esta semana" },
  ];

  const row =
    "flex h-9 items-center gap-2.5 rounded-xl text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink";
  const rowActive = "bg-paper-deep text-ink";

  function railCollapsed() {
    return (
      <>
        <button
          type="button"
          aria-label={t("menu_open")}
          title={t("menu_open")}
          onClick={() => setExpanded(true)}
          className={cn(row, "text-ink-faint")}
        >
          <PanelLeft size={18} strokeWidth={1.6} />
        </button>

        <Link to="/" aria-label="home" title={t("app_name")} className="mt-2 flex h-9 w-9 items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-serif text-[15px] font-semibold text-paper">
            詰
          </span>
        </Link>

        <nav className="mt-4 flex flex-col items-center gap-1">
          {actions.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                title={item.label}
                className={cn(row, active && rowActive)}
              >
                {item.icon}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setLocaleOpen((v) => !v)}
              aria-label={t("settings_lang")}
              title={`${t("settings_lang")} · ${locale.toUpperCase()}`}
              className={cn(row, localeOpen && rowActive)}
            >
              <Globe size={18} strokeWidth={1.6} />
            </button>
            {localeOpen && (
              <div
                role="listbox"
                className="absolute bottom-11 left-0 z-50 flex flex-col rounded-xl border border-line bg-card p-1 shadow-sm"
              >
                {locales.map((l: Locale) => (
                  <button
                    key={l}
                    type="button"
                    role="option"
                    aria-selected={l === locale}
                    onClick={() => {
                      setLocale(l);
                      setLocaleOpen(false);
                    }}
                    className={cn(
                      "rounded-lg px-4 py-1.5 text-left text-[13px]",
                      l === locale ? "bg-paper-deep font-medium text-ink" : "text-ink-soft",
                    )}
                  >
                    {l === "zh" ? "繁體中文" : l === "en" ? "English" : "Español"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t("theme_toggle")}
            title={t("theme_toggle")}
            className={row}
          >
            {theme === "dark" ? <Sun size={18} strokeWidth={1.6} /> : <Moon size={18} strokeWidth={1.6} />}
          </button>

          {me.data ? (
            <button
              type="button"
              onClick={() => logout.mutate()}
              title={`${me.data.name} · ${t("account_logout")}`}
              aria-label={`${me.data.name} · ${t("account_logout")}`}
              className="flex h-9 w-9 items-center justify-center"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ember-wash font-serif text-[13px] text-ember">
                {me.data.name.slice(0, 1)}
              </span>
            </button>
          ) : (
            <Link to="/login" aria-label={t("login_title")} title={t("login_title")} className={row}>
              <User size={18} strokeWidth={1.6} />
            </Link>
          )}
        </div>
      </>
    );
  }

  function drawerBody() {
    return (
      <>
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-[15px] font-semibold text-paper">
            詰
          </span>
          <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold text-ink">{t("app_name")}</span>
          <button
            type="button"
            aria-label={t("menu_open")}
            title={t("menu_open")}
            onClick={() => setExpanded(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {actions.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={cn(row, "pl-[22px] pr-3 text-[13.5px]", active && rowActive)}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-ink-faint uppercase">
            {t("nav_recent")}
          </p>
          <ul className="flex flex-col gap-0.5 overflow-y-auto">
            {recent.map((item) => (
              <li key={item.title}>
                <Link
                  to="/dialogue"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-baseline justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-paper-deep hover:text-ink"
                >
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{item.when}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line/60 p-3">
          {me.data ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-wash font-serif text-[13px] text-ember">
                {me.data.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{me.data.name}</span>
              <button
                type="button"
                onClick={() => logout.mutate()}
                className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink-faint hover:bg-paper-deep hover:text-ink"
              >
                {t("account_logout")}
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              onClick={() => setDrawerOpen(false)}
              className={cn(row, "flex-1 pl-[22px] pr-3 text-[13.5px]")}
            >
              <User size={17} strokeWidth={1.6} />
              <span>{t("login_title")}</span>
            </Link>
          )}
          <div className="flex shrink-0 items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLocaleOpen((v) => !v)}
                aria-label={t("settings_lang")}
                title={`${t("settings_lang")} · ${locale.toUpperCase()}`}
                className={cn(row, "w-9 justify-center")}
              >
                <Globe size={17} strokeWidth={1.6} />
              </button>
              {localeOpen && (
                <div
                  role="listbox"
                  className="absolute bottom-11 left-0 z-50 flex flex-col rounded-xl border border-line bg-card p-1 shadow-sm"
                >
                  {locales.map((l: Locale) => (
                    <button
                      key={l}
                      type="button"
                      role="option"
                      aria-selected={l === locale}
                      onClick={() => {
                        setLocale(l);
                        setLocaleOpen(false);
                      }}
                      className={cn(
                        "rounded-lg px-4 py-1.5 text-left text-[13px]",
                        l === locale ? "bg-paper-deep font-medium text-ink" : "text-ink-soft",
                      )}
                    >
                      {l === "zh" ? "繁體中文" : l === "en" ? "English" : "Español"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t("theme_toggle")}
              title={t("theme_toggle")}
              className={cn(row, "w-9 justify-center")}
            >
              {theme === "dark" ? <Sun size={17} strokeWidth={1.6} /> : <Moon size={17} strokeWidth={1.6} />}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line/60 bg-paper transition-[width] duration-200 md:flex",
          expanded ? "w-72" : "w-16 items-center py-3",
        )}
      >
        {expanded ? drawerBody() : railCollapsed()}
      </aside>

      <button
        type="button"
        aria-label={t("menu_open")}
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card/90 text-ink-soft backdrop-blur md:hidden"
      >
        <PanelLeft size={18} strokeWidth={1.6} />
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-paper">
            {drawerBody()}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
