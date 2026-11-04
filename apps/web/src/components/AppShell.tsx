import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { cn } from "@/components/ui";
import { locales, setLocale, useI18n, type Locale } from "@/i18n";
import { ChartNoAxesColumn, Globe, MessageSquare, Moon, Plus, Settings, SquareActivity, Sun, User } from "lucide-react";
import { toggleTheme, useTheme } from "@/theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const nav = [
    { to: "/dialogue", label: t("nav_dialogue"), icon: <MessageSquare size={18} strokeWidth={1.6} /> },
    { to: "/report/current", label: t("nav_reports"), icon: <ChartNoAxesColumn size={18} strokeWidth={1.6} /> },
    ...(isTeacher
      ? [
          { to: "/t/setup", label: t("nav_setup"), icon: <Plus size={18} strokeWidth={1.6} /> },
          { to: "/t/live/current", label: t("nav_live"), icon: <SquareActivity size={18} strokeWidth={1.6} /> },
        ]
      : []),
    { to: "/settings", label: t("nav_settings"), icon: <Settings size={18} strokeWidth={1.6} /> },
  ];

  const row =
    "flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink";
  const rowActive = "bg-paper-deep text-ink";

  function railBody() {
    return (
      <>
        <Link to="/" aria-label="home" className="flex h-9 w-9 items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-serif text-[15px] font-semibold text-paper">
            詰
          </span>
        </Link>

        <nav className="mt-4 flex flex-col items-center gap-1">
          {nav.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                aria-label={item.label}
                title={item.label}
                className={cn(row, active && rowActive)}
              >
                {item.icon}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1 pb-4">
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
            className={cn(row)}
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
            <Link to="/login" aria-label={t("login_title")} title={t("login_title")} className={cn(row)}>
              <User size={18} strokeWidth={1.6} />
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center border-r border-line/60 bg-paper py-3 md:flex">
        {railBody()}
      </aside>

      <button
        type="button"
        aria-label={t("menu_open")}
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card/90 text-ink-soft backdrop-blur md:hidden"
      >
        <MessageSquare size={18} strokeWidth={1.6} />
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-16 flex-col items-center border-r border-line bg-paper py-3">
            {railBody()}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
